//! StockWeave strategy accounts and lifecycle (Phase 4).
//!
//! Critical identity, assets, rules, and status live on-chain. Off-chain
//! services may propose actions but can never bypass these guards.
//!
//! Phase 5 adds the rebalance lifecycle: propose_rebalance / approve_rebalance /
//! execute_rebalance. The agent is an UNTRUSTED proposer — the program rejects
//! invalid proposals (max-weight, reserve, stale oracle, wrong feed, excessive
//! notional, revoked/expired permission) and a valid proposal cannot execute
//! until the creator approves it with the exact approval nonce. Oracle freshness
//! is enforced on-chain against the cluster Clock using a caller-supplied
//! snapshot (feed_id/price/publish_time); price authenticity is enforced
//! off-chain (see D-502). execute_rebalance is SIMULATE-only (D-503).
//!
//! DEPLOYED: Devnet program 2z9QVsHonA4QcZkwLAcb1P5BGyrTL9UYUrE45TrmqC2a,
//! verified on-chain 2026-09-19 (executable, BPF upgradeable loader).

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, MintTo, Token, TokenAccount, Transfer},
};
use pyth_solana_receiver_sdk::price_update::{get_feed_id_from_hex, PriceUpdateV2};

// Deployed on Devnet via Solana Playground; verified on-chain 2026-09-19
// (owner BPFLoaderUpgradeab1e11111111111111111111111, executable=true).
// This address is the program's identity — do not change it.
declare_id!("EVx3g8ooCpshuemiNz3bt3vqoYapu7XjPab86BbnrgYN");

#[program]
pub mod stockweave {
    use super::*;

    /// Create the strategy identity account. Creator becomes sole authority.
    pub fn initialize_strategy(ctx: Context<InitializeStrategy>, strategy_id: String) -> Result<()> {
        require!(strategy_id.len() > 0 && strategy_id.len() <= 64, StockWeaveError::BadStrategyId);
        let strategy = &mut ctx.accounts.strategy;
        strategy.creator = ctx.accounts.creator.key();
        strategy.strategy_id = strategy_id;
        strategy.parent_strategy = Pubkey::default();
        strategy.status = StrategyStatus::Active as u8;
        strategy.rules_hash = [0u8; 32];
        strategy.bump = ctx.bumps.strategy;
        emit!(StrategyCreated {
            strategy: strategy.key(),
            creator: strategy.creator,
            strategy_id: strategy.strategy_id.clone(),
        });
        Ok(())
    }

    /// Register one approved asset (mint + target weight). Creator only,
    /// rejected while paused. Arbitrary mints are rejected off-chain by the
    /// allowlist; on-chain we bind each asset PDA to its mint.
    pub fn set_assets(
        ctx: Context<SetAssets>,
        target_weight_bps: u16,
        max_weight_bps: u16,
    ) -> Result<()> {
        let strategy = &ctx.accounts.strategy;
        require!(strategy.status != StrategyStatus::Paused as u8, StockWeaveError::StrategyPaused);
        require!(
            ctx.accounts.creator.key() == strategy.creator,
            StockWeaveError::Unauthorized
        );
        require!(target_weight_bps as u32 <= 10_000, StockWeaveError::BadRules);
        require!(max_weight_bps as u32 <= 10_000, StockWeaveError::BadRules);
        let asset = &mut ctx.accounts.asset;
        asset.strategy = strategy.key();
        asset.mint = ctx.accounts.mint.key();
        asset.target_weight_bps = target_weight_bps;
        asset.max_weight_bps = max_weight_bps;
        asset.enabled = true;
        asset.bump = ctx.bumps.asset;
        Ok(())
    }

