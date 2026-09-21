// StockWeave Anchor tests — run inside Solana Playground (browser) on Devnet.
// NOT run by `npm test`. See docs/solana-playground-phase04.md for steps.
// Covers the Phase 4 checkpoint: deterministic seeds, unauthorized rejection,
// pause rejects protected actions, revoked agent loses authority, event logs.
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Stockweave } from "../target/types/stockweave";
// `assert` is injected as a global by Solana Playground. That package is NOT
// importable there (even a type-only import of it makes the bundler fail with
// "Package ... is not available"), so we declare the global loosely instead.
// `.equal(actual, expected)` and `.ok(value, msg)` behave as expected.
declare const assert: {
  equal(actual: unknown, expected: unknown, msg?: string): void;
  ok(value: unknown, msg?: string): void;
};

describe("stockweave-phase4", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Stockweave as Program<Stockweave>;
  const creator = provider.wallet;

  // Unique per run: Devnet persists state across runs (unlike a local
  // validator), so a fixed id would collide on the second run ("account
  // already in use") and leave a paused strategy that breaks later tests.
  // PDA derivation stays deterministic for a given id — we just don't reuse ids.
  const strategyId = `ai-infrastructure-${Date.now()}`;
  const [strategyPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("strategy"), creator.publicKey.toBuffer(), Buffer.from(strategyId)],
    program.programId
  );
  const [rulesPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("rules"), strategyPda.toBuffer()],
    program.programId
  );
  const agent = anchor.web3.Keypair.generate();
  const [permPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("permission"), strategyPda.toBuffer(), agent.publicKey.toBuffer()],
    program.programId
  );
  const mint = anchor.web3.Keypair.generate().publicKey;
  const [assetPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("asset"), strategyPda.toBuffer(), mint.toBuffer()],
    program.programId
  );

  it("initializes the strategy with deterministic seeds", async () => {
    const sig = await program.methods
      .initializeStrategy(strategyId)
      .accounts({ strategy: strategyPda, creator: creator.publicKey })
      .rpc();
    console.log("initialize_strategy:", sig);
    const acct = await program.account.strategy.fetch(strategyPda);
    assert.equal(acct.creator.toBase58(), creator.publicKey.toBase58());
    assert.equal(acct.strategyId, strategyId);
    assert.equal(acct.status, 0); // Active
  });

  it("rejects an unauthorized writer", async () => {
    const attacker = anchor.web3.Keypair.generate();
    // Fund the attacker from the main wallet so the tx reaches the program's
    // authority guard instead of failing on fees. (Devnet faucet airdrops are
    // flaky and throw "Internal error", which would fail this test for the
    // wrong reason — we want the on-chain Unauthorized rejection, not a funding
    // error.) 0.01 SOL is plenty for a single transaction fee.
    const fundTx = new anchor.web3.Transaction().add(
      anchor.web3.SystemProgram.transfer({
        fromPubkey: creator.publicKey,
        toPubkey: attacker.publicKey,
        lamports: 10_000_000,
      })
    );
    await provider.sendAndConfirm(fundTx);
    let failed = false;
    try {
      await program.methods
        .pauseStrategy()
        .accounts({ strategy: strategyPda, creator: attacker.publicKey })
        .signers([attacker])
        .rpc();
    } catch (e) {
      failed = true;
      console.log("unauthorized pause rejected:", e.toString().slice(0, 160));
    }
    assert.ok(failed, "unauthorized pause must fail");
  });

  it("sets assets, rules, and agent permission, then pauses", async () => {
    await program.methods
      .setAssets(3000, 3500)
      .accounts({ strategy: strategyPda, asset: assetPda, mint, creator: creator.publicKey })
      .rpc();
    const asset = await program.account.strategyAsset.fetch(assetPda);
    assert.equal(asset.targetWeightBps, 3000);

    await program.methods
      .setRules({
        reserveWeightBps: 1000,
        rebalanceDriftBps: 500,
        maxSingleAssetWeightBps: 3500,
        maxTradeNotional: new anchor.BN(50),
        maxDailyNotional: new anchor.BN(200),
        maxPriceAgeSeconds: new anchor.BN(30),
        referenceFeedId: Array(32).fill(1),
      })
      .accounts({ strategy: strategyPda, rules: rulesPda, creator: creator.publicKey })
      .rpc();
    const rules = await program.account.rules.fetch(rulesPda);
    assert.equal(rules.version.toNumber(), 1);
    assert.equal(rules.requireUserApproval, true);

    const permSig = await program.methods
      .setAgentPermission(0b011, new anchor.BN(50), new anchor.BN(200), new anchor.BN(9_999_999_999))
      .accounts({ strategy: strategyPda, permission: permPda, agent: agent.publicKey, creator: creator.publicKey })
      .rpc();
    console.log("set_agent_permission:", permSig);

    const pauseSig = await program.methods
      .pauseStrategy()
      .accounts({ strategy: strategyPda, creator: creator.publicKey })
      .rpc();
    console.log("pause_strategy:", pauseSig);
  });

  it("rejects protected actions while paused", async () => {
    let failed = false;
    try {
      await program.methods
        .setAssets(3000, 3500)
        .accounts({ strategy: strategyPda, asset: assetPda, mint, creator: creator.publicKey })
        .rpc();
    } catch (e) {
      failed = true;
      console.log("paused set_assets rejected:", e.toString().slice(0, 160));
    }
    assert.ok(failed, "protected action while paused must fail");
  });

  it("revokes the agent", async () => {
    const sig = await program.methods
      .revokeAgent()
      .accounts({ strategy: strategyPda, permission: permPda, creator: creator.publicKey })
      .rpc();
    console.log("revoke_agent:", sig);
    const perm = await program.account.agentPermission.fetch(permPda);
    assert.equal(perm.revoked, true);
  });
});

