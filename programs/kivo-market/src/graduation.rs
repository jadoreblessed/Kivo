//! Atomic DAMM v2 pool creation and permanent liquidity lock.
//! Account layout and the instruction discriminator are pinned to the
//! Meteora DAMM v2 cp-amm source; changing its ABI requires a new review.
use super::*;
use anchor_lang::solana_program::{instruction::{AccountMeta, Instruction}, program::invoke_signed};
use anchor_spl::token::{self, Token};
use anchor_spl::token_interface::{CloseAccount, SyncNative};

const DAMM: Pubkey = pubkey!("cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG");
const POOL_IX: [u8; 8] = [0x14, 0xa1, 0xf1, 0x18, 0xbd, 0xdd, 0xb4, 0x02];
const LOCK_IX: [u8; 8] = [0xa5, 0xb0, 0x7d, 0x06, 0xe7, 0xab, 0xba, 0xd5];
const CLAIM_IX: [u8; 8] = [0xb4, 0x26, 0x9a, 0x11, 0x85, 0x21, 0xa2, 0xd3];
const DEAD_LIQUIDITY: u128 = 100u128 << 64;
const RENT_BUDGET: u64 = 500_000_000;

#[derive(Accounts)]
pub struct Graduate<'info> {
    #[account(mut)] pub cranker: Signer<'info>,
    #[account(mut, address = market.mint @ KivoError::InvalidMint)] pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut, seeds = [b"market", mint.key().as_ref()], bump = market.bump)]
    pub market: Account<'info, MarketState>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = market,
        associated_token::token_program = token_2022_program)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: A KIVO PDA owned by the system program, validated before CPI.
    #[account(mut)] pub liquidity_authority: UncheckedAccount<'info>,
    #[account(init_if_needed, payer = cranker, associated_token::mint = mint,
        associated_token::authority = liquidity_authority, associated_token::token_program = token_2022_program)]
    pub liquidity_tokens: InterfaceAccount<'info, TokenAccount>,
    #[account(address = token::spl_token::native_mint::ID)] pub wrapped_mint: InterfaceAccount<'info, Mint>,
    #[account(init_if_needed, payer = cranker, associated_token::mint = wrapped_mint,
        associated_token::authority = liquidity_authority, associated_token::token_program = legacy_token_program)]
    pub wrapped_sol: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: DAMM v2 checks this signer and initializes the mint.
    #[account(mut)] pub position_nft_mint: UncheckedAccount<'info>,
    /// CHECK: DAMM v2 derives and initializes the NFT holding account.
    #[account(mut)] pub position_nft_account: UncheckedAccount<'info>,
    /// CHECK: DAMM v2 validates its authority PDA.
    pub pool_authority: UncheckedAccount<'info>,
    /// CHECK: DAMM v2 derives and initializes the customizable pool.
    #[account(mut)] pub pool: UncheckedAccount<'info>,
    /// CHECK: DAMM v2 derives and initializes the position.
    #[account(mut)] pub position: UncheckedAccount<'info>,
    /// CHECK: DAMM v2 derives and initializes the token vault.
    #[account(mut)] pub token_a_vault: UncheckedAccount<'info>,
    /// CHECK: DAMM v2 derives and initializes the token vault.
    #[account(mut)] pub token_b_vault: UncheckedAccount<'info>,
    /// CHECK: DAMM v2 validates its event authority PDA.
    pub event_authority: UncheckedAccount<'info>,
    /// CHECK: Pinned DAMM v2 program ID and executable account.
    #[account(address = DAMM, executable)] pub damm_program: UncheckedAccount<'info>,
    pub token_2022_program: Program<'info, anchor_spl::token_2022::Token2022>,
    pub legacy_token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CollectPoolFees<'info> {
    #[account(mut)] pub cranker: Signer<'info>,
    #[account(address = market.mint @ KivoError::InvalidMint)] pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut, seeds = [b"market", mint.key().as_ref()], bump = market.bump)]
    pub market: Account<'info, MarketState>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = market,
        associated_token::token_program = token_2022_program)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(address = token::spl_token::native_mint::ID)] pub wrapped_mint: InterfaceAccount<'info, Mint>,
    #[account(init_if_needed, payer = cranker, associated_token::mint = wrapped_mint,
        associated_token::authority = market, associated_token::token_program = legacy_token_program)]
    pub wrapped_sol: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: Validated by DAMM v2 against the immutable pool position.
    pub position_nft_account: UncheckedAccount<'info>,
    /// CHECK: Meteora's pool authority PDA, checked here and by DAMM.
    pub pool_authority: UncheckedAccount<'info>,
    /// CHECK: The stored DAMM pool, checked against market.pool.
    pub pool: UncheckedAccount<'info>,
    /// CHECK: Derived position PDA and validated by DAMM.
    #[account(mut)] pub position: UncheckedAccount<'info>,
    /// CHECK: DAMM verifies token vaults against pool state.
    #[account(mut)] pub token_a_vault: UncheckedAccount<'info>,
    /// CHECK: DAMM verifies token vaults against pool state.
    #[account(mut)] pub token_b_vault: UncheckedAccount<'info>,
    /// CHECK: DAMM event authority PDA.
    pub event_authority: UncheckedAccount<'info>,
    /// CHECK: Pinned DAMM v2 program ID.
    #[account(address = DAMM, executable)] pub damm_program: UncheckedAccount<'info>,
    pub token_2022_program: Program<'info, anchor_spl::token_2022::Token2022>,
    pub legacy_token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn collect_pool_fees(mut ctx: Context<CollectPoolFees>) -> Result<()> {
    let a=&mut ctx.accounts;
    require!(a.market.migration_complete && a.wrapped_sol.amount == 0 && a.vault.amount == 0,
        KivoError::InvalidMigration);
    require_keys_eq!(a.pool.key(), a.market.pool, KivoError::InvalidMigration);
    let mint=a.mint.key();
    let nft=Pubkey::find_program_address(&[b"position_mint",mint.as_ref()],&crate::ID).0;
    verify_pda(a.position.key(), &[b"position", nft.as_ref()], DAMM)?;
    verify_pda(a.position_nft_account.key(), &[b"position_nft_account", nft.as_ref()], DAMM)?;
    verify_pda(a.pool_authority.key(), &[b"pool_authority"], DAMM)?;
    verify_pda(a.event_authority.key(), &[b"__event_authority"], DAMM)?;
    let signer_seed:&[&[u8]]=&[b"market",mint.as_ref(),&[a.market.bump]];
    let rent=a.wrapped_sol.to_account_info().lamports();
    let ix=Instruction {program_id:DAMM,data:CLAIM_IX.to_vec(),accounts:vec![
        AccountMeta::new_readonly(a.pool_authority.key(),false),
        AccountMeta::new_readonly(a.pool.key(),false),
        AccountMeta::new(a.position.key(),false),
        AccountMeta::new(a.vault.key(),false),
        AccountMeta::new(a.wrapped_sol.key(),false),
        AccountMeta::new(a.token_a_vault.key(),false),
        AccountMeta::new(a.token_b_vault.key(),false),
        AccountMeta::new_readonly(mint,false),
        AccountMeta::new_readonly(a.wrapped_mint.key(),false),
        AccountMeta::new_readonly(a.position_nft_account.key(),false),
        AccountMeta::new_readonly(a.market.key(),true),
        AccountMeta::new_readonly(a.token_2022_program.key(),false),
        AccountMeta::new_readonly(a.legacy_token_program.key(),false),
        AccountMeta::new_readonly(a.event_authority.key(),false),
        AccountMeta::new_readonly(DAMM,false),
    ]};
    invoke_signed(&ix,&[
        a.pool_authority.to_account_info(),a.pool.to_account_info(),a.position.to_account_info(),
        a.vault.to_account_info(),a.wrapped_sol.to_account_info(),
        a.token_a_vault.to_account_info(),a.token_b_vault.to_account_info(),
        a.mint.to_account_info(),a.wrapped_mint.to_account_info(),a.position_nft_account.to_account_info(),
        a.market.to_account_info(),a.token_2022_program.to_account_info(),
        a.legacy_token_program.to_account_info(),a.event_authority.to_account_info(),
        a.damm_program.to_account_info(),
    ],&[signer_seed])?;
    a.vault.reload()?;
    a.wrapped_sol.reload()?;
    require!(a.vault.amount==0,KivoError::InvalidMigration);
    let fees=a.wrapped_sol.amount;
    token_interface::close_account(CpiContext::new(a.legacy_token_program.to_account_info(), CloseAccount {
        account:a.wrapped_sol.to_account_info(),destination:a.market.to_account_info(),
        authority:a.market.to_account_info(),
    }).with_signer(&[signer_seed]))?;
    a.market.reserve=a.market.reserve.checked_add(fees).ok_or(KivoError::Overflow)?;
    let creator_cut=(fees as u128).checked_mul(a.market.pool_creator_share_bps as u128)
        .ok_or(KivoError::Overflow)? / 10_000;
    let creator_cut=u64::try_from(creator_cut).map_err(|_| KivoError::Overflow)?;
    a.market.credit_creator_split(creator_cut)?;
    a.market.creator_fees=a.market.creator_fees.checked_add(creator_cut).ok_or(KivoError::Overflow)?;
    a.market.treasury_fees=a.market.treasury_fees.checked_add(fees-creator_cut).ok_or(KivoError::Overflow)?;
    pay_from_market(&a.market.to_account_info(),&a.cranker.to_account_info(),rent)?;
    Ok(())
}

