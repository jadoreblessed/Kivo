use anchor_lang::prelude::*;
use anchor_lang::solana_program::program_option::COption;
use std::str::FromStr;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_2022::spl_token_2022;
use spl_token_2022::extension::{BaseStateWithExtensions, ExtensionType, StateWithExtensions};
use anchor_spl::token_interface::{self, Burn, Mint, MintTo, SetAuthority, TokenAccount, TokenInterface, TransferChecked};
use kivo_market_math as math;
mod graduation;
pub use graduation::{Graduate, CollectPoolFees};
pub(crate) use graduation::__client_accounts_graduate;
pub(crate) use graduation::__client_accounts_collect_pool_fees;

declare_id!("CDemMSGfs8N1JiMNN1iiEiitfRTq6G2ThcgkPv6u53wi");

const TOTAL_SUPPLY: u64 = 1_000_000_000_000_000;
const DECIMALS: u8 = 6;

#[program]
pub mod kivo_market {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, raise_lamports: u64, rules: RuleConfig, treasury: Pubkey,
        pool_creator_share_bps: u16, splits: Vec<CreatorShare>) -> Result<()> {
        rules.math().validate().map_err(map_math_error)?;
        let fixed_treasury=Pubkey::from_str(env!("KIVO_TREASURY_PUBKEY"))
            .map_err(|_| KivoError::InvalidTreasury)?;
        require_keys_eq!(treasury, fixed_treasury, KivoError::InvalidTreasury);
        require!(pool_creator_share_bps <= 8_000, KivoError::InvalidRules);
        require!(!splits.is_empty() && splits.len() <= 4, KivoError::InvalidRules);
        let mut total=0u32;
        for (i,share) in splits.iter().enumerate() {
            require!(share.wallet != Pubkey::default() && share.bps>0, KivoError::InvalidRules);
            require!(!splits[..i].iter().any(|prior| prior.wallet==share.wallet), KivoError::InvalidRules);
            total=total.checked_add(share.bps as u32).ok_or(KivoError::Overflow)?;
        }
        require!(total==10_000, KivoError::InvalidRules);
        let mint_info = ctx.accounts.mint.to_account_info();
        let mint_data = mint_info.try_borrow_data()?;
        let mint_extensions = StateWithExtensions::<spl_token_2022::state::Mint>::unpack(&mint_data)
            .map_err(|_| KivoError::InvalidMint)?;
        for extension in mint_extensions.get_extension_types().map_err(|_| KivoError::InvalidMint)? {
            require!(matches!(extension, ExtensionType::MetadataPointer | ExtensionType::TokenMetadata), KivoError::UnsupportedMintExtension);
        }
        drop(mint_data);
        let slot = Clock::get()?.slot;
        let start = math::Market::new(raise_lamports, slot).map_err(map_math_error)?;
        let market = &mut ctx.accounts.market;
        market.creator = ctx.accounts.creator.key();
        market.treasury = treasury;
        market.pool_creator_share_bps = pool_creator_share_bps;
        if let Some(blueprint) = &mut ctx.accounts.blueprint {
            require!(rules.try_to_vec()? == blueprint.rules.try_to_vec()?, KivoError::InvalidRules);
            market.blueprint=blueprint.key();
            market.royalty_author=blueprint.author;
            market.royalty_bps=blueprint.royalty_bps;
            blueprint.uses=blueprint.uses.checked_add(1).ok_or(KivoError::Overflow)?;
        }
        market.split_count=splits.len() as u8;
        for (index,share) in splits.iter().enumerate() {
            market.split_addresses[index]=share.wallet;
            market.split_bps[index]=share.bps;
        }
        market.mint = ctx.accounts.mint.key();
        market.bump = ctx.bumps.market;
        market.rules = rules;
        market.raise_lamports = start.raise_lamports;
        market.launch_slot = start.launch_slot;
        market.creator_first_buy_pending = true;
        let mint_key = ctx.accounts.mint.key();
        let signer_seeds: &[&[&[u8]]] = &[&[b"market", mint_key.as_ref(), &[market.bump]]];
        token_interface::mint_to(
            CpiContext::new(ctx.accounts.token_program.to_account_info(), MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: market.to_account_info(),
            }).with_signer(signer_seeds),
            TOTAL_SUPPLY,
        )?;
        token_interface::set_authority(
            CpiContext::new(ctx.accounts.token_program.to_account_info(), SetAuthority {
                account_or_mint: ctx.accounts.mint.to_account_info(),
                current_authority: market.to_account_info(),
            }).with_signer(signer_seeds),
            spl_token_2022::instruction::AuthorityType::MintTokens,
            None,
        )?;
        Ok(())
    }

    pub fn buy(ctx: Context<Trade>, gross_tokens: u64, max_lamports: u64) -> Result<()> {
        let market = &ctx.accounts.market;
        let is_creator = market.creator == ctx.accounts.trader.key();
        let quote = math::quote_buy(market.math(), market.rules.math(), gross_tokens, Clock::get()?.slot, is_creator)
            .map_err(map_math_error)?;
        require!(quote.total_payment <= max_lamports, KivoError::Slippage);
        anchor_lang::system_program::transfer(
            CpiContext::new(ctx.accounts.system_program.to_account_info(), anchor_lang::system_program::Transfer {
                from: ctx.accounts.trader.to_account_info(), to: market.to_account_info(),
            }), quote.total_payment,
        )?;
        let mint_key = ctx.accounts.mint.key();
        let signer_seeds: &[&[&[u8]]] = &[&[b"market", mint_key.as_ref(), &[market.bump]]];
        token_interface::transfer_checked(
            CpiContext::new(ctx.accounts.token_program.to_account_info(), TransferChecked {
                mint: ctx.accounts.mint.to_account_info(),
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.trader_tokens.to_account_info(),
                authority: market.to_account_info(),
            }).with_signer(signer_seeds), quote.delivered_tokens, DECIMALS,
        )?;
        if quote.burned_tokens > 0 {
            token_interface::burn(CpiContext::new(ctx.accounts.token_program.to_account_info(), Burn {
                mint: ctx.accounts.mint.to_account_info(),
                from: ctx.accounts.vault.to_account_info(),
                authority: market.to_account_info(),
            }).with_signer(signer_seeds), quote.burned_tokens)?;
        }
        if quote.pot_payout > 0 {
            pay_from_market(&ctx.accounts.market.to_account_info(), &ctx.accounts.trader.to_account_info(), quote.pot_payout)?;
        }
        ctx.accounts.market.apply(quote.next)?;
        emit!(TradeEvent { market: ctx.accounts.market.key(), trader: ctx.accounts.trader.key(), buy: true,
            tokens: quote.delivered_tokens, lamports: quote.total_payment });
        Ok(())
    }

    pub fn sell(ctx: Context<Trade>, tokens: u64, min_lamports: u64) -> Result<()> {
        let market = &ctx.accounts.market;
        let quote = math::quote_sell(market.math(), market.rules.math(), tokens).map_err(map_math_error)?;
        require!(quote.payout >= min_lamports, KivoError::Slippage);
        token_interface::transfer_checked(CpiContext::new(ctx.accounts.token_program.to_account_info(), TransferChecked {
            mint: ctx.accounts.mint.to_account_info(),
            from: ctx.accounts.trader_tokens.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
            authority: ctx.accounts.trader.to_account_info(),
        }), tokens, DECIMALS)?;
        pay_from_market(&ctx.accounts.market.to_account_info(), &ctx.accounts.trader.to_account_info(), quote.payout)?;
        ctx.accounts.market.apply(quote.next)?;
        emit!(TradeEvent { market: ctx.accounts.market.key(), trader: ctx.accounts.trader.key(), buy: false,
            tokens, lamports: quote.payout });
        Ok(())
    }

    pub fn claim_creator_fees(ctx: Context<ClaimFees>) -> Result<()> {
        require_keys_eq!(ctx.accounts.recipient.key(), ctx.accounts.market.creator, KivoError::InvalidRecipient);
        require!(ctx.accounts.market.split_count==1 &&
            ctx.accounts.market.split_addresses[0]==ctx.accounts.market.creator, KivoError::InvalidRecipient);
        let (amount, next) = math::claim_fees(ctx.accounts.market.math(), true).map_err(map_math_error)?;
        pay_from_market(&ctx.accounts.market.to_account_info(), &ctx.accounts.recipient.to_account_info(), amount)?;
        ctx.accounts.market.apply(next)?;
        ctx.accounts.market.split_accrued[0]=0;
        Ok(())
    }

    pub fn claim_split_fees(ctx: Context<ClaimFees>, index: u8) -> Result<()> {
        let market=&mut ctx.accounts.market;
        require!((index as usize)<market.split_count as usize, KivoError::InvalidRecipient);
        let index=index as usize;
        require_keys_eq!(ctx.accounts.recipient.key(),market.split_addresses[index],KivoError::InvalidRecipient);
        let amount=market.split_accrued[index];
        let remaining=market.reserve.checked_sub(amount).ok_or(KivoError::InsufficientReserve)?;
        if !market.graduated {
            require!(remaining>=math::curve_cost(market.raise_lamports,0,market.sold).map_err(map_math_error)?,KivoError::InsufficientReserve);
        }
        pay_from_market(&market.to_account_info(),&ctx.accounts.recipient.to_account_info(),amount)?;
        market.reserve=remaining;
        market.creator_fees=market.creator_fees.checked_sub(amount).ok_or(KivoError::InsufficientReserve)?;
        market.split_accrued[index]=0;
        Ok(())
    }

    pub fn claim_treasury_fees(ctx: Context<ClaimFees>) -> Result<()> {
        require_keys_eq!(ctx.accounts.recipient.key(), ctx.accounts.market.treasury, KivoError::InvalidRecipient);
        let (amount, next) = math::claim_fees(ctx.accounts.market.math(), false).map_err(map_math_error)?;
        pay_from_market(&ctx.accounts.market.to_account_info(), &ctx.accounts.recipient.to_account_info(), amount)?;
        ctx.accounts.market.apply(next)?;
        Ok(())
    }

    pub fn claim_royalty(ctx: Context<ClaimFees>) -> Result<()> {
        require!(ctx.accounts.market.royalty_bps>0,KivoError::InvalidRecipient);
        require_keys_eq!(ctx.accounts.recipient.key(),ctx.accounts.market.royalty_author,KivoError::InvalidRecipient);
        let (amount,next)=math::claim_royalty(ctx.accounts.market.math()).map_err(map_math_error)?;
        pay_from_market(&ctx.accounts.market.to_account_info(),&ctx.accounts.recipient.to_account_info(),amount)?;
        ctx.accounts.market.apply(next)?;
        Ok(())
    }

    pub fn publish_blueprint(ctx: Context<PublishBlueprint>, name: String, rules: RuleConfig,
        royalty_bps: u16) -> Result<()> {
        require!(!name.trim().is_empty() && name.len()<=32,KivoError::InvalidRules);
        rules.math().validate().map_err(map_math_error)?;
        require!(royalty_bps<=1_000 && (royalty_bps==0 || rules.lp_bps>0 || rules.pot_bps>0),KivoError::InvalidRules);
        let blueprint=&mut ctx.accounts.blueprint;
        blueprint.author=ctx.accounts.author.key();
        blueprint.name=name;
        blueprint.rules=rules;
        blueprint.royalty_bps=royalty_bps;
        blueprint.bump=ctx.bumps.blueprint;
        Ok(())
    }

    pub fn graduate(ctx: Context<Graduate>, sqrt_price: u128, liquidity: u128) -> Result<()> {
        graduation::graduate(ctx, sqrt_price, liquidity)
    }

    pub fn collect_pool_fees(ctx: Context<CollectPoolFees>) -> Result<()> {
        graduation::collect_pool_fees(ctx)
    }

    pub fn prepare_graduation(ctx: Context<PrepareGraduation>) -> Result<()> {
        let market = &mut ctx.accounts.market;
        require!(market.graduated && !market.migration_prepared && !market.migration_complete, KivoError::InvalidMigration);
        let mint = market.mint;
        require_keys_eq!(ctx.accounts.liquidity_authority.key(),
            Pubkey::find_program_address(&[b"liquidity", mint.as_ref()], &crate::ID).0, KivoError::InvalidMigration);
        require_keys_eq!(*ctx.accounts.liquidity_authority.to_account_info().owner, System::id(), KivoError::InvalidMigration);
        let pool_sol = market.reserve.checked_sub(market.creator_fees)
            .and_then(|n| n.checked_sub(market.treasury_fees))
            .and_then(|n| n.checked_sub(market.royalty_fees))
            .and_then(|n| n.checked_add(market.pot)).ok_or(KivoError::InsufficientReserve)?;
        require!(pool_sol > 0, KivoError::InvalidMigration);
        pay_from_market(&market.to_account_info(), &ctx.accounts.liquidity_authority.to_account_info(), pool_sol)?;
        market.reserve = market.creator_fees.checked_add(market.treasury_fees)
            .and_then(|n| n.checked_add(market.royalty_fees)).ok_or(KivoError::Overflow)?;
        market.pot = 0;
        market.prepared_sol = pool_sol;
        market.migration_prepared = true;
        Ok(())
    }
}

