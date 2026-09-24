// Client-side bridge to the deployed StockWeave program on Devnet.
// Reads the REAL on-chain strategy/rules/permission accounts the demo displays,
// and builds a real fork_strategy transaction the connected wallet signs.
// Raw web3.js (no anchor in the browser) — discriminators/layouts are fixed by
// the deployed program. Program id + seeded strategies come from tests/seed-onchain-strategy.js.
import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
} from "@solana/web3.js";

export const PROGRAM_ID = new PublicKey("EVx3g8ooCpshuemiNz3bt3vqoYapu7XjPab86BbnrgYN");
// Creator of the canonical (official) strategies, i.e. the demo deploy wallet.
export const OFFICIAL_CREATOR = new PublicKey("3jNEVjYZtMKHShfPLmS7tH8oKNngd42bU3sX7AJ1yxQD");
// Public identity of the constrained backend agent (its secret key never leaves
// the server). When set, new baskets grant it READ+PROPOSE so the /api/agent/propose
// service can sign real proposals; the connected wallet still approves+executes.
// Unset (the default) → the loop falls back to the wallet as its own agent.
function parseAgentPubkey(): PublicKey | null {
  const v = process.env.NEXT_PUBLIC_AGENT_PUBKEY;
  if (!v) return null;
  try {
    return new PublicKey(v);
  } catch {
    return null;
  }
}
export const AGENT_PUBKEY: PublicKey | null = parseAgentPubkey();
// Anchor instruction discriminators — sha256("global:<name>")[..8]. Fixed by the
// deployed program; verified against tests/seed-onchain-strategy.js.
const IX = {
  initialize_strategy: Uint8Array.from([208, 119, 144, 145, 178, 57, 105, 252]),
  set_assets: Uint8Array.from([133, 157, 142, 223, 213, 231, 238, 228]),
  set_rules: Uint8Array.from([66, 148, 196, 43, 232, 210, 174, 169]),
  set_agent_permission: Uint8Array.from([109, 197, 145, 204, 128, 88, 53, 116]),
  propose_rebalance: Uint8Array.from([11, 89, 222, 191, 238, 93, 94, 177]),
  approve_rebalance: Uint8Array.from([111, 92, 56, 1, 31, 237, 6, 246]),
  execute_rebalance: Uint8Array.from([36, 232, 110, 192, 96, 226, 100, 120]),
  fork_strategy: Uint8Array.from([189, 124, 51, 106, 39, 45, 186, 13]),
  // Stage 6 — Devnet mirror buy/faucet (see programs/stockweave/src/lib.rs).
  faucet_usdc: Uint8Array.from([190, 45, 226, 28, 94, 130, 98, 127]),
  subscribe: Uint8Array.from([254, 28, 191, 138, 156, 179, 183, 53]),
  // D-705 — sell/redeem: burn the mirror asset from the holder and pay USDC back
  // from the strategy treasury at the published price (the exit path for subscribe).
  redeem: Uint8Array.from([184, 12, 86, 149, 70, 196, 97, 225]),
  // D-703 — publish/refresh an asset's on-chain price (creator-signed). subscribe
  // and execute_rebalance bind their token quantity to it within tolerance.
  set_asset_price: Uint8Array.from([153, 17, 107, 170, 189, 135, 141, 170]),
  // Stage 9 — append a live-priced NAV snapshot to the on-chain ring (creator/
  // keeper-signed; the READ+PROPOSE agent never records).
  record_nav: Uint8Array.from([12, 39, 195, 29, 234, 54, 160, 24]),
} as const;
const FORK_DISC = IX.fork_strategy;

// Anchor account discriminators — sha256("account:<Struct>")[..8].
const ACC = {
  Strategy: Uint8Array.from([174, 110, 39, 119, 82, 106, 169, 102]),
  StrategyAsset: Uint8Array.from([24, 194, 2, 138, 13, 96, 102, 51]),
  RebalanceProposal: Uint8Array.from([144, 76, 53, 190, 165, 195, 179, 53]),
  AssetPrice: Uint8Array.from([197, 106, 216, 207, 155, 172, 40, 245]),
  NavHistory: Uint8Array.from([40, 139, 233, 237, 46, 197, 105, 74]),
} as const;

// Little-endian scalar encoders (borsh).
function u16(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n, 0);
  return b;
}
// Little-endian 64-bit encoders. We fill the 8 bytes by hand instead of calling
// Buffer.writeBigUInt64LE / writeBigInt64LE: those BigInt methods exist on Node's
// Buffer but NOT on the `buffer` polyfill bundled into the browser, where they
// throw "writeBigUInt64LE is not a function". Manual byte writes work everywhere.
function u64(n: number | bigint): Buffer {
  const b = Buffer.alloc(8);
  const MASK = BigInt(0xff);
  const SHIFT = BigInt(8);
  let v = BigInt(n);
  if (v < BigInt(0)) throw new Error("u64 cannot encode a negative value");
  for (let i = 0; i < 8; i++) {
    b[i] = Number(v & MASK);
    v >>= SHIFT;
  }
  return b;
}
function i64(n: number | bigint): Buffer {
  const b = Buffer.alloc(8);
  const MASK = BigInt(0xff);
  const SHIFT = BigInt(8);
  // Two's-complement wrap so negative i64s serialize correctly.
  let v = BigInt(n) & ((BigInt(1) << BigInt(64)) - BigInt(1));
  for (let i = 0; i < 8; i++) {
    b[i] = Number(v & MASK);
    v >>= SHIFT;
  }
  return b;
}
// Little-endian 64-bit DECODERS. Same story as u64/i64 above, mirrored: the
// browser `buffer` polyfill has no readBigUInt64LE / readBigInt64LE either (they
// throw "is not a function", which surfaced as "Couldn't buy: e.readBigUInt64LE
// is not a function"). Read the 8 bytes by hand. Returns a bigint; callers Number()
// it exactly as they did the Buffer methods.
function readU64LE(b: Uint8Array, o: number): bigint {
  let v = BigInt(0);
  for (let i = 7; i >= 0; i--) v = (v << BigInt(8)) | BigInt(b[o + i]);
  return v;
}
function readI64LE(b: Uint8Array, o: number): bigint {
  const u = readU64LE(b, o);
  const TWO_63 = BigInt(1) << BigInt(63);
  return u >= TWO_63 ? u - (BigInt(1) << BigInt(64)) : u; // two's-complement
}

