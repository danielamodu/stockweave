# Phase 5 stage 5b — trustless Pyth (PENDING / BLOCKED in Playground)

Status: **BLOCKED** in Solana Playground. Playground's Rust build ships a fixed
crate set and cannot resolve `pyth-solana-receiver-sdk`
(`error[E0433]: use of undeclared crate pyth_solana_receiver_sdk`), and there is
no local Solana toolchain on the PC (project constraint). Phase 5 is complete
via stage 5a, which already enforces oracle freshness on-chain (StaleOracle,
error 6009, proven on Devnet). Stage 5b is the *extra* trustless-authenticity
demo for the Pyth bounty.

## How to unblock (before final submission)

Build in a Pyth-capable environment (GitHub Codespaces with Anchor, or a local
`anchor` toolchain), NOT Playground. Then deploy the upgrade to Devnet and run
the `stockweave-phase5b` tests. The verbatim code to re-apply is below.

## Cargo.toml (add under [dependencies])

```toml
pyth-solana-receiver-sdk = "0.6.1"
# Fallback ladder if the Solana toolchain version conflicts: 0.6.1 → 0.4.0 → 2.0.0
```

## src/lib.rs — import (top of file)

```rust
use pyth_solana_receiver_sdk::price_update::{get_feed_id_from_hex, PriceUpdateV2};
```

## src/lib.rs — instruction (inside #[program] mod)

```rust
/// Stage 5b — trustless Pyth. Reads a REAL PriceUpdateV2 and enforces freshness
/// on-chain (get_price_no_older_than reverts if stale or wrong feed). Anchor's
/// Account<PriceUpdateV2> verifies Pyth ownership. BORROWED reference feed
/// (SOL/USD) — NOT a basket asset price (pre-IPO assets have no feed, D-203).
pub fn verify_reference_oracle(
    ctx: Context<VerifyReferenceOracle>,
    feed_id_hex: String,
    maximum_age_seconds: u64,
) -> Result<()> {
    let feed_id = get_feed_id_from_hex(&feed_id_hex)?;
    let price = ctx
        .accounts
        .price_update
        .get_price_no_older_than(&Clock::get()?, maximum_age_seconds, &feed_id)?;
    emit!(ReferenceOracleVerified {
        feed_id,
        price: price.price,
        exponent: price.exponent,
        conf: price.conf,
        publish_time: price.publish_time,
    });
    Ok(())
}
```

## src/lib.rs — accounts context + event

```rust
#[derive(Accounts)]
pub struct VerifyReferenceOracle<'info> {
    pub price_update: Account<'info, PriceUpdateV2>,
}

#[event]
pub struct ReferenceOracleVerified {
    pub feed_id: [u8; 32],
    pub price: i64,
    pub exponent: i32,
    pub conf: u64,
    pub publish_time: i64,
}
```

## tests/stockweave.ts — append (new describe block)

```ts
describe("stockweave-phase5b (Pyth receiver — borrowed SOL/USD feed)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Stockweave as Program<Stockweave>;

  const SOL_USD_FEED_HEX = "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
  const PRICE_FEED_PROGRAM = new anchor.web3.PublicKey("pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT");

  function priceFeedAccount(shard: number, feedHex: string) {
    const feedId = Buffer.from(feedHex.replace(/^0x/, ""), "hex");
    const shardBuf = Buffer.alloc(2);
    shardBuf.writeUInt16LE(shard, 0);
    return anchor.web3.PublicKey.findProgramAddressSync([shardBuf, feedId], PRICE_FEED_PROGRAM)[0];
  }
  const priceUpdate = priceFeedAccount(0, SOL_USD_FEED_HEX);

  it("reads the real SOL/USD Pyth price update on-chain (trustless fresh read)", async () => {
    const sig = await program.methods
      .verifyReferenceOracle(SOL_USD_FEED_HEX, new anchor.BN(3600))
      .accounts({ priceUpdate })
      .rpc();
    console.log("verify_reference_oracle (fresh read):", sig);
    console.log("price feed account:", priceUpdate.toBase58());
  });

  it("enforces freshness trustlessly: max_age=1s rejects a real feed (PriceTooOld)", async () => {
    let msg = "";
    try {
      await program.methods
        .verifyReferenceOracle(SOL_USD_FEED_HEX, new anchor.BN(1))
        .accounts({ priceUpdate })
        .rpc();
    } catch (e) {
      msg = e.toString();
      console.log("trustless staleness rejection:", msg.slice(0, 200));
    }
    assert.ok(/TooOld|older|PriceTooOld|stale/i.test(msg), "expected a PriceTooOld freshness rejection");
  });
});
```

## Verification checklist when unblocked

- [ ] Confirm SOL/USD feed id against https://www.pyth.network/developers/price-feed-ids
- [ ] Confirm the sponsored SOL/USD PriceUpdateV2 exists + is maintained on Devnet
      (if not, use the Hermes pull flow: post an update, read the ephemeral account)
- [ ] `anchor test` → fresh read succeeds; max_age=1s rejects with PriceTooOld
- [ ] Record the fresh-read signature + rejection reason in docs/checkpoints/phase-05.md