    /// Store the rule set hash + limits. Creator only, rejected while paused.
    pub fn set_rules(ctx: Context<SetRules>, rules: RuleSetParams) -> Result<()> {
        let strategy = &mut ctx.accounts.strategy;
        require!(strategy.status != StrategyStatus::Paused as u8, StockWeaveError::StrategyPaused);
        require!(
            ctx.accounts.creator.key() == strategy.creator,
            StockWeaveError::Unauthorized
        );
        require!(rules.max_single_asset_weight_bps as u32 <= 10_000, StockWeaveError::BadRules);
        require!(rules.reserve_weight_bps as u32 <= 10_000, StockWeaveError::BadRules);
        require!(rules.max_price_age_seconds > 0, StockWeaveError::BadRules);
        let rules_acct = &mut ctx.accounts.rules;
        rules_acct.strategy = strategy.key();
        rules_acct.reserve_weight_bps = rules.reserve_weight_bps;
        rules_acct.rebalance_drift_bps = rules.rebalance_drift_bps;
        rules_acct.max_single_asset_weight_bps = rules.max_single_asset_weight_bps;
        rules_acct.max_trade_notional = rules.max_trade_notional;
        rules_acct.max_daily_notional = rules.max_daily_notional;
        rules_acct.max_price_age_seconds = rules.max_price_age_seconds;
        rules_acct.reference_feed_id = rules.reference_feed_id;
        rules_acct.require_user_approval = true;
        rules_acct.version = rules_acct.version.checked_add(1).unwrap();
        rules_acct.bump = ctx.bumps.rules;
        // Bind the strategy to this rule-set version.
        strategy.rules_hash = rules_acct.key().to_bytes();
        emit!(RulesUpdated {
            strategy: strategy.key(),
            version: rules_acct.version,
        });
        Ok(())
    }

    /// Grant (or overwrite) an agent permission. Default mandate is
    /// READ + PROPOSE; execution stays opt-in and approval-gated.
    /// Creator only, rejected while paused.
    pub fn set_agent_permission(
        ctx: Context<SetAgentPermission>,
        allowed_actions: u8,
        max_notional_per_action: u64,
        max_daily_notional: u64,
        expiry: i64,
    ) -> Result<()> {
        let strategy = &ctx.accounts.strategy;
        require!(strategy.status != StrategyStatus::Paused as u8, StockWeaveError::StrategyPaused);
        require!(
            ctx.accounts.creator.key() == strategy.creator,
            StockWeaveError::Unauthorized
        );
        // Only known action bits may be set (READ=1, PROPOSE=2, EXECUTE=4).
        require!(allowed_actions & !0b111 == 0, StockWeaveError::BadPermission);
        let perm = &mut ctx.accounts.permission;
        perm.strategy = strategy.key();
        perm.agent = ctx.accounts.agent.key();
        perm.authority = ctx.accounts.creator.key();
        perm.allowed_actions = allowed_actions;
        perm.max_notional_per_action = max_notional_per_action;
        perm.max_daily_notional = max_daily_notional;
        perm.expiry = expiry;
        perm.approval_required = true;
        perm.revoked = false;
        perm.bump = ctx.bumps.permission;
        // action bit constants: READ=1, PROPOSE=2, EXECUTE=4.
        emit!(PermissionSet {
            strategy: strategy.key(),
            agent: perm.agent,
            allowed_actions,
        });
        Ok(())
    }

    /// Pause the strategy. Creator only. Protected actions fail while paused.
    pub fn pause_strategy(ctx: Context<StrategyAuthority>) -> Result<()> {
        let strategy = &mut ctx.accounts.strategy;
        require!(
            ctx.accounts.creator.key() == strategy.creator,
            StockWeaveError::Unauthorized
        );
        strategy.status = StrategyStatus::Paused as u8;
        emit!(StrategyPaused {
            strategy: strategy.key(),
        });
        Ok(())
    }