export const EXPLORER = (addr: string) => `https://explorer.solana.com/address/${addr}?cluster=devnet`;
export const EXPLORER_TX = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;

function findPda(seeds: (Buffer | Uint8Array)[]): PublicKey {
  return PublicKey.findProgramAddressSync(seeds as Buffer[], PROGRAM_ID)[0];
}
const strategyPda = (creator: PublicKey, id: string) =>
  findPda([Buffer.from("strategy"), creator.toBuffer(), Buffer.from(id)]);
const rulesPda = (strategy: PublicKey) => findPda([Buffer.from("rules"), strategy.toBuffer()]);
const permissionPda = (strategy: PublicKey, agent: PublicKey) =>
  findPda([Buffer.from("permission"), strategy.toBuffer(), agent.toBuffer()]);
const assetPda = (strategy: PublicKey, mint: PublicKey) =>
  findPda([Buffer.from("asset"), strategy.toBuffer(), mint.toBuffer()]);
const pricePda = (strategy: PublicKey, mint: PublicKey) =>
  findPda([Buffer.from("price"), strategy.toBuffer(), mint.toBuffer()]);
const proposalPda = (strategy: PublicKey, proposalId: number | bigint) =>
  findPda([Buffer.from("proposal"), strategy.toBuffer(), u64(proposalId)]);
const navPda = (strategy: PublicKey) => findPda([Buffer.from("nav"), strategy.toBuffer()]);

