/**
 * Seed the canonical on-chain strategies the web demo reads + forks.
 *
 * For each catalogue basket, under the deploy wallet as creator:
 *   initialize_strategy(id)             only when the Strategy PDA is missing
 *   set_rules(guardrails)               per-basket cash reserve; self-heals
 *   set_assets(mint, target, max)       one per non-cash constituent
 *   set_agent_permission(READ+PROPOSE)  to the backend agent if set, else creator
 *
 * Idempotent + self-healing: initialize runs once; rules/assets/permissions are
 * re-applied safely (init_if_needed), so re-running repairs a partially-seeded
 * basket (missing assets, missing agent grant, wrong reserve).
 *
 * Env: ANCHOR_WALLET (creator keypair), HELIUS_RPC | ANCHOR_PROVIDER_URL (RPC),
 *      NEXT_PUBLIC_AGENT_PUBKEY | AGENT_PUBKEY (agent to grant PROPOSE).
 */
const fs = require("fs");
const crypto = require("crypto");
const anchor = require("@coral-xyz/anchor");
const { listApprovedAssets } = require("../lib/asset-registry");
const { getBasket } = require("../lib/baskets");
const { Connection, PublicKey, Keypair, TransactionInstruction, Transaction, SystemProgram, sendAndConfirmTransaction } =
  anchor.web3;

const RPC = process.env.HELIUS_RPC || process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com";
const WALLET = process.env.ANCHOR_WALLET;
if (!WALLET) throw new Error("Set ANCHOR_WALLET to the deploy keypair path");

const PROGRAM_ID = new PublicKey("EVx3g8ooCpshuemiNz3bt3vqoYapu7XjPab86BbnrgYN");
// SOL/USD feed as the strategy's reference market (coherent with stage 5b).
const REFERENCE_FEED = Buffer.from("ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d", "hex");
const MAX_SINGLE_BPS = 3500; // matches set_rules max_single_asset_weight_bps below
const BASKETS = ["ai-infrastructure", "space-deep-tech"];

// Optional backend agent: granted READ+PROPOSE so /api/agent/propose can sign.
function parseAgent() {
  const v = process.env.NEXT_PUBLIC_AGENT_PUBKEY || process.env.AGENT_PUBKEY;
  if (!v) return null;
  try { return new PublicKey(v); } catch { return null; }
}

function disc(name) { return crypto.createHash("sha256").update(`global:${name}`).digest().subarray(0, 8); }
function u16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n, 0); return b; }
function u64(n) { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n), 0); return b; }
function i64(n) { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n), 0); return b; }
function borshString(s) { const b = Buffer.from(s, "utf8"); const len = Buffer.alloc(4); len.writeUInt32LE(b.length, 0); return Buffer.concat([len, b]); }
function pda(seeds) { return PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0]; }
// Send instructions in small batches so a fully-seeded basket stays under the
// transaction size limit. initialize_strategy (index 0) rides the first batch so
// the Strategy PDA is created before the dependent instructions run.
async function sendBatched(connection, signer, ixs, size = 4) {
  const sigs = [];
  for (let i = 0; i < ixs.length; i += size) {
    const tx = new Transaction().add(...ixs.slice(i, i + size));
    sigs.push(await sendAndConfirmTransaction(connection, tx, [signer], { commitment: "confirmed" }));
  }
  return sigs;
}