    /// Revoke an agent immediately. Creator only. The agent loses all authority,
    /// including pending proposal rights (enforced in Phase 5).
    pub fn revoke_agent(ctx: Context<RevokeAgent>) -> Result<()> {
        let strategy = &ctx.accounts.strategy;
        require!(
            ctx.accounts.creator.key() == strategy.creator,
            StockWeaveError::Unauthorized
        );
        let perm = &mut ctx.accounts.permission;
        require!(perm.strategy == strategy.key(), StockWeaveError::Unauthorized);
        perm.revoked = true;
        emit!(AgentRevoked {
            strategy: strategy.key(),
            agent: perm.agent,
        });
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Phase 5 — rebalance lifecycle. Agent proposes (untrusted), program guards
    // reject invalid proposals, creator approves, execution is simulate-only.
    // -----------------------------------------------------------------------

    /// Agent proposes a single-asset rebalance to a new target weight. Signed by
    /// the agent. Rejected on-chain for: paused strategy, wrong/expired/revoked
    /// permission, missing PROPOSE grant, wrong oracle feed, stale oracle,
    /// max-weight breach, reserve breach, or excessive notional. A successful
    /// call only records the proposal — it CANNOT execute without approval.
    pub fn propose_rebalance(ctx: Context<ProposeRebalance>, args: ProposeArgs) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let strategy = &ctx.accounts.strategy;
        let rules = &ctx.accounts.rules;
        let perm = &ctx.accounts.permission;

        // --- authority / permission guards ---
        require!(strategy.status != StrategyStatus::Paused as u8, StockWeaveError::StrategyPaused);
        require!(perm.strategy == strategy.key(), StockWeaveError::Unauthorized);
        require!(perm.agent == ctx.accounts.agent.key(), StockWeaveError::Unauthorized);
        require!(!perm.revoked, StockWeaveError::PermissionRevoked);
        require!(now < perm.expiry, StockWeaveError::PermissionExpired);
        // PROPOSE bit (0b010) must be granted.
        require!(perm.allowed_actions & 0b010 != 0, StockWeaveError::ProposeNotAllowed);

        // --- oracle guards (freshness enforced on-chain vs cluster Clock) ---
        require!(args.oracle_feed_id == rules.reference_feed_id, StockWeaveError::WrongFeed);
        require!(args.oracle_publish_time <= now, StockWeaveError::StaleOracle);
        let age = now.checked_sub(args.oracle_publish_time).unwrap_or(i64::MAX);
        require!(age <= rules.max_price_age_seconds as i64, StockWeaveError::StaleOracle);

        // --- risk guards ---
        require!(
            args.new_target_weight_bps <= rules.max_single_asset_weight_bps,
            StockWeaveError::MaxWeightExceeded
        );
        require!(
            args.projected_reserve_bps >= rules.reserve_weight_bps,
            StockWeaveError::ReserveBreach
        );
        require!(args.notional <= rules.max_trade_notional, StockWeaveError::ExcessiveNotional);
        require!(args.notional <= perm.max_notional_per_action, StockWeaveError::ExcessiveNotional);
        require!(args.expires_at > now, StockWeaveError::ProposalExpired);

        // Capture before taking the &mut borrow on a sibling account field.
        let strategy_key = strategy.key();
        let agent_key = ctx.accounts.agent.key();
        let proposal = &mut ctx.accounts.proposal;
        proposal.strategy = strategy_key;
        proposal.proposal_id = args.proposal_id;
        proposal.created_by = agent_key;
        proposal.mint = args.mint;
        proposal.new_target_weight_bps = args.new_target_weight_bps;
        proposal.projected_reserve_bps = args.projected_reserve_bps;
        proposal.notional = args.notional;
        proposal.reason_code = args.reason_code;
        proposal.oracle_feed_id = args.oracle_feed_id;
        proposal.oracle_price = args.oracle_price;
        proposal.oracle_publish_time = args.oracle_publish_time;
        proposal.approval_nonce = args.approval_nonce;
        proposal.expires_at = args.expires_at;
        proposal.status = ProposalStatus::Proposed as u8;
        proposal.bump = ctx.bumps.proposal;
        emit!(RebalanceProposed {
            strategy: strategy_key,
            proposal: proposal.key(),
            proposal_id: proposal.proposal_id,
            mint: proposal.mint,
            new_target_weight_bps: proposal.new_target_weight_bps,
            notional: proposal.notional,
        });
        Ok(())
    }

    /// Creator approves a pending proposal. The approval is bound to the exact
    /// proposal AND its approval nonce, and rejected if the proposal is expired
    /// or not in Proposed state.
    pub fn approve_rebalance(ctx: Context<ApproveRebalance>, approval_nonce: u64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let strategy_key = ctx.accounts.strategy.key();
        require!(
            ctx.accounts.strategy.status != StrategyStatus::Paused as u8,
            StockWeaveError::StrategyPaused
        );
        let proposal = &mut ctx.accounts.proposal;
        require!(proposal.strategy == strategy_key, StockWeaveError::Unauthorized);
        require!(proposal.status == ProposalStatus::Proposed as u8, StockWeaveError::BadProposalState);
        require!(now <= proposal.expires_at, StockWeaveError::ProposalExpired);
        require!(approval_nonce == proposal.approval_nonce, StockWeaveError::BadApprovalNonce);
        proposal.status = ProposalStatus::Approved as u8;
        emit!(RebalanceApproved {
            strategy: strategy_key,
            proposal: proposal.key(),
            proposal_id: proposal.proposal_id,
        });
        Ok(())
    }