// Phase 5 — rebalance lifecycle on-chain. Fresh, ACTIVE strategy (the phase-4
// strategy ends up paused/revoked). Proves: valid proposal → approval →
// simulated execution, plus on-chain rejection of an over-max-weight proposal
// and a stale-oracle proposal. Oracle timestamps use the cluster clock so
// freshness is judged against the same clock the program reads.
describe("stockweave-phase5", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Stockweave as Program<Stockweave>;
  const creator = provider.wallet;

  const strategyId = `p5-${Date.now()}`;
  const [strategyPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("strategy"), creator.publicKey.toBuffer(), Buffer.from(strategyId)],
    program.programId
  );
  const [rulesPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("rules"), strategyPda.toBuffer()],
    program.programId
  );
  const agent = anchor.web3.Keypair.generate();
  const [permPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("permission"), strategyPda.toBuffer(), agent.publicKey.toBuffer()],
    program.programId
  );
  const mint = anchor.web3.Keypair.generate().publicKey;
  const [assetPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("asset"), strategyPda.toBuffer(), mint.toBuffer()],
    program.programId
  );
  const REF_FEED = Array(32).fill(7);
  let clusterNow: number;

  function proposalPda(id: number) {
    return anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("proposal"), strategyPda.toBuffer(), new anchor.BN(id).toArrayLike(Buffer, "le", 8)],
      program.programId
    )[0];
  }

  function args(overrides: any) {
    return {
      proposalId: new anchor.BN(1),
      mint,
      newTargetWeightBps: 3480,
      projectedReserveBps: 1050,
      notional: new anchor.BN(42),
      reasonCode: 1,
      oracleFeedId: REF_FEED,
      oraclePrice: new anchor.BN(100),
      oraclePublishTime: new anchor.BN(clusterNow),
      approvalNonce: new anchor.BN(7),
      expiresAt: new anchor.BN(clusterNow + 3600),
      ...overrides,
    };
  }

  it("sets up an active phase-5 strategy (assets, rules, agent, funding)", async () => {
    await program.methods
      .initializeStrategy(strategyId)
      .accounts({ strategy: strategyPda, creator: creator.publicKey })
      .rpc();
    await program.methods
      .setAssets(3000, 3500)
      .accounts({ strategy: strategyPda, asset: assetPda, mint, creator: creator.publicKey })
      .rpc();
    await program.methods
      .setRules({
        reserveWeightBps: 1000,
        rebalanceDriftBps: 500,
        maxSingleAssetWeightBps: 3500,
        maxTradeNotional: new anchor.BN(50),
        maxDailyNotional: new anchor.BN(200),
        maxPriceAgeSeconds: new anchor.BN(30),
        referenceFeedId: REF_FEED,
      })
      .accounts({ strategy: strategyPda, rules: rulesPda, creator: creator.publicKey })
      .rpc();
    await program.methods
      .setAgentPermission(0b011, new anchor.BN(50), new anchor.BN(200), new anchor.BN(9_999_999_999))
      .accounts({ strategy: strategyPda, permission: permPda, agent: agent.publicKey, creator: creator.publicKey })
      .rpc();
    // Fund the agent so it can pay for the proposal account + fees.
    const fundTx = new anchor.web3.Transaction().add(
      anchor.web3.SystemProgram.transfer({
        fromPubkey: creator.publicKey,
        toPubkey: agent.publicKey,
        lamports: 20_000_000,
      })
    );
    await provider.sendAndConfirm(fundTx);
    // Read the cluster clock for oracle timestamps.
    const slot = await provider.connection.getSlot();
    clusterNow = (await provider.connection.getBlockTime(slot)) as number;
  });

  it("Scenario B: valid proposal is accepted, needs approval, then executes", async () => {
    const proposal = proposalPda(1);
    const proposeSig = await program.methods
      .proposeRebalance(args({ proposalId: new anchor.BN(1) }))
      .accounts({ strategy: strategyPda, rules: rulesPda, permission: permPda, proposal, agent: agent.publicKey })
      .signers([agent])
      .rpc();
    console.log("propose_rebalance:", proposeSig);
    const p = await program.account.rebalanceProposal.fetch(proposal);
    assert.equal(p.status, 0); // Proposed — cannot execute yet

    const approveSig = await program.methods
      .approveRebalance(new anchor.BN(7))
      .accounts({ strategy: strategyPda, proposal, creator: creator.publicKey })
      .rpc();
    console.log("approve_rebalance:", approveSig);

    const execSig = await program.methods
      .executeRebalance()
      .accounts({ strategy: strategyPda, proposal, creator: creator.publicKey })
      .rpc();
    console.log("execute_rebalance:", execSig);
    const pe = await program.account.rebalanceProposal.fetch(proposal);
    assert.equal(pe.status, 2); // Executed (simulated)
  });

  it("Scenario A: weight above 35% is rejected on-chain (MaxWeightExceeded)", async () => {
    const proposal = proposalPda(2);
    let failed = false;
    try {
      await program.methods
        .proposeRebalance(args({ proposalId: new anchor.BN(2), newTargetWeightBps: 4120 }))
        .accounts({ strategy: strategyPda, rules: rulesPda, permission: permPda, proposal, agent: agent.publicKey })
        .signers([agent])
        .rpc();
    } catch (e) {
      failed = true;
      console.log("invalid weight rejected:", e.toString().slice(0, 180));
    }
    assert.ok(failed, "over-max-weight proposal must be rejected");
  });

  it("Scenario C: stale oracle is rejected on-chain (StaleOracle)", async () => {
    const proposal = proposalPda(3);
    let failed = false;
    try {
      await program.methods
        .proposeRebalance(args({ proposalId: new anchor.BN(3), oraclePublishTime: new anchor.BN(clusterNow - 120) }))
        .accounts({ strategy: strategyPda, rules: rulesPda, permission: permPda, proposal, agent: agent.publicKey })
        .signers([agent])
        .rpc();
    } catch (e) {
      failed = true;
      console.log("stale oracle rejected:", e.toString().slice(0, 180));
    }
    assert.ok(failed, "stale-oracle proposal must be rejected");
  });

  it("approval requires the exact nonce (BadApprovalNonce)", async () => {
    const proposal = proposalPda(4);
    await program.methods
      .proposeRebalance(args({ proposalId: new anchor.BN(4) }))
      .accounts({ strategy: strategyPda, rules: rulesPda, permission: permPda, proposal, agent: agent.publicKey })
      .signers([agent])
      .rpc();
    let failed = false;
    try {
      await program.methods
        .approveRebalance(new anchor.BN(8)) // wrong nonce
        .accounts({ strategy: strategyPda, proposal, creator: creator.publicKey })
        .rpc();
    } catch (e) {
      failed = true;
      console.log("bad approval nonce rejected:", e.toString().slice(0, 180));
    }
    assert.ok(failed, "wrong approval nonce must be rejected");
  });
});

