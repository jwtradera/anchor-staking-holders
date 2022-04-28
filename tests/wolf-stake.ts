import * as anchor from '@project-serum/anchor';
import { Program } from '@project-serum/anchor';
import { TOKEN_PROGRAM_ID, Token } from "@solana/spl-token";
import { assert } from 'chai';

import { WolfStaking } from "../target/types/wolf_staking";

describe("wolf-staking", () => {

  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.WolfStaking as Program<WolfStaking>;

  // Initial mint amount
  const MINT_A_AMOUNT = 1_000;

  // Create our user keypairs
  const user1 = anchor.web3.Keypair.generate();

  // Declare our user associated token account
  let user1TokenAAccount = null;

  // Declare our token account PDA and bump
  let pdaTokenAAddress = null;
  let pdaTokenABump = null;

  // Declare our Mint
  let mintA = null;

  // Create our payer -- this payer is tied to the mintA -- allows us to easily use mintA.<function> to send transactions, 
  // instead of using Token.<function> to create an instruction and then send the transaction manually.
  const payer = anchor.web3.Keypair.generate();

  // Create our minting authority
  const mintAuthority = anchor.web3.Keypair.generate();

  let vaultState = null;

  it('Initialize test state', async () => {
    // Airdrop sol to the users
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(user1.publicKey, anchor.web3.LAMPORTS_PER_SOL),
      "confirmed"
    );

    // Airdrop sol to the mint authority
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(mintAuthority.publicKey, anchor.web3.LAMPORTS_PER_SOL),
      "confirmed"
    );

    // Airdrop sol to the payer
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(payer.publicKey, anchor.web3.LAMPORTS_PER_SOL),
      "confirmed"
    );

    // Create mint for mintA
    mintA = await Token.createMint(
      provider.connection,
      payer,
      mintAuthority.publicKey,
      null,
      0,
      TOKEN_PROGRAM_ID
    );

    // Create user1's associated token account
    user1TokenAAccount = await mintA.createAccount(user1.publicKey);

    // Mint tokens to user1's token account
    await mintA.mintTo(
      user1TokenAAccount,
      mintAuthority.publicKey,
      [mintAuthority],
      MINT_A_AMOUNT
    );

    let amount = (await mintA.getAccountInfo(user1TokenAAccount)).amount.toNumber();
    assert.equal(MINT_A_AMOUNT, amount);

    // Find our PDA's
    // For this addresses seeds, we use 'vault' as well as the tokens mint public key -- We could also use a name, but I don't feel that is necessary.
    [pdaTokenAAddress, pdaTokenABump] = await anchor.web3.PublicKey.findProgramAddress([Buffer.from("vault"), mintA.publicKey.toBuffer()], program.programId);

    console.log(`PDA Token A Address: ${pdaTokenAAddress}, Bump: ${pdaTokenABump}`);
    console.log("User1 PubKey: ", user1.publicKey.toString());
    console.log("Payer PubKey: ", payer.publicKey.toString());
  });

  it('Initializes our programs token vault', async () => {
    const tx = await provider.connection.confirmTransaction(
      await program.rpc.initializeVault(
        pdaTokenABump, {
          accounts: {
            vaultAccount: pdaTokenAAddress,
            payer: payer.publicKey,
            mint: mintA.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          },
          signers: [payer]
      })
    );

    let pdaTokenAOwningProgram = await (await provider.connection.getAccountInfo(pdaTokenAAddress)).owner;
    assert.equal(pdaTokenAOwningProgram.toString(), TOKEN_PROGRAM_ID.toString());

    let pdaTokenAAccountAmount = await (await mintA.getAccountInfo(pdaTokenAAddress)).amount.toNumber();
    assert.equal(0, pdaTokenAAccountAmount);

    let pdaTokenAAccountInfo = await mintA.getAccountInfo(pdaTokenAAddress);
    let pdaTokenAOwner = pdaTokenAAccountInfo.owner;

    console.log("Token A Owner:", pdaTokenAOwner.toString());

  });

  it('Deposits to our programs token vault', async () => {
    const AMOUNT_TO_DEPOSIT = 200;

    await provider.connection.confirmTransaction(
      await program.rpc.deposit(
        new anchor.BN(AMOUNT_TO_DEPOSIT), {
          accounts: {
            vaultAccount: pdaTokenAAddress,
            depositor: user1.publicKey,
            depositorTokenAccount: user1TokenAAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
          },
          signers: [user1]
      })
    );

    let pdaTokenAAccountAmount = await (await mintA.getAccountInfo(pdaTokenAAddress)).amount.toNumber();
    assert.equal(AMOUNT_TO_DEPOSIT, pdaTokenAAccountAmount);
  });

  it('Withdraw from our programs token vault', async () => {
    const AMOUNT_TO_WITHDRAW = 200;

    await provider.connection.confirmTransaction(
      await program.rpc.withdraw(
        new anchor.BN(AMOUNT_TO_WITHDRAW),
        pdaTokenABump, {
          accounts: {
            vaultAccount: pdaTokenAAddress,
            to: user1TokenAAccount,
            authority: user1.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          },
          signers: [user1]
      })
    );

    let pdaTokenAAccountAmount = await (await mintA.getAccountInfo(pdaTokenAAddress)).amount.toNumber();
    assert.equal(0, pdaTokenAAccountAmount);

  });

  it('Withdraw insufficient amount from our programs token vault', async () => {
    const AMOUNT_TO_DEPOSIT = 200;

    // Create a second user keypair
    let user2 = anchor.web3.Keypair.generate();

    // Airdrop sol to user2
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(user2.publicKey, anchor.web3.LAMPORTS_PER_SOL),
      "confirmed"
    );

    // Create mintA associated token account for user2
    let user2TokenAAccount = await mintA.createAccount(user2.publicKey);

    // Mint to user2's token account;
    await mintA.mintTo(
      user2TokenAAccount,
      mintAuthority.publicKey,
      [mintAuthority],
      MINT_A_AMOUNT
    );
    
    //console.log("Depositing funds to vault from user2")
    // Deposit funds to vault from user2
    await provider.connection.confirmTransaction(
      await program.rpc.deposit(
        new anchor.BN(AMOUNT_TO_DEPOSIT), {
          accounts: {
            vaultAccount: pdaTokenAAddress,
            depositor: user2.publicKey,
            depositorTokenAccount: user2TokenAAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
          },
          signers: [user2]
      })
    );

    // Withdraw more funds then deposited
    const AMOUNT_TO_WITHDRAW = AMOUNT_TO_DEPOSIT + 100;

    //console.log("Withdrawing funds from vault for user2")
    try {
      await provider.connection.confirmTransaction(
        await program.rpc.withdraw(
          new anchor.BN(AMOUNT_TO_WITHDRAW),
          pdaTokenABump, {
            accounts: {
              vaultAccount: pdaTokenAAddress,
              to: user2TokenAAccount,
              authority: user2.publicKey,
              tokenProgram: TOKEN_PROGRAM_ID,
            },
            signers: [user2]
        })
      );
    } catch (err) {
      const ERROR_MESSAGE = "Error: Insufficient funds in vault";
      console.log(err);
    }

  });

});
