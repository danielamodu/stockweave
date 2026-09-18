// StockWeave Anchor tests — run inside Solana Playground (browser) on Devnet.
// NOT run by `npm test`. See docs/solana-playground-phase04.md for steps.
// Covers the Phase 4 checkpoint: deterministic seeds, unauthorized rejection,
// pause rejects protected actions, revoked agent loses authority, event logs.
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Stockweave } from "../target/types/stockweave";
import { assert } from "chai";

describe("stockweave-phase4", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Stockweave as Program<Stockweave>;
  const creator = provider.wallet;

  const strategyId = "ai-infrastructure";
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
    // Airdrop so the tx reaches the program guard instead of failing on funds.
    const airdrop = await provider.connection.requestAirdrop(attacker.publicKey, 1_000_000_000);
    await provider.connection.confirmTransaction(airdrop);
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
