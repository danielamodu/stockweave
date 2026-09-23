/**
 * Stage 9 keeper — record each strategy's live-priced NAV into the on-chain
 * NavHistory ring (record_nav). Proof-of-return that accumulates FORWARD from
 * launch: there is no backfill — pre-IPO mirror assets have no honest price
 * history and the live source is spot-only. NAV is a weighted index rebased to
 * $1.000000 at inception: I_t = Σ w_i·(P_i,t / P_i,0) + w_cash, recorded as
 * nav_u = round(I_t × 1e6) (USDC micro-units, 6 dp). Inception prices P_i,0 are
 * captured once (from the SAME real live Jupiter quotes) into tests/nav-basis.json
 * and reused thereafter — the on-chain NAV points are the verifiable artifact;
 * the basis is the inception reference (a fund's since-inception "cost basis").
 *
 * Creator/keeper-signed (has_one = creator). The READ+PROPOSE agent never records.
 *
 * Env: ANCHOR_WALLET (creator keypair), HELIUS_RPC | ANCHOR_PROVIDER_URL (RPC).
 * Optional: NAV_ROUNDS (default 1), NAV_INTERVAL_MS (default 3000) to append
 * several real snapshots in one invocation.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const anchor = require("@coral-xyz/anchor");
const { getBasket } = require("../lib/baskets");
const { fetchLivePricesBySymbol } = require("../lib/live-prices");
const { Connection, PublicKey, Keypair, TransactionInstruction, Transaction, SystemProgram, sendAndConfirmTransaction } =
  anchor.web3;

const RPC = process.env.HELIUS_RPC || process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com";
const WALLET = process.env.ANCHOR_WALLET;
if (!WALLET) throw new Error("Set ANCHOR_WALLET to the creator/keeper keypair path");

const PROGRAM_ID = new PublicKey("EVx3g8ooCpshuemiNz3bt3vqoYapu7XjPab86BbnrgYN");
const BASKETS = ["ai-infrastructure", "space-deep-tech"];
const BASIS_FILE = path.join(__dirname, "nav-basis.json");
const ROUNDS = Math.max(1, Number(process.env.NAV_ROUNDS || 1));
const INTERVAL_MS = Math.max(0, Number(process.env.NAV_INTERVAL_MS || 3000));

function disc(name) { return crypto.createHash("sha256").update(`global:${name}`).digest().subarray(0, 8); }
function u64(n) { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n), 0); return b; }
function pda(seeds) { return PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0]; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadBasis() {
  try { return JSON.parse(fs.readFileSync(BASIS_FILE, "utf-8")); } catch { return { _note: "Inception reference for on-chain NAV (real live prices captured once at launch; never hand-edit). The verifiable artifact is the on-chain NavHistory ring.", baskets: {} }; }
}
function saveBasis(basis) { fs.writeFileSync(BASIS_FILE, JSON.stringify(basis, null, 2) + "\n"); }

// Weighted index rebased to 1.0 at inception, in USDC micro-units.
function navMicro(weights, launch, live) {
  let idx = 0;
  for (const [sym, w] of Object.entries(weights)) {
    if (sym === "USDC") { idx += w; continue; } // cash pinned at $1, ratio 1
    const p0 = launch[sym];
    const pt = live[sym] && Number(live[sym].price);
    if (!p0 || !pt) throw new Error(`missing price for ${sym} (launch=${p0} live=${pt})`);
    idx += w * (pt / p0);
  }
  return Math.round(idx * 1_000_000);
}

async function sendWithRetry(connection, signer, ix) {
  let lastErr;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      return await sendAndConfirmTransaction(connection, new Transaction().add(ix), [signer], { commitment: "confirmed" });
    } catch (e) {
      lastErr = e;
      const msg = String((e && e.message) || e);
      if (!/Blockhash not found|block height exceeded|Node is behind|429|Too Many Requests|Timed out|timeout/i.test(msg)) throw e;
      console.log(`  … transient RPC error (attempt ${attempt}), retrying: ${msg}`);
      await sleep(1500 * attempt);
    }
  }
  throw lastErr;
}

async function navCount(connection, navPk) {
  // Best-effort (logging only): a transient RPC blip here must never crash the
  // keeper after the snapshot already landed.
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const info = await connection.getAccountInfo(navPk);
      if (!info) return 0;
      return Number(info.data.readBigUInt64LE(8 + 32 + 32)); // disc + strategy + authority → count
    } catch {
      await sleep(1200 * attempt);
    }
  }
  return -1; // unknown — the record tx still succeeded
}

async function main() {
  const connection = new Connection(RPC, "confirmed");
  const creator = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(WALLET, "utf-8"))));
  console.log("keeper (creator):", creator.publicKey.toBase58());
  console.log(`rounds=${ROUNDS} interval=${INTERVAL_MS}ms rpc=${RPC.split("?")[0]}\n`);

  // Weights per basket (fractions summing to 1) and the non-cash symbols to price.
  const weightsByBasket = {};
  const symbolSet = new Set();
  for (const id of BASKETS) {
    const w = {};
    for (const c of getBasket(id).constituents) { w[c.symbol] = c.targetBps / 10000; if (c.symbol !== "USDC") symbolSet.add(c.symbol); }
    weightsByBasket[id] = w;
  }
  const priceSymbols = [...symbolSet];

  for (let round = 1; round <= ROUNDS; round++) {
    const live = await fetchLivePricesBySymbol(priceSymbols);
    const priced = priceSymbols.filter((s) => live[s] && Number(live[s].price) > 0);
    console.log(`[round ${round}/${ROUNDS}] live: ${priced.map((s) => `${s}=$${Number(live[s].price).toFixed(2)}`).join(", ") || "(none)"}`);
    if (priced.length < priceSymbols.length) { console.log(`  ⚠ missing live prices for ${priceSymbols.filter((s) => !priced.includes(s)).join(", ")} — skipping this round`); if (round < ROUNDS) await sleep(INTERVAL_MS); continue; }

    const basis = loadBasis();
    for (const id of BASKETS) {
      const weights = weightsByBasket[id];
      // Capture inception prices once (real live quotes), then reuse forever.
      if (!basis.baskets[id]) {
        const launch = {};
        for (const s of Object.keys(weights)) if (s !== "USDC") launch[s] = Number(live[s].price);
        basis.baskets[id] = { launchTs: Math.floor(Date.now() / 1000), launchIso: new Date().toISOString(), launchPricesUsd: launch };
        saveBasis(basis);
        console.log(`  [${id}] inception captured: ${Object.entries(launch).map(([s, p]) => `${s}=$${p.toFixed(2)}`).join(", ")}`);
      }
      const strategy = pda([Buffer.from("strategy"), creator.publicKey.toBuffer(), Buffer.from(id)]);
      const navPk = pda([Buffer.from("nav"), strategy.toBuffer()]);
      const navU = navMicro(weights, basis.baskets[id].launchPricesUsd, live);
      const ix = new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: strategy, isSigner: false, isWritable: false },
          { pubkey: navPk, isSigner: false, isWritable: true },
          { pubkey: creator.publicKey, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: Buffer.concat([disc("record_nav"), u64(navU)]),
      });
      const sig = await sendWithRetry(connection, creator, ix);
      const count = await navCount(connection, navPk);
      console.log(`  [${id}] nav=$${(navU / 1e6).toFixed(6)} (${((navU / 1e6 - 1) * 100).toFixed(2)}% since launch) count=${count < 0 ? "?" : count} tx=${sig}`);
    }
    if (round < ROUNDS) await sleep(INTERVAL_MS);
  }
  console.log("\nDone.");
}

main().catch((e) => { console.error(e); process.exit(1); });
