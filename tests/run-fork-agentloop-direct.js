/**
 * Fork-path agent-loop dress rehearsal — the real READ+PROPOSE loop on a
 * USER-OWNED fork, end-to-end on Devnet (no IDL, hand-encoded).
 *
 * Unlike run-stage7-execute-direct.js (creator self-proposes on the OFFICIAL
 * basket), this exercises the path the demo actually claims:
 *   - a DISTINCT agent keypair (A) signs propose_rebalance  (READ+PROPOSE)
 *   - the fork CREATOR (U) signs approve + execute           (creator-only)
 *   - a NEGATIVE proves the agent CANNOT approve (has_one=creator rejects it)
 *
 * Preconditions (done by tests/_rehearsal.sh before this runs):
 *   - U funded with SOL; A funded with SOL
 *   - a fork strategy seeded under U for BASKET with agent A granted PROPOSE
 *     and a fresh live Jupiter price published for the trim asset.
 *
 * Env: ANCHOR_WALLET (fork creator U), AGENT_WALLET (agent A),
 *      HELIUS_RPC | ANCHOR_PROVIDER_URL (RPC). Writes tests/rehearsal-fork-evidence.json.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const anchor = require("@coral-xyz/anchor");
const { Connection, PublicKey, Keypair, TransactionInstruction, Transaction, SystemProgram, sendAndConfirmTransaction } =
  anchor.web3;

const RPC = process.env.HELIUS_RPC || process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com";
const CREATOR_WALLET = process.env.ANCHOR_WALLET;
const AGENT_WALLET = process.env.AGENT_WALLET;
if (!CREATOR_WALLET) throw new Error("Set ANCHOR_WALLET to the fork-creator keypair path");
if (!AGENT_WALLET) throw new Error("Set AGENT_WALLET to the agent keypair path");

const PROGRAM_ID = new PublicKey("EVx3g8ooCpshuemiNz3bt3vqoYapu7XjPab86BbnrgYN");
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
function load(p) { return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf-8")))); }
async function bal(connection, addr) {
  try { return (await connection.getTokenAccountBalance(addr)).value.uiAmount ?? 0; } catch { return 0; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Send + confirm, retrying ONLY transient RPC faults; real program errors re-raise.
async function send(connection, ixs, signers, label) {
  const tx = new Transaction().add(...ixs);
  let lastErr;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try { return await sendAndConfirmTransaction(connection, tx, signers, { commitment: "confirmed" }); }
    catch (e) {
      lastErr = e;
      const msg = String((e && e.message) || e);
      if (!/Blockhash not found|block height exceeded|Node is behind|429|Too Many Requests|Timed out|timeout|fetch failed|ETIMEDOUT|socket hang up/i.test(msg)) throw e;
      console.log(`  … transient RPC error on ${label} (attempt ${attempt}), retrying: ${msg}`);
      await sleep(1500 * attempt);
    }
  }
  throw lastErr;
}

async function main() {
  const connection = new Connection(RPC, "confirmed");
  const creator = load(CREATOR_WALLET); // U — owns the fork, signs approve/execute
  const agent = load(AGENT_WALLET);     // A — READ+PROPOSE, signs propose only

  const reg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "web", "lib", "devnet-mints.json"), "utf-8"));
  if (!reg.usdc || !reg.usdc.mint || !reg.assets[TRIM_SYMBOL]) throw new Error("Mirror mints not seeded — run tests/seed-devnet-mints.js");
  const usdcMint = new PublicKey(reg.usdc.mint);
  const assetMint = new PublicKey(reg.assets[TRIM_SYMBOL].mint);

  const vault = pda([Buffer.from("vault")]);
  const strategy = pda([Buffer.from("strategy"), creator.publicKey.toBuffer(), Buffer.from(BASKET_ID)]);
  const asset = pda([Buffer.from("asset"), strategy.toBuffer(), assetMint.toBuffer()]);
  const assetPrice = pda([Buffer.from("price"), strategy.toBuffer(), assetMint.toBuffer()]);
  const rulesPk = pda([Buffer.from("rules"), strategy.toBuffer()]);
  const permAgent = pda([Buffer.from("permission"), strategy.toBuffer(), agent.publicKey.toBuffer()]);
  const creatorAsset = ata(creator.publicKey, assetMint);
  const creatorUsdc = ata(creator.publicKey, usdcMint);
  const treasuryUsdc = ata(vault, usdcMint);
  const sys = SystemProgram.programId;

  // The fork must already exist (seeded under U with agent A granted).
  const sInfo = await connection.getAccountInfo(strategy);
  if (!sInfo) throw new Error(`Fork strategy missing under creator ${creator.publicKey.toBase58()} — seed step did not run`);
  const stratCreator = new PublicKey(sInfo.data.subarray(8, 40));
  if (!stratCreator.equals(creator.publicKey)) throw new Error("Fork strategy.creator != U — wrong keypair");
  const pInfo = await connection.getAccountInfo(permAgent);
  if (!pInfo) throw new Error("Agent permission PDA missing — fork did not grant the agent PROPOSE");

  // Read the guardrails so the proposal satisfies every on-chain check.
  const rb = (await connection.getAccountInfo(rulesPk)).data;
  const reserveBps = rb.readUInt16LE(40);
  const maxSingleBps = rb.readUInt16LE(44);
  const maxTradeNotional = Number(rb.readBigUInt64LE(46));
  const feedId = rb.subarray(70, 102);
  // Live on-chain price the fork published (AssetPrice: disc8 + strategy32 + mint32 → price_u@72).
  const apData = (await connection.getAccountInfo(assetPrice)).data;
  const priceU = Number(apData.readBigUInt64LE(72));
  if (!(priceU > 0)) throw new Error("AssetPrice.price_u not published for the trim asset");

  const now = Math.floor(Date.now() / 1000);
  const proposalId = BigInt(Date.now());
  const nonce = proposalId;
  const notional = Math.max(1, Math.min(5, maxTradeNotional)); // $5, well under the $50 cap
  const newTargetWeightBps = Math.min(1000, maxSingleBps);
  const proposalPk = pda([Buffer.from("proposal"), strategy.toBuffer(), u64(proposalId)]);

  // Size the trim burn from the live price (the exact bind the execute guard enforces),
  // then hold 4x that so the burn always has cover regardless of the live price level.
  const assetQtyTrim = (BigInt(notional) * 1_000_000n * 1_000_000_000n) / BigInt(priceU);
  const subQty = assetQtyTrim * 4n;
  const usdcIn = (subQty * BigInt(priceU)) / 1_000_000_000n;
  const faucetAmt = usdcIn + 20_000_000n; // + $20 headroom for U's balance

  console.log("fork creator U:", creator.publicKey.toBase58());
  console.log("agent A:       ", agent.publicKey.toBase58());
  console.log("strategy(fork):", strategy.toBase58());
  console.log("asset:         ", TRIM_SYMBOL, assetMint.toBase58());
  console.log("proposal:      ", proposalPk.toBase58(), "id", proposalId.toString());
  console.log(`live price:     $${(priceU / 1e6).toFixed(2)}/${TRIM_SYMBOL}  ·  notional=$${notional}  newTargetBps=${newTargetWeightBps}  reserveBps=${reserveBps}`);

  // 0) Give U holdings to trim + top up the shared treasury: faucet USDC then subscribe.
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
    data: Buffer.concat([disc("faucet_usdc"), u64(faucetAmt)]),
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
    data: Buffer.concat([disc("subscribe"), u64(usdcIn), u64(subQty)]),
  });
  const setupSig = await send(connection, [faucetIx, subIx], [creator], "faucet+subscribe");
  console.log("setup tx (faucet+subscribe):", setupSig);

  // 1) propose_rebalance — signed by the AGENT (A). This is the whole point:
  //    the constrained agent can draft a trim, using its own permission PDA.
  const proposeArgs = Buffer.concat([
    u64(proposalId),
    assetMint.toBuffer(),
    u16(newTargetWeightBps),
    u16(reserveBps),   // projected_reserve_bps ≥ reserve_weight_bps
    u64(notional),
    Buffer.from([1]),  // reason_code
    Buffer.from(feedId),
    i64(100),          // oracle_price (unchecked value)
    i64(now - 2),      // oracle_publish_time (fresh)
    u64(nonce),
    i64(now + 3600),   // expires_at
  ]);
  const proposeIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: strategy, isSigner: false, isWritable: false },
      { pubkey: rulesPk, isSigner: false, isWritable: false },
      { pubkey: permAgent, isSigner: false, isWritable: false },
      { pubkey: proposalPk, isSigner: false, isWritable: true },
      { pubkey: agent.publicKey, isSigner: true, isWritable: true },
      { pubkey: sys, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([disc("propose_rebalance"), proposeArgs]),
  });
  const proposeSig = await send(connection, [proposeIx], [agent], "propose(agent)");
  console.log("propose tx (AGENT-signed):", proposeSig);

  // 2) NEGATIVE — the agent tries to APPROVE its own proposal. has_one=creator on the
  //    strategy must reject it: PROPOSE never implies EXECUTE.
  let agentApproveRejected = false, agentApproveErr = "";
  const mkApproveIx = (signerPk) => new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: strategy, isSigner: false, isWritable: false },
      { pubkey: proposalPk, isSigner: false, isWritable: true },
      { pubkey: signerPk, isSigner: true, isWritable: false },
    ],
    data: Buffer.concat([disc("approve_rebalance"), u64(nonce)]),
  });
  try {
    const bad = await send(connection, [mkApproveIx(agent.publicKey)], [agent], "agent-approve(should fail)");
    console.log("agent approve (SHOULD NOT LAND):", bad);
  } catch (e) {
    agentApproveRejected = true;
    agentApproveErr = (e && e.message ? e.message.split("\n")[0] : String(e));
    console.log("agent approve rejected on-chain ✓ —", agentApproveErr);
  }

  // 3) approve_rebalance — the CREATOR (U) approves. Only U can.
  const approveSig = await send(connection, [mkApproveIx(creator.publicKey)], [creator], "creator-approve");
  console.log("approve tx (CREATOR-signed):", approveSig);

  // Snapshot right before execute so deltas isolate the trim.
  const midAsset = await bal(connection, creatorAsset);
  const midUsdc = await bal(connection, creatorUsdc);
  const midTreasury = await bal(connection, treasuryUsdc);
  console.log(`before execute: ${TRIM_SYMBOL}=${midAsset} USDC=${midUsdc} treasury=${midTreasury}`);

  // 4) execute_rebalance — CREATOR (U) settles: burn assetQtyTrim, return notional USDC.
  const executeIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
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
    ],
    data: Buffer.concat([disc("execute_rebalance"), u64(assetQtyTrim)]),
  });
  const executeSig = await send(connection, [executeIx], [creator], "creator-execute");
  const burnedUi = Number(assetQtyTrim) / 1e9;
  console.log("execute tx (CREATOR-signed):", executeSig, "· burn", burnedUi, TRIM_SYMBOL, "for $" + notional);

  const afterAsset = await bal(connection, creatorAsset);
  const afterUsdc = await bal(connection, creatorUsdc);
  const afterTreasury = await bal(connection, treasuryUsdc);
  console.log(`after execute:  ${TRIM_SYMBOL}=${afterAsset} USDC=${afterUsdc} treasury=${afterTreasury}`);

  const propInfo = await connection.getAccountInfo(proposalPk);
  const status = propInfo ? propInfo.data.readUInt8(189) : -1; // 2 = Executed
  const okBurn = Math.abs(midAsset - burnedUi - afterAsset) < 1e-6;
  const okUsdc = Math.abs(afterUsdc - midUsdc - notional) < 1e-6;
  const okTreasury = Math.abs(midTreasury - notional - afterTreasury) < 1e-6;
  const okStatus = status === 2;
  const pass = okBurn && okUsdc && okTreasury && okStatus && agentApproveRejected;
  console.log(pass
    ? "\nPASS — agent proposed, agent-approve REJECTED, creator approved+executed; tokens moved."
    : `\nFAIL — burn:${okBurn} usdc:${okUsdc} treasury:${okTreasury} status:${okStatus}(${status}) agentRejected:${agentApproveRejected}`);

  const evidence = {
    stage: "e2e-fork-agent-loop",
    programId: PROGRAM_ID.toBase58(),
    forkCreator: creator.publicKey.toBase58(),
    agent: agent.publicKey.toBase58(),
    basket: BASKET_ID,
    symbol: TRIM_SYMBOL,
    assetMint: assetMint.toBase58(),
    usdcMint: usdcMint.toBase58(),
    strategy: strategy.toBase58(),
    proposal: proposalPk.toBase58(),
    proposalId: proposalId.toString(),
    treasuryUsdc: treasuryUsdc.toBase58(),
    priceU, priceUsd: priceU / 1e6, notional, assetBurned: burnedUi,
    negativeAgentApprove: { rejected: agentApproveRejected, err: agentApproveErr },
    setupTx: setupSig,
    proposeTx: proposeSig,
    approveTx: approveSig,
    executeTx: executeSig,
    proposalStatus: status,
    balances: { midAsset, afterAsset, midUsdc, afterUsdc, midTreasury, afterTreasury },
    checks: { okBurn, okUsdc, okTreasury, okStatus, agentApproveRejected },
    pass,
    ts: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(__dirname, "rehearsal-fork-evidence.json"), JSON.stringify(evidence, null, 2) + "\n");
  if (!pass) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