    /// Simulate execution of an approved proposal (D-503: no custody/real swaps).
    /// Rejected unless the proposal is Approved, unexpired, and the strategy is
    /// active. Records the executed state and emits the lifecycle event.
    pub fn execute_rebalance(ctx: Context<ExecuteRebalance>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let strategy_key = ctx.accounts.strategy.key();
        require!(
            ctx.accounts.strategy.status != StrategyStatus::Paused as u8,
            StockWeaveError::StrategyPaused
        );
        let proposal = &mut ctx.accounts.proposal;
        require!(proposal.strategy == strategy_key, StockWeaveError::Unauthorized);
        require!(proposal.status == ProposalStatus::Approved as u8, StockWeaveError::BadProposalState);
        require!(now <= proposal.expires_at, StockWeaveError::ProposalExpired);
        proposal.status = ProposalStatus::Executed as u8;
        emit!(RebalanceExecuted {
            strategy: strategy_key,
            proposal: proposal.key(),
            proposal_id: proposal.proposal_id,
            new_target_weight_bps: proposal.new_target_weight_bps,
            simulated: true,
        });
        Ok(())
    }

    /// Phase 7 — fork a public strategy into INDEPENDENT on-chain state. The
    /// caller becomes the fork's sole creator/authority; the fork records its
    /// parent and copies the parent's rule template into its own Rules PDA
    /// (version reset to 1). The parent's creator has no authority over the
    /// fork, and the fork's agent/permissions/assets are set up fresh by the
    /// new owner (D-701). A copied frontend object is not a fork — this creates
    /// new PDAs owned by a new wallet.
    pub fn fork_strategy(ctx: Context<ForkStrategy>, new_strategy_id: String) -> Result<()> {
        require!(
            new_strategy_id.len() > 0 && new_strategy_id.len() <= 64,
            StockWeaveError::BadStrategyId
        );
        let parent_key = ctx.accounts.parent_strategy.key();
        let creator_key = ctx.accounts.creator.key();
        let pr = &ctx.accounts.parent_rules;
        // Snapshot parent rule values before mutably borrowing the fork rules.
        let (reserve, drift, max_w, max_trade, max_daily, max_age, feed) = (
            pr.reserve_weight_bps,
            pr.rebalance_drift_bps,
            pr.max_single_asset_weight_bps,
            pr.max_trade_notional,
            pr.max_daily_notional,
            pr.max_price_age_seconds,
            pr.reference_feed_id,
        );

        let fork = &mut ctx.accounts.fork_strategy;
        fork.creator = creator_key;
        fork.strategy_id = new_strategy_id;
        fork.parent_strategy = parent_key;
        fork.status = StrategyStatus::Active as u8;
        fork.rules_hash = [0u8; 32];
        fork.bump = ctx.bumps.fork_strategy;
        let fork_key = fork.key();

        let fr = &mut ctx.accounts.fork_rules;
        fr.strategy = fork_key;
        fr.reserve_weight_bps = reserve;
        fr.rebalance_drift_bps = drift;
        fr.max_single_asset_weight_bps = max_w;
        fr.max_trade_notional = max_trade;
        fr.max_daily_notional = max_daily;
        fr.max_price_age_seconds = max_age;
        fr.reference_feed_id = feed;
        fr.require_user_approval = true;
        fr.version = 1;
        fr.bump = ctx.bumps.fork_rules;

        // Bind the fork to its own (independent) rule-set account.
        ctx.accounts.fork_strategy.rules_hash = fork_key.to_bytes();

        emit!(StrategyForked {
            parent: parent_key,
            fork: fork_key,
            creator: creator_key,
        });
        Ok(())
    }

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