function borshString(s: string): Buffer {
  const b = Buffer.from(s, "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(b.length, 0);
  return Buffer.concat([len, b]);
}

export type OnchainRules = {
  reserveWeightBps: number;
  rebalanceDriftBps: number;
  maxSingleAssetWeightBps: number;
  maxTradeNotional: number;
  maxDailyNotional: number;
  maxPriceAgeSeconds: number;
  version: number;
};

export type OnchainStrategyState = {
  exists: boolean;
  strategy: string;
  rulesAccount: string;
  permissionAccount: string;
  creator?: string;
  parent?: string;
  status?: number;
  rules?: OnchainRules;
  agentAllowedActions?: number; // bit flags: READ=1, PROPOSE=2, EXECUTE=4
};

// Skip the 8-byte anchor account discriminator.
function decodeStrategy(data: Buffer) {
  let o = 8;
  const creator = new PublicKey(data.subarray(o, o + 32)); o += 32;
  const idLen = data.readUInt32LE(o); o += 4 + idLen;
  const parent = new PublicKey(data.subarray(o, o + 32)); o += 32;
  const status = data.readUInt8(o); o += 1;
  return { creator, parent, status };
}
function decodeRules(data: Buffer): OnchainRules {
  let o = 8 + 32; // disc + strategy pubkey
  const reserveWeightBps = data.readUInt16LE(o); o += 2;
  const rebalanceDriftBps = data.readUInt16LE(o); o += 2;
  const maxSingleAssetWeightBps = data.readUInt16LE(o); o += 2;
  const maxTradeNotional = Number(readU64LE(data, o)); o += 8;
  const maxDailyNotional = Number(readU64LE(data, o)); o += 8;
  const maxPriceAgeSeconds = Number(readU64LE(data, o)); o += 8;
  o += 32; // reference_feed_id
  o += 1; // require_user_approval
  const version = Number(readU64LE(data, o));
  return {
    reserveWeightBps,
    rebalanceDriftBps,
    maxSingleAssetWeightBps,
    maxTradeNotional,
    maxDailyNotional,
    maxPriceAgeSeconds,
    version,
  };
}
function decodeAllowedActions(data: Buffer): number {
  // AgentPermission: disc(8) + strategy(32) + agent(32) + authority(32) + allowed_actions(u8)
  return data.readUInt8(8 + 32 + 32 + 32);
}

// Read the official on-chain strategy for a basket id (id === basketId).
export async function readOfficialStrategy(
  connection: Connection,
  basketId: string,
): Promise<OnchainStrategyState> {
  const strategy = strategyPda(OFFICIAL_CREATOR, basketId);
  const rules = rulesPda(strategy);
  const permission = permissionPda(strategy, OFFICIAL_CREATOR);
  // If a dedicated agent identity is configured, its grant is the one that
  // actually gates the proposer — prefer it, falling back to the creator grant.
  const agentPerm = AGENT_PUBKEY ? permissionPda(strategy, AGENT_PUBKEY) : permission;
  const base: OnchainStrategyState = {
    exists: false,
    strategy: strategy.toBase58(),
    rulesAccount: rules.toBase58(),
    permissionAccount: (AGENT_PUBKEY ? agentPerm : permission).toBase58(),
  };
  const [sInfo, rInfo, pInfo, aInfo] = await connection.getMultipleAccountsInfo([
    strategy,
    rules,
    permission,
    agentPerm,
  ]);
  if (!sInfo) return base;
  const s = decodeStrategy(Buffer.from(sInfo.data));
  const permInfo = aInfo ?? pInfo; // agent grant preferred, creator grant fallback
  return {
    ...base,
    exists: true,
    creator: s.creator.toBase58(),
    parent: s.parent.toBase58(),
    status: s.status,
    rules: rInfo ? decodeRules(Buffer.from(rInfo.data)) : undefined,
    agentAllowedActions: permInfo ? decodeAllowedActions(Buffer.from(permInfo.data)) : undefined,
  };
}

export type SendFn = (tx: Transaction, connection: Connection) => Promise<string>;

// Build + send a REAL fork_strategy transaction. `sendTransaction` is the
// wallet-adapter fn (signs with the connected wallet, submits). Returns the
// signature and the new fork's on-chain address.
export async function forkOfficialStrategy(params: {
  connection: Connection;
  walletPublicKey: PublicKey;
  sendTransaction: SendFn;
  basketId: string;
  newId: string;
}): Promise<{ signature: string; forkStrategy: string }> {
  const { connection, walletPublicKey, sendTransaction, basketId, newId } = params;
  const parent = strategyPda(OFFICIAL_CREATOR, basketId);
  const parentRules = rulesPda(parent);
  const fork = strategyPda(walletPublicKey, newId);
  const forkRules = rulesPda(fork);

  const data = Buffer.concat([Buffer.from(FORK_DISC), borshString(newId)]);
  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: parent, isSigner: false, isWritable: false },
      { pubkey: parentRules, isSigner: false, isWritable: false },
      { pubkey: fork, isSigner: false, isWritable: true },
      { pubkey: forkRules, isSigner: false, isWritable: true },
      { pubkey: walletPublicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  const tx = new Transaction().add(ix);
  tx.feePayer = walletPublicKey;
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  const signature = await sendTransaction(tx, connection);
  await confirmSig(connection, signature, lastValidBlockHeight);
  return { signature, forkStrategy: fork.toBase58() };
}

// SOL/USD Pyth feed — the strategies' reference market (matches the seed script
// and stage-5b oracle work). New baskets reuse it so proposals validate on-chain.
export const REFERENCE_FEED_HEX = "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
const REFERENCE_FEED = Uint8Array.from(Buffer.from(REFERENCE_FEED_HEX, "hex"));

export type NewBasketRules = {
  reserveWeightBps: number;
  rebalanceDriftBps: number;
  maxSingleAssetWeightBps: number;
  maxTradeNotional: number;
  maxDailyNotional: number;
  maxPriceAgeSeconds: number;
};
// Mirrors the seed guardrails: 10% reserve, 5% drift, 35% single-asset cap.
export const DEFAULT_NEW_RULES: NewBasketRules = {
  reserveWeightBps: 1000,
  rebalanceDriftBps: 100,
  maxSingleAssetWeightBps: 3500,
  maxTradeNotional: 50,
  maxDailyNotional: 200,
  maxPriceAgeSeconds: 30,
};

export type NewBasketAsset = { mint: string; targetBps: number; maxBps?: number };

// Confirm a signature robustly over HTTP only (no WebSocket). web3.js's built-in
// confirmTransaction relies on a signatureSubscribe WS, which doesn't exist when
// the client talks to our same-origin `/api/rpc` proxy; and on a laggy public RPC
// its block-height strategy reports "block height exceeded" even when the tx
// actually landed (wallet-approval latency eats the blockhash window). Instead we
// poll getSignatureStatuses until the tx confirms, errors, or its blockhash truly
// expires — only calling expiry once the status is still absent past the window.
async function confirmSig(
  connection: Connection,
  signature: string,
  lastValidBlockHeight: number,
): Promise<void> {
  const startedAt = Date.now();
  for (;;) {
    const st = (await connection.getSignatureStatuses([signature])).value[0];
    if (st?.err) throw new Error(`Transaction failed on-chain: ${JSON.stringify(st.err)}`);
    if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) return;
    if (!st) {
      let height = 0;
      try {
        height = await connection.getBlockHeight("confirmed");
      } catch {
        // ignore a transient RPC hiccup; the elapsed-time guard below still bounds us
      }
      if (height > lastValidBlockHeight) throw new Error(`Transaction ${signature} expired: block height exceeded.`);
    }
    if (Date.now() - startedAt > 90_000) throw new Error(`Transaction ${signature} not confirmed after 90s.`);
    await new Promise((r) => setTimeout(r, 2000));
  }
}