fn pay_from_market(market: &AccountInfo, recipient: &AccountInfo, amount: u64) -> Result<()> {
    let remaining = market.lamports().checked_sub(amount).ok_or(KivoError::InsufficientReserve)?;
    let rent = Rent::get()?.minimum_balance(market.data_len());
    require!(remaining >= rent, KivoError::InsufficientReserve);
    **market.try_borrow_mut_lamports()? = remaining;
    **recipient.try_borrow_mut_lamports()? = recipient.lamports().checked_add(amount).ok_or(KivoError::Overflow)?;
    Ok(())
}

fn map_math_error(error: math::Error) -> anchor_lang::error::Error {
    match error {
        math::Error::Overflow => KivoError::Overflow.into(),
        math::Error::InvalidRules => KivoError::InvalidRules.into(),
        math::Error::InvalidAmount => KivoError::InvalidAmount.into(),
        math::Error::InsufficientReserve => KivoError::InsufficientReserve.into(),
        math::Error::Slippage => KivoError::Slippage.into(),
        math::Error::SoldOut => KivoError::SoldOut.into(),
        math::Error::AlreadyGraduated => KivoError::AlreadyGraduated.into(),
        math::Error::GuardCap => KivoError::GuardCap.into(),
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)] pub creator: Signer<'info>,
    #[account(mut, constraint = mint.to_account_info().owner == &spl_token_2022::ID @ KivoError::InvalidMint,
        constraint = mint.decimals == DECIMALS @ KivoError::InvalidMint,
        constraint = mint.supply == 0 @ KivoError::InvalidMint,
        constraint = mint.mint_authority == COption::Some(market.key()) @ KivoError::InvalidMint,
        constraint = mint.freeze_authority == COption::None @ KivoError::InvalidMint)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(init, payer = creator, space = 8 + MarketState::INIT_SPACE,
        seeds = [b"market", mint.key().as_ref()], bump)]
    pub market: Account<'info, MarketState>,
    #[account(init, payer = creator, associated_token::mint = mint,
        associated_token::authority = market, associated_token::token_program = token_program)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)] pub blueprint: Option<Account<'info, Blueprint>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(name: String, rules: RuleConfig, royalty_bps: u16)]
