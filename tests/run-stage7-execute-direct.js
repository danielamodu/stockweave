/**
 * Stage 7 verifier — REAL on-chain rebalance EXECUTE on Devnet (no IDL, hand-encoded).
 * Proves execute_rebalance actually MOVES mirror tokens (no longer a no-op record):
 *   set_asset_price → propose_rebalance → approve_rebalance → execute_rebalance
 * execute BURNS `asset_qty` of the mirror asset from the creator (creator signs)
 * and TRANSFERS the proposal's `notional` (whole USDC → 6 dp) from the strategy
 * treasury back to the creator (vault PDA signs) — atomically. Shares out, cash in.
 * The burn qty is now BOUND to the published on-chain price (D-703): burning too
 * little for the notional payout is rejected (PriceOutOfBounds), so the treasury
 * can't be drained. A NEGATIVE case proves exactly that before the real trim runs.
 *
 * The script first publishes the price, then faucets USDC + subscribes a leg so the
 * creator provably holds the asset and the treasury holds USDC, then measures balances
 * immediately BEFORE and AFTER the execute so the asserted deltas isolate the trim
 * (re-runs still PASS — earlier balances just accumulate). Writes tests/stage07-evidence.json.
 *
 * Env: ANCHOR_WALLET (creator keypair — also the strategy's agent), HELIUS_RPC |
 * ANCHOR_PROVIDER_URL (RPC). The creator is the deploy wallet (OFFICIAL_CREATOR).
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const anchor = require("@coral-xyz/anchor");
const { Connection, PublicKey, Keypair, TransactionInstruction, Transaction, SystemProgram, sendAndConfirmTransaction } =
  anchor.web3;

const RPC = process.env.HELIUS_RPC || process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com";
const WALLET = process.env.ANCHOR_WALLET;
if (!WALLET) throw new Error("Set ANCHOR_WALLET to the creator keypair path");

const PROGRAM_ID = new PublicKey("EVx3g8ooCpshuemiNz3bt3vqoYapu7XjPab86BbnrgYN");
const OFFICIAL_CREATOR = new PublicKey("3jNEVjYZtMKHShfPLmS7tH8oKNngd42bU3sX7AJ1yxQD");
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const BASKET_ID = "ai-infrastructure";
const TRIM_SYMBOL = "OPENAI";

function disc(name) { return crypto.createHash("sha256").update(`global:${name}`).digest().subarray(0, 8); }
function u16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n, 0); return b; }
function u64(n) { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n), 0); return b; }
function i64(n) { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n), 0); return b; }
function pda(seeds) { return PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0]; }
function ata(owner, mint) {
  return PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()], ATA_PROGRAM_ID)[0];
}
async function bal(connection, addr) {
  try { return (await connection.getTokenAccountBalance(addr)).value.uiAmount ?? 0; } catch { return 0; }
}
async function main() {
  const connection = new Connection(RPC, "confirmed");
  const creator = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(WALLET, "utf-8"))));
  const reg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "web", "lib", "devnet-mints.json"), "utf-8"));
  if (!reg.usdc || !reg.usdc.mint || !reg.assets[TRIM_SYMBOL]) throw new Error("Mirror mints not seeded — run tests/seed-devnet-mints.js");
  const usdcMint = new PublicKey(reg.usdc.mint);
  const assetMint = new PublicKey(reg.assets[TRIM_SYMBOL].mint);
  const vault = pda([Buffer.from("vault")]);
  const strategy = pda([Buffer.from("strategy"), OFFICIAL_CREATOR.toBuffer(), Buffer.from(BASKET_ID)]);
  const asset = pda([Buffer.from("asset"), strategy.toBuffer(), assetMint.toBuffer()]);
  const assetPrice = pda([Buffer.from("price"), strategy.toBuffer(), assetMint.toBuffer()]);
  const rulesPk = pda([Buffer.from("rules"), strategy.toBuffer()]);
  const permission = pda([Buffer.from("permission"), strategy.toBuffer(), creator.publicKey.toBuffer()]);
  const creatorAsset = ata(creator.publicKey, assetMint);
  const creatorUsdc = ata(creator.publicKey, usdcMint);
  const treasuryUsdc = ata(vault, usdcMint);
  const sys = SystemProgram.programId;

  // Read the on-chain rules so the proposal is guaranteed to satisfy every guard
  // (feed id, weight caps, notional caps) instead of guessing.
  const rInfo = await connection.getAccountInfo(rulesPk);
  if (!rInfo) throw new Error("Strategy rules missing — run tests/seed-onchain-strategy.js");
  const rb = rInfo.data;
  const reserveBps = rb.readUInt16LE(40);
  const maxSingleBps = rb.readUInt16LE(44);
  const maxTradeNotional = Number(rb.readBigUInt64LE(46));
  const feedId = rb.subarray(70, 102);
  const pInfo = await connection.getAccountInfo(permission);
  const maxNotionalPerAction = pInfo ? Number(pInfo.data.readBigUInt64LE(105)) : maxTradeNotional;

  const now = Math.floor(Date.now() / 1000);
  const proposalId = BigInt(Date.now());
  const nonce = proposalId;
  const notional = Math.max(1, Math.min(5, maxTradeNotional, maxNotionalPerAction));
  const newTargetWeightBps = Math.min(1000, maxSingleBps);
  const proposalPk = pda([Buffer.from("proposal"), strategy.toBuffer(), u64(proposalId)]);

  console.log("creator: ", creator.publicKey.toBase58());
  console.log("strategy:", strategy.toBase58());
  console.log("asset:   ", TRIM_SYMBOL, assetMint.toBase58());
  console.log("proposal:", proposalPk.toBase58(), "id", proposalId.toString());
  console.log(`args:     notional=$${notional} newTargetBps=${newTargetWeightBps} reserveBps=${reserveBps}`);

  // 0) Guarantee state: publish the on-chain price the execute is bound to (D-703),
  //    then faucet USDC + subscribe one leg so the creator holds the asset (to burn)
  //    and the treasury holds USDC (to pay out). $100.00 per OPENAI → price_u=100e6.
  const PRICE_U = 100_000_000; // USDC base units (6dp) per whole 9dp token
  const setPriceIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: strategy, isSigner: false, isWritable: false },
      { pubkey: assetMint, isSigner: false, isWritable: false },
      { pubkey: asset, isSigner: false, isWritable: false },
      { pubkey: assetPrice, isSigner: false, isWritable: true },
      { pubkey: creator.publicKey, isSigner: true, isWritable: true },
      { pubkey: sys, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([disc("set_asset_price"), u64(PRICE_U)]),
  });
  const priceSig = await sendAndConfirmTransaction(connection, new Transaction().add(setPriceIx), [creator], { commitment: "confirmed" });
  console.log("set price tx:", priceSig, "· $" + (PRICE_U / 1e6).toFixed(2) + "/" + TRIM_SYMBOL);

  const faucetIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: usdcMint, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: false },
      { pubkey: creator.publicKey, isSigner: true, isWritable: true },
      { pubkey: creatorUsdc, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ATA_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: sys, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([disc("faucet_usdc"), u64(200_000_000)]),
  });
  const subIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: strategy, isSigner: false, isWritable: false },
      { pubkey: assetMint, isSigner: false, isWritable: true },
      { pubkey: usdcMint, isSigner: false, isWritable: false },
      { pubkey: asset, isSigner: false, isWritable: false },
      { pubkey: assetPrice, isSigner: false, isWritable: false },
      { pubkey: vault, isSigner: false, isWritable: false },
      { pubkey: creator.publicKey, isSigner: true, isWritable: true },
      { pubkey: creatorAsset, isSigner: false, isWritable: true },
      { pubkey: creatorUsdc, isSigner: false, isWritable: true },
      { pubkey: treasuryUsdc, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ATA_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: sys, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([disc("subscribe"), u64(100_000_000), u64(1_000_000_000)]),
  });
  const setupSig = await sendAndConfirmTransaction(connection, new Transaction().add(faucetIx).add(subIx), [creator], { commitment: "confirmed" });
  console.log("setup tx (faucet+subscribe):", setupSig);
  // 1) propose_rebalance — the constrained agent (here the creator) signs a trim.
  const proposeArgs = Buffer.concat([
    u64(proposalId),
    assetMint.toBuffer(),
    u16(newTargetWeightBps),
    u16(reserveBps), // projected_reserve_bps ≥ reserve_weight_bps
    u64(notional),
    Buffer.from([1]), // reason_code
    Buffer.from(feedId), // must equal rules.reference_feed_id
    i64(100), // oracle_price (unchecked value)
    i64(now - 2), // oracle_publish_time (fresh, ≤ cluster now)
    u64(nonce),
    i64(now + 3600), // expires_at
  ]);
  const proposeIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: strategy, isSigner: false, isWritable: false },
      { pubkey: rulesPk, isSigner: false, isWritable: false },
      { pubkey: permission, isSigner: false, isWritable: false },
      { pubkey: proposalPk, isSigner: false, isWritable: true },
      { pubkey: creator.publicKey, isSigner: true, isWritable: true },
      { pubkey: sys, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([disc("propose_rebalance"), proposeArgs]),
  });
  const proposeSig = await sendAndConfirmTransaction(connection, new Transaction().add(proposeIx), [creator], { commitment: "confirmed" });
  console.log("propose tx: ", proposeSig);

  // 2) approve_rebalance — creator approves, bound to the exact nonce.
  const approveIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: strategy, isSigner: false, isWritable: false },
      { pubkey: proposalPk, isSigner: false, isWritable: true },
      { pubkey: creator.publicKey, isSigner: true, isWritable: false },
    ],
    data: Buffer.concat([disc("approve_rebalance"), u64(nonce)]),
  });
  const approveSig = await sendAndConfirmTransaction(connection, new Transaction().add(approveIx), [creator], { commitment: "confirmed" });
  console.log("approve tx: ", approveSig);

  // Snapshot immediately before execute so the asserted deltas isolate the trim.
  const midAsset = await bal(connection, creatorAsset);
  const midUsdc = await bal(connection, creatorUsdc);
  const midTreasury = await bal(connection, treasuryUsdc);
  console.log(`before execute: ${TRIM_SYMBOL}=${midAsset} USDC=${midUsdc} treasury=${midTreasury}`);

  // Shared account list for execute (positive + negative differ only in asset_qty).
  // asset_price is bound in right after the asset PDA — it's what the burn qty must honor.
  const execKeys = [
    { pubkey: strategy, isSigner: false, isWritable: false },
    { pubkey: proposalPk, isSigner: false, isWritable: true },
    { pubkey: asset, isSigner: false, isWritable: false },
    { pubkey: assetPrice, isSigner: false, isWritable: false },
    { pubkey: assetMint, isSigner: false, isWritable: true },
    { pubkey: usdcMint, isSigner: false, isWritable: false },
    { pubkey: vault, isSigner: false, isWritable: false },
    { pubkey: creator.publicKey, isSigner: true, isWritable: true },
    { pubkey: creatorAsset, isSigner: false, isWritable: true },
    { pubkey: creatorUsdc, isSigner: false, isWritable: true },
    { pubkey: treasuryUsdc, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: ATA_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: sys, isSigner: false, isWritable: false },
  ];
  const mkExecuteIx = (qty) => new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: execKeys,
    data: Buffer.concat([disc("execute_rebalance"), u64(qty)]),
  });

  // At $100/token, returning `notional` whole USDC must burn notional*1e7 base units
  // (notional*1e6 USDC base units × 1e9 scale ÷ price_u). The guard binds qty↔notional.
  const assetQtyTrim = Number((BigInt(notional) * BigInt(1_000_000) * BigInt(1_000_000_000)) / BigInt(PRICE_U));

  // 3a) NEGATIVE: keep the full `notional` USDC payout but try to burn a token dust
  // (0.0001 asset). This is the exact exploit the guard exists for — draining the
  // treasury while burning ~0 shares. It MUST revert, leaving the proposal Approved.
  let rejected = false;
  let rejectErr = "";
  const gamedQty = 100_000; // 0.0001 asset — ~nothing burned for a full-notional payout
  try {
    const badSig = await sendAndConfirmTransaction(connection, new Transaction().add(mkExecuteIx(gamedQty)), [creator], { commitment: "confirmed" });
    console.log("gamed execute (SHOULD NOT LAND):", badSig);
  } catch (e) {
    rejected = true;
    rejectErr = e && e.message ? e.message.split("\n")[0] : String(e);
    console.log("gamed execute rejected on-chain ✓ —", rejectErr);
  }
  // Proposal must still be Approved (1), not Executed — the reverted attempt can't consume it.
  const gInfo = await connection.getAccountInfo(proposalPk);
  const gStatus = gInfo ? gInfo.data.readUInt8(189) : -1;
  const gAsset = await bal(connection, creatorAsset);
  const gTreasury = await bal(connection, treasuryUsdc);
  const okRejected = rejected && gStatus === 1 && Math.abs(gAsset - midAsset) < 1e-6 && Math.abs(gTreasury - midTreasury) < 1e-6;

  // 3b) execute_rebalance — REAL trim: burn assetQtyTrim from creator, return notional USDC.
  const executeSig = await sendAndConfirmTransaction(connection, new Transaction().add(mkExecuteIx(assetQtyTrim)), [creator], { commitment: "confirmed" });
  console.log("execute tx: ", executeSig, "· burn", assetQtyTrim / 1e9, TRIM_SYMBOL, "for $" + notional);

  const afterAsset = await bal(connection, creatorAsset);
  const afterUsdc = await bal(connection, creatorUsdc);
  const afterTreasury = await bal(connection, treasuryUsdc);
  console.log(`after execute:  ${TRIM_SYMBOL}=${afterAsset} USDC=${afterUsdc} treasury=${afterTreasury}`);

  const burnedUi = assetQtyTrim / 1e9;
  const okBurn = Math.abs(midAsset - burnedUi - afterAsset) < 1e-6;
  const okUsdc = Math.abs(afterUsdc - midUsdc - notional) < 1e-6;
  const okTreasury = Math.abs(midTreasury - notional - afterTreasury) < 1e-6;
  // Confirm the proposal is now Executed (status byte @ offset 189).
  const propInfo = await connection.getAccountInfo(proposalPk);
  const status = propInfo ? propInfo.data.readUInt8(189) : -1;
  const okStatus = status === 2;
  const pass = okBurn && okUsdc && okTreasury && okStatus && okRejected;
  console.log(pass ? "\nPASS — real trim moved tokens + price-guard rejected the drained-treasury attempt." : `\nFAIL — burn:${okBurn} usdc:${okUsdc} treasury:${okTreasury} status:${okStatus}(${status}) rejected:${okRejected}`);

  const evidence = {
    stage: "7-devnet-execute-rebalance",
    programId: PROGRAM_ID.toBase58(),
    upgradeTx: "3mSTDS4rgDYZMmpbb3WLvDn7qY35d92GiGHmBhDf1FrARzFFiHmrU6ehjctVCmk1SBoizovAiNnuBriMyXNt2xKz",
    creator: creator.publicKey.toBase58(),
    basket: BASKET_ID,
    symbol: TRIM_SYMBOL,
    assetMint: assetMint.toBase58(),
    usdcMint: usdcMint.toBase58(),
    strategy: strategy.toBase58(),
    proposal: proposalPk.toBase58(),
    proposalId: proposalId.toString(),
    vault: vault.toBase58(),
    treasuryUsdc: treasuryUsdc.toBase58(),
    notional,
    priceU: PRICE_U,
    priceUsd: PRICE_U / 1e6,
    assetBurned: burnedUi,
    gamed: { qty: gamedQty, rejected, rejectErr, proposalStatusAfter: gStatus, balancesUnchanged: okRejected },
    setPriceTx: priceSig,
    setupTx: setupSig,
    proposeTx: proposeSig,
    approveTx: approveSig,
    executeTx: executeSig,
    proposalStatus: status,
    balances: { midAsset, afterAsset, midUsdc, afterUsdc, midTreasury, afterTreasury },
    pass,
    ts: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(__dirname, "stage07-evidence.json"), JSON.stringify(evidence, null, 2) + "\n");
  if (!pass) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