// Assemble, sign (via the wallet), send, and confirm a set of instructions.
async function sendIxs(
  connection: Connection,
  feePayer: PublicKey,
  sendTransaction: SendFn,
  ixs: TransactionInstruction[],
): Promise<string> {
  const tx = new Transaction().add(...ixs);
  tx.feePayer = feePayer;
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  const signature = await sendTransaction(tx, connection);
  await confirmSig(connection, signature, lastValidBlockHeight);
  return signature;
}
// Create a REAL strategy on-chain in one wallet-signed transaction:
// initialize_strategy + set_rules + one asset PDA per holding + an agent
// permission grant (READ+PROPOSE). `agent` defaults to the creator so the
// basket works before a dedicated agent key is wired. Weights are basis points;
// the USDC/cash reserve is implicit (rules.reserveWeightBps), not an asset row.
export async function createBasketOnchain(params: {
  connection: Connection;
  walletPublicKey: PublicKey;
  sendTransaction: SendFn;
  newId: string;
  assets: NewBasketAsset[];
  rules?: NewBasketRules;
  agent?: PublicKey;
}): Promise<{ signature: string; strategy: string }> {
  const { connection, walletPublicKey, sendTransaction, newId, assets } = params;
  const rules = params.rules ?? DEFAULT_NEW_RULES;
  const agent = params.agent ?? walletPublicKey;
  if (!newId || newId.length > 64) throw new Error("Strategy id must be 1–64 characters");
  if (assets.length === 0) throw new Error("A basket needs at least one asset");
  if (assets.length > 6) throw new Error("Too many assets for one transaction (max 6)");

  const strategy = strategyPda(walletPublicKey, newId);
  const rulesAcct = rulesPda(strategy);
  const sys = SystemProgram.programId;

  const initIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: strategy, isSigner: false, isWritable: true },
      { pubkey: walletPublicKey, isSigner: true, isWritable: true },
      { pubkey: sys, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from(IX.initialize_strategy), borshString(newId)]),
  });
  const rulesIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: strategy, isSigner: false, isWritable: true },
      { pubkey: rulesAcct, isSigner: false, isWritable: true },
      { pubkey: walletPublicKey, isSigner: true, isWritable: true },
      { pubkey: sys, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      Buffer.from(IX.set_rules),
      u16(rules.reserveWeightBps),
      u16(rules.rebalanceDriftBps),
      u16(rules.maxSingleAssetWeightBps),
      u64(rules.maxTradeNotional),
      u64(rules.maxDailyNotional),
      u64(rules.maxPriceAgeSeconds),
      Buffer.from(REFERENCE_FEED),
    ]),
  });
  const assetIxs = assets.map((a) => {
    const mint = new PublicKey(a.mint);
    return new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: strategy, isSigner: false, isWritable: true },
        { pubkey: assetPda(strategy, mint), isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: walletPublicKey, isSigner: true, isWritable: true },
        { pubkey: sys, isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([Buffer.from(IX.set_assets), u16(a.targetBps), u16(a.maxBps ?? rules.maxSingleAssetWeightBps)]),
    });
  });
  const expiry = Math.floor(Date.now() / 1000) + 365 * 86400;
  // Grant READ+PROPOSE (0b011) to an agent identity. The connected wallet always
  // gets a grant (so it can read/propose on its own basket); when a dedicated
  // backend agent is configured, it gets its own grant so /api/agent/propose can
  // sign proposals the wallet then approves. EXECUTE is never delegated.
  const permIxFor = (agentKey: PublicKey) =>
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: strategy, isSigner: false, isWritable: true },
        { pubkey: permissionPda(strategy, agentKey), isSigner: false, isWritable: true },
        { pubkey: agentKey, isSigner: false, isWritable: false },
        { pubkey: walletPublicKey, isSigner: true, isWritable: true },
        { pubkey: sys, isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([Buffer.from(IX.set_agent_permission), Buffer.from([0b011]), u64(50), u64(200), i64(expiry)]),
    });
  const permIxs = [permIxFor(walletPublicKey)];
  if (!agent.equals(walletPublicKey)) permIxs.push(permIxFor(agent));

  const signature = await sendIxs(connection, walletPublicKey, sendTransaction, [
    initIx,
    rulesIx,
    ...assetIxs,
    ...permIxs,
  ]);
  return { signature, strategy: strategy.toBase58() };
}
// Creator approves a pending proposal by its exact approval nonce (wallet-signed).
// The nonce is committed in the proposal on-chain and must match.
export async function approveRebalanceOnchain(params: {
  connection: Connection;
  walletPublicKey: PublicKey;
  sendTransaction: SendFn;
  strategy: PublicKey;
  proposalId: number | bigint;
  approvalNonce: number | bigint;
}): Promise<string> {
  const { connection, walletPublicKey, sendTransaction, strategy, proposalId, approvalNonce } = params;
  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: strategy, isSigner: false, isWritable: false },
      { pubkey: proposalPda(strategy, proposalId), isSigner: false, isWritable: true },
      { pubkey: walletPublicKey, isSigner: true, isWritable: true },
    ],
    data: Buffer.concat([Buffer.from(IX.approve_rebalance), u64(approvalNonce)]),
  });
  return sendIxs(connection, walletPublicKey, sendTransaction, [ix]);
}

// Build a set_asset_price instruction (creator-signed). Account order MUST match
// the SetAssetPrice struct in programs/stockweave/src/lib.rs. price_u is USDC base
// units (6 dp) per WHOLE asset token.
function buildSetAssetPriceIx(
  strategy: PublicKey,
  assetMint: PublicKey,
  creator: PublicKey,
  priceU: number | bigint,
): TransactionInstruction {
  if (BigInt(priceU) <= BigInt(0)) throw new Error("price_u must be positive");
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: strategy, isSigner: false, isWritable: false },
      { pubkey: assetMint, isSigner: false, isWritable: false },
      { pubkey: assetPda(strategy, assetMint), isSigner: false, isWritable: false },
      { pubkey: pricePda(strategy, assetMint), isSigner: false, isWritable: true },
      { pubkey: creator, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from(IX.set_asset_price), u64(priceU)]),
  });
}

// Creator finalizes an approved proposal — a REAL Devnet-mirror trim (Stage 7,
// D-702): the program BURNS `assetQty` of the mirror asset from the creator and
// TRANSFERS the proposal's notional (whole USDC → 6 dp) from the strategy
// treasury back to the creator, atomically. `assetQty` is sized off-chain from
// the published price; the USDC leg is fixed on-chain by the guarded
// `proposal.notional`, and the program binds `assetQty` to that price within
// tolerance (D-703). Pass `priceU` to publish/refresh that price in the SAME
// transaction (creator signs once) so the guard has a fresh price to check
// against. Account order MUST match the ExecuteRebalance struct in
// programs/stockweave/src/lib.rs exactly. Creator-only (has_one); the agent
// never signs execute.
export async function executeRebalanceOnchain(params: {
  connection: Connection;
  walletPublicKey: PublicKey;
  sendTransaction: SendFn;
  strategy: PublicKey;
  proposalId: number | bigint;
  assetMint: PublicKey;
  usdcMint: PublicKey;
  assetQty: number | bigint;
  priceU?: number | bigint; // when set, prepend set_asset_price in the same tx
}): Promise<string> {
  const { connection, walletPublicKey, sendTransaction, strategy, proposalId, assetMint, usdcMint, assetQty, priceU } = params;
  if (BigInt(assetQty) <= BigInt(0)) throw new Error("Execute amount (asset quantity to trim) must be positive");
  const vault = vaultPda();
  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: strategy, isSigner: false, isWritable: false },
      { pubkey: proposalPda(strategy, proposalId), isSigner: false, isWritable: true },
      { pubkey: assetPda(strategy, assetMint), isSigner: false, isWritable: false },
      { pubkey: pricePda(strategy, assetMint), isSigner: false, isWritable: false },
      { pubkey: assetMint, isSigner: false, isWritable: true },
      { pubkey: usdcMint, isSigner: false, isWritable: false },
      { pubkey: vault, isSigner: false, isWritable: false },
      { pubkey: walletPublicKey, isSigner: true, isWritable: true },
      { pubkey: ataFor(walletPublicKey, assetMint), isSigner: false, isWritable: true },
      { pubkey: ataFor(walletPublicKey, usdcMint), isSigner: false, isWritable: true },
      { pubkey: ataFor(vault, usdcMint), isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from(IX.execute_rebalance), u64(assetQty)]),
  });
  const ixs = priceU && BigInt(priceU) > BigInt(0)
    ? [buildSetAssetPriceIx(strategy, assetMint, walletPublicKey, priceU), ix]
    : [ix];
  return sendIxs(connection, walletPublicKey, sendTransaction, ixs);
}