    /// Stage 6 (Devnet mirror) — test-USDC faucet. Mints capped Devnet USDC-mirror
    /// to the caller so a wallet has cash to subscribe with. The vault PDA is the
    /// mint authority (no server key — the program itself signs). Devnet demo
    /// convenience only; there is no mainnet counterpart.
    pub fn faucet_usdc(ctx: Context<FaucetUsdc>, amount: u64) -> Result<()> {
        require!(
            amount > 0 && amount <= 1_000_000_000_000,
            StockWeaveError::BadFaucetAmount
        );
        let bump = ctx.bumps.vault;
        let seeds: &[&[u8]] = &[b"vault", &[bump]];
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.usdc_mint.to_account_info(),
                    to: ctx.accounts.recipient_usdc_ata.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                },
                &[seeds],
            ),
            amount,
        )?;
        Ok(())
    }
    /// Stage 6 (Devnet mirror) — REAL on-chain buy "through the program". The
    /// buyer pays `usdc_in` USDC into the strategy treasury (buyer-signed transfer)
    /// and the program mints `asset_qty` of the asset's mirror token to the buyer
    /// (vault-signed mint_to). Atomic: cash out, shares in. The asset PDA binds the
    /// mint to this strategy and must be enabled. This reopens D-503 for Devnet:
    /// the program now custodies USDC and issues mirror tokens (documented).
    pub fn subscribe(ctx: Context<Subscribe>, usdc_in: u64, asset_qty: u64) -> Result<()> {
        require!(usdc_in > 0 && asset_qty > 0, StockWeaveError::BadSubscription);
        require!(
            ctx.accounts.strategy.status != StrategyStatus::Paused as u8,
            StockWeaveError::StrategyPaused
        );
        require!(ctx.accounts.asset.enabled, StockWeaveError::AssetDisabled);
        // 1) Buyer pays USDC into the treasury (buyer authority signs).
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.buyer_usdc_ata.to_account_info(),
                    to: ctx.accounts.treasury_usdc_ata.to_account_info(),
                    authority: ctx.accounts.buyer.to_account_info(),
                },
            ),
            usdc_in,
        )?;
        // 2) Program mints the mirror asset to the buyer (vault PDA authority signs).
        let bump = ctx.bumps.vault;
        let seeds: &[&[u8]] = &[b"vault", &[bump]];
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.asset_mint.to_account_info(),
                    to: ctx.accounts.buyer_asset_ata.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                },
                &[seeds],
            ),
            asset_qty,
        )?;
        emit!(Subscribed {
            strategy: ctx.accounts.strategy.key(),
            buyer: ctx.accounts.buyer.key(),
            asset_mint: ctx.accounts.asset_mint.key(),
            usdc_in,
            asset_qty,
        });
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum StrategyStatus {
    Active = 0,
    Paused = 1,
    Archived = 2,
}

#[account]
pub struct Strategy {
    pub creator: Pubkey,
    pub strategy_id: String,
    pub parent_strategy: Pubkey,
    pub status: u8,
    pub rules_hash: [u8; 32],
    pub bump: u8,
}

#[account]
pub struct Rules {
    pub strategy: Pubkey,
    pub reserve_weight_bps: u16,
    pub rebalance_drift_bps: u16,
    pub max_single_asset_weight_bps: u16,
    pub max_trade_notional: u64,
    pub max_daily_notional: u64,
    pub max_price_age_seconds: u64,
    // Expected Pyth feed id for the strategy's reference market; a proposal
    // carrying any other feed id is rejected (WrongFeed). All-zero = unset.
    pub reference_feed_id: [u8; 32],
    pub require_user_approval: bool,
    pub version: u64,
    pub bump: u8,
}

#[account]
pub struct StrategyAsset {
    pub strategy: Pubkey,
    pub mint: Pubkey,
    pub target_weight_bps: u16,
    pub max_weight_bps: u16,
    pub enabled: bool,
    pub bump: u8,
}

#[account]
pub struct AgentPermission {
    pub strategy: Pubkey,
    pub agent: Pubkey,
    pub authority: Pubkey,
    pub allowed_actions: u8,
    pub max_notional_per_action: u64,
    pub max_daily_notional: u64,
    pub expiry: i64,
    pub approval_required: bool,
    pub revoked: bool,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct RuleSetParams {
    pub reserve_weight_bps: u16,
    pub rebalance_drift_bps: u16,
    pub max_single_asset_weight_bps: u16,
    pub max_trade_notional: u64,
    pub max_daily_notional: u64,
    pub max_price_age_seconds: u64,
    pub reference_feed_id: [u8; 32],
}

#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum ProposalStatus {
    Proposed = 0,
    Approved = 1,
    Executed = 2,
    Rejected = 3,
    Expired = 4,
}

