/**
 * One-off repair: zero the stale xAI mirror asset on the OFFICIAL `ai-infrastructure`
 * strategy so its on-chain target weights sum to 100% again.
 *
 * Background: the AI basket was reseeded from xAI -> Figure AI, but the program has
 * no remove/disable-asset instruction, so the old xAI asset PDA lingers enabled at
 * 3000bps. On-chain targets therefore read 40/... no — 3x3000 (good) + 3000 (xAI)
 * = 12000bps = 120%. The UI + agent already ignore it (unknown mint), but a judge
 * reading the chain sees 120%. `set_assets(mint, 0, 3500)` sets its target to 0
 * (lib.rs only requires target_weight_bps <= 10000), leaving 3x3000 + reserve 1000
 * = 100%. Re-runnable and harmless.
 *
 * Run from repo root in WSL:
 *   ANCHOR_WALLET=/path/to/deploy-keypair.json \
 *   HELIUS_RPC="<your devnet rpc>" \
 *   node tests/zero-stale-ai-asset.js            # applies the fix
 *   DRY_RUN=1 ... node tests/zero-stale-ai-asset.js   # inspect only, no tx
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const anchor = require("@coral-xyz/anchor");
const { Connection, PublicKey, Keypair, TransactionInstruction, Transaction, SystemProgram, sendAndConfirmTransaction } =
  anchor.web3;

const RPC = process.env.HELIUS_RPC || process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com";
const WALLET = process.env.ANCHOR_WALLET;
if (!WALLET) throw new Error("Set ANCHOR_WALLET to the deploy keypair path (the official creator).");
const DRY_RUN = process.env.DRY_RUN === "1";

const PROGRAM_ID = new PublicKey("EVx3g8ooCpshuemiNz3bt3vqoYapu7XjPab86BbnrgYN");
const OFFICIAL_CREATOR = "3jNEVjYZtMKHShfPLmS7tH8oKNngd42bU3sX7AJ1yxQD";
const BASKET_ID = "ai-infrastructure";
const STALE_XAI = "2oTGsm49RtmxDRsHP4U1SJ7yQGhBUeKYjuAorWCSP2EK"; // leftover xAI mirror mint
const MAX_SINGLE_BPS = 3500;

function disc(name) { return crypto.createHash("sha256").update(`global:${name}`).digest().subarray(0, 8); }
function u16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n, 0); return b; }
function pda(seeds) { return PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0]; }

// StrategyAsset layout: [disc 8][strategy 32][mint 32][target u16][max u16][enabled u8]
function decodeAsset(info) {
  if (!info || !info.data || info.data.length < 77) return null;
  const d = info.data;
  return { target: d.readUInt16LE(72), max: d.readUInt16LE(74), enabled: d[76] === 1 };
}

async function main() {
  const connection = new Connection(RPC, "confirmed");
  const creator = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(WALLET, "utf-8"))));
  console.log("creator:", creator.publicKey.toBase58(), DRY_RUN ? "(DRY RUN)" : "");
  if (creator.publicKey.toBase58() !== OFFICIAL_CREATOR) {
    console.log(`  ⚠ wallet is NOT the official creator (${OFFICIAL_CREATOR}). It will act on THIS wallet's own`);
    console.log("    ai-infrastructure strategy, if any. Ctrl-C if that isn't what you want.");
  }

  const strategy = pda([Buffer.from("strategy"), creator.publicKey.toBuffer(), Buffer.from(BASKET_ID)]);
  console.log("strategy:", strategy.toBase58());

  // Current constituents (good) from the committed devnet mirror registry + the stale xAI.
  const reg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "web", "lib", "devnet-mints.json"), "utf-8"));
  const good = Object.entries(reg.assets || {})
    .filter(([, a]) => a && a.mint)
    .map(([symbol, a]) => ({ label: symbol, mint: a.mint }));
  const rows = [...good, { label: "xAI (stale)", mint: STALE_XAI }];

  async function report(tag) {
    let sum = 0;
    console.log(`\n[${tag}] on-chain asset targets:`);
    for (const r of rows) {
      const assetPk = pda([Buffer.from("asset"), strategy.toBuffer(), new PublicKey(r.mint).toBuffer()]);
      const dec = decodeAsset(await connection.getAccountInfo(assetPk));
      if (dec) { sum += dec.enabled ? dec.target : 0; console.log(`  ${r.label.padEnd(14)} ${dec.target}bps enabled=${dec.enabled}`); }
      else { console.log(`  ${r.label.padEnd(14)} (not registered)`); }
    }
    console.log(`  → enabled target sum = ${sum}bps (${(sum / 100).toFixed(0)}%) + reserve`);
    return sum;
  }

  await report("before");
  const stalePk = pda([Buffer.from("asset"), strategy.toBuffer(), new PublicKey(STALE_XAI).toBuffer()]);
  const staleBefore = decodeAsset(await connection.getAccountInfo(stalePk));
  if (!staleBefore) { console.log("\nStale xAI asset not found — nothing to do."); return; }
  if (staleBefore.target === 0) { console.log("\nStale xAI asset already at 0bps — nothing to do."); return; }
  if (DRY_RUN) { console.log("\nDRY_RUN=1 — not sending. Re-run without it to apply."); return; }

  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: strategy, isSigner: false, isWritable: true },
      { pubkey: stalePk, isSigner: false, isWritable: true },
      { pubkey: new PublicKey(STALE_XAI), isSigner: false, isWritable: false },
      { pubkey: creator.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([disc("set_assets"), u16(0), u16(MAX_SINGLE_BPS)]),
  });
  const sig = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [creator], { commitment: "confirmed" });
  console.log("\nset_assets(xAI, 0) tx:", sig);
  await report("after");
  console.log("\nDone.");
}

main().catch((e) => { console.error(e); process.exit(1); });