// Exported address helpers so the backend agent service can derive the same PDAs
// this client uses (identical seeds → identical addresses).
export const strategyAddress = (creator: PublicKey, id: string) => strategyPda(creator, id);
export const rulesAddress = (strategy: PublicKey) => rulesPda(strategy);
export const permissionAddress = (strategy: PublicKey, agent: PublicKey) => permissionPda(strategy, agent);
export const proposalAddress = (strategy: PublicKey, proposalId: number | bigint) => proposalPda(strategy, proposalId);

// One agent-signed propose_rebalance. Mirrors ProposeArgs in the deployed program
// exactly (field order + widths). The on-chain guards reject anything invalid
// (wrong feed, stale oracle, over-weight, reserve breach, excessive notional);
// this only assembles the instruction — signing/sending is the caller's job.
export type ProposeArgsInput = {
  proposalId: number | bigint;
  mint: PublicKey;
  newTargetWeightBps: number;
  projectedReserveBps: number;
  notional: number | bigint;
  reasonCode: number;
  oracleFeedIdHex: string; // 64 hex chars ([u8;32])
  oraclePrice: number | bigint; // i64 (Pyth price, native exponent)
  oraclePublishTime: number | bigint; // i64 unix seconds
  approvalNonce: number | bigint;
  expiresAt: number | bigint; // i64 unix seconds
};

export function buildProposeRebalanceIx(
  strategy: PublicKey,
  agent: PublicKey,
  args: ProposeArgsInput,
): TransactionInstruction {
  const feed = Buffer.from(args.oracleFeedIdHex, "hex");
  if (feed.length !== 32) throw new Error("oracleFeedIdHex must be 32 bytes (64 hex chars)");
  const data = Buffer.concat([
    Buffer.from(IX.propose_rebalance),
    u64(args.proposalId),
    args.mint.toBuffer(),
    u16(args.newTargetWeightBps),
    u16(args.projectedReserveBps),
    u64(args.notional),
    Buffer.from([args.reasonCode & 0xff]),
    feed,
    i64(args.oraclePrice),
    i64(args.oraclePublishTime),
    u64(args.approvalNonce),
    i64(args.expiresAt),
  ]);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: strategy, isSigner: false, isWritable: false },
      { pubkey: rulesPda(strategy), isSigner: false, isWritable: false },
      { pubkey: permissionPda(strategy, agent), isSigner: false, isWritable: false },
      { pubkey: proposalPda(strategy, args.proposalId), isSigner: false, isWritable: true },
      { pubkey: agent, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}
// --- Read helpers (enumerate + decode real on-chain state) --------------------

function discEq(data: Uint8Array, disc: Uint8Array): boolean {
  for (let i = 0; i < 8; i++) if (data[i] !== disc[i]) return false;
  return true;
}
// Full Strategy decode (adds the id string the summary decode skipped).
function decodeStrategyFull(data: Buffer) {
  let o = 8;
  const creator = new PublicKey(data.subarray(o, o + 32)); o += 32;
  const idLen = data.readUInt32LE(o); o += 4;
  const strategyId = data.subarray(o, o + idLen).toString("utf8"); o += idLen;
  const parent = new PublicKey(data.subarray(o, o + 32)); o += 32;
  const status = data.readUInt8(o); o += 1;
  return { creator, strategyId, parent, status };
}
function decodeAsset(data: Buffer): OnchainAsset {
  let o = 8 + 32; // disc + strategy pubkey
  const mint = new PublicKey(data.subarray(o, o + 32)); o += 32;
  const targetWeightBps = data.readUInt16LE(o); o += 2;
  const maxWeightBps = data.readUInt16LE(o); o += 2;
  const enabled = data.readUInt8(o) === 1;
  return { mint: mint.toBase58(), targetWeightBps, maxWeightBps, enabled };
}

export type OnchainAsset = { mint: string; targetWeightBps: number; maxWeightBps: number; enabled: boolean };
export type WalletStrategy = { address: string; strategyId: string; parent: string; status: number; isFork: boolean };

const SYSTEM_ADDR = SystemProgram.programId.toBase58();

// Every strategy whose creator is `owner` — their own baskets and forks.
export async function listWalletStrategies(connection: Connection, owner: PublicKey): Promise<WalletStrategy[]> {
  const accts = await connection.getProgramAccounts(PROGRAM_ID, {
    filters: [{ memcmp: { offset: 8, bytes: owner.toBase58() } }],
  });
  return accts
    .filter((a) => discEq(a.account.data, ACC.Strategy))
    .map((a) => {
      const s = decodeStrategyFull(Buffer.from(a.account.data));
      const parent = s.parent.toBase58();
      return {
        address: a.pubkey.toBase58(),
        strategyId: s.strategyId,
        parent,
        status: s.status,
        isFork: parent !== SYSTEM_ADDR && parent !== a.pubkey.toBase58(),
      };
    });
}