#[account]
pub struct RebalanceProposal {
    pub strategy: Pubkey,
    pub proposal_id: u64,
    pub created_by: Pubkey,
    pub mint: Pubkey,
    pub new_target_weight_bps: u16,
    pub projected_reserve_bps: u16,
    pub notional: u64,
    pub reason_code: u8,
    pub oracle_feed_id: [u8; 32],
    pub oracle_price: i64,
    pub oracle_publish_time: i64,
    pub approval_nonce: u64,
    pub expires_at: i64,
    pub status: u8,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ProposeArgs {
    pub proposal_id: u64,
    pub mint: Pubkey,
    pub new_target_weight_bps: u16,
    pub projected_reserve_bps: u16,
    pub notional: u64,
    pub reason_code: u8,
    pub oracle_feed_id: [u8; 32],
    pub oracle_price: i64,
    pub oracle_publish_time: i64,
    pub approval_nonce: u64,
    pub expires_at: i64,
}

// Deterministic seeds — identical inputs always derive identical addresses.
#[derive(Accounts)]
#[instruction(strategy_id: String)]
pub struct InitializeStrategy<'info> {
    #[account(
        init,
        payer = creator,
        space = 8 + 32 + (4 + 64) + 32 + 1 + 32 + 1,
        seeds = [b"strategy", creator.key().as_ref(), strategy_id.as_bytes()],
        bump
    )]
    pub strategy: Account<'info, Strategy>,
    #[account(mut)]
    pub creator: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetAssets<'info> {
    #[account(mut, has_one = creator)]
    pub strategy: Account<'info, Strategy>,
    #[account(
        init_if_needed,
        payer = creator,
        space = 8 + 32 + 32 + 2 + 2 + 1 + 1,
        seeds = [b"asset", strategy.key().as_ref(), mint.key().as_ref()],
        bump
    )]
    pub asset: Account<'info, StrategyAsset>,
    /// CHECK: mint address is bound into the asset PDA seeds; allowlist enforced off-chain.
    pub mint: UncheckedAccount<'info>,
    #[account(mut)]
    pub creator: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetRules<'info> {
    #[account(mut, has_one = creator)]
    pub strategy: Account<'info, Strategy>,
    #[account(
        init_if_needed,
        payer = creator,
        // disc + strategy + 3xu16 + 3xu64 + feed_id[32] + bool + version u64 + bump
        space = 8 + 32 + 2 + 2 + 2 + 8 + 8 + 8 + 32 + 1 + 8 + 1,
        seeds = [b"rules", strategy.key().as_ref()],
        bump
    )]
    pub rules: Account<'info, Rules>,
    #[account(mut)]
    pub creator: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetAgentPermission<'info> {
    #[account(mut, has_one = creator)]
    pub strategy: Account<'info, Strategy>,
    #[account(
        init_if_needed,
        payer = creator,
        space = 8 + 32 + 32 + 32 + 1 + 8 + 8 + 8 + 1 + 1 + 1,
        seeds = [b"permission", strategy.key().as_ref(), agent.key().as_ref()],
        bump
    )]
    pub permission: Account<'info, AgentPermission>,
    /// CHECK: agent identity key bound into the permission PDA seeds.
    pub agent: UncheckedAccount<'info>,
    #[account(mut)]
    pub creator: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct StrategyAuthority<'info> {
    #[account(mut, has_one = creator)]
    pub strategy: Account<'info, Strategy>,
    pub creator: Signer<'info>,
}

#[derive(Accounts)]
pub struct RevokeAgent<'info> {
    #[account(has_one = creator)]
    pub strategy: Account<'info, Strategy>,
    #[account(mut)]
    pub permission: Account<'info, AgentPermission>,
    pub creator: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(args: ProposeArgs)]