pub struct PublishBlueprint<'info> {
    #[account(mut)] pub author: Signer<'info>,
    #[account(init, payer=author, space=8+Blueprint::INIT_SPACE,
        seeds=[b"blueprint",author.key().as_ref(),name.as_bytes()], bump)]
    pub blueprint: Account<'info,Blueprint>,
    pub system_program: Program<'info,System>,
}

#[derive(Accounts)]
pub struct Trade<'info> {
    #[account(mut)] pub trader: Signer<'info>,
    #[account(mut, address = market.mint @ KivoError::InvalidMint)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut, seeds = [b"market", mint.key().as_ref()], bump = market.bump)]
    pub market: Account<'info, MarketState>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = market,
        associated_token::token_program = token_program)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(init_if_needed, payer = trader, associated_token::mint = mint,
        associated_token::authority = trader, associated_token::token_program = token_program)]
    pub trader_tokens: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimFees<'info> {
    #[account(mut, seeds = [b"market", market.mint.as_ref()], bump = market.bump)]
    pub market: Account<'info, MarketState>,
    /// CHECK: Bound to the stored creator or treasury by each instruction.
    #[account(mut)] pub recipient: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct PrepareGraduation<'info> {
    #[account(mut, seeds = [b"market", market.mint.as_ref()], bump = market.bump)]
    pub market: Account<'info, MarketState>,
    /// CHECK: A system-owned PDA of this program, checked in the handler.
    #[account(mut)] pub liquidity_authority: UncheckedAccount<'info>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, Default)]