// Every registered asset row for a strategy (target/max weights, enabled flag).
export async function listStrategyAssets(connection: Connection, strategy: PublicKey): Promise<OnchainAsset[]> {
  const accts = await connection.getProgramAccounts(PROGRAM_ID, {
    filters: [{ memcmp: { offset: 8, bytes: strategy.toBase58() } }],
  });
  return accts
    .filter((a) => discEq(a.account.data, ACC.StrategyAsset))
    .map((a) => decodeAsset(Buffer.from(a.account.data)));
}

// D-703 price binding. price_u is USDC base units (6 dp) per WHOLE asset token.
export type OnchainAssetPrice = { mint: string; priceU: number; updatedAt: number };
// AssetPrice: disc(8) + strategy(32) + mint(32) + price_u(u64) + updated_at(i64) + bump(u8).
function decodeAssetPrice(data: Buffer): OnchainAssetPrice {
  let o = 8 + 32; // disc + strategy pubkey
  const mint = new PublicKey(data.subarray(o, o + 32)); o += 32;
  const priceU = Number(readU64LE(data, o)); o += 8;
  const updatedAt = Number(readU64LE(data, o)); // always a positive unix ts
  return { mint: mint.toBase58(), priceU, updatedAt };
}
// Published prices for a strategy, keyed by mint. Absent = never published (a
// subscribe/execute against it reverts PriceUnavailable on-chain).
export async function readAssetPrices(
  connection: Connection,
  strategy: PublicKey,
): Promise<Record<string, OnchainAssetPrice>> {
  const accts = await connection.getProgramAccounts(PROGRAM_ID, {
    filters: [{ memcmp: { offset: 8, bytes: strategy.toBase58() } }],
  });
  const out: Record<string, OnchainAssetPrice> = {};
  for (const a of accts) {
    if (!discEq(a.account.data, ACC.AssetPrice)) continue;
    const p = decodeAssetPrice(Buffer.from(a.account.data));
    out[p.mint] = p;
  }
  return out;
}

// The on-chain price-binding tolerance (must match PRICE_TOLERANCE_BPS in the
// program). Sizing a quantity from the SAME price the program checks keeps the
// only difference to integer rounding, comfortably inside this band.
export const PRICE_TOLERANCE_BPS = 100; // 1%
// Mirror asset mints are 9 dp. Size a token quantity from a usdc base-unit amount
// and the published price so the on-chain check passes: qty = usdcIn * 10^dec / price_u.
export function sizeAssetQtyFromPriceU(
  usdcInBaseUnits: number | bigint,
  priceU: number | bigint,
  assetDecimals = 9,
): bigint {
  const p = BigInt(priceU);
  if (p <= BigInt(0)) throw new Error("price_u must be positive");
  return (BigInt(usdcInBaseUnits) * BigInt(10) ** BigInt(assetDecimals)) / p;
}

// SPL token program ids. PreStocks mints are Token-2022; USDC is the classic
// Token program — so a wallet's real holdings can live under either.
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

// The wallet's REAL on-chain balance for each requested mint, keyed mint → uiAmount.
// Queries both token programs and keeps only the mints asked for; a mint the
// wallet doesn't hold is simply absent (treat as 0). No custody is modelled —
// this is the connected wallet's own token accounts, nothing else.
export async function readWalletTokenBalances(
  connection: Connection,
  owner: PublicKey,
  mints: string[],
): Promise<Record<string, number>> {
  const want = new Set(mints);
  const out: Record<string, number> = {};
  const results = await Promise.all(
    [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].map((programId) =>
      connection
        .getParsedTokenAccountsByOwner(owner, { programId })
        .catch(() => ({ value: [] as { account: { data: unknown } }[] })),
    ),
  );
  for (const res of results) {
    for (const { account } of res.value) {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const info = (account.data as any)?.parsed?.info;
      const mint: string | undefined = info?.mint;
      const ui: number | null = info?.tokenAmount?.uiAmount ?? null;
      /* eslint-enable @typescript-eslint/no-explicit-any */
      if (mint && want.has(mint) && typeof ui === "number") out[mint] = (out[mint] ?? 0) + ui;
    }
  }
  return out;
}

// Read any strategy (creator + id) the same way readOfficialStrategy reads the
// canonical ones. Permission is looked up for the configured agent (or the
// explicit `agent`), preferring that grant over the creator's own.
export async function readStrategyById(
  connection: Connection,
  creator: PublicKey,
  id: string,
  agent?: PublicKey,
): Promise<OnchainStrategyState> {
  const strategy = strategyPda(creator, id);
  const rules = rulesPda(strategy);
  const effectiveAgent = agent ?? AGENT_PUBKEY ?? creator;
  const creatorPerm = permissionPda(strategy, creator);
  const agentPerm = permissionPda(strategy, effectiveAgent);
  const base: OnchainStrategyState = {
    exists: false,
    strategy: strategy.toBase58(),
    rulesAccount: rules.toBase58(),
    permissionAccount: agentPerm.toBase58(),
  };
  const [sInfo, rInfo, aInfo, cInfo] = await connection.getMultipleAccountsInfo([
    strategy,
    rules,
    agentPerm,
    creatorPerm,
  ]);
  if (!sInfo) return base;
  const s = decodeStrategy(Buffer.from(sInfo.data));
  const permInfo = aInfo ?? cInfo; // agent grant preferred, creator grant fallback
  return {
    ...base,
    exists: true,
    creator: s.creator.toBase58(),
    parent: s.parent.toBase58(),
    status: s.status,
    rules: rInfo ? decodeRules(Buffer.from(rInfo.data)) : undefined,
    agentAllowedActions: permInfo ? decodeAllowedActions(Buffer.from(permInfo.data)) : undefined,
  };
}