pub struct ProposeRebalance<'info> {
    pub strategy: Account<'info, Strategy>,
    #[account(seeds = [b"rules", strategy.key().as_ref()], bump = rules.bump)]
    pub rules: Account<'info, Rules>,
    #[account(
        seeds = [b"permission", strategy.key().as_ref(), agent.key().as_ref()],
        bump = permission.bump
    )]
    pub permission: Account<'info, AgentPermission>,
    #[account(
        init,
        payer = agent,
        // disc + strategy + id + created_by + mint + 2xu16 + notional + reason
        //   + feed[32] + price + publish + nonce + expires + status + bump
        space = 8 + 32 + 8 + 32 + 32 + 2 + 2 + 8 + 1 + 32 + 8 + 8 + 8 + 8 + 1 + 1,
        seeds = [b"proposal", strategy.key().as_ref(), args.proposal_id.to_le_bytes().as_ref()],
        bump
    )]
    pub proposal: Account<'info, RebalanceProposal>,
    #[account(mut)]
    pub agent: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ApproveRebalance<'info> {
    #[account(has_one = creator)]
    pub strategy: Account<'info, Strategy>,
    #[account(
        mut,
        seeds = [b"proposal", strategy.key().as_ref(), proposal.proposal_id.to_le_bytes().as_ref()],
        bump = proposal.bump
    )]
    pub proposal: Account<'info, RebalanceProposal>,
    pub creator: Signer<'info>,
}

#[derive(Accounts)]
pub struct ExecuteRebalance<'info> {
    #[account(has_one = creator)]
    pub strategy: Account<'info, Strategy>,
    #[account(
        mut,
        seeds = [b"proposal", strategy.key().as_ref(), proposal.proposal_id.to_le_bytes().as_ref()],
        bump = proposal.bump
    )]
    pub proposal: Account<'info, RebalanceProposal>,
    pub creator: Signer<'info>,
}

#[derive(Accounts)]
pub struct VerifyReferenceOracle<'info> {
    pub price_update: Account<'info, PriceUpdateV2>,
}

#[derive(Accounts)]
#[instruction(new_strategy_id: String)]
pub struct ForkStrategy<'info> {
    // Parent (read-only source). Any wallet may fork a public strategy.
    pub parent_strategy: Account<'info, Strategy>,
    #[account(
        seeds = [b"rules", parent_strategy.key().as_ref()],
        bump = parent_rules.bump
    )]
    pub parent_rules: Account<'info, Rules>,
    // The fork: a brand-new Strategy PDA owned by the caller.
    #[account(
        init,
        payer = creator,
        space = 8 + 32 + (4 + 64) + 32 + 1 + 32 + 1,
        seeds = [b"strategy", creator.key().as_ref(), new_strategy_id.as_bytes()],
        bump
    )]
    pub fork_strategy: Account<'info, Strategy>,
    #[account(
        init,
        payer = creator,
        space = 8 + 32 + 2 + 2 + 2 + 8 + 8 + 8 + 32 + 1 + 8 + 1,
        seeds = [b"rules", fork_strategy.key().as_ref()],
        bump
    )]
    pub fork_rules: Account<'info, Rules>,
    #[account(mut)]
    pub creator: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FaucetUsdc<'info> {
    // Boxed to keep try_accounts' stack frame under the 4KB SBF limit.
    #[account(mut)]
    pub usdc_mint: Box<Account<'info, Mint>>,
    /// CHECK: program vault PDA — mint authority for every mirror mint. Not read
    /// or written as data; only used as the CPI signer via its seeds.
    #[account(seeds = [b"vault"], bump)]
    pub vault: UncheckedAccount<'info>,
    #[account(mut)]
    pub recipient: Signer<'info>,
    #[account(
        init_if_needed,
        payer = recipient,
        associated_token::mint = usdc_mint,
        associated_token::authority = recipient,
    )]
    pub recipient_usdc_ata: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct Subscribe<'info> {
    // Every Account is boxed so try_accounts' generated stack frame stays under
    // the 4KB SBF limit — the two init_if_needed ATAs alone overflow it unboxed.
    // The strategy being bought into (read-only identity).
    pub strategy: Box<Account<'info, Strategy>>,
    #[account(mut)]
    pub asset_mint: Box<Account<'info, Mint>>,
    pub usdc_mint: Box<Account<'info, Mint>>,
    // Binds asset_mint to this strategy and must be enabled — the buyer can only
    // ever mint an asset that genuinely belongs to the strategy.
    #[account(
        seeds = [b"asset", strategy.key().as_ref(), asset_mint.key().as_ref()],
        bump = asset.bump,
        constraint = asset.strategy == strategy.key() @ StockWeaveError::Unauthorized,
    )]
    pub asset: Box<Account<'info, StrategyAsset>>,
    /// CHECK: program vault PDA — mint authority + treasury owner. CPI signer only.
    #[account(seeds = [b"vault"], bump)]
    pub vault: UncheckedAccount<'info>,
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(
        init_if_needed,
        payer = buyer,
        associated_token::mint = asset_mint,
        associated_token::authority = buyer,
    )]
    pub buyer_asset_ata: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = buyer,
    )]
    pub buyer_usdc_ata: Box<Account<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = buyer,
        associated_token::mint = usdc_mint,
        associated_token::authority = vault,
    )]
    pub treasury_usdc_ata: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[event]
