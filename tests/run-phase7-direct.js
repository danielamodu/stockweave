/**
 * Direct Phase 7 test runner.
 * Reads ANCHOR_WALLET and ANCHOR_PROVIDER_URL from env (set by the shell).
 * Loads the IDL + types, configures the provider, and runs the fork_strategy
 * instruction + rejection assertion against the deployed devnet program.
 */
const fs = require("fs");
const path = require("path");
const anchor = require("@coral-xyz/anchor");
const { Program } = require("@coral-xyz/anchor");

// RPC: prefer HELIUS_RPC (set in your shell profile) so we never hit the public
// devnet rate limit. Falls back to ANCHOR_PROVIDER_URL, then public devnet.
const HELIUS =
  process.env.HELIUS_RPC ||
  process.env.ANCHOR_PROVIDER_URL ||
  "https://api.devnet.solana.com";
const WALLET = process.env.ANCHOR_WALLET || "";
if (!WALLET) {
  throw new Error("Set ANCHOR_WALLET env var to your deploy keypair path");
}

const IDL_PATH = path.join(__dirname, "..", "target/idl/stockweave.json");
const IDL = JSON.parse(fs.readFileSync(IDL_PATH, "utf8"));
const PROGRAM_ID = IDL.address; // EVx3g8ooCpshuemiNz3bt3vqoYapu7XjPab86BbnrgYN

// Configure provider — load the keypair from the JSON secret-key array.
const secretKey = Uint8Array.from(JSON.parse(fs.readFileSync(WALLET, "utf-8")));
const keypair = anchor.web3.Keypair.fromSecretKey(secretKey);
const wallet = new anchor.Wallet(keypair);
const provider = new anchor.AnchorProvider(
  new anchor.web3.Connection(HELIUS, "confirmed"),
  wallet,
  { commitment: "confirmed", preflightCommitment: "confirmed" }
);
anchor.setProvider(provider);