// --- Stage 6: REAL on-chain buy/faucet on Devnet -----------------------------
// The program mints Devnet "mirror" tokens for the real (mainnet) PreStocks
// assets so a Devnet wallet genuinely holds the basket. subscribe() = buyer pays
// USDC into the strategy treasury and the program mints the mirror asset to them
// (atomic). faucet_usdc() = capped Devnet test cash. The program's vault PDA is
// the mint authority + treasury owner, so there is NO server key in this path.
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

// The program's global authority PDA (mint authority for every mirror mint and
// owner of the USDC treasury). Seeds must match `[b"vault"]` in the program.
const vaultPda = () => findPda([Buffer.from("vault")]);
export const vaultAddress = () => vaultPda();

// Derive an associated token account address (works for a PDA owner too — the
// derivation math is identical). Mirror mints are classic SPL, so default to it.
function ataFor(owner: PublicKey, mint: PublicKey, tokenProgram: PublicKey = TOKEN_PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];
}
export const associatedTokenAddress = (owner: PublicKey, mint: PublicKey) => ataFor(owner, mint);
// Mint capped Devnet test-USDC to the connected wallet (one wallet-signed txn).
// `amountBaseUnits` is in USDC base units (6 decimals → 10_000 USDC = 10_000e6).
export async function faucetUsdcOnchain(params: {
  connection: Connection;
  walletPublicKey: PublicKey;
  sendTransaction: SendFn;
  usdcMint: PublicKey;
  amountBaseUnits: number | bigint;
}): Promise<string> {
  const { connection, walletPublicKey, sendTransaction, usdcMint, amountBaseUnits } = params;
  const vault = vaultPda();
  const recipientUsdc = ataFor(walletPublicKey, usdcMint);
  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: usdcMint, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: false },
      { pubkey: walletPublicKey, isSigner: true, isWritable: true },
      { pubkey: recipientUsdc, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from(IX.faucet_usdc), u64(amountBaseUnits)]),
  });
  return sendIxs(connection, walletPublicKey, sendTransaction, [ix]);
}

export type SubscribeLeg = { assetMint: string; usdcIn: number | bigint; assetQty: number | bigint };
// Buy into a basket: one subscribe() instruction per asset leg (USDC in, mirror
// asset minted out), batched into wallet-signed transactions. Account order must
// match the program's Subscribe struct exactly. Returns every signature.
export async function subscribeToBasketOnchain(params: {
  connection: Connection;
  walletPublicKey: PublicKey;
  sendTransaction: SendFn;
  strategyCreator: PublicKey;
  strategyId: string;
  usdcMint: PublicKey;
  legs: SubscribeLeg[];
}): Promise<{ signatures: string[]; strategy: string }> {
  const { connection, walletPublicKey, sendTransaction, strategyCreator, strategyId, usdcMint, legs } = params;
  if (legs.length === 0) throw new Error("Nothing to buy");
  const strategy = strategyPda(strategyCreator, strategyId);
  const vault = vaultPda();
  const buyerUsdc = ataFor(walletPublicKey, usdcMint);
  const treasuryUsdc = ataFor(vault, usdcMint);
  const sys = SystemProgram.programId;
  const mkIx = (leg: SubscribeLeg) => {
    const assetMint = new PublicKey(leg.assetMint);
    return new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: strategy, isSigner: false, isWritable: false },
        { pubkey: assetMint, isSigner: false, isWritable: true },
        { pubkey: usdcMint, isSigner: false, isWritable: false },
        { pubkey: assetPda(strategy, assetMint), isSigner: false, isWritable: false },
        { pubkey: pricePda(strategy, assetMint), isSigner: false, isWritable: false },
        { pubkey: vault, isSigner: false, isWritable: false },
        { pubkey: walletPublicKey, isSigner: true, isWritable: true },
        { pubkey: ataFor(walletPublicKey, assetMint), isSigner: false, isWritable: true },
        { pubkey: buyerUsdc, isSigner: false, isWritable: true },
        { pubkey: treasuryUsdc, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: sys, isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([Buffer.from(IX.subscribe), u64(leg.usdcIn), u64(leg.assetQty)]),
    });
  };
  const signatures: string[] = [];
  const CHUNK = 5; // ~12 accounts/leg; 5 legs stays well under the tx size limit
  for (let i = 0; i < legs.length; i += CHUNK) {
    const ixs = legs.slice(i, i + CHUNK).map(mkIx);
    signatures.push(await sendIxs(connection, walletPublicKey, sendTransaction, ixs));
  }
  return { signatures, strategy: strategy.toBase58() };
}

export type RedeemLeg = { assetMint: string; assetQty: number | bigint };
// Sell out of a basket: one redeem() instruction per asset leg (mirror asset
// burned, USDC paid back from the treasury at the published price). Account order
// must match the program's Redeem struct exactly. Returns every signature.
export async function redeemFromBasketOnchain(params: {
  connection: Connection;
  walletPublicKey: PublicKey;
  sendTransaction: SendFn;
  strategyCreator: PublicKey;
  strategyId: string;
  usdcMint: PublicKey;
  legs: RedeemLeg[];
}): Promise<{ signatures: string[]; strategy: string }> {
  const { connection, walletPublicKey, sendTransaction, strategyCreator, strategyId, usdcMint, legs } = params;
  const active = legs.filter((l) => BigInt(l.assetQty) > BigInt(0));
  if (active.length === 0) throw new Error("Nothing to sell");
  const strategy = strategyPda(strategyCreator, strategyId);
  const vault = vaultPda();
  const sellerUsdc = ataFor(walletPublicKey, usdcMint);
  const treasuryUsdc = ataFor(vault, usdcMint);
  const sys = SystemProgram.programId;
  const mkIx = (leg: RedeemLeg) => {
    const assetMint = new PublicKey(leg.assetMint);
    return new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: strategy, isSigner: false, isWritable: false },
        { pubkey: assetMint, isSigner: false, isWritable: true },
        { pubkey: usdcMint, isSigner: false, isWritable: false },
        { pubkey: assetPda(strategy, assetMint), isSigner: false, isWritable: false },
        { pubkey: pricePda(strategy, assetMint), isSigner: false, isWritable: false },
        { pubkey: vault, isSigner: false, isWritable: false },
        { pubkey: walletPublicKey, isSigner: true, isWritable: true },
        { pubkey: ataFor(walletPublicKey, assetMint), isSigner: false, isWritable: true },
        { pubkey: sellerUsdc, isSigner: false, isWritable: true },
        { pubkey: treasuryUsdc, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: sys, isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([Buffer.from(IX.redeem), u64(leg.assetQty)]),
    });
  };
  const signatures: string[] = [];
  const CHUNK = 5; // ~13 accounts/leg; 5 legs stays well under the tx size limit
  for (let i = 0; i < active.length; i += CHUNK) {
    const ixs = active.slice(i, i + CHUNK).map(mkIx);
    signatures.push(await sendIxs(connection, walletPublicKey, sendTransaction, ixs));
  }
  return { signatures, strategy: strategy.toBase58() };
}

