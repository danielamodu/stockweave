/**
 * Stage 10 / D-705 verifier — REAL on-chain SELL (redeem) round-trip on Devnet
 * (no IDL, hand-encoded). redeem is the mirror image of subscribe: burn the mirror
 * asset from the holder, pay USDC back from the strategy treasury at the published
 * price (vault PDA authority; NO server key). This is the EXIT path — what lets a
 * follower turn shares back into cash, not just buy in.
 *
 * Flow (all real Devnet txns):
 *   faucet_usdc     → give the seller test-USDC so it can buy in first
 *   set_asset_price → creator publishes the price redeem is bound to (D-703)
 *   subscribe       → seller buys 1.0 asset (guarantees holdings + a funded treasury)
 *   redeem          → seller burns 0.5 asset, receives $50 back from the treasury
 * Positive assertions use before+delta on the REDEEM alone (isolated), so re-runs
 * still PASS. A NEGATIVE case then tries to redeem more than the treasury can pay
 * and asserts the on-chain solvency guard (InsufficientTreasury) rejects it BEFORE
 * burning, with no balance movement. Writes tests/stage10-redeem-evidence.json.
 *
 * Env: ANCHOR_WALLET (seller keypair = OFFICIAL_CREATOR, so it can publish price),
 *      HELIUS_RPC | ANCHOR_PROVIDER_URL (RPC).
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const anchor = require("@coral-xyz/anchor");
const { Connection, PublicKey, Keypair, TransactionInstruction, Transaction, SystemProgram, sendAndConfirmTransaction } =
  anchor.web3;

const RPC = process.env.HELIUS_RPC || process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com";
const WALLET = process.env.ANCHOR_WALLET;
if (!WALLET) throw new Error("Set ANCHOR_WALLET to the seller keypair path");

const PROGRAM_ID = new PublicKey("EVx3g8ooCpshuemiNz3bt3vqoYapu7XjPab86BbnrgYN");
const OFFICIAL_CREATOR = new PublicKey("3jNEVjYZtMKHShfPLmS7tH8oKNngd42bU3sX7AJ1yxQD");
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const BASKET_ID = "ai-infrastructure";
const SELL_SYMBOL = "OPENAI";

function disc(name) { return crypto.createHash("sha256").update(`global:${name}`).digest().subarray(0, 8); }
function u64(n) { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n), 0); return b; }
function pda(seeds) { return PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0]; }
function ata(owner, mint) {
  return PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()], ATA_PROGRAM_ID)[0];
}
async function bal(connection, addr) {
  try { return (await connection.getTokenAccountBalance(addr)).value.uiAmount ?? 0; } catch { return 0; }
}
// Send one instruction, retrying only TRANSIENT RPC/network faults (Helius sits
// behind Cloudflare and intermittently times out). Real program errors — a failed
// require! like InsufficientTreasury — are NOT retried; they surface immediately so
// the negative case below still asserts the guard fired.
async function send(connection, ix, signer) {
  let lastErr;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      return await sendAndConfirmTransaction(connection, new Transaction().add(ix), [signer], { commitment: "confirmed" });
    } catch (e) {
      const msg = (e && e.message) || String(e);
      const transient = /fetch failed|ETIMEDOUT|ENETUNREACH|blockhash not found|block height exceeded|429|timed out|socket hang up/i.test(msg);
      lastErr = e;
      if (!transient) throw e;
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
  throw lastErr;
}
async function main() {
  const connection = new Connection(RPC, "confirmed");
  const seller = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(WALLET, "utf-8"))));
  const reg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "web", "lib", "devnet-mints.json"), "utf-8"));
  if (!reg.usdc || !reg.usdc.mint || !reg.assets[SELL_SYMBOL]) throw new Error("Mirror mints not seeded — run tests/seed-devnet-mints.js");
  const usdcMint = new PublicKey(reg.usdc.mint);
  const assetMint = new PublicKey(reg.assets[SELL_SYMBOL].mint);
  const vault = pda([Buffer.from("vault")]);
  const strategy = pda([Buffer.from("strategy"), OFFICIAL_CREATOR.toBuffer(), Buffer.from(BASKET_ID)]);
  const asset = pda([Buffer.from("asset"), strategy.toBuffer(), assetMint.toBuffer()]);
  const assetPrice = pda([Buffer.from("price"), strategy.toBuffer(), assetMint.toBuffer()]);
  const sellerUsdc = ata(seller.publicKey, usdcMint);
  const sellerAsset = ata(seller.publicKey, assetMint);
  const treasuryUsdc = ata(vault, usdcMint);
  const sys = SystemProgram.programId;

  console.log("seller:  ", seller.publicKey.toBase58());
  console.log("strategy:", strategy.toBase58());
  console.log("asset:   ", SELL_SYMBOL, assetMint.toBase58());

  const PRICE_U = 100_000_000; // $100.00 per whole token (USDC base units, 6 dp)

  // --- setup: faucet + publish price + buy in, so the seller holds the asset and
  // the treasury is funded. Same instructions proven in Stage 6; the redeem
  // assertions below are isolated to the redeem call via before+delta.
  const faucetIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: usdcMint, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: false },
      { pubkey: seller.publicKey, isSigner: true, isWritable: true },
      { pubkey: sellerUsdc, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ATA_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: sys, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([disc("faucet_usdc"), u64(1_000_000_000)]),
  });
  const faucetSig = await send(connection, faucetIx, seller);
  console.log("faucet tx:   ", faucetSig);
  const setPriceIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: strategy, isSigner: false, isWritable: false },
      { pubkey: assetMint, isSigner: false, isWritable: false },
      { pubkey: asset, isSigner: false, isWritable: false },
      { pubkey: assetPrice, isSigner: false, isWritable: true },
      { pubkey: seller.publicKey, isSigner: true, isWritable: true },
      { pubkey: sys, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([disc("set_asset_price"), u64(PRICE_U)]),
  });
  const priceSig = await send(connection, setPriceIx, seller);
  console.log("set price tx:", priceSig, "· $" + (PRICE_U / 1e6).toFixed(2) + "/" + SELL_SYMBOL);

  const subIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: strategy, isSigner: false, isWritable: false },
      { pubkey: assetMint, isSigner: false, isWritable: true },
      { pubkey: usdcMint, isSigner: false, isWritable: false },
      { pubkey: asset, isSigner: false, isWritable: false },
      { pubkey: assetPrice, isSigner: false, isWritable: false },
      { pubkey: vault, isSigner: false, isWritable: false },
      { pubkey: seller.publicKey, isSigner: true, isWritable: true },
      { pubkey: sellerAsset, isSigner: false, isWritable: true },
      { pubkey: sellerUsdc, isSigner: false, isWritable: true },
      { pubkey: treasuryUsdc, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ATA_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: sys, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([disc("subscribe"), u64(100_000_000), u64(1_000_000_000)]),
  });
  const subSig = await send(connection, subIx, seller);
  console.log("subscribe tx:", subSig, "· bought 1.0 " + SELL_SYMBOL + " for $100");

  // --- capture balances immediately BEFORE redeem, so the deltas isolate it.
  const usdcBefore = await bal(connection, sellerUsdc);
  const assetBefore = await bal(connection, sellerAsset);
  const treasuryBefore = await bal(connection, treasuryUsdc);
  console.log(`before redeem: USDC=${usdcBefore}  ${SELL_SYMBOL}=${assetBefore}  treasury=${treasuryBefore}`);
  // shared redeem account list (positive + negative differ only in asset_qty).
  const redeemKeys = [
    { pubkey: strategy, isSigner: false, isWritable: false },
    { pubkey: assetMint, isSigner: false, isWritable: true },
    { pubkey: usdcMint, isSigner: false, isWritable: false },
    { pubkey: asset, isSigner: false, isWritable: false },
    { pubkey: assetPrice, isSigner: false, isWritable: false },
    { pubkey: vault, isSigner: false, isWritable: false },
    { pubkey: seller.publicKey, isSigner: true, isWritable: true },
    { pubkey: sellerAsset, isSigner: false, isWritable: true },
    { pubkey: sellerUsdc, isSigner: false, isWritable: true },
    { pubkey: treasuryUsdc, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: ATA_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: sys, isSigner: false, isWritable: false },
  ];

  // POSITIVE: redeem 0.5 OPENAI → $50 back. usdc_out is computed on-chain from the
  // published price (0.5 × $100), NOT supplied by the caller — nothing to game.
  const redeemQty = 500_000_000; // 0.5 asset (9 dp)
  const expectUsdcOut = 50; // 0.5 × $100
  const redeemIx = new TransactionInstruction({ programId: PROGRAM_ID, keys: redeemKeys, data: Buffer.concat([disc("redeem"), u64(redeemQty)]) });
  const redeemSig = await send(connection, redeemIx, seller);
  console.log("redeem tx:   ", redeemSig, `· burned 0.5 ${SELL_SYMBOL}, expect +$${expectUsdcOut}`);

  const usdcAfter = await bal(connection, sellerUsdc);
  const assetAfter = await bal(connection, sellerAsset);
  const treasuryAfter = await bal(connection, treasuryUsdc);
  console.log(`after redeem:  USDC=${usdcAfter}  ${SELL_SYMBOL}=${assetAfter}  treasury=${treasuryAfter}`);

  // NEGATIVE: try to redeem more asset than the treasury can pay for. usdc_out would
  // exceed the treasury balance, so the on-chain solvency guard MUST reject it
  // (InsufficientTreasury) BEFORE any burn — a redeem can't half-drain a treasury it
  // can't cover. Sized live to (treasury + $1,000) worth of asset.
  const overValueUsdc = Math.ceil(treasuryAfter) + 1000; // whole USDC, guaranteed > treasury
  const gamedQty = (BigInt(overValueUsdc) * 1000000n * 1000000000n) / BigInt(PRICE_U); // usdc_baseunits*10^9/price_u
  let rejected = false, rejectErr = "", rejectCode = null;
  const gamedIx = new TransactionInstruction({ programId: PROGRAM_ID, keys: redeemKeys, data: Buffer.concat([disc("redeem"), u64(gamedQty)]) });
  const codeFromLogs = (logs) => {
    const m = (logs || []).join("\n").match(/Error Number:\s*(\d+)/i);
    return m ? parseInt(m[1], 10) : null;
  };
  try {
    const badSig = await send(connection, gamedIx, seller);
    console.log("over-redeem tx (SHOULD NOT LAND):", badSig);
  } catch (e) {
    rejected = true;
    rejectErr = e && e.message ? e.message.split("\n")[0] : String(e);
    try { rejectCode = codeFromLogs(typeof e.getLogs === "function" ? await e.getLogs(connection) : e.logs); } catch {}
    console.log("over-redeem rejected on-chain ✓ —", rejectErr, rejectCode != null ? `(err ${rejectCode})` : "");
  }
  // Confirm WHICH guard fired — simulate to read the Anchor error code deterministically
  // (preflight error messages don't always carry it). 6026 = InsufficientTreasury.
  if (rejectCode == null) {
    try {
      const sim = await connection.simulateTransaction(new Transaction().add(gamedIx), [seller]);
      rejectCode = codeFromLogs(sim.value && sim.value.logs);
    } catch {}
  }
  const solvencyGuard = rejectCode === 6026; // InsufficientTreasury
  const usdcGamed = await bal(connection, sellerUsdc);
  const assetGamed = await bal(connection, sellerAsset);
  const treasuryGamed = await bal(connection, treasuryUsdc);
  const okUnchanged =
    Math.abs(usdcGamed - usdcAfter) < 1e-6 &&
    Math.abs(assetGamed - assetAfter) < 1e-6 &&
    Math.abs(treasuryGamed - treasuryAfter) < 1e-6;

  const okAsset = Math.abs(assetBefore - 0.5 - assetAfter) < 1e-6;
  const okUsdc = Math.abs(usdcBefore + expectUsdcOut - usdcAfter) < 1e-6;
  const okTreasury = Math.abs(treasuryBefore - expectUsdcOut - treasuryAfter) < 1e-6;
  const pass = okAsset && okUsdc && okTreasury && rejected && okUnchanged && solvencyGuard;
  console.log(
    pass
      ? "\nPASS — real on-chain redeem (sell) + solvency-guard rejection (InsufficientTreasury) verified."
      : `\nFAIL — asset:${okAsset} usdc:${okUsdc} treasury:${okTreasury} rejected:${rejected} unchanged:${okUnchanged} solvency:${solvencyGuard}`,
  );

  const evidence = {
    stage: "10-devnet-mirror-redeem",
    decision: "D-705",
    programId: PROGRAM_ID.toBase58(),
    seller: seller.publicKey.toBase58(),
    basket: BASKET_ID,
    symbol: SELL_SYMBOL,
    assetMint: assetMint.toBase58(),
    usdcMint: usdcMint.toBase58(),
    strategy: strategy.toBase58(),
    vault: vault.toBase58(),
    treasuryUsdc: treasuryUsdc.toBase58(),
    priceU: PRICE_U,
    priceUsd: PRICE_U / 1e6,
    faucetTx: faucetSig,
    setPriceTx: priceSig,
    subscribeTx: subSig,
    redeemTx: redeemSig,
    redeemQty,
    expectUsdcOut,
    overRedeem: { gamedQty: gamedQty.toString(), rejected, rejectErr, rejectCode, solvencyGuard, balancesUnchanged: okUnchanged },
    balances: { usdcBefore, usdcAfter, assetBefore, assetAfter, treasuryBefore, treasuryAfter },
    pass,
    ts: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(__dirname, "stage10-redeem-evidence.json"), JSON.stringify(evidence, null, 2) + "\n");
  if (!pass) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });



