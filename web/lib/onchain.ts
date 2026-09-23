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
} as const;
const FORK_DISC = IX.fork_strategy;

// Anchor account discriminators — sha256("account:<Struct>")[..8].
const ACC = {
  Strategy: Uint8Array.from([174, 110, 39, 119, 82, 106, 169, 102]),
  StrategyAsset: Uint8Array.from([24, 194, 2, 138, 13, 96, 102, 51]),
  RebalanceProposal: Uint8Array.from([144, 76, 53, 190, 165, 195, 179, 53]),
} as const;

// Little-endian scalar encoders (borsh).
function u16(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n, 0);
  return b;
}
function u64(n: number | bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n), 0);
  return b;
}
function i64(n: number | bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigInt64LE(BigInt(n), 0);
  return b;
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
const proposalPda = (strategy: PublicKey, proposalId: number | bigint) =>
  findPda([Buffer.from("proposal"), strategy.toBuffer(), u64(proposalId)]);

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
  const maxTradeNotional = Number(data.readBigUInt64LE(o)); o += 8;
  const maxDailyNotional = Number(data.readBigUInt64LE(o)); o += 8;
  const maxPriceAgeSeconds = Number(data.readBigUInt64LE(o)); o += 8;
  o += 32; // reference_feed_id
  o += 1; // require_user_approval
  const version = Number(data.readBigUInt64LE(o));
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
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  const signature = await sendTransaction(tx, connection);
  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight: (await connection.getLatestBlockhash("confirmed")).lastValidBlockHeight }, "confirmed");
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
  rebalanceDriftBps: 500,
  maxSingleAssetWeightBps: 3500,
  maxTradeNotional: 50,
  maxDailyNotional: 200,
  maxPriceAgeSeconds: 30,
};

export type NewBasketAsset = { mint: string; targetBps: number; maxBps?: number };

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
  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
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

// Creator finalizes an approved proposal (applies the new target weight on-chain).
export async function executeRebalanceOnchain(params: {
  connection: Connection;
  walletPublicKey: PublicKey;
  sendTransaction: SendFn;
  strategy: PublicKey;
  proposalId: number | bigint;
}): Promise<string> {
  const { connection, walletPublicKey, sendTransaction, strategy, proposalId } = params;
  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: strategy, isSigner: false, isWritable: false },
      { pubkey: proposalPda(strategy, proposalId), isSigner: false, isWritable: true },
      { pubkey: walletPublicKey, isSigner: true, isWritable: true },
    ],
    data: Buffer.from(IX.execute_rebalance),
  });
  return sendIxs(connection, walletPublicKey, sendTransaction, [ix]);
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
