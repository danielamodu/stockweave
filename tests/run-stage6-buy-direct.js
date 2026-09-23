/**
 * Stage 6 verifier — REAL on-chain buy round-trip on Devnet (no IDL, hand-encoded).
 *   faucet_usdc  → mint capped Devnet test-USDC to the buyer
 *   subscribe    → buyer pays USDC into the treasury, program mints the mirror
 *                  asset to the buyer (vault PDA authority; NO server key)
 * then reads the buyer's real token balances to prove the wallet genuinely holds
 * the basket asset. Uses the deploy wallet as the buyer (any signer works).
 *
 * Assertions use before+delta, so re-runs still PASS (balances just accumulate).
 * Writes tests/stage06-buy-evidence.json.
 *
 * Env: ANCHOR_WALLET (buyer keypair), HELIUS_RPC | ANCHOR_PROVIDER_URL (RPC).
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const anchor = require("@coral-xyz/anchor");
const { Connection, PublicKey, Keypair, TransactionInstruction, Transaction, SystemProgram, sendAndConfirmTransaction } =
  anchor.web3;

const RPC = process.env.HELIUS_RPC || process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com";
const WALLET = process.env.ANCHOR_WALLET;
if (!WALLET) throw new Error("Set ANCHOR_WALLET to the buyer keypair path");

const PROGRAM_ID = new PublicKey("EVx3g8ooCpshuemiNz3bt3vqoYapu7XjPab86BbnrgYN");
const OFFICIAL_CREATOR = new PublicKey("3jNEVjYZtMKHShfPLmS7tH8oKNngd42bU3sX7AJ1yxQD");
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const BASKET_ID = "ai-infrastructure";
const BUY_SYMBOL = "OPENAI";

function disc(name) { return crypto.createHash("sha256").update(`global:${name}`).digest().subarray(0, 8); }
function u64(n) { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n), 0); return b; }
function pda(seeds) { return PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0]; }
function ata(owner, mint) {
  return PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()], ATA_PROGRAM_ID)[0];
}
async function bal(connection, addr) {
  try { return (await connection.getTokenAccountBalance(addr)).value.uiAmount ?? 0; } catch { return 0; }
}

async function main() {
  const connection = new Connection(RPC, "confirmed");
  const buyer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(WALLET, "utf-8"))));
  const reg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "web", "lib", "devnet-mints.json"), "utf-8"));
  if (!reg.usdc || !reg.usdc.mint || !reg.assets[BUY_SYMBOL]) throw new Error("Mirror mints not seeded — run tests/seed-devnet-mints.js");
  const usdcMint = new PublicKey(reg.usdc.mint);
  const assetMint = new PublicKey(reg.assets[BUY_SYMBOL].mint);
  const vault = pda([Buffer.from("vault")]);
  const strategy = pda([Buffer.from("strategy"), OFFICIAL_CREATOR.toBuffer(), Buffer.from(BASKET_ID)]);
  const asset = pda([Buffer.from("asset"), strategy.toBuffer(), assetMint.toBuffer()]);
  const buyerUsdc = ata(buyer.publicKey, usdcMint);
  const buyerAsset = ata(buyer.publicKey, assetMint);
  const treasuryUsdc = ata(vault, usdcMint);
  const sys = SystemProgram.programId;

  console.log("buyer:   ", buyer.publicKey.toBase58());
  console.log("strategy:", strategy.toBase58());
  console.log("asset:   ", BUY_SYMBOL, assetMint.toBase58());

  const usdcBefore = await bal(connection, buyerUsdc);
  const assetBefore = await bal(connection, buyerAsset);
  const treasuryBefore = await bal(connection, treasuryUsdc);
  console.log(`before:  USDC=${usdcBefore}  ${BUY_SYMBOL}=${assetBefore}  treasury=${treasuryBefore}`);

  // 1) faucet 1,000 test USDC to the buyer
  const faucetIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: usdcMint, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: false },
      { pubkey: buyer.publicKey, isSigner: true, isWritable: true },
      { pubkey: buyerUsdc, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ATA_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: sys, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([disc("faucet_usdc"), u64(1_000_000_000)]),
  });
  const faucetSig = await sendAndConfirmTransaction(connection, new Transaction().add(faucetIx), [buyer], { commitment: "confirmed" });
  console.log("faucet tx:   ", faucetSig);

  // 2) subscribe: pay 100 USDC into the treasury, mint 1.0 OPENAI to the buyer
  const usdcIn = 100_000_000; // 100 USDC (6 dp)
  const assetQty = 1_000_000_000; // 1.0 asset (9 dp)
  const subIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: strategy, isSigner: false, isWritable: false },
      { pubkey: assetMint, isSigner: false, isWritable: true },
      { pubkey: usdcMint, isSigner: false, isWritable: false },
      { pubkey: asset, isSigner: false, isWritable: false },
      { pubkey: vault, isSigner: false, isWritable: false },
      { pubkey: buyer.publicKey, isSigner: true, isWritable: true },
      { pubkey: buyerAsset, isSigner: false, isWritable: true },
      { pubkey: buyerUsdc, isSigner: false, isWritable: true },
      { pubkey: treasuryUsdc, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ATA_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: sys, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([disc("subscribe"), u64(usdcIn), u64(assetQty)]),
  });
  const subSig = await sendAndConfirmTransaction(connection, new Transaction().add(subIx), [buyer], { commitment: "confirmed" });
  console.log("subscribe tx:", subSig);

  const usdcAfter = await bal(connection, buyerUsdc);
  const assetAfter = await bal(connection, buyerAsset);
  const treasuryAfter = await bal(connection, treasuryUsdc);
  console.log(`after:   USDC=${usdcAfter}  ${BUY_SYMBOL}=${assetAfter}  treasury=${treasuryAfter}`);

  const okUsdc = Math.abs(usdcBefore + 1000 - 100 - usdcAfter) < 1e-6;
  const okAsset = Math.abs(assetBefore + 1 - assetAfter) < 1e-6;
  const okTreasury = Math.abs(treasuryBefore + 100 - treasuryAfter) < 1e-6;
  const pass = okUsdc && okAsset && okTreasury;
  console.log(pass ? "\nPASS — real on-chain buy round-trip verified." : `\nFAIL — usdc:${okUsdc} asset:${okAsset} treasury:${okTreasury}`);

  const evidence = {
    stage: "6-devnet-mirror-buy",
    programId: PROGRAM_ID.toBase58(),
    buyer: buyer.publicKey.toBase58(),
    basket: BASKET_ID,
    symbol: BUY_SYMBOL,
    assetMint: assetMint.toBase58(),
    usdcMint: usdcMint.toBase58(),
    strategy: strategy.toBase58(),
    vault: vault.toBase58(),
    treasuryUsdc: treasuryUsdc.toBase58(),
    faucetTx: faucetSig,
    subscribeTx: subSig,
    balances: { usdcBefore, usdcAfter, assetBefore, assetAfter, treasuryBefore, treasuryAfter },
    pass,
    ts: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(__dirname, "stage06-buy-evidence.json"), JSON.stringify(evidence, null, 2) + "\n");
  if (!pass) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
