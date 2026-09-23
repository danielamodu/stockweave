/**
 * Stage 9 verifier — read the on-chain NAV rings BACK from Devnet and prove the
 * proof-of-return is real, not asserted. For each official strategy this:
 *   1. fetches the NavHistory PDA in ONE getAccountInfo,
 *   2. checks the Anchor account discriminator,
 *   3. decodes the #[repr(C)] layout (mirrors the program byte-for-byte),
 *   4. verifies structural invariants (strategy field == PDA's strategy,
 *      authority == official creator, count ≥ points, monotonic non-decreasing
 *      timestamps, first snapshot rebased to ~$1.000000),
 *   5. recomputes the since-launch return from the ring itself.
 * Writes tests/stage09-evidence.json — a self-contained artifact a judge can
 * diff against the chain. Read-only: no wallet, no signing, no writes on-chain.
 *
 * Env: HELIUS_RPC | ANCHOR_PROVIDER_URL (RPC). No keypair required.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Connection, PublicKey } = require("@solana/web3.js");

const RPC = process.env.HELIUS_RPC || process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey("EVx3g8ooCpshuemiNz3bt3vqoYapu7XjPab86BbnrgYN");
// Official strategies are created by the deploy/keeper wallet (public key only —
// no secret here). Matches OFFICIAL_CREATOR in web/lib/onchain.ts.
const OFFICIAL_CREATOR = new PublicKey("3jNEVjYZtMKHShfPLmS7tH8oKNngd42bU3sX7AJ1yxQD");
const BASKETS = ["ai-infrastructure", "space-deep-tech"];
const BASIS_FILE = path.join(__dirname, "nav-basis.json");
const OUT_FILE = path.join(__dirname, "stage09-evidence.json");
const NAV_CAPACITY = 128;

function accDisc(name) { return crypto.createHash("sha256").update(`account:${name}`).digest().subarray(0, 8); }
function pda(seeds) { return PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0]; }

// Mirror of the program's NavHistory #[repr(C)] layout (see programs/…/lib.rs and
// web/lib/onchain.ts decodeNavHistory). Offsets are absolute from the account start.
function decodeNavHistory(data) {
  const strategy = new PublicKey(data.subarray(8, 8 + 32)).toBase58();
  const authority = new PublicKey(data.subarray(8 + 32, 8 + 64)).toBase58();
  const count = Number(data.readBigUInt64LE(8 + 64));
  const head = data.readUInt32LE(8 + 64 + 8);
  const POINTS_OFF = 8 + 32 + 32 + 8 + 4 + 4; // = 88 (disc + strategy + authority + count + head + _pad0)
  const bump = data.readUInt8(POINTS_OFF + 16 * NAV_CAPACITY);
  const readPoint = (slot) => {
    const o = POINTS_OFF + slot * 16;
    return { ts: Number(data.readBigInt64LE(o)), navU: Number(data.readBigUInt64LE(o + 8)) };
  };
  const points = [];
  if (count <= NAV_CAPACITY) {
    for (let i = 0; i < count; i++) points.push(readPoint(i));
  } else {
    const h = count % NAV_CAPACITY;
    for (let i = 0; i < NAV_CAPACITY; i++) points.push(readPoint((h + i) % NAV_CAPACITY));
  }
  return { strategy, authority, count, head, bump, points };
}

async function main() {
  const connection = new Connection(RPC, "confirmed");
  const wantDisc = accDisc("NavHistory");
  const basis = (() => { try { return JSON.parse(fs.readFileSync(BASIS_FILE, "utf-8")); } catch { return { baskets: {} }; } })();
  console.log(`verify-nav · program ${PROGRAM_ID.toBase58()} · rpc ${RPC.split("?")[0]}\n`);

  const evidence = {
    generatedAt: new Date().toISOString(),
    network: "devnet",
    programId: PROGRAM_ID.toBase58(),
    officialCreator: OFFICIAL_CREATOR.toBase58(),
    note:
      "Forward-tracked live NAV, recorded on-chain (record_nav ring). No back-fill: " +
      "pre-IPO mirror assets have no honest price history, and the live source is spot-only. " +
      "Each strategy's NavHistory PDA is read in one getAccountInfo and decoded here from the " +
      "program's #[repr(C)] layout — this file is a snapshot a judge can diff against the chain.",
    strategies: {},
  };

  let allPass = true;
  for (const id of BASKETS) {
    const strategyPk = pda([Buffer.from("strategy"), OFFICIAL_CREATOR.toBuffer(), Buffer.from(id)]);
    const navPk = pda([Buffer.from("nav"), strategyPk.toBuffer()]);
    const info = await connection.getAccountInfo(navPk);

    const checks = {};
    const fail = (k, msg) => { checks[k] = { pass: false, detail: msg }; allPass = false; };
    const ok = (k, detail) => { checks[k] = { pass: true, ...(detail ? { detail } : {}) }; };

    if (!info) {
      fail("accountExists", "no NavHistory account — keeper has not recorded yet");
      evidence.strategies[id] = { strategy: strategyPk.toBase58(), navHistory: navPk.toBase58(), checks, points: [] };
      console.log(`[${id}] ✗ no NavHistory account at ${navPk.toBase58()}`);
      continue;
    }
    ok("accountExists", `${info.data.length} bytes`);
    info.data.subarray(0, 8).equals(wantDisc) ? ok("discriminator", "account:NavHistory")
      : fail("discriminator", `got ${Buffer.from(info.data.subarray(0, 8)).toString("hex")}`);

    const d = decodeNavHistory(Buffer.from(info.data));
    d.strategy === strategyPk.toBase58() ? ok("strategyField") : fail("strategyField", `${d.strategy} != ${strategyPk.toBase58()}`);
    d.authority === OFFICIAL_CREATOR.toBase58() ? ok("authority") : fail("authority", `${d.authority} != official creator`);
    d.count >= d.points.length ? ok("countConsistent", `count=${d.count} points=${d.points.length}`)
      : fail("countConsistent", `count=${d.count} < points=${d.points.length}`);

    // Timestamps must be non-decreasing (snapshots only ever appended forward).
    let monotonic = true;
    for (let i = 1; i < d.points.length; i++) if (d.points[i].ts < d.points[i - 1].ts) monotonic = false;
    monotonic ? ok("timestampsMonotonic") : fail("timestampsMonotonic", "found an out-of-order snapshot");

    // First recorded snapshot is the inception index — must rebase to ~$1.000000.
    if (d.points.length > 0) {
      const first = d.points[0].navU;
      Math.abs(first - 1_000_000) <= 500 ? ok("inceptionRebased", `nav0=$${(first / 1e6).toFixed(6)}`)
        : fail("inceptionRebased", `nav0=$${(first / 1e6).toFixed(6)} (expected ≈ $1.000000)`);
    }

    const first = d.points[0]?.navU ?? 0;
    const last = d.points[d.points.length - 1]?.navU ?? 0;
    const sinceLaunchPct = first > 0 ? (last / first - 1) * 100 : null;

    evidence.strategies[id] = {
      strategy: strategyPk.toBase58(),
      navHistory: navPk.toBase58(),
      accountBytes: info.data.length,
      count: d.count,
      head: d.head,
      bump: d.bump,
      inception: basis.baskets?.[id]?.launchIso ?? null,
      inceptionPricesUsd: basis.baskets?.[id]?.launchPricesUsd ?? null,
      navFirst: first,
      navLast: last,
      sinceLaunchPct: sinceLaunchPct == null ? null : Number(sinceLaunchPct.toFixed(4)),
      checks,
      points: d.points.map((p) => ({ ts: p.ts, iso: new Date(p.ts * 1000).toISOString(), navU: p.navU, nav: Number((p.navU / 1e6).toFixed(6)) })),
    };

    const verdict = Object.values(checks).every((c) => c.pass) ? "✓" : "✗";
    console.log(
      `[${id}] ${verdict} nav ${navPk.toBase58().slice(0, 8)}… · count=${d.count} · ` +
        `first=$${(first / 1e6).toFixed(6)} last=$${(last / 1e6).toFixed(6)} · ` +
        `${sinceLaunchPct == null ? "—" : (sinceLaunchPct >= 0 ? "+" : "") + sinceLaunchPct.toFixed(2) + "%"} since launch`,
    );
    for (const [k, c] of Object.entries(checks)) if (!c.pass) console.log(`        ✗ ${k}: ${c.detail}`);
  }

  evidence.allChecksPass = allPass;
  fs.writeFileSync(OUT_FILE, JSON.stringify(evidence, null, 2) + "\n");
  console.log(`\n${allPass ? "ALL CHECKS PASS" : "SOME CHECKS FAILED"} → wrote ${path.relative(process.cwd(), OUT_FILE)}`);
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