async function main() {
  const connection = new Connection(RPC, "confirmed");
  const creator = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(WALLET, "utf-8"))));
  const agent = parseAgent();
  console.log("creator:", creator.publicKey.toBase58());
  console.log("agent:", agent ? agent.toBase58() : "(none — granting creator only)");

  const mintOf = {};
  for (const a of listApprovedAssets()) mintOf[a.symbol] = a.mint;
  const sys = SystemProgram.programId;
  const expiry = Math.floor(Date.now() / 1000) + 365 * 86400;

  // set_agent_permission(READ|PROPOSE=0b011, per-action 50, daily 200, expiry +1y)
  const permIxFor = (strategy, agentKey) =>
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: strategy, isSigner: false, isWritable: true },
        { pubkey: pda([Buffer.from("permission"), strategy.toBuffer(), agentKey.toBuffer()]), isSigner: false, isWritable: true },
        { pubkey: agentKey, isSigner: false, isWritable: false },
        { pubkey: creator.publicKey, isSigner: true, isWritable: true },
        { pubkey: sys, isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([disc("set_agent_permission"), Buffer.from([0b011]), u64(50), u64(200), i64(expiry)]),
    });
  for (const id of BASKETS) {
    const basket = getBasket(id);
    const nonCash = basket.constituents.filter((c) => c.symbol !== "USDC");
    const usdc = basket.constituents.find((c) => c.symbol === "USDC");
    const reserveBps = usdc ? usdc.targetBps : 1000;

    const strategy = pda([Buffer.from("strategy"), creator.publicKey.toBuffer(), Buffer.from(id)]);
    const rules = pda([Buffer.from("rules"), strategy.toBuffer()]);
    const exists = await connection.getAccountInfo(strategy);
    console.log(`\n[${id}] strategy=${strategy.toBase58()} ${exists ? "(exists — healing)" : "(new)"}`);

    const ixs = [];
    if (!exists) {
      ixs.push(new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: strategy, isSigner: false, isWritable: true },
          { pubkey: creator.publicKey, isSigner: true, isWritable: true },
          { pubkey: sys, isSigner: false, isWritable: false },
        ],
        data: Buffer.concat([disc("initialize_strategy"), borshString(id)]),
      }));
    }

    // set_rules — per-basket cash reserve; re-applied on every run to self-heal.
    ixs.push(new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: strategy, isSigner: false, isWritable: true },
        { pubkey: rules, isSigner: false, isWritable: true },
        { pubkey: creator.publicKey, isSigner: true, isWritable: true },
        { pubkey: sys, isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([
        disc("set_rules"),
        u16(reserveBps), u16(500), u16(MAX_SINGLE_BPS), // reserve, drift, maxSingle
        u64(50), u64(200), u64(30),                     // maxTrade, maxDaily, maxAge
        REFERENCE_FEED,
      ]),
    }));
    // set_assets — one per non-cash constituent (mint bound into the asset PDA).
    for (const c of nonCash) {
      const mint = mintOf[c.symbol];
      if (!mint) throw new Error(`No approved mint for ${id}/${c.symbol}`);
      const mintPk = new PublicKey(mint);
      ixs.push(new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: strategy, isSigner: false, isWritable: true },
          { pubkey: pda([Buffer.from("asset"), strategy.toBuffer(), mintPk.toBuffer()]), isSigner: false, isWritable: true },
          { pubkey: mintPk, isSigner: false, isWritable: false },
          { pubkey: creator.publicKey, isSigner: true, isWritable: true },
          { pubkey: sys, isSigner: false, isWritable: false },
        ],
        data: Buffer.concat([disc("set_assets"), u16(c.targetBps), u16(MAX_SINGLE_BPS)]),
      }));
    }

    // Always (re)grant the creator; grant the backend agent too when configured.
    ixs.push(permIxFor(strategy, creator.publicKey));
    if (agent && !agent.equals(creator.publicKey)) ixs.push(permIxFor(strategy, agent));

    const sigs = await sendBatched(connection, creator, ixs);
    const grant = agent && !agent.equals(creator.publicKey) ? "agent+creator" : "creator";
    console.log(
      `  ${exists ? "healed" : "seeded"} in ${sigs.length} tx (${grant}); rules=${rules.toBase58()} reserve=${reserveBps}bps assets=${nonCash.length}`,
    );
  }

  console.log("\nDone. Official creator (for the web client):", creator.publicKey.toBase58());
  if (agent) console.log("Agent granted READ+PROPOSE:", agent.toBase58());
}

main().catch((e) => { console.error(e); process.exit(1); });