// D-703 — publish/refresh one asset's on-chain price (creator-signed). price_u is
// USDC base units (6 dp) per WHOLE asset token ($100.00 → 100_000_000). Only the
// strategy creator may call it; on a wallet's own fork the wallet is the creator,
// so it publishes a fresh price right before executing an approved trim. Account
// order MUST match the SetAssetPrice struct in programs/stockweave/src/lib.rs.
export async function setAssetPriceOnchain(params: {
  connection: Connection;
  walletPublicKey: PublicKey;
  sendTransaction: SendFn;
  strategy: PublicKey;
  assetMint: PublicKey;
  priceU: number | bigint;
}): Promise<string> {
  const { connection, walletPublicKey, sendTransaction, strategy, assetMint, priceU } = params;
  const ix = buildSetAssetPriceIx(strategy, assetMint, walletPublicKey, priceU);
  return sendIxs(connection, walletPublicKey, sendTransaction, [ix]);
}
export const priceAddress = (strategy: PublicKey, mint: PublicKey) => pricePda(strategy, mint);

// --- Stage 9: on-chain NAV track record (proof-of-return) --------------------
// NavHistory is a zero_copy ring buffer (seeds [b"nav", strategy]) a keeper
// appends to via record_nav. One getAccountInfo returns the whole history. The
// decoder below mirrors the program's #[repr(C)] byte layout exactly (including
// the explicit padding that keeps it bytemuck-Pod).
export const navAddress = (strategy: PublicKey) => navPda(strategy);

export type NavPoint = { ts: number; navU: number };
// nav_u is USDC micro-units (6 dp). This is the raw ring: `points` are already
// unwrapped oldest → newest and trimmed to how many snapshots actually exist.
export type NavSeries = { count: number; points: NavPoint[] };

const NAV_CAPACITY = 128; // must match NAV_CAPACITY in the program.

// NavHistory data after the 8-byte disc: strategy(32) + authority(32) + count(u64)
// + head(u32) + _pad0(4) + points([{i64 ts, u64 nav_u} × 128] @ off 80) + bump(u8)
// + _pad1(7). Unwrap the ring: with count ≤ capacity the live points are slots
// 0..count in order; once wrapped, read `capacity` points starting at head (the
// oldest) and wrapping — that yields oldest → newest.
function decodeNavHistory(data: Buffer): NavSeries {
  const count = Number(readU64LE(data, 8 + 32 + 32));
  const POINTS_OFF = 8 + 32 + 32 + 8 + 4 + 4; // = 88 (disc + fields + _pad0)
  const readPoint = (slot: number): NavPoint => {
    const o = POINTS_OFF + slot * 16;
    const ts = Number(readI64LE(data, o));
    const navU = Number(readU64LE(data, o + 8));
    return { ts, navU };
  };
  const live = Math.min(count, NAV_CAPACITY);
  const points: NavPoint[] = [];
  if (count <= NAV_CAPACITY) {
    for (let i = 0; i < live; i++) points.push(readPoint(i));
  } else {
    const head = count % NAV_CAPACITY; // oldest live slot
    for (let i = 0; i < NAV_CAPACITY; i++) points.push(readPoint((head + i) % NAV_CAPACITY));
  }
  return { count, points };
}

// Read a strategy's on-chain NAV history in one getAccountInfo. Returns an empty
// series (count 0) when the keeper has never recorded — the UI shows an honest
// "tracking since …" empty state rather than inventing a curve.
export async function readNavHistory(connection: Connection, strategy: PublicKey): Promise<NavSeries> {
  const info = await connection.getAccountInfo(navPda(strategy));
  if (!info || !discEq(info.data, ACC.NavHistory)) return { count: 0, points: [] };
  return decodeNavHistory(Buffer.from(info.data));
}

// Append one live-priced NAV snapshot (creator/keeper-signed). nav_u is the
// target-weight basket value in USDC micro-units (6 dp). Account order MUST match
// the RecordNav struct in programs/stockweave/src/lib.rs.
export function buildRecordNavIx(strategy: PublicKey, creator: PublicKey, navU: number | bigint): TransactionInstruction {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: strategy, isSigner: false, isWritable: false },
      { pubkey: navPda(strategy), isSigner: false, isWritable: true },
      { pubkey: creator, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from(IX.record_nav), u64(navU)]),
  });
}
export async function recordNavOnchain(params: {
  connection: Connection;
  walletPublicKey: PublicKey;
  sendTransaction: SendFn;
  strategy: PublicKey;
  navU: number | bigint;
}): Promise<string> {
  const { connection, walletPublicKey, sendTransaction, strategy, navU } = params;
  const ix = buildRecordNavIx(strategy, walletPublicKey, navU);
  return sendIxs(connection, walletPublicKey, sendTransaction, [ix]);
}