pub struct RuleConfig {
    pub base_bps: u16,
    pub surge_ceiling_bps: u16,
    pub surge_sensitivity: u8,
    pub guard_slots: u32,
    pub guard_cap_bps: u16,
    pub snipe_tax_bps: u16,
    pub burn_bps: u16,
    pub lp_bps: u16,
    pub pot_bps: u16,
    pub pot_every: u32,
    pub pot_min_lamports: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace)]
pub struct CreatorShare { pub wallet: Pubkey, pub bps: u16 }

#[account]
#[derive(InitSpace)]
pub struct Blueprint {
    pub author: Pubkey,
    #[max_len(32)] pub name: String,
    pub rules: RuleConfig,
    pub royalty_bps: u16,
    pub uses: u64,
    pub bump: u8,
}

impl RuleConfig {
    pub fn math(self) -> math::Rules {
        math::Rules { base_bps: self.base_bps, surge_ceiling_bps: self.surge_ceiling_bps,
            surge_sensitivity: self.surge_sensitivity, guard_slots: self.guard_slots,
            guard_cap_bps: self.guard_cap_bps, snipe_tax_bps: self.snipe_tax_bps,
            burn_bps: self.burn_bps, lp_bps: self.lp_bps, pot_bps: self.pot_bps,
            pot_every: self.pot_every, pot_min_lamports: self.pot_min_lamports }
    }
}

