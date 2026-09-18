//! StockWeave strategy accounts and lifecycle (Phase 4).
//!
//! Critical identity, assets, rules, and status live on-chain. Off-chain
//! services may propose actions but can never bypass these guards.
//! Proposal + approval instructions arrive in Phase 5.
//!
//! DEPLOY NOTE: the `declare_id!` below is a compile-only placeholder.
//! Solana Playground generates the real keypair on deploy and patches this
//! value. No program ID is claimed until the Playground deploy step in
//! docs/solana-playground-phase04.md is run.

use anchor_lang::prelude::*;

// Compile-only placeholder. Replaced by the Playground-generated keypair.
declare_id!("11111111111111111111111111111111");

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
        space = 8 + 32 + 2 + 2 + 2 + 8 + 8 + 8 + 1 + 8 + 1,
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
}