pub struct StrategyCreated {
    pub strategy: Pubkey,
    pub creator: Pubkey,
    pub strategy_id: String,
}

#[event]
pub struct RulesUpdated {
    pub strategy: Pubkey,
    pub version: u64,
}

#[event]
pub struct PermissionSet {
    pub strategy: Pubkey,
    pub agent: Pubkey,
    pub allowed_actions: u8,
}

#[event]
pub struct StrategyPaused {
    pub strategy: Pubkey,
}

#[event]
pub struct AgentRevoked {
    pub strategy: Pubkey,
    pub agent: Pubkey,
}

#[event]
pub struct RebalanceProposed {
    pub strategy: Pubkey,
    pub proposal: Pubkey,
    pub proposal_id: u64,
    pub mint: Pubkey,
    pub new_target_weight_bps: u16,
    pub notional: u64,
}

#[event]
pub struct RebalanceApproved {
    pub strategy: Pubkey,
    pub proposal: Pubkey,
    pub proposal_id: u64,
}

#[event]
pub struct RebalanceExecuted {
    pub strategy: Pubkey,
    pub proposal: Pubkey,
    pub proposal_id: u64,
    pub new_target_weight_bps: u16,
    pub simulated: bool,
}

#[event]
pub struct StrategyForked {
    pub parent: Pubkey,
    pub fork: Pubkey,
    pub creator: Pubkey,
}

#[event]
pub struct ReferenceOracleVerified {
    pub feed_id: [u8; 32],
    pub price: i64,
    pub exponent: i32,
    pub conf: u64,
    pub publish_time: i64,
}

#[event]
pub struct Subscribed {
    pub strategy: Pubkey,
    pub buyer: Pubkey,
    pub asset_mint: Pubkey,
    pub usdc_in: u64,
    pub asset_qty: u64,
}

#[error_code]
pub enum StockWeaveError {
    #[msg("Signer is not the strategy creator/authority.")]
    Unauthorized,
    #[msg("Strategy is paused; protected actions are rejected.")]
    StrategyPaused,
    #[msg("Invalid strategy id.")]
    BadStrategyId,
    #[msg("Rule parameters out of range.")]
    BadRules,
    #[msg("Unknown permission action bits.")]
    BadPermission,
    #[msg("Agent permission has been revoked.")]
    PermissionRevoked,
    #[msg("Agent permission has expired.")]
    PermissionExpired,
    #[msg("Agent lacks the PROPOSE grant.")]
    ProposeNotAllowed,
    #[msg("Oracle feed id does not match the strategy reference feed.")]
    WrongFeed,
    #[msg("Oracle price is stale (older than max_price_age_seconds).")]
    StaleOracle,
    #[msg("Proposed weight exceeds the maximum single-asset weight.")]
    MaxWeightExceeded,
    #[msg("Projected USDC reserve is below the minimum.")]
    ReserveBreach,
    #[msg("Trade notional exceeds a per-action limit.")]
    ExcessiveNotional,
    #[msg("Proposal is expired or its expiry is not in the future.")]
    ProposalExpired,
    #[msg("Approval nonce does not match the proposal.")]
    BadApprovalNonce,
    #[msg("Proposal is not in the required state.")]
    BadProposalState,
    #[msg("Faucet amount must be > 0 and <= 1,000,000 USDC.")]
    BadFaucetAmount,
    #[msg("Subscription amounts must be positive.")]
    BadSubscription,
    #[msg("Asset is disabled for this strategy.")]
    AssetDisabled,
}