#[account]
#[derive(InitSpace)]
pub struct MarketState {
    pub creator: Pubkey,
    pub treasury: Pubkey,
    pub mint: Pubkey,
    pub bump: u8,
    pub rules: RuleConfig,
    pub raise_lamports: u64,
    pub sold: u64,
    pub reserve: u64,
    pub creator_fees: u64,
    pub treasury_fees: u64,
    pub pot: u64,
    pub buy_count: u64,
    pub launch_slot: u64,
    pub last_guard_slot: u64,
    pub guard_bought_in_slot: u64,
    pub last_pot_slot: u64,
    pub graduated: bool,
    pub creator_first_buy_pending: bool,
    pub migration_complete: bool,
    pub migration_prepared: bool,
    pub prepared_sol: u64,
    pub pool: Pubkey,
    pub pool_creator_share_bps: u16,
    pub split_count: u8,
    pub split_addresses: [Pubkey;4],
    pub split_bps: [u16;4],
    pub split_accrued: [u64;4],
    pub blueprint: Pubkey,
    pub royalty_author: Pubkey,
    pub royalty_bps: u16,
    pub royalty_fees: u64,
}

impl MarketState {
    fn math(&self) -> math::Market {
        math::Market { raise_lamports: self.raise_lamports, sold: self.sold,
            reserve: self.reserve, creator_fees: self.creator_fees,
            treasury_fees: self.treasury_fees, royalty_bps:self.royalty_bps,
            royalty_fees:self.royalty_fees,pot: self.pot, buy_count: self.buy_count,
            launch_slot: self.launch_slot, last_guard_slot: self.last_guard_slot,
            guard_bought_in_slot: self.guard_bought_in_slot, last_pot_slot: self.last_pot_slot,
            graduated: self.graduated, creator_first_buy_pending: self.creator_first_buy_pending }
    }
    fn apply(&mut self, next: math::Market) -> Result<()> {
        if next.creator_fees>self.creator_fees {
            self.credit_creator_split(next.creator_fees-self.creator_fees)?;
        }
        self.sold = next.sold; self.reserve = next.reserve;
        self.creator_fees = next.creator_fees; self.treasury_fees = next.treasury_fees;
        self.royalty_fees=next.royalty_fees;
        self.pot = next.pot;
        self.buy_count = next.buy_count; self.last_guard_slot = next.last_guard_slot;
        self.guard_bought_in_slot = next.guard_bought_in_slot; self.last_pot_slot = next.last_pot_slot;
        self.graduated = next.graduated;
        self.creator_first_buy_pending = next.creator_first_buy_pending;
        Ok(())
    }
    pub(crate) fn credit_creator_split(&mut self, amount: u64) -> Result<()> {
        let mut remaining=amount;
        for i in 0..self.split_count as usize {
            let cut=if i+1==self.split_count as usize {remaining} else {
                u64::try_from((amount as u128).checked_mul(self.split_bps[i] as u128)
                    .ok_or(KivoError::Overflow)? / 10_000).map_err(|_| KivoError::Overflow)?
            };
            remaining=remaining.checked_sub(cut).ok_or(KivoError::Overflow)?;
            self.split_accrued[i]=self.split_accrued[i].checked_add(cut).ok_or(KivoError::Overflow)?;
        }
        Ok(())
    }
}

#[event]
pub struct TradeEvent { pub market: Pubkey, pub trader: Pubkey, pub buy: bool, pub tokens: u64, pub lamports: u64 }

#[error_code]
pub enum KivoError {
    #[msg("Arithmetic overflow")] Overflow,
    #[msg("Invalid rule configuration")] InvalidRules,
    #[msg("Invalid amount")] InvalidAmount,
    #[msg("Insufficient market reserve")] InsufficientReserve,
    #[msg("Slippage exceeded")] Slippage,
    #[msg("Curve sold out")] SoldOut,
    #[msg("Curve has graduated")] AlreadyGraduated,
    #[msg("Guard cap reached for this slot")] GuardCap,
    #[msg("Mint does not match market requirements")] InvalidMint,
    #[msg("This mint extension is not supported by KIVO trading")] UnsupportedMintExtension,
    #[msg("Treasury address is invalid")] InvalidTreasury,
    #[msg("Fee recipient does not match the market")] InvalidRecipient,
    #[msg("Meteora migration accounts or amounts are invalid")] InvalidMigration,
}