async function runPhase7() {
  // Anchor 0.30.1: program id comes from idl.address; 2nd arg is the provider.
  const program = new Program(IDL, provider);

  // Wallet A = provider wallet (parent creator)
  // Wallet B = a fresh devnet keypair (forker) — funded from A
  const walletB = anchor.web3.Keypair.generate();
  const walletA = provider.wallet.publicKey;

  // Fund Wallet B from A
  const fundTx = new anchor.web3.Transaction().add(
    anchor.web3.SystemProgram.transfer({
      fromPubkey: walletA,
      toPubkey: walletB.publicKey,
      lamports: 50_000_000, // 0.05 SOL
    })
  );
  await provider.sendAndConfirm(fundTx);
  console.log("Funded Wallet B:", walletB.publicKey.toBase58());

  // Set up parent strategy
  const parentId = `p7-parent-direct-${Date.now()}`;
  const [parentPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("strategy"), walletA.toBuffer(), Buffer.from(parentId)],
    program.programId
  );
  const [parentRulesPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("rules"), parentPda.toBuffer()],
    program.programId
  );

  // Anchor 0.30.1 camelCases IDL field names internally, so args + decoded
  // accounts use camelCase keys.
  const RULES = {
    reserveWeightBps: 1000,
    rebalanceDriftBps: 500,
    maxSingleAssetWeightBps: 3500,
    maxTradeNotional: new anchor.BN(50),
    maxDailyNotional: new anchor.BN(200),
    maxPriceAgeSeconds: new anchor.BN(30),
    referenceFeedId: Array(32).fill(1),
  };

  const initSig = await program.methods
    .initializeStrategy(parentId)
    .accounts({ strategy: parentPda, creator: walletA })
    .rpc();
  console.log("initialize_strategy (parent):", initSig);

  const rulesSig = await program.methods
    .setRules(RULES)
    .accounts({ strategy: parentPda, rules: parentRulesPda, creator: walletA })
    .rpc();
  console.log("set_rules (parent):", rulesSig);

  // Fork
  const forkId = `p7-fork-direct-${Date.now()}`;
  const [forkPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("strategy"), walletB.publicKey.toBuffer(), Buffer.from(forkId)],
    program.programId
  );
  const [forkRulesPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("rules"), forkPda.toBuffer()],
    program.programId
  );

  // Wallet B forks
  const forkSig = await program.methods
    .forkStrategy(forkId)
    .accounts({
      parentStrategy: parentPda,
      parentRules: parentRulesPda,
      forkStrategy: forkPda,
      forkRules: forkRulesPda,
      creator: walletB.publicKey,
    })
    .signers([walletB])
    .rpc();
  console.log("fork_strategy:", forkSig);

  // Verify fork state
  const fork = await program.account.strategy.fetch(forkPda);
  console.log("  fork creator:", fork.creator.toBase58());
  console.log("  fork parent:", fork.parentStrategy.toBase58());
  console.log("  parent creator:", walletA.toBase58());

  if (!fork.creator.equals(walletB.publicKey)) throw new Error("Fork creator must be Wallet B");
  if (!fork.parentStrategy.equals(parentPda)) throw new Error("Fork must record parent");

  // Parent is original (no parent link)
  const parent = await program.account.strategy.fetch(parentPda);
  if (!parent.parentStrategy.equals(anchor.web3.PublicKey.default)) throw new Error("Parent must have no parent link");

  // Fork copies rules
  const forkRules = await program.account.rules.fetch(forkRulesPda);
  if (forkRules.maxSingleAssetWeightBps !== 3500) throw new Error("Rules not copied");
  if (forkRules.version.toNumber() !== 1) throw new Error("Fork rule version must be 1");

  // Wallet B can change a rule on its fork
  const editSig = await program.methods
    .setRules({ ...RULES, rebalanceDriftBps: 300 })
    .accounts({ strategy: forkPda, rules: forkRulesPda, creator: walletB.publicKey })
    .signers([walletB])
    .rpc();
  console.log("fork set_rules (B):", editSig);
  const editedForkRules = await program.account.rules.fetch(forkRulesPda);
  if (editedForkRules.rebalanceDriftBps !== 300) throw new Error("Rule not changed");
  if (editedForkRules.version.toNumber() !== 2) throw new Error("Version must bump to 2");
  if (editedForkRules.reserveWeightBps !== 1000) throw new Error("Parent rules must be untouched");

  // Wallet A cannot control Wallet B's fork
  let rejected = false;
  try {
    await program.methods
      .setRules({ ...RULES, rebalanceDriftBps: 100 })
      .accounts({ strategy: forkPda, rules: forkRulesPda, creator: walletA })
      .rpc();
  } catch (e) {
    rejected = true;
    console.log("Parent owner rejected on fork:", e.toString().slice(0, 120));
  }
  if (!rejected) throw new Error("Wallet A must not control Wallet B's fork");

  const sig = forkSig;
  console.log("\n=== Phase 7 PASS ===");
  console.log("fork_strategy signature:", sig);
  console.log("Parent isolation rejection: CONFIRMED (Wallet A cannot edit fork)");

  // Write evidence file
  const evidence = {
    phase: 7,
    status: "PASS",
    fork_strategy_signature: sig,
    fork_strategy_tx: sig,
    parent_strategy: parentPda.toBase58(),
    fork_strategy: forkPda.toBase58(),
    fork_creator: walletB.publicKey.toBase58(),
    parent_creator: walletA.toBase58(),
    parent_isolation_rejected: true,
    parent_isolation_tx: editSig, // the last allowed tx before the rejected attempt
    deploy_program_id: PROGRAM_ID,
    rpc: HELIUS.replace(/api-key=[^&]+/, "api-key=<redacted>"),
    timestamp: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(__dirname, "phase07-evidence.json"), JSON.stringify(evidence, null, 2));
  console.log("Evidence written to tests/phase07-evidence.json");
}

runPhase7().catch(e => { console.error(e); process.exit(1); });
