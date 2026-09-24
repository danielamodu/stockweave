/**
 * READ-ONLY: print the on-chain asset targets for the APP'S OFFICIAL
 * ai-infrastructure strategy (creator = OFFICIAL_CREATOR, exactly as the deployed
 * app derives it) so we can confirm the stale xAI asset is really zeroed on the
 * basket users actually see. Signs nothing, sends nothing, needs no keypair.
 *
 *   HELIUS_RPC="<devnet rpc>" node tests/verify-ai-weights.js
 */
const fs = require("fs");
const path = require("path");
const { Connection, PublicKey } = require("@coral-xyz/anchor").web3;

const RPC = process.env.HELIUS_RPC || process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey("EVx3g8ooCpshuemiNz3bt3vqoYapu7XjPab86BbnrgYN");
const OFFICIAL_CREATOR = new PublicKey("3jNEVjYZtMKHShfPLmS7tH8oKNngd42bU3sX7AJ1yxQD"); // matches web/lib/onchain.ts
const BASKET_ID = "ai-infrastructure";
const STALE_XAI = "2oTGsm49RtmxDRsHP4U1SJ7yQGhBUeKYjuAorWCSP2EK";

function pda(seeds) { return PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0]; }
function decodeAsset(info) {
  if (!info || !info.data || info.data.length < 77) return null;
  const d = info.data;
  return { target: d.readUInt16LE(72), max: d.readUInt16LE(74), enabled: d[76] === 1 };
}

async function main() {
  const connection = new Connection(RPC, "confirmed");
  const strategy = pda([Buffer.from("strategy"), OFFICIAL_CREATOR.toBuffer(), Buffer.from(BASKET_ID)]);
  console.log("official creator:", OFFICIAL_CREATOR.toBase58());
  console.log("official strategy:", strategy.toBase58());

  const reg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "web", "lib", "devnet-mints.json"), "utf-8"));
  const rows = Object.entries(reg.assets || {})
    .filter(([, a]) => a && a.mint)
    .map(([symbol, a]) => ({ label: symbol, mint: a.mint }));
  rows.push({ label: "xAI (stale)", mint: STALE_XAI });

  let sum = 0;
  console.log("\non-chain asset targets:");
  for (const r of rows) {
    const assetPk = pda([Buffer.from("asset"), strategy.toBuffer(), new PublicKey(r.mint).toBuffer()]);
    const dec = decodeAsset(await connection.getAccountInfo(assetPk));
    if (dec) { sum += dec.enabled ? dec.target : 0; console.log(`  ${r.label.padEnd(14)} ${dec.target}bps enabled=${dec.enabled}`); }
    else { console.log(`  ${r.label.padEnd(14)} (not registered)`); }
  }
  console.log(`  → enabled target sum = ${sum}bps (${(sum / 100).toFixed(0)}%) + reserve`);
}
main().catch((e) => { console.error(e); process.exit(1); });
