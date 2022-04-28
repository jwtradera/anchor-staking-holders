use anchor_lang::{prelude::*};
use anchor_lang::solana_program::entrypoint::ProgramResult;
use anchor_spl::token::{self, TokenAccount, Mint, Token, Transfer};

declare_id!("6PXA5EtWqQ7r9agVNYm5sPPXCao2DxRwuE5HkTQ4d6uZ");

#[program]
pub mod wolf_staking {    
    
    use super::*;

    pub const MAX_NFTS: u64 = 1111;
    pub const REWARD_TOKEN_AMOUNT: u64 = 1_000_000_000;
    pub const REWARD_PERIOD: u64 = 10; // 10 seconds
    
    pub fn initialize_vault(ctx: Context<InitializeVault>) -> ProgramResult {
        Ok(())
    }

    pub fn initialize_user(ctx: Context<InitializeUser>) -> ProgramResult {

        let user_account = &mut ctx.accounts.user_account;
        user_account.authority = ctx.accounts.user.key();
        user_account.total_claimed = 0;
        user_account.amount = 0;
        user_account.last_claimed_time = Clock::get().unwrap().unix_timestamp.try_into().unwrap();

        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> ProgramResult {
        token::transfer((&*ctx.accounts).into(), amount)?;
        Ok(())
    }

    pub fn claim(ctx: Context<Claim>, _vault_bump: u8, amount: u64) -> Result<()> {
        
        require!(amount <= MAX_NFTS, CustomError::InvalidHoldAmount);

        let user_account = &mut ctx.accounts.user_account;
        let now: u64 = Clock::get().unwrap().unix_timestamp.try_into().unwrap();

        require!(now > user_account.last_claimed_time + REWARD_PERIOD, CustomError::AlreadyClaimed);

        let reward_rate = (now - user_account.last_claimed_time)
                            .checked_div(REWARD_PERIOD).unwrap();

        let token_amount = amount.checked_mul(REWARD_TOKEN_AMOUNT).unwrap()
                                .checked_mul(reward_rate).unwrap();
        
        let valut_balance = ctx.accounts.vault_account.amount;
        let valut_account = ctx.accounts.vault_account.to_account_info();
        require!(token_amount <= valut_balance, CustomError::InsufficientFundsInVault);

        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_accounts = Transfer {
            from: valut_account.clone(),
            to: ctx.accounts.to.to_account_info(),
            authority: valut_account.clone(),
        };
        
        token::transfer(
            CpiContext::new_with_signer(
                cpi_program, 
                cpi_accounts,
                &[&[b"vault", ctx.accounts.to.mint.as_ref(), &[_vault_bump]]]), 
            token_amount)?;

        user_account.last_claimed_time = now;
        user_account.total_claimed += token_amount;
        user_account.amount = amount;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeVault<'info> {

    #[account(
        init,
        payer = payer,
        seeds = [b"vault", mint.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = vault_account
    )]
    pub vault_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub payer: Signer<'info>,
    
    pub mint: Account<'info, Mint>,
    
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct InitializeUser<'info> {
    #[account(
        init,
        payer = user,
        seeds = [b"user", user.key().as_ref()],
        bump,
        space = 8 + User::LEN
    )]
    pub user_account: Account<'info, User>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub system_program: Program<'info, System>,
}


#[derive(Accounts)]
#[instruction(amount: u64)]
pub struct Deposit<'info> {
    #[account(
        mut,
        seeds = [b"vault", depositor_token_account.mint.as_ref()],
        bump,
    )]
    pub vault_account: Account<'info, TokenAccount>,

    pub depositor: Signer<'info>,
    
    #[account(mut)]
    pub depositor_token_account: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
}

impl<'info> From<&Deposit<'info>> for CpiContext<'_, '_, '_, 'info, Transfer<'info>> {
    fn from(accounts: &Deposit<'info>) -> Self {
        let cpi_program = accounts.token_program.to_account_info();
        let cpi_accounts = Transfer {
            from: accounts.depositor_token_account.to_account_info(),
            to: accounts.vault_account.to_account_info(),
            authority: accounts.depositor.to_account_info(),
        };

        CpiContext::new(cpi_program, cpi_accounts)
    }
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(
        mut,
        seeds = [b"vault", to.mint.as_ref()],
        bump,
    )]
    pub vault_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"user", user.key().as_ref()],
        bump,
    )]
    pub user_account: Account<'info, User>,

    #[account(mut, constraint = to.owner == user.key())]
    pub to: Account<'info, TokenAccount>,

    pub user: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

#[account]
pub struct User {
    pub authority: Pubkey,
    pub total_claimed: u64,
    pub amount: u64,
    pub last_claimed_time: u64,
}
impl User {
    pub const LEN: usize = 
        32 + 8 + 8 + 8;
}

#[error_code]
pub enum CustomError {
    #[msg("Error: Invalid hold amount")]
    InvalidHoldAmount,

    #[msg("Error: Already claimed")]
    AlreadyClaimed,

    #[msg("Error: Insufficient funds in vault")]
    InsufficientFundsInVault,
}