#[derive(AnchorSerialize)]
struct PoolFees {
    base_fee: [u8; 27],
    compounding_fee_bps: u16,
    padding: u8,
    dynamic_fee: Option<()>,
}

#[derive(AnchorSerialize)]
struct PoolParams {
    pool_fees: PoolFees,
    sqrt_min_price: u128,
    sqrt_max_price: u128,
    has_alpha_vault: bool,
    liquidity: u128,
    sqrt_price: u128,
    activation_type: u8,
    collect_fee_mode: u8,
    activation_point: Option<u64>,
}

fn verify_pda(key: Pubkey, seeds: &[&[u8]], program: Pubkey) -> Result<()> {
    require_keys_eq!(key, Pubkey::find_program_address(seeds, &program).0, KivoError::InvalidMigration);
    Ok(())
}

pub fn graduate(mut ctx: Context<Graduate>, sqrt_price: u128, liquidity: u128) -> Result<()> {
    let accounts = &mut ctx.accounts;
    require!(accounts.market.graduated && accounts.market.migration_prepared && !accounts.market.migration_complete, KivoError::InvalidMigration);
    require!(liquidity > DEAD_LIQUIDITY && sqrt_price > 4_295_048_016, KivoError::InvalidMigration);
    let mint = accounts.mint.key();
    let lp = accounts.liquidity_authority.key();
    verify_pda(lp, &[b"liquidity", mint.as_ref()], crate::ID)?;
    require_keys_eq!(*accounts.liquidity_authority.to_account_info().owner, System::id(), KivoError::InvalidMigration);
    verify_pda(accounts.position_nft_mint.key(), &[b"position_mint", mint.as_ref()], crate::ID)?;
    let (max_mint, min_mint) = if mint > accounts.wrapped_mint.key() {
        (mint, accounts.wrapped_mint.key())
    } else { (accounts.wrapped_mint.key(), mint) };
    let pool = accounts.pool.key();
    verify_pda(pool, &[b"cpool", max_mint.as_ref(), min_mint.as_ref()], DAMM)?;
    verify_pda(accounts.position.key(), &[b"position", accounts.position_nft_mint.key().as_ref()], DAMM)?;
    verify_pda(accounts.position_nft_account.key(), &[b"position_nft_account", accounts.position_nft_mint.key().as_ref()], DAMM)?;
    verify_pda(accounts.pool_authority.key(), &[b"pool_authority"], DAMM)?;
    verify_pda(accounts.token_a_vault.key(), &[b"token_vault", mint.as_ref(), pool.as_ref()], DAMM)?;
    verify_pda(accounts.token_b_vault.key(), &[b"token_vault", accounts.wrapped_mint.key().as_ref(), pool.as_ref()], DAMM)?;
    verify_pda(accounts.event_authority.key(), &[b"__event_authority"], DAMM)?;

    let market_seed: &[&[u8]] = &[b"market", mint.as_ref(), &[accounts.market.bump]];
    let market_signer: &[&[&[u8]]] = &[market_seed];
    let (_, lp_bump) = Pubkey::find_program_address(&[b"liquidity", mint.as_ref()], &crate::ID);
    let lp_signer: &[&[&[u8]]] = &[&[b"liquidity", mint.as_ref(), &[lp_bump]]];
    let (_, nft_bump) = Pubkey::find_program_address(&[b"position_mint", mint.as_ref()], &crate::ID);
    let nft_seed: &[&[u8]] = &[b"position_mint", mint.as_ref(), &[nft_bump]];
    let lp_seed: &[&[u8]] = &[b"liquidity", mint.as_ref(), &[lp_bump]];

    anchor_lang::system_program::transfer(
        CpiContext::new(accounts.system_program.to_account_info(), anchor_lang::system_program::Transfer {
            from: accounts.cranker.to_account_info(), to: accounts.liquidity_authority.to_account_info(),
        }), RENT_BUDGET,
    )?;
    let pool_sol = accounts.market.prepared_sol;
    require!(pool_sol > 0 && accounts.vault.amount > 0, KivoError::InvalidMigration);
    anchor_lang::system_program::transfer(CpiContext::new(accounts.system_program.to_account_info(), anchor_lang::system_program::Transfer {
        from: accounts.liquidity_authority.to_account_info(), to: accounts.wrapped_sol.to_account_info(),
    }).with_signer(lp_signer), pool_sol)?;
    token_interface::sync_native(CpiContext::new(accounts.legacy_token_program.to_account_info(), SyncNative {
        account: accounts.wrapped_sol.to_account_info(),
    }))?;
    token_interface::transfer_checked(CpiContext::new(accounts.token_2022_program.to_account_info(), TransferChecked {
        mint: accounts.mint.to_account_info(), from: accounts.vault.to_account_info(),
        to: accounts.liquidity_tokens.to_account_info(), authority: accounts.market.to_account_info(),
    }).with_signer(market_signer), accounts.vault.amount, DECIMALS)?;

    let mut base_fee = [0u8; 27];
    base_fee[..8].copy_from_slice(&10_000_000u64.to_le_bytes()); // 1% / DAMM denominator 1e9
    let params = PoolParams {
        pool_fees: PoolFees { base_fee, compounding_fee_bps: 1, padding: 0, dynamic_fee: None },
        sqrt_min_price: 0, sqrt_max_price: 0, has_alpha_vault: false,
        liquidity, sqrt_price, activation_type: 0, collect_fee_mode: 2, activation_point: None,
    };
    let mut data = POOL_IX.to_vec();
    data.extend(params.try_to_vec()?);
    let pool_ix = Instruction { program_id: DAMM, data, accounts: vec![
        AccountMeta::new_readonly(accounts.market.key(), false),
        AccountMeta::new(accounts.position_nft_mint.key(), true),
        AccountMeta::new(accounts.position_nft_account.key(), false),
        AccountMeta::new(lp, true),
        AccountMeta::new_readonly(accounts.pool_authority.key(), false),
        AccountMeta::new(pool, false),
        AccountMeta::new(accounts.position.key(), false),
        AccountMeta::new_readonly(mint, false),
        AccountMeta::new_readonly(accounts.wrapped_mint.key(), false),
        AccountMeta::new(accounts.token_a_vault.key(), false),
        AccountMeta::new(accounts.token_b_vault.key(), false),
        AccountMeta::new(accounts.liquidity_tokens.key(), false),
        AccountMeta::new(accounts.wrapped_sol.key(), false),
        AccountMeta::new_readonly(accounts.token_2022_program.key(), false),
        AccountMeta::new_readonly(accounts.legacy_token_program.key(), false),
        AccountMeta::new_readonly(accounts.token_2022_program.key(), false),
        AccountMeta::new_readonly(accounts.system_program.key(), false),
        AccountMeta::new_readonly(accounts.event_authority.key(), false),
        AccountMeta::new_readonly(DAMM, false),
    ] };
    let infos = vec![
        accounts.market.to_account_info(), accounts.position_nft_mint.to_account_info(),
        accounts.position_nft_account.to_account_info(), accounts.liquidity_authority.to_account_info(),
        accounts.pool_authority.to_account_info(),
        accounts.pool.to_account_info(), accounts.position.to_account_info(),
        accounts.mint.to_account_info(), accounts.wrapped_mint.to_account_info(),
        accounts.token_a_vault.to_account_info(), accounts.token_b_vault.to_account_info(),
        accounts.liquidity_tokens.to_account_info(), accounts.wrapped_sol.to_account_info(),
        accounts.token_2022_program.to_account_info(), accounts.legacy_token_program.to_account_info(),
        accounts.token_2022_program.to_account_info(), accounts.system_program.to_account_info(),
        accounts.event_authority.to_account_info(), accounts.damm_program.to_account_info(),
    ];
    invoke_signed(&pool_ix, &infos, &[lp_seed, nft_seed])?;
    accounts.liquidity_tokens.reload()?;
    accounts.wrapped_sol.reload()?;
    // Limit the amount stranded in the program-controlled source accounts.
    require!(accounts.liquidity_tokens.amount <= accounts.vault.amount / 10_000 + 1, KivoError::InvalidMigration);
    require!(accounts.wrapped_sol.amount <= pool_sol / 10_000 + 1, KivoError::InvalidMigration);

    let mut lock_data = LOCK_IX.to_vec();
    lock_data.extend_from_slice(&(liquidity - DEAD_LIQUIDITY).to_le_bytes());
    let lock_ix = Instruction { program_id: DAMM, data: lock_data, accounts: vec![
        AccountMeta::new(pool, false),
        AccountMeta::new(accounts.position.key(), false),
        AccountMeta::new_readonly(accounts.position_nft_account.key(), false),
        AccountMeta::new_readonly(accounts.market.key(), true),
        AccountMeta::new_readonly(accounts.event_authority.key(), false),
        AccountMeta::new_readonly(DAMM, false),
    ] };
    invoke_signed(&lock_ix, &[
        accounts.pool.to_account_info(), accounts.position.to_account_info(),
        accounts.position_nft_account.to_account_info(), accounts.market.to_account_info(),
        accounts.event_authority.to_account_info(), accounts.damm_program.to_account_info(),
    ], market_signer)?;

    // Bound and clear source-account dust. ATA rent returns to the cranker;
    // native SOL rounding dust (at most 0.01%) is the public crank reward.
    if accounts.liquidity_tokens.amount > 0 {
        token_interface::burn(CpiContext::new(accounts.token_2022_program.to_account_info(), Burn {
            mint: accounts.mint.to_account_info(), from: accounts.liquidity_tokens.to_account_info(),
            authority: accounts.liquidity_authority.to_account_info(),
        }).with_signer(lp_signer), accounts.liquidity_tokens.amount)?;
    }
    token_interface::close_account(CpiContext::new(accounts.token_2022_program.to_account_info(), CloseAccount {
        account: accounts.liquidity_tokens.to_account_info(), destination: accounts.cranker.to_account_info(),
        authority: accounts.liquidity_authority.to_account_info(),
    }).with_signer(lp_signer))?;
    token_interface::close_account(CpiContext::new(accounts.legacy_token_program.to_account_info(), CloseAccount {
        account: accounts.wrapped_sol.to_account_info(), destination: accounts.cranker.to_account_info(),
        authority: accounts.liquidity_authority.to_account_info(),
    }).with_signer(lp_signer))?;

    // Rent funding belongs to the caller. All market principal and the pot stay in the pool.
    let refund = accounts.liquidity_authority.lamports();
    if refund > 0 {
        anchor_lang::system_program::transfer(CpiContext::new(accounts.system_program.to_account_info(), anchor_lang::system_program::Transfer {
            from: accounts.liquidity_authority.to_account_info(), to: accounts.cranker.to_account_info(),
        }).with_signer(lp_signer), refund)?;
    }
    accounts.market.prepared_sol = 0;
    accounts.market.pool = pool;
    accounts.market.migration_complete = true;
    msg!("KIVO graduated to locked DAMM v2 pool {}", pool);
    Ok(())
}