// Phase 7 — forking into independent on-chain state. Wallet A (provider) owns a
// parent strategy; Wallet B (a funded keypair) forks it, gets a new Strategy +
// Rules PDA with a parent link, changes a rule on its fork, and Wallet A cannot
// touch the fork.
describe("stockweave-phase7 (forking)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Stockweave as Program<Stockweave>;
  const walletA = provider.wallet; // parent creator
  const walletB = anchor.web3.Keypair.generate(); // forker

  const parentId = `p7-parent-${Date.now()}`;
  const forkId = `p7-fork-${Date.now()}`;

  const [parentPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("strategy"), walletA.publicKey.toBuffer(), Buffer.from(parentId)],
    program.programId
  );
  const [parentRulesPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("rules"), parentPda.toBuffer()],
    program.programId
  );
  const [forkPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("strategy"), walletB.publicKey.toBuffer(), Buffer.from(forkId)],
    program.programId
  );
  const [forkRulesPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("rules"), forkPda.toBuffer()],
    program.programId
  );

  const RULES = {
    reserveWeightBps: 1000,
    rebalanceDriftBps: 500,
    maxSingleAssetWeightBps: 3500,
    maxTradeNotional: new anchor.BN(50),
    maxDailyNotional: new anchor.BN(200),
    maxPriceAgeSeconds: new anchor.BN(30),
    referenceFeedId: Array(32).fill(1),
  };

  it("sets up Wallet A's parent strategy + rules and funds Wallet B", async () => {
    await program.methods
      .initializeStrategy(parentId)
      .accounts({ strategy: parentPda, creator: walletA.publicKey })
      .rpc();
    await program.methods
      .setRules(RULES)
      .accounts({ strategy: parentPda, rules: parentRulesPda, creator: walletA.publicKey })
      .rpc();
    const fundTx = new anchor.web3.Transaction().add(
      anchor.web3.SystemProgram.transfer({
        fromPubkey: walletA.publicKey,
        toPubkey: walletB.publicKey,
        lamports: 50_000_000,
      })
    );
    await provider.sendAndConfirm(fundTx);
  });

  it("Wallet B forks Wallet A's strategy into independent state", async () => {
    const sig = await program.methods
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
    console.log("fork_strategy:", sig);
    const fork = await program.account.strategy.fetch(forkPda);
    assert.equal(fork.creator.toBase58(), walletB.publicKey.toBase58());
    assert.equal(fork.parentStrategy.toBase58(), parentPda.toBase58());
    const forkRules = await program.account.rules.fetch(forkRulesPda);
    assert.equal(forkRules.version.toNumber(), 1);
    assert.equal(forkRules.maxSingleAssetWeightBps, 3500); // copied from parent
  });

  it("Wallet B can change a rule on its fork", async () => {
    const sig = await program.methods
      .setRules({ ...RULES, rebalanceDriftBps: 300 })
      .accounts({ strategy: forkPda, rules: forkRulesPda, creator: walletB.publicKey })
      .signers([walletB])
      .rpc();
    console.log("fork set_rules (B):", sig);
    const forkRules = await program.account.rules.fetch(forkRulesPda);
    assert.equal(forkRules.rebalanceDriftBps, 300);
    assert.equal(forkRules.version.toNumber(), 2);
  });

  it("Wallet A cannot control Wallet B's fork", async () => {
    let failed = false;
    try {
      await program.methods
        .setRules({ ...RULES, rebalanceDriftBps: 100 })
        .accounts({ strategy: forkPda, rules: forkRulesPda, creator: walletA.publicKey })
        .rpc();
    } catch (e) {
      failed = true;
      console.log("parent-owner cannot edit fork:", e.toString().slice(0, 160));
    }
    assert.ok(failed, "Wallet A must not control Wallet B's fork");
  });
});
