import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { WebSocketServer, WebSocket } from 'ws';
import {
  CURATED_PUZZLES,
  getPuzzleDifficulty,
  type PuzzleDifficulty,
  type PuzzleSortOrder,
} from './src/data/puzzleCatalog.ts';
import {
  getPlanLimits,
  getTodayQuotaDate,
  normalizeQuotaUsage,
  PLAN_CATALOG,
  type DailyQuotaUsage,
  type PlanTier,
} from './src/data/plans.ts';
import {
  createInitialState,
  evaluateGameResult,
  makeMove,
  parseFen,
  toFen,
  uciToMove,
} from './src/engine/chessEngine.ts';
import type { BoardState, ChessVariant, Move, PieceColor } from './src/types/chess.ts';
import { isBotAccount } from './src/utils/botFilter.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const SESSION_SECRET =
  process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

// Safe filesystem store confinement
const DATA_DIR = path.resolve(__dirname, 'data');
const STORE_FILE = path.resolve(DATA_DIR, 'store.json');
if (!STORE_FILE.startsWith(DATA_DIR + path.sep)) {
  throw new Error('Invalid persistent store path');
}

interface StoredUser {
  id: string;
  username: string;
  usernameLower: string;
  passwordHash: string;
  rating: number;
  createdAt: string;
  plan?: PlanTier;
  quota?: DailyQuotaUsage;
  isBot?: boolean;
}

interface StoredTournamentPlayer {
  id: string;
  name: string;
  rating: number;
  score: number;
  streak: number;
  gamesPlayed: number;
  buchholz?: number;
  userId?: string;
}

interface StoredTournament {
  id: string;
  name: string;
  format: 'arena' | 'swiss';
  variant: string;
  timeControl: string;
  durationMinutes?: number;
  totalRounds?: number;
  currentRound: number;
  status: 'upcoming' | 'active' | 'finished';
  players: StoredTournamentPlayer[];
  ownerId?: string;
  createdBy?: string;
}

interface StoredPaymentOrder {
  orderId: string;
  orderToken: string;
  userId: string;
  plan: 'pro' | 'max';
  amountInr: number;
  currency: 'INR';
  provider: 'stripe' | 'razorpay' | 'sandbox';
  status: 'pending' | 'paid';
  method?: 'upi' | 'netbanking' | 'card' | 'razorpay';
  methodLabel?: string;
  receiptId?: string;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  createdAt: string;
  paidAt?: string;
}

interface StoredLeaderboardVisitor {
  id: string;
  username: string;
  usernameLower: string;
  ratings: {
    bullet: number;
    blitz: number;
    rapid: number;
    classical: number;
    chess960: number;
  };
  isBot: boolean;
  lastSeenAt: string;
}

interface StoredGlobalTournamentChatMessage {
  id: string;
  author: string;
  isGuest: boolean;
  tournamentTag?: string;
  text: string;
  createdAt: string;
}

interface StoredCustomPuzzle {
  id: string;
  title: string;
  rating: number;
  themes: string[];
  fen: string;
  solutionUci: string[];
  playerColor: PieceColor;
  author: string;
  createdAt: string;
}

interface StoredClub {
  id: string;
  name: string;
  description: string;
  createdBy: string;
  members: string[];
  totalScore: number;
}

interface StoredHallOfFameEntry {
  id: string;
  tournamentId: string;
  tournamentName: string;
  format: 'arena' | 'swiss' | 'knockout';
  completedAt: string;
  podium: { rank: 1 | 2 | 3; name: string; isGuest?: boolean; score: number }[];
}

interface StoreData {
  users: StoredUser[];
  visitors: StoredLeaderboardVisitor[];
  tournaments: StoredTournament[];
  payments: StoredPaymentOrder[];
  tournamentGlobalChat: StoredGlobalTournamentChatMessage[];
  customPuzzles: StoredCustomPuzzle[];
  clubs: StoredClub[];
  hallOfFame: StoredHallOfFameEntry[];
}

const VALID_VARIANTS = new Set([
  'standard',
  'chess960',
  'kingOfTheHill',
  'threeCheck',
  'antichess',
  'atomic',
  'horde',
  'racingKings',
  'crazyhouse',
]);

function createDefaultTournaments(): StoredTournament[] {
  return [
    {
      id: 'arena-blitz',
      name: 'Hourly Blitz Arena',
      format: 'arena',
      variant: 'standard',
      timeControl: '3+0',
      durationMinutes: 45,
      currentRound: 1,
      status: 'active',
      createdBy: 'Caissa Club',
      players: [],
    },
    {
      id: 'arena-crazyhouse',
      name: 'Crazyhouse Variant Arena',
      format: 'arena',
      variant: 'crazyhouse',
      timeControl: '3+2',
      durationMinutes: 60,
      currentRound: 1,
      status: 'active',
      createdBy: 'Caissa Club',
      players: [],
    },
    {
      id: 'swiss-open',
      name: 'Caissa Open Swiss Championship',
      format: 'swiss',
      variant: 'standard',
      timeControl: '5+3',
      totalRounds: 5,
      currentRound: 1,
      status: 'active',
      createdBy: 'Caissa Club',
      players: [],
    },
  ];
}

function createDefaultClubs(): StoredClub[] {
  return [
    {
      id: 'club-vanguard',
      name: 'Caissa Vanguard',
      description: 'Daily arena grinders, open tactical study, and team battles.',
      createdBy: 'Caissa Club',
      members: ['Caissa Club'],
      totalScore: 420,
    },
    {
      id: 'club-gambit',
      name: 'Gambit Syndicate',
      description: 'Romantic sharp openings, King’s Gambit, and Crazyhouse brawls.',
      createdBy: 'Caissa Club',
      members: ['Caissa Club'],
      totalScore: 365,
    },
    {
      id: 'club-endgame',
      name: 'Endgame Architects',
      description: 'Classical endgame precision, rook endings, and tournament prep.',
      createdBy: 'Caissa Club',
      members: ['Caissa Club'],
      totalScore: 310,
    },
  ];
}

function loadStore(): StoreData {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(STORE_FILE)) {
      const raw = fs.readFileSync(STORE_FILE, 'utf8');
      const parsed = JSON.parse(raw) as Partial<StoreData>;
      const users = Array.isArray(parsed.users) ? parsed.users : [];
      const botUserIds = new Set(
        users
          .filter((u) => u.isBot === true || isBotAccount({ username: u.username }))
          .map((u) => u.id)
      );
      const rawTournaments =
        Array.isArray(parsed.tournaments) && parsed.tournaments.length > 0
          ? parsed.tournaments
          : createDefaultTournaments();
      let strippedLegacyBots = false;
      const tournaments = rawTournaments.map((t) => {
        const beforeCount = Array.isArray(t.players) ? t.players.length : 0;
        const cleanPlayers = (Array.isArray(t.players) ? t.players : []).filter(
          (p) => Boolean(p.userId) && !isBotAccount(p) && !botUserIds.has(p.userId!)
        );
        if (cleanPlayers.length !== beforeCount) {
          strippedLegacyBots = true;
        }
        return { ...t, players: cleanPlayers };
      });
      const data: StoreData = {
        users,
        visitors: Array.isArray(parsed.visitors) ? parsed.visitors : [],
        tournaments,
        payments: Array.isArray(parsed.payments) ? parsed.payments : [],
        tournamentGlobalChat: Array.isArray(parsed.tournamentGlobalChat)
          ? parsed.tournamentGlobalChat.slice(-250)
          : [],
        customPuzzles: Array.isArray(parsed.customPuzzles) ? parsed.customPuzzles : [],
        clubs:
          Array.isArray(parsed.clubs) && parsed.clubs.length > 0
            ? parsed.clubs
            : createDefaultClubs(),
        hallOfFame: Array.isArray(parsed.hallOfFame) ? parsed.hallOfFame.slice(0, 50) : [],
      };
      if (strippedLegacyBots) {
        saveStore(data);
      }
      return data;
    }
  } catch {
    // Fallback to clean seeded store
  }
  const initial: StoreData = {
    users: [],
    visitors: [],
    tournaments: createDefaultTournaments(),
    payments: [],
    tournamentGlobalChat: [],
    customPuzzles: [],
    clubs: createDefaultClubs(),
    hallOfFame: [],
  };
  saveStore(initial);
  return initial;
}

function saveStore(data: StoreData): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const tmpFile = path.resolve(DATA_DIR, `store.${crypto.randomUUID()}.tmp`);
  if (!tmpFile.startsWith(DATA_DIR + path.sep)) {
    throw new Error('Invalid temp store path');
  }
  fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmpFile, STORE_FILE);
}

const store: StoreData = loadStore();
const revokedTokenIds = new Set<string>();
const authAttempts = new Map<string, { count: number; resetAt: number }>();

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, hashHex] = parts;
  if (!salt || !hashHex) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const storedBuf = Buffer.from(hashHex, 'hex');
  if (derived.length !== storedBuf.length) return false;
  return crypto.timingSafeEqual(derived, storedBuf);
}

interface TokenPayload {
  sub: string;
  username: string;
  jti: string;
  iat: number;
  exp: number;
}

function signToken(user: StoredUser): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: TokenPayload = {
    sub: user.id,
    username: user.username,
    jti: crypto.randomUUID(),
    iat: now,
    exp: now + 7 * 24 * 60 * 60,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sigB64 = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(payloadB64)
    .digest('base64url');
  return `${payloadB64}.${sigB64}`;
}

function verifyToken(token: string): { user: StoredUser; jti: string } | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;
  if (!payloadB64 || !sigB64) return null;

  const expectedSig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(payloadB64)
    .digest('base64url');

  const sigBuf = Buffer.from(sigB64, 'utf8');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf8')
    ) as TokenPayload;
    const now = Math.floor(Date.now() / 1000);
    if (!payload.sub || !payload.jti || payload.exp <= now) return null;
    if (revokedTokenIds.has(payload.jti)) return null;
    const user = store.users.find((u) => u.id === payload.sub);
    if (!user) return null;
    return { user, jti: payload.jti };
  } catch {
    return null;
  }
}

function resolveUserPlan(u: StoredUser): {
  plan: PlanTier;
  quota: DailyQuotaUsage;
} {
  const plan: PlanTier =
    u.plan === 'pro' || u.plan === 'max' ? u.plan : 'free';
  const quota = normalizeQuotaUsage(u.quota);
  return { plan, quota };
}

function toPublicUser(u: StoredUser) {
  const { plan, quota } = resolveUserPlan(u);
  return {
    id: u.id,
    username: u.username,
    rating: u.rating,
    createdAt: u.createdAt,
    plan,
    quota,
    isBot: Boolean(u.isBot || isBotAccount({ username: u.username })),
  };
}

interface AuthedRequest extends Request {
  authUser?: StoredUser;
  authJti?: string;
}

function extractBearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const token = extractBearer(req);
  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const verified = verifyToken(token);
  if (!verified) {
    res.status(401).json({ error: 'Invalid or expired session' });
    return;
  }
  req.authUser = verified.user;
  req.authJti = verified.jti;
  next();
}

function checkAuthRateLimit(req: Request, res: Response): boolean {
  const ip = req.ip || 'local';
  const now = Date.now();
  const entry = authAttempts.get(ip);
  if (!entry || entry.resetAt <= now) {
    authAttempts.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count >= 25) {
    res.status(429).json({ error: 'Too many authentication attempts. Please wait a minute.' });
    return false;
  }
  entry.count += 1;
  return true;
}

function formatTournamentForClient(t: StoredTournament, userId?: string) {
  const botUserIds = new Set(
    store.users
      .filter((u) => u.isBot === true || isBotAccount({ username: u.username }))
      .map((u) => u.id)
  );
  const humanPlayers = t.players.filter(
    (p) => Boolean(p.userId) && !isBotAccount(p) && !botUserIds.has(p.userId!)
  );
  const joined = userId ? humanPlayers.some((p) => p.userId === userId) : false;
  return {
    id: t.id,
    name: t.name,
    format: t.format,
    variant: t.variant,
    timeControl: t.timeControl,
    durationMinutes: t.durationMinutes,
    totalRounds: t.totalRounds,
    currentRound: t.currentRound,
    status: t.status,
    joined,
    ownerId: t.ownerId,
    createdBy: t.createdBy,
    players: humanPlayers.map((p) => ({
      id: p.id,
      name: p.name,
      rating: p.rating,
      score: p.score,
      streak: p.streak,
      gamesPlayed: p.gamesPlayed,
      buchholz: p.buchholz,
      isUser: userId ? p.userId === userId : false,
    })),
  };
}

function normalizeUsername(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

const USERNAME_REGEX = /^[\p{L}\p{N}_. @+-]{3,48}$/u;

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '100kb' }));

  // ==================== AUTHENTICATION ROUTES ====================
  app.post('/api/auth/register', (req: Request, res: Response) => {
    if (!checkAuthRateLimit(req, res)) return;
    const rawUsername = normalizeUsername(req.body?.username);
    const rawPassword = typeof req.body?.password === 'string' ? req.body.password : '';

    if (rawUsername.length < 3 || rawUsername.length > 48 || !USERNAME_REGEX.test(rawUsername)) {
      res.status(400).json({
        error:
          'Username must be 3 to 48 characters (letters, numbers, spaces, _, ., -, @, or +).',
      });
      return;
    }
    if (rawPassword.length < 6 || rawPassword.length > 128) {
      res.status(400).json({
        error: 'Password must be between 6 and 128 characters.',
      });
      return;
    }

    const lower = rawUsername.toLowerCase();
    if (store.users.some((u) => u.usernameLower === lower)) {
      res.status(409).json({ error: 'That username is already registered.' });
      return;
    }

    const claimBlitz = Number(req.body?.claimRatings?.blitz);
    const claimedRating =
      Number.isFinite(claimBlitz) && claimBlitz >= 400 && claimBlitz <= 3500
        ? Math.round(claimBlitz)
        : 1620;

    const rawVisitorId = typeof req.body?.visitorId === 'string' ? req.body.visitorId.trim() : '';
    const validVisitorId = /^[a-zA-Z0-9_-]{8,64}$/.test(rawVisitorId) ? rawVisitorId : '';

    const user: StoredUser = {
      id: `usr-${crypto.randomUUID()}`,
      username: rawUsername,
      usernameLower: lower,
      passwordHash: hashPassword(rawPassword),
      rating: claimedRating,
      createdAt: new Date().toISOString(),
      plan: 'free',
      quota: { date: getTodayQuotaDate(), analysisUsed: 0, puzzlesUsed: 0 },
      isBot: isBotAccount({ username: rawUsername, isBot: Boolean(req.body?.isBot) }),
    };
    store.users.push(user);
    if (validVisitorId) {
      store.visitors = store.visitors.filter((v) => v.id !== validVisitorId);
    }
    saveStore(store);

    const token = signToken(user);
    res.status(201).json({ token, user: toPublicUser(user) });
  });

  app.post('/api/auth/login', (req: Request, res: Response) => {
    if (!checkAuthRateLimit(req, res)) return;
    const rawUsername = normalizeUsername(req.body?.username);
    const rawPassword = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!rawUsername || !rawPassword) {
      res.status(400).json({ error: 'Username and password are required.' });
      return;
    }

    const lower = rawUsername.toLowerCase();
    const user = store.users.find((u) => u.usernameLower === lower);
    if (!user || !verifyPassword(rawPassword, user.passwordHash)) {
      res.status(401).json({ error: 'Invalid username or password.' });
      return;
    }

    const token = signToken(user);
    res.json({ token, user: toPublicUser(user) });
  });

  app.get('/api/auth/me', requireAuth, (req: AuthedRequest, res: Response) => {
    res.json({ user: toPublicUser(req.authUser!) });
  });

  app.post('/api/auth/logout', requireAuth, (req: AuthedRequest, res: Response) => {
    if (req.authJti) {
      revokedTokenIds.add(req.authJti);
    }
    res.json({ ok: true });
  });

  // ==================== ACCOUNT PLAN & QUOTA ROUTES ====================
  app.get('/api/account/plan', requireAuth, (req: AuthedRequest, res: Response) => {
    const user = req.authUser!;
    const { plan, quota } = resolveUserPlan(user);
    if (user.quota?.date !== quota.date || !user.plan) {
      user.plan = plan;
      user.quota = quota;
      saveStore(store);
    }
    res.json({
      plan,
      quota,
      limits: getPlanLimits(plan),
    });
  });

  app.post('/api/account/plan', requireAuth, (req: AuthedRequest, res: Response) => {
    const user = req.authUser!;
    const rawPlan: unknown = req.body?.plan;
    if (rawPlan !== 'free' && rawPlan !== 'pro' && rawPlan !== 'max') {
      res.status(400).json({ error: 'Invalid plan tier. Choose free, pro, or max.' });
      return;
    }
    if (rawPlan === 'pro' || rawPlan === 'max') {
      const amount = PLAN_CATALOG[rawPlan].priceInr;
      res.status(402).json({
        error: `Payment of ₹${amount} is required to activate ${PLAN_CATALOG[rawPlan].name}. Complete checkout first.`,
      });
      return;
    }
    user.plan = 'free';
    user.quota = normalizeQuotaUsage(user.quota);
    saveStore(store);
    res.json({
      plan: 'free',
      quota: user.quota,
      limits: getPlanLimits('free'),
      user: toPublicUser(user),
    });
  });

  // ==================== PAYMENTS & CHECKOUT ROUTES ====================
  function getRazorpayConfig() {
    const keyId = (process.env.RAZORPAY_KEY_ID || '').trim();
    const keySecret = (process.env.RAZORPAY_KEY_SECRET || '').trim();
    const enabled = keyId.length > 0 && keySecret.length > 0;
    const partial = (keyId.length > 0) !== (keySecret.length > 0);
    const mode: 'live' | 'test' | 'sandbox' = !enabled
      ? 'sandbox'
      : keyId.startsWith('rzp_live_')
      ? 'live'
      : 'test';
    return { keyId, keySecret, enabled, partial, mode };
  }

  function resolveOptionalAuth(
    req: Request,
    res: Response
  ): { ok: true; user: StoredUser | null } | { ok: false } {
    const token = extractBearer(req);
    if (!token) {
      return { ok: true, user: null };
    }
    const verified = verifyToken(token);
    if (!verified) {
      res.status(401).json({ error: 'Invalid or expired session' });
      return { ok: false };
    }
    return { ok: true, user: verified.user };
  }

  app.get('/api/payments/config', (_req: Request, res: Response) => {
    const cfg = getRazorpayConfig();
    res.json({
      razorpayEnabled: cfg.enabled,
      mode: cfg.mode,
    });
  });

  app.post('/api/payments/create-order', async (req: Request, res: Response) => {
    const auth = resolveOptionalAuth(req, res);
    if (!auth.ok) return;
    const user = auth.user;
    const ownerId = user ? user.id : 'guest';

    const rawPlan: unknown = req.body?.plan;
    if (rawPlan !== 'pro' && rawPlan !== 'max') {
      res.status(400).json({ error: 'Checkout is only required for Pro (₹100) or Max (₹1,000).' });
      return;
    }

    const plan: PlanTier = rawPlan;
    const amountInr = PLAN_CATALOG[plan].priceInr;
    const orderId = `ord_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`;
    const orderToken = crypto
      .createHmac('sha256', SESSION_SECRET)
      .update(`${orderId}:${ownerId}:${plan}:${amountInr}`)
      .digest('hex');

    const cfg = getRazorpayConfig();
    if (cfg.partial) {
      res.status(503).json({
        error:
          'Razorpay is partially configured. Set both RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in AI Studio Secrets.',
      });
      return;
    }

    if (cfg.enabled) {
      try {
        const authHeader = Buffer.from(`${cfg.keyId}:${cfg.keySecret}`, 'utf8').toString('base64');
        const rzpResp = await fetch('https://api.razorpay.com/v1/orders', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Basic ${authHeader}`,
          },
          body: JSON.stringify({
            amount: amountInr * 100,
            currency: 'INR',
            receipt: orderId,
            notes: {
              plan,
              accountType: user ? 'member' : 'guest',
              username: user ? user.username : 'Guest',
              app: 'CaissaChess',
            },
          }),
        });
        const rzpData = (await rzpResp.json().catch(() => ({}))) as {
          id?: string;
          error?: { description?: string };
        };
        if (!rzpResp.ok || !rzpData?.id) {
          res.status(502).json({
            error:
              rzpData?.error?.description ||
              'Razorpay could not create a payment order. Verify RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.',
          });
          return;
        }

        const order: StoredPaymentOrder = {
          orderId,
          orderToken,
          userId: ownerId,
          plan,
          amountInr,
          currency: 'INR',
          provider: 'razorpay',
          status: 'pending',
          razorpayOrderId: rzpData.id,
          createdAt: new Date().toISOString(),
        };
        store.payments.push(order);
        saveStore(store);

        res.status(201).json({
          orderId: order.orderId,
          orderToken: order.orderToken,
          plan: order.plan,
          amountInr: order.amountInr,
          currency: order.currency,
          provider: order.provider,
          razorpayOrderId: rzpData.id,
          razorpayKeyId: cfg.keyId,
          razorpayMode: cfg.mode === 'live' ? 'live' : 'test',
        });
        return;
      } catch {
        res.status(502).json({ error: 'Unable to connect to Razorpay API to create order.' });
        return;
      }
    }

    const order: StoredPaymentOrder = {
      orderId,
      orderToken,
      userId: ownerId,
      plan,
      amountInr,
      currency: 'INR',
      provider: 'sandbox',
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    store.payments.push(order);
    saveStore(store);

    res.status(201).json({
      orderId: order.orderId,
      orderToken: order.orderToken,
      plan: order.plan,
      amountInr: order.amountInr,
      currency: order.currency,
      provider: order.provider,
    });
  });

  app.post('/api/payments/verify', async (req: Request, res: Response) => {
    const auth = resolveOptionalAuth(req, res);
    if (!auth.ok) return;
    const user = auth.user;
    const requesterId = user ? user.id : 'guest';

    const orderId = typeof req.body?.orderId === 'string' ? req.body.orderId.trim() : '';
    const orderToken = typeof req.body?.orderToken === 'string' ? req.body.orderToken.trim() : '';

    if (!orderId || !orderToken) {
      res.status(400).json({ error: 'Missing order reference.' });
      return;
    }

    const order = store.payments.find((p) => p.orderId === orderId);
    if (!order || order.userId !== requesterId) {
      res.status(404).json({ error: 'Payment order not found for this session.' });
      return;
    }
    if (order.status === 'paid') {
      res.status(409).json({ error: 'This payment order has already been completed.' });
      return;
    }

    const expectedToken = crypto
      .createHmac('sha256', SESSION_SECRET)
      .update(`${order.orderId}:${order.userId}:${order.plan}:${order.amountInr}`)
      .digest('hex');
    const suppliedBuf = Buffer.from(orderToken, 'utf8');
    const expectedBuf = Buffer.from(expectedToken, 'utf8');
    if (
      suppliedBuf.length !== expectedBuf.length ||
      !crypto.timingSafeEqual(suppliedBuf, expectedBuf)
    ) {
      res.status(403).json({ error: 'Payment order verification mismatch.' });
      return;
    }

    if (order.provider === 'razorpay') {
      const cfg = getRazorpayConfig();
      if (!cfg.enabled || !order.razorpayOrderId) {
        res.status(503).json({
          error: 'Razorpay credentials are not available on the server to verify this order.',
        });
        return;
      }

      const rzpOrderId =
        typeof req.body?.razorpayOrderId === 'string' ? req.body.razorpayOrderId.trim() : '';
      const rzpPaymentId =
        typeof req.body?.razorpayPaymentId === 'string' ? req.body.razorpayPaymentId.trim() : '';
      const rzpSignature =
        typeof req.body?.razorpaySignature === 'string'
          ? req.body.razorpaySignature.trim().toLowerCase()
          : '';

      if (
        !/^order_[A-Za-z0-9]{6,40}$/.test(rzpOrderId) ||
        !/^pay_[A-Za-z0-9]{6,40}$/.test(rzpPaymentId) ||
        !/^[0-9a-f]{64}$/.test(rzpSignature)
      ) {
        res.status(400).json({ error: 'Invalid Razorpay payment confirmation fields.' });
        return;
      }
      if (rzpOrderId !== order.razorpayOrderId) {
        res.status(403).json({ error: 'Razorpay order ID mismatch.' });
        return;
      }
      if (store.payments.some((p) => p.razorpayPaymentId === rzpPaymentId)) {
        res.status(409).json({ error: 'This Razorpay payment has already been redeemed.' });
        return;
      }

      const expectedSig = crypto
        .createHmac('sha256', cfg.keySecret)
        .update(`${order.razorpayOrderId}|${rzpPaymentId}`)
        .digest('hex');
      const rzpSigBuf = Buffer.from(rzpSignature, 'utf8');
      const expSigBuf = Buffer.from(expectedSig, 'utf8');
      if (rzpSigBuf.length !== expSigBuf.length || !crypto.timingSafeEqual(rzpSigBuf, expSigBuf)) {
        res.status(403).json({ error: 'Razorpay cryptographic signature verification failed.' });
        return;
      }

      let methodLabel = 'Razorpay Checkout (INR)';
      try {
        const authHeader = Buffer.from(`${cfg.keyId}:${cfg.keySecret}`, 'utf8').toString('base64');
        const payResp = await fetch(
          `https://api.razorpay.com/v1/payments/${encodeURIComponent(rzpPaymentId)}`,
          {
            method: 'GET',
            headers: { Authorization: `Basic ${authHeader}` },
          }
        );
        const payData = (await payResp.json().catch(() => ({}))) as {
          id?: string;
          order_id?: string;
          amount?: number;
          currency?: string;
          status?: string;
          method?: string;
          vpa?: string;
          bank?: string;
          card?: { last4?: string; network?: string };
          error?: { description?: string };
        };
        if (!payResp.ok || !payData?.id) {
          res.status(502).json({
            error: payData?.error?.description || 'Could not confirm payment status with Razorpay.',
          });
          return;
        }
        if (
          payData.order_id !== order.razorpayOrderId ||
          payData.currency !== 'INR' ||
          Number(payData.amount) !== order.amountInr * 100
        ) {
          res.status(403).json({ error: 'Razorpay payment amount or order does not match plan price.' });
          return;
        }
        if (payData.status === 'authorized') {
          const capResp = await fetch(
            `https://api.razorpay.com/v1/payments/${encodeURIComponent(rzpPaymentId)}/capture`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Basic ${authHeader}`,
              },
              body: JSON.stringify({
                amount: order.amountInr * 100,
                currency: 'INR',
              }),
            }
          );
          if (!capResp.ok) {
            res.status(402).json({ error: 'Payment authorized but capture failed in Razorpay.' });
            return;
          }
        } else if (payData.status !== 'captured') {
          res.status(402).json({
            error: `Payment status is "${payData.status || 'incomplete'}". Complete payment to activate your plan.`,
          });
          return;
        }

        if (payData.method === 'upi') {
          methodLabel = payData.vpa ? `Razorpay UPI (${payData.vpa})` : 'Razorpay UPI';
        } else if (payData.method === 'netbanking') {
          methodLabel = payData.bank
            ? `Razorpay NetBanking (${payData.bank})`
            : 'Razorpay NetBanking';
        } else if (payData.method === 'card') {
          const net = payData.card?.network || 'Card';
          const last4 = payData.card?.last4 ? ` •••• ${payData.card.last4}` : '';
          methodLabel = `Razorpay ${net}${last4}`;
        } else if (payData.method) {
          methodLabel = `Razorpay (${payData.method.toUpperCase()})`;
        }
      } catch {
        res.status(502).json({ error: 'Unable to reach Razorpay servers for payment confirmation.' });
        return;
      }

      const paidAt = new Date().toISOString();
      order.status = 'paid';
      order.method = 'razorpay';
      order.methodLabel = methodLabel;
      order.receiptId = rzpPaymentId;
      order.razorpayPaymentId = rzpPaymentId;
      order.paidAt = paidAt;

      let updatedQuota = normalizeQuotaUsage(undefined);
      if (user) {
        user.plan = order.plan;
        user.quota = normalizeQuotaUsage(user.quota);
        updatedQuota = user.quota;
      }
      saveStore(store);

      res.json({
        ok: true,
        plan: order.plan,
        quota: updatedQuota,
        limits: getPlanLimits(order.plan),
        user: user ? toPublicUser(user) : undefined,
        receipt: {
          receiptId: rzpPaymentId,
          orderId: order.orderId,
          plan: order.plan,
          amountInr: order.amountInr,
          currency: order.currency,
          method: 'razorpay' as const,
          methodLabel,
          status: 'paid' as const,
          paidAt,
          razorpayPaymentId: rzpPaymentId,
        },
      });
      return;
    }

    // Sandbox verification fallback when Razorpay keys are not configured
    const method = req.body?.method;
    const upiId = typeof req.body?.upiId === 'string' ? req.body.upiId.trim() : '';
    const bankName = typeof req.body?.bankName === 'string' ? req.body.bankName.trim() : '';
    const otpCode = typeof req.body?.otpCode === 'string' ? req.body.otpCode.trim() : '';

    if (method !== 'upi' && method !== 'netbanking' && method !== 'card') {
      res.status(400).json({ error: 'Select a valid payment method (UPI, NetBanking, or Card).' });
      return;
    }

    let methodLabel = '';
    if (method === 'upi') {
      if (!/^[a-zA-Z0-9._-]{2,64}@[a-zA-Z0-9]{2,32}$/.test(upiId)) {
        res.status(400).json({ error: 'Enter a valid UPI ID (for example, name@okicici).' });
        return;
      }
      methodLabel = `UPI (${upiId})`;
    } else if (method === 'netbanking') {
      if (bankName.length < 2 || bankName.length > 40) {
        res.status(400).json({ error: 'Select a bank for NetBanking authorization.' });
        return;
      }
      if (!/^\d{4,6}$/.test(otpCode)) {
        res.status(400).json({ error: 'Enter the 4–6 digit bank authorization OTP (e.g. 123456).' });
        return;
      }
      methodLabel = `NetBanking (${bankName})`;
    } else {
      if (!/^\d{4,6}$/.test(otpCode)) {
        res.status(400).json({ error: 'Complete gateway 3DS OTP confirmation (4–6 digits, e.g. 123456).' });
        return;
      }
      methodLabel = 'Card (3DS Tokenized)';
    }

    const receiptId = `rcpt_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const paidAt = new Date().toISOString();

    order.status = 'paid';
    order.method = method;
    order.methodLabel = methodLabel;
    order.receiptId = receiptId;
    order.paidAt = paidAt;

    let updatedQuota = normalizeQuotaUsage(undefined);
    if (user) {
      user.plan = order.plan;
      user.quota = normalizeQuotaUsage(user.quota);
      updatedQuota = user.quota;
    }
    saveStore(store);

    res.json({
      ok: true,
      plan: order.plan,
      quota: updatedQuota,
      limits: getPlanLimits(order.plan),
      user: user ? toPublicUser(user) : undefined,
      receipt: {
        receiptId,
        orderId: order.orderId,
        plan: order.plan,
        amountInr: order.amountInr,
        currency: order.currency,
        method,
        methodLabel,
        status: 'paid' as const,
        paidAt,
      },
    });
  });

  app.get('/api/payments/history', requireAuth, (req: AuthedRequest, res: Response) => {
    const user = req.authUser!;
    const receipts = store.payments
      .filter((p) => p.userId === user.id && p.status === 'paid')
      .map((p) => ({
        receiptId: p.receiptId || p.orderId,
        orderId: p.orderId,
        plan: p.plan,
        amountInr: p.amountInr,
        currency: p.currency,
        method: p.method || 'upi',
        methodLabel: p.methodLabel || 'UPI',
        status: 'paid' as const,
        paidAt: p.paidAt || p.createdAt,
        razorpayPaymentId: p.razorpayPaymentId,
      }))
      .sort((a, b) => b.paidAt.localeCompare(a.paidAt));
    res.json({ receipts });
  });

  app.post('/api/account/usage', requireAuth, (req: AuthedRequest, res: Response) => {
    const user = req.authUser!;
    const kind = req.body?.kind;
    if (kind !== 'analysis' && kind !== 'puzzle') {
      res.status(400).json({ error: 'Invalid usage type.' });
      return;
    }
    const { plan, quota } = resolveUserPlan(user);
    const limits = getPlanLimits(plan);

    if (kind === 'analysis') {
      if (limits.analysisPerDay !== null && quota.analysisUsed >= limits.analysisPerDay) {
        res.status(403).json({
          code: 'QUOTA_EXCEEDED',
          error: `Daily analysis limit reached (${limits.analysisPerDay}/day on ${plan.toUpperCase()}). Upgrade to Pro or Max for more analyses.`,
          plan,
          quota,
          limits,
        });
        return;
      }
      quota.analysisUsed += 1;
    } else {
      if (limits.puzzlesPerDay !== null && quota.puzzlesUsed >= limits.puzzlesPerDay) {
        res.status(403).json({
          code: 'QUOTA_EXCEEDED',
          error: `Daily puzzle limit reached (${limits.puzzlesPerDay}/day on ${plan.toUpperCase()}). Upgrade to Pro or Max to continue solving today.`,
          plan,
          quota,
          limits,
        });
        return;
      }
      quota.puzzlesUsed += 1;
    }

    user.plan = plan;
    user.quota = quota;
    saveStore(store);
    res.json({ plan, quota, limits });
  });

  // ==================== DYNAMIC PUZZLE FILTERING API ====================
  app.get('/api/puzzles', (req: Request, res: Response) => {
    const rawDiff = typeof req.query.difficulty === 'string' ? req.query.difficulty : 'all';
    const rawSort = typeof req.query.sort === 'string' ? req.query.sort : 'default';

    const difficulty: PuzzleDifficulty =
      rawDiff === 'easy' || rawDiff === 'medium' || rawDiff === 'hard' ? rawDiff : 'all';
    const sort: PuzzleSortOrder =
      rawSort === 'rating-asc' || rawSort === 'rating-desc' ? rawSort : 'default';

    const counts = {
      all: CURATED_PUZZLES.length,
      easy: CURATED_PUZZLES.filter((p) => getPuzzleDifficulty(p.rating) === 'easy').length,
      medium: CURATED_PUZZLES.filter((p) => getPuzzleDifficulty(p.rating) === 'medium').length,
      hard: CURATED_PUZZLES.filter((p) => getPuzzleDifficulty(p.rating) === 'hard').length,
    };

    let filtered =
      difficulty === 'all'
        ? [...CURATED_PUZZLES]
        : CURATED_PUZZLES.filter((p) => getPuzzleDifficulty(p.rating) === difficulty);

    if (sort === 'rating-asc') {
      filtered.sort((a, b) => a.rating - b.rating);
    } else if (sort === 'rating-desc') {
      filtered.sort((a, b) => b.rating - a.rating);
    }

    res.json({ puzzles: filtered, counts, difficulty, sort });
  });

  // ==================== HUMAN-ONLY LEADERBOARD & BOT STATUS ====================
  function clampLeaderboardRating(val: unknown, fallback = 1620): number {
    const n = Number(val);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(400, Math.min(3500, Math.round(n)));
  }

  app.post('/api/account/bot', requireAuth, (req: AuthedRequest, res: Response) => {
    const user = req.authUser!;
    const requestedBot = Boolean(req.body?.isBot);
    const effectiveBot = requestedBot || isBotAccount({ username: user.username });
    user.isBot = effectiveBot;
    if (effectiveBot) {
      for (const t of store.tournaments) {
        t.players = t.players.filter((p) => p.userId !== user.id);
      }
    }
    saveStore(store);
    res.json({ user: toPublicUser(user) });
  });

  app.post('/api/leaderboard/checkin', (req: Request, res: Response) => {
    const auth = resolveOptionalAuth(req, res);
    if (!auth.ok) return;

    const rawVisitorId = typeof req.body?.visitorId === 'string' ? req.body.visitorId.trim() : '';
    const validVisitorId = /^[a-zA-Z0-9_-]{8,64}$/.test(rawVisitorId) ? rawVisitorId : '';

    const rawRatings =
      req.body?.ratings && typeof req.body.ratings === 'object' ? req.body.ratings : {};
    const ratings = {
      bullet: clampLeaderboardRating(rawRatings.bullet, 1540),
      blitz: clampLeaderboardRating(rawRatings.blitz, 1620),
      rapid: clampLeaderboardRating(rawRatings.rapid, 1685),
      classical: clampLeaderboardRating(rawRatings.classical, 1710),
      chess960: clampLeaderboardRating(rawRatings.chess960, 1590),
    };
    const isBot =
      Boolean(req.body?.isBot) ||
      (auth.user ? isBotAccount({ username: auth.user.username }) : false);

    if (auth.user) {
      auth.user.rating = ratings.blitz;
      auth.user.isBot = isBot || Boolean(auth.user.isBot);
      if (validVisitorId) {
        store.visitors = store.visitors.filter((v) => v.id !== validVisitorId);
      }
      saveStore(store);
      res.json({ ok: true });
      return;
    }

    if (!validVisitorId) {
      res.status(400).json({ error: 'Valid visitorId is required.' });
      return;
    }

    if (isBot) {
      store.visitors = store.visitors.filter((v) => v.id !== validVisitorId);
      saveStore(store);
      res.json({ ok: true, excludedAsBot: true });
      return;
    }

    const displayName = 'Anonymous';
    const now = new Date().toISOString();
    const existing = store.visitors.find((v) => v.id === validVisitorId);
    if (existing) {
      existing.username = displayName;
      existing.usernameLower = 'anonymous';
      existing.ratings = ratings;
      existing.isBot = false;
      existing.lastSeenAt = now;
    } else {
      store.visitors.push({
        id: validVisitorId,
        username: displayName,
        usernameLower: 'anonymous',
        ratings,
        isBot: false,
        lastSeenAt: now,
      });
    }
    saveStore(store);
    res.json({ ok: true });
  });

  app.get('/api/leaderboard', (req: Request, res: Response) => {
    const rawCategory = typeof req.query.category === 'string' ? req.query.category : 'blitz';
    const category =
      rawCategory === 'bullet' ||
      rawCategory === 'blitz' ||
      rawCategory === 'rapid' ||
      rawCategory === 'classical' ||
      rawCategory === 'chess960'
        ? rawCategory
        : 'blitz';
    const includeBots = req.query.includeBots === '1' || req.query.includeBots === 'true';

    const categoryOffset: Record<string, number> = {
      bullet: -80,
      blitz: 0,
      rapid: 65,
      classical: 90,
      chess960: -30,
    };

    const userEntries = store.users
      .filter((u) => {
        const bot = Boolean(u.isBot) || isBotAccount({ username: u.username });
        return includeBots ? true : !bot;
      })
      .map((u) => {
        const bot = Boolean(u.isBot) || isBotAccount({ username: u.username });
        return {
          id: u.id,
          username: u.username,
          rating: Math.max(400, u.rating + (categoryOffset[category] || 0)),
          isBot: bot,
          source: 'account' as const,
        };
      });

    const accountNames = new Set(userEntries.map((u) => u.username.toLowerCase()));

    const visitorEntries = store.visitors
      .filter(
        (v) =>
          !v.isBot &&
          !isBotAccount({ username: v.username }) &&
          (v.usernameLower === 'anonymous' ||
            v.username === 'CaissaPlayer' ||
            !accountNames.has(v.usernameLower))
      )
      .map((v) => ({
        id: v.id,
        username: 'Anonymous',
        rating: v.ratings?.[category] ?? 1620,
        isBot: false,
        source: 'visitor' as const,
      }));

    const players = [...userEntries, ...visitorEntries].sort((a, b) => b.rating - a.rating);
    res.json({ players, total: players.length });
  });

  // ==================== TOURNAMENTS API ====================
  app.get('/api/tournaments', (req: Request, res: Response) => {
    const token = extractBearer(req);
    const verified = token ? verifyToken(token) : null;
    const userId = verified?.user.id;
    res.json({
      tournaments: store.tournaments.map((t) => formatTournamentForClient(t, userId)),
    });
  });

  app.post('/api/tournaments', requireAuth, (req: AuthedRequest, res: Response) => {
    const user = req.authUser!;
    const format = req.body?.format === 'swiss' ? 'swiss' : 'arena';
    const variant =
      typeof req.body?.variant === 'string' && VALID_VARIANTS.has(req.body.variant)
        ? req.body.variant
        : 'standard';
    const rawName = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (rawName.length > 80) {
      res.status(400).json({ error: 'Tournament name must be 80 characters or fewer.' });
      return;
    }
    const timeControl =
      typeof req.body?.timeControl === 'string' && /^\d{1,2}\+\d{1,2}$/.test(req.body.timeControl)
        ? req.body.timeControl
        : '3+2';
    const durationMinutes =
      format === 'arena'
        ? Math.max(10, Math.min(180, Number(req.body?.durationMinutes) || 30))
        : undefined;
    const totalRounds =
      format === 'swiss'
        ? Math.max(3, Math.min(9, Number(req.body?.totalRounds) || 5))
        : undefined;

    const isCreatorBot = Boolean(user.isBot || isBotAccount({ username: user.username }));
    const name = rawName || `${user.username}'s ${format === 'arena' ? 'Arena' : 'Swiss'}`;
    const created: StoredTournament = {
      id: `tour-${crypto.randomUUID().slice(0, 8)}`,
      name,
      format,
      variant,
      timeControl,
      durationMinutes,
      totalRounds,
      currentRound: 1,
      status: 'active',
      ownerId: user.id,
      createdBy: user.username,
      players: isCreatorBot
        ? []
        : [
            {
              id: `pl-${user.id}`,
              name: user.username,
              rating: user.rating,
              score: 0,
              streak: 0,
              gamesPlayed: 0,
              buchholz: 0,
              userId: user.id,
            },
          ],
    };

    store.tournaments.unshift(created);
    saveStore(store);
    res.status(201).json({ tournament: formatTournamentForClient(created, user.id) });
  });

  app.post('/api/tournaments/:id/join', requireAuth, (req: AuthedRequest, res: Response) => {
    const user = req.authUser!;
    if (user.isBot || isBotAccount({ username: user.username })) {
      res.status(403).json({ error: 'Bots are not allowed in tournament leaderboards.' });
      return;
    }
    const tournament = store.tournaments.find((t) => t.id === req.params.id);
    if (!tournament) {
      res.status(404).json({ error: 'Tournament not found.' });
      return;
    }

    const existingIdx = tournament.players.findIndex((p) => p.userId === user.id);
    if (existingIdx >= 0) {
      tournament.players.splice(existingIdx, 1);
    } else {
      tournament.players.push({
        id: `pl-${user.id}`,
        name: user.username,
        rating: user.rating,
        score: 0,
        streak: 0,
        gamesPlayed: 0,
        buchholz: 0,
        userId: user.id,
      });
    }
    saveStore(store);
    res.json({ tournament: formatTournamentForClient(tournament, user.id) });
  });

  app.post('/api/tournaments/:id/result', requireAuth, (req: AuthedRequest, res: Response) => {
    const user = req.authUser!;
    if (user.isBot || isBotAccount({ username: user.username })) {
      res.status(403).json({ error: 'Bots are not allowed in tournament leaderboards.' });
      return;
    }
    const tournament = store.tournaments.find((t) => t.id === req.params.id);
    if (!tournament) {
      res.status(404).json({ error: 'Tournament not found.' });
      return;
    }

    const outcome = req.body?.outcome;
    if (outcome !== 'win' && outcome !== 'draw' && outcome !== 'loss') {
      res.status(400).json({ error: 'Invalid match outcome.' });
      return;
    }
    const berserk = Boolean(req.body?.berserk);
    const isSwiss = tournament.format === 'swiss';

    let player = tournament.players.find((p) => p.userId === user.id);
    if (!player) {
      player = {
        id: `pl-${user.id}`,
        name: user.username,
        rating: user.rating,
        score: 0,
        streak: 0,
        gamesPlayed: 0,
        buchholz: 0,
        userId: user.id,
      };
      tournament.players.push(player);
    }

    tournament.players = tournament.players.map((p) => {
      if (p.userId === user.id) {
        if (outcome === 'win') {
          const streakBonus = !isSwiss && p.streak >= 2 ? 2 : 0;
          const berserkBonus = !isSwiss && berserk ? 1 : 0;
          const pts = isSwiss ? 1 : 2 + streakBonus + berserkBonus;
          return {
            ...p,
            score: p.score + pts,
            streak: p.streak + 1,
            gamesPlayed: p.gamesPlayed + 1,
            buchholz: (p.buchholz || 0) + 1.5,
          };
        }
        if (outcome === 'draw') {
          return {
            ...p,
            score: p.score + (isSwiss ? 0.5 : 1),
            streak: 0,
            gamesPlayed: p.gamesPlayed + 1,
            buchholz: (p.buchholz || 0) + 1,
          };
        }
        return { ...p, streak: 0, gamesPlayed: p.gamesPlayed + 1 };
      }
      return p;
    });

    if (isSwiss) {
      const total = tournament.totalRounds || 5;
      if (tournament.currentRound >= total) {
        tournament.status = 'finished';
      }
      tournament.currentRound = Math.min(total, tournament.currentRound + 1);
    }

    saveStore(store);
    res.json({ tournament: formatTournamentForClient(tournament, user.id) });
  });

  app.delete('/api/tournaments/:id', requireAuth, (req: AuthedRequest, res: Response) => {
    const user = req.authUser!;
    const idx = store.tournaments.findIndex((t) => t.id === req.params.id);
    if (idx < 0) {
      res.status(404).json({ error: 'Tournament not found.' });
      return;
    }
    if (store.tournaments[idx].ownerId !== user.id) {
      res.status(403).json({ error: 'Only the tournament creator can delete this tournament.' });
      return;
    }
    store.tournaments.splice(idx, 1);
    saveStore(store);
    res.json({ ok: true });
  });

  // ==================== GLOBAL TOURNAMENT CHAT (REST + WEBSOCKET) ====================
  const wssTournamentChat = new WebSocketServer({ noServer: true });

  function broadcastTournamentChat(payload: unknown): void {
    const serialized = JSON.stringify(payload);
    for (const client of wssTournamentChat.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(serialized);
      }
    }
  }

  function appendGlobalTournamentChatMessage(params: {
    clientMsgId?: unknown;
    text: unknown;
    tournamentTag?: unknown;
    user: StoredUser | null;
  }):
    | { ok: true; message: StoredGlobalTournamentChatMessage; duplicate: boolean }
    | { ok: false; error: string } {
    const rawText = typeof params.text === 'string' ? params.text.trim() : '';
    if (rawText.length < 1 || rawText.length > 300) {
      return { ok: false, error: 'Message must be between 1 and 300 characters.' };
    }
    const rawId = typeof params.clientMsgId === 'string' ? params.clientMsgId.trim() : '';
    const validId = /^[a-zA-Z0-9_-]{6,64}$/.test(rawId)
      ? rawId
      : `tgc-${crypto.randomUUID().slice(0, 16)}`;

    const existing = store.tournamentGlobalChat.find((m) => m.id === validId);
    if (existing) {
      return { ok: true, message: existing, duplicate: true };
    }

    const rawTag =
      typeof params.tournamentTag === 'string' ? params.tournamentTag.trim().slice(0, 80) : '';
    const message: StoredGlobalTournamentChatMessage = {
      id: validId,
      author: params.user ? params.user.username : 'Anonymous',
      isGuest: !params.user,
      tournamentTag: rawTag || undefined,
      text: rawText,
      createdAt: new Date().toISOString(),
    };

    store.tournamentGlobalChat.push(message);
    if (store.tournamentGlobalChat.length > 250) {
      store.tournamentGlobalChat = store.tournamentGlobalChat.slice(-250);
    }
    saveStore(store);
    return { ok: true, message, duplicate: false };
  }

  app.get('/api/tournaments/chat', (_req: Request, res: Response) => {
    res.json({
      messages: store.tournamentGlobalChat,
      onlineCount: wssTournamentChat.clients.size,
    });
  });

  app.post('/api/tournaments/chat', (req: Request, res: Response) => {
    const auth = resolveOptionalAuth(req, res);
    if (!auth.ok) return;

    const result = appendGlobalTournamentChatMessage({
      clientMsgId: req.body?.id,
      text: req.body?.text,
      tournamentTag: req.body?.tournamentTag,
      user: auth.user,
    });
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    if (!result.duplicate) {
      broadcastTournamentChat({ type: 'chat:message', message: result.message });
    }
    res.status(result.duplicate ? 200 : 201).json({ message: result.message });
  });

  wssTournamentChat.on('connection', (ws) => {
    ws.send(
      JSON.stringify({
        type: 'chat:init',
        messages: store.tournamentGlobalChat,
        onlineCount: wssTournamentChat.clients.size,
      })
    );
    broadcastTournamentChat({
      type: 'chat:presence',
      onlineCount: wssTournamentChat.clients.size,
    });

    ws.on('message', (raw) => {
      try {
        const parsed = JSON.parse(raw.toString()) as {
          type?: string;
          clientMsgId?: string;
          token?: string | null;
          text?: string;
          tournamentTag?: string;
        };
        if (parsed?.type !== 'chat:send') return;

        const tokenStr = typeof parsed.token === 'string' ? parsed.token.trim() : '';
        const verified = tokenStr ? verifyToken(tokenStr) : null;
        const result = appendGlobalTournamentChatMessage({
          clientMsgId: parsed.clientMsgId,
          text: parsed.text,
          tournamentTag: parsed.tournamentTag,
          user: verified ? verified.user : null,
        });
        if (!result.ok) {
          ws.send(JSON.stringify({ type: 'chat:error', error: result.error }));
          return;
        }
        if (!result.duplicate) {
          broadcastTournamentChat({ type: 'chat:message', message: result.message });
        }
      } catch {
        // Ignore malformed payloads
      }
    });

    ws.on('close', () => {
      broadcastTournamentChat({
        type: 'chat:presence',
        onlineCount: wssTournamentChat.clients.size,
      });
    });
  });

  // ==================== CUSTOM PUZZLES, CLUBS & HALL OF FAME APIS ====================
  app.get('/api/puzzles/custom', (_req: Request, res: Response) => {
    res.json({ puzzles: store.customPuzzles });
  });

  app.post('/api/puzzles/custom', (req: Request, res: Response) => {
    const auth = resolveOptionalAuth(req, res);
    if (!auth.ok) return;

    const title = typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 80) : '';
    const fen = typeof req.body?.fen === 'string' ? req.body.fen.trim() : '';
    const rawSolution = Array.isArray(req.body?.solutionUci) ? req.body.solutionUci : [];
    const themes = Array.isArray(req.body?.themes)
      ? req.body.themes.filter((t: unknown): t is string => typeof t === 'string').slice(0, 6)
      : ['Custom'];
    const rating = clampLeaderboardRating(req.body?.rating, 1500);

    if (title.length < 3) {
      res.status(400).json({ error: 'Puzzle title must be at least 3 characters.' });
      return;
    }
    if (!fen || rawSolution.length < 1 || rawSolution.length > 10) {
      res.status(400).json({ error: 'Provide a valid FEN and 1–10 solution moves.' });
      return;
    }

    let state: BoardState;
    try {
      state = parseFen(fen, 'standard');
    } catch {
      res.status(400).json({ error: 'Invalid FEN position.' });
      return;
    }
    const playerColor = state.turn;
    const verifiedUci: string[] = [];
    let simState = state;
    for (const rawMove of rawSolution) {
      if (typeof rawMove !== 'string') {
        res.status(400).json({ error: 'Invalid move format in solution.' });
        return;
      }
      const mv = uciToMove(simState, rawMove.trim());
      if (!mv) {
        res.status(400).json({ error: `Illegal move "${rawMove}" in solution sequence.` });
        return;
      }
      const applied = makeMove(simState, mv);
      verifiedUci.push(applied.uci);
      simState = applied.next;
    }

    const created: StoredCustomPuzzle = {
      id: `cp-${crypto.randomUUID().slice(0, 10)}`,
      title,
      rating,
      themes: themes.length > 0 ? themes : ['Custom'],
      fen: toFen(state),
      solutionUci: verifiedUci,
      playerColor,
      author: auth.user ? auth.user.username : 'Anonymous',
      createdAt: new Date().toISOString(),
    };
    store.customPuzzles.unshift(created);
    if (store.customPuzzles.length > 200) {
      store.customPuzzles = store.customPuzzles.slice(0, 200);
    }
    saveStore(store);
    res.status(201).json({ puzzle: created });
  });

  app.get('/api/clubs', (_req: Request, res: Response) => {
    const clubs = [...store.clubs]
      .sort((a, b) => b.totalScore - a.totalScore)
      .map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        createdBy: c.createdBy,
        memberCount: c.members.length,
        members: c.members,
        totalScore: c.totalScore,
      }));
    res.json({ clubs });
  });

  app.post('/api/clubs', (req: Request, res: Response) => {
    const auth = resolveOptionalAuth(req, res);
    if (!auth.ok) return;

    const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 48) : '';
    const description =
      typeof req.body?.description === 'string'
        ? req.body.description.trim().slice(0, 160)
        : 'Friendly chess club & team war squad.';
    if (name.length < 3) {
      res.status(400).json({ error: 'Club name must be at least 3 characters.' });
      return;
    }
    if (store.clubs.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      res.status(409).json({ error: 'A club with that name already exists.' });
      return;
    }
    const creator = auth.user ? auth.user.username : 'Anonymous';
    const club: StoredClub = {
      id: `club-${crypto.randomUUID().slice(0, 8)}`,
      name,
      description: description || 'Friendly chess club & team war squad.',
      createdBy: creator,
      members: [creator],
      totalScore: 50,
    };
    store.clubs.unshift(club);
    saveStore(store);
    res.status(201).json({
      club: {
        ...club,
        memberCount: club.members.length,
      },
    });
  });

  app.post('/api/clubs/:id/join', (req: Request, res: Response) => {
    const auth = resolveOptionalAuth(req, res);
    if (!auth.ok) return;
    const club = store.clubs.find((c) => c.id === req.params.id);
    if (!club) {
      res.status(404).json({ error: 'Club not found.' });
      return;
    }
    const memberName = auth.user
      ? auth.user.username
      : typeof req.body?.visitorId === 'string' && req.body.visitorId.trim()
      ? `Guest-${req.body.visitorId.trim().slice(-4)}`
      : 'Anonymous';
    const rawDelta = Number(req.body?.scoreDelta);
    if (Number.isFinite(rawDelta) && rawDelta > 0) {
      club.totalScore += Math.min(20, Math.round(rawDelta));
    } else if (club.members.includes(memberName)) {
      if (club.members.length > 1) {
        club.members = club.members.filter((m) => m !== memberName);
      }
    } else {
      club.members.push(memberName);
      club.totalScore += 15;
    }
    saveStore(store);
    res.json({
      club: {
        ...club,
        memberCount: club.members.length,
      },
    });
  });

  app.get('/api/tournaments/hall-of-fame', (_req: Request, res: Response) => {
    res.json({ entries: store.hallOfFame });
  });

  app.post('/api/tournaments/hall-of-fame', (req: Request, res: Response) => {
    const tournamentId =
      typeof req.body?.tournamentId === 'string' ? req.body.tournamentId.trim().slice(0, 64) : '';
    const tournamentName =
      typeof req.body?.tournamentName === 'string'
        ? req.body.tournamentName.trim().slice(0, 80)
        : '';
    const format =
      req.body?.format === 'swiss' || req.body?.format === 'knockout' ? req.body.format : 'arena';
    const rawPodium = Array.isArray(req.body?.podium) ? req.body.podium.slice(0, 3) : [];
    if (!tournamentId || !tournamentName || rawPodium.length === 0) {
      res.status(400).json({ error: 'Tournament podium payload is incomplete.' });
      return;
    }
    const existing = store.hallOfFame.find((e) => e.tournamentId === tournamentId);
    if (existing) {
      res.json({ entry: existing });
      return;
    }
    const entry: StoredHallOfFameEntry = {
      id: `hof-${crypto.randomUUID().slice(0, 8)}`,
      tournamentId,
      tournamentName,
      format,
      completedAt: new Date().toISOString(),
      podium: rawPodium.map(
        (p: { name?: unknown; isGuest?: unknown; score?: unknown }, idx: number) => ({
          rank: (idx + 1) as 1 | 2 | 3,
          name: typeof p?.name === 'string' ? p.name.slice(0, 48) : 'Player',
          isGuest: Boolean(p?.isGuest),
          score: Number(p?.score) || 0,
        })
      ),
    };
    store.hallOfFame.unshift(entry);
    if (store.hallOfFame.length > 50) {
      store.hallOfFame = store.hallOfFame.slice(0, 50);
    }
    saveStore(store);
    res.status(201).json({ entry });
  });

  // ==================== REAL-TIME 1v1 MULTIPLAYER ARENA & SPECTATOR TV (/ws/arena) ====================
  interface ArenaRoomChat {
    id: string;
    author: string;
    isGuest: boolean;
    text: string;
    createdAt: string;
  }

  interface ArenaRoom {
    id: string;
    variant: ChessVariant;
    timeControl: string;
    baseMs: number;
    incMs: number;
    state: BoardState;
    initialFen: string;
    historyStates: BoardState[];
    moves: Move[];
    fens: string[];
    whiteWs: WebSocket | null;
    blackWs: WebSocket | null;
    whiteName: string;
    blackName: string;
    whiteIsGuest: boolean;
    blackIsGuest: boolean;
    whiteMs: number;
    blackMs: number;
    lastTickAt: number;
    status: 'waiting' | 'active' | 'finished';
    resultReason: string | null;
    winner: PieceColor | 'draw' | null;
    drawOfferBy: PieceColor | null;
    takebackOfferBy: PieceColor | null;
    rematchVotes: { w: boolean; b: boolean };
    series: { w: number; b: number; draws: number; round: number };
    spectators: Set<WebSocket>;
    chat: ArenaRoomChat[];
  }

  interface ArenaQueueEntry {
    ws: WebSocket;
    variant: ChessVariant;
    timeControl: string;
    name: string;
    isGuest: boolean;
  }

  const arenaRooms = new Map<string, ArenaRoom>();
  let arenaQueue: ArenaQueueEntry[] = [];
  const wssArena = new WebSocketServer({ noServer: true });

  function parseTimeControlMs(tc: string): { baseMs: number; incMs: number } {
    const parts = tc.split('+').map((n) => parseInt(n, 10));
    const min = Number.isFinite(parts[0]) && parts[0] > 0 ? Math.min(60, parts[0]) : 5;
    const inc = Number.isFinite(parts[1]) && parts[1] >= 0 ? Math.min(30, parts[1]) : 0;
    return { baseMs: min * 60_000, incMs: inc * 1000 };
  }

  function resolveSocketIdentity(token?: unknown): { name: string; isGuest: boolean } {
    const tokenStr = typeof token === 'string' ? token.trim() : '';
    const verified = tokenStr ? verifyToken(tokenStr) : null;
    if (verified) {
      return { name: verified.user.username, isGuest: false };
    }
    return { name: 'Anonymous', isGuest: true };
  }

  function tickRoomClock(room: ArenaRoom) {
    if (room.status !== 'active' || room.moves.length === 0) {
      room.lastTickAt = Date.now();
      return;
    }
    const now = Date.now();
    const elapsed = Math.max(0, now - room.lastTickAt);
    room.lastTickAt = now;
    if (room.state.turn === 'w') {
      room.whiteMs = Math.max(0, room.whiteMs - elapsed);
      if (room.whiteMs === 0) {
        room.status = 'finished';
        room.winner = 'b';
        room.resultReason = 'White flagged on time';
      }
    } else {
      room.blackMs = Math.max(0, room.blackMs - elapsed);
      if (room.blackMs === 0) {
        room.status = 'finished';
        room.winner = 'w';
        room.resultReason = 'Black flagged on time';
      }
    }
  }

  function serializeRoomState(room: ArenaRoom) {
    return {
      type: 'room:state',
      room: {
        id: room.id,
        variant: room.variant,
        timeControl: room.timeControl,
        fen: toFen(room.state),
        turn: room.state.turn,
        moves: room.moves,
        fens: room.fens,
        whiteName: room.whiteName,
        blackName: room.blackName,
        whiteIsGuest: room.whiteIsGuest,
        blackIsGuest: room.blackIsGuest,
        whiteMs: room.whiteMs,
        blackMs: room.blackMs,
        status: room.status,
        winner: room.winner,
        resultReason: room.resultReason,
        drawOfferBy: room.drawOfferBy,
        takebackOfferBy: room.takebackOfferBy,
        rematchVotes: room.rematchVotes,
        series: room.series,
        spectatorCount: room.spectators.size,
        chat: room.chat,
      },
    };
  }

  function broadcastArenaRoom(room: ArenaRoom) {
    const payload = JSON.stringify(serializeRoomState(room));
    const targets: (WebSocket | null)[] = [room.whiteWs, room.blackWs, ...room.spectators];
    for (const sock of targets) {
      if (sock && sock.readyState === WebSocket.OPEN) {
        sock.send(payload);
      }
    }
  }

  function createArenaRoom(params: {
    variant: ChessVariant;
    timeControl: string;
    whiteWs: WebSocket;
    whiteName: string;
    whiteIsGuest: boolean;
    blackWs?: WebSocket | null;
    blackName?: string;
    blackIsGuest?: boolean;
  }): ArenaRoom {
    const { baseMs, incMs } = parseTimeControlMs(params.timeControl);
    const state = createInitialState(params.variant);
    const initialFen = toFen(state);
    const room: ArenaRoom = {
      id: `rm-${crypto.randomUUID().slice(0, 8)}`,
      variant: params.variant,
      timeControl: params.timeControl,
      baseMs,
      incMs,
      state,
      initialFen,
      historyStates: [state],
      moves: [],
      fens: [initialFen],
      whiteWs: params.whiteWs,
      blackWs: params.blackWs ?? null,
      whiteName: params.whiteName,
      blackName: params.blackName ?? 'Waiting for opponent...',
      whiteIsGuest: params.whiteIsGuest,
      blackIsGuest: params.blackIsGuest ?? true,
      whiteMs: baseMs,
      blackMs: baseMs,
      lastTickAt: Date.now(),
      status: params.blackWs ? 'active' : 'waiting',
      resultReason: null,
      winner: null,
      drawOfferBy: null,
      takebackOfferBy: null,
      rematchVotes: { w: false, b: false },
      series: { w: 0, b: 0, draws: 0, round: 1 },
      spectators: new Set(),
      chat: [],
    };
    arenaRooms.set(room.id, room);
    return room;
  }

  function getSocketRole(room: ArenaRoom, ws: WebSocket): PieceColor | null {
    if (room.whiteWs === ws) return 'w';
    if (room.blackWs === ws) return 'b';
    return null;
  }

  app.get('/api/live-games', (_req: Request, res: Response) => {
    const games = Array.from(arenaRooms.values())
      .filter((r) => r.status === 'active' || r.status === 'waiting')
      .map((r) => {
        tickRoomClock(r);
        return {
          roomId: r.id,
          variant: r.variant,
          timeControl: r.timeControl,
          whiteName: r.whiteName,
          whiteIsGuest: r.whiteIsGuest,
          blackName: r.blackName,
          blackIsGuest: r.blackIsGuest,
          fen: toFen(r.state),
          moveCount: r.moves.length,
          spectatorCount: r.spectators.size,
          status: r.status,
        };
      })
      .slice(0, 24);
    res.json({ games });
  });

  wssArena.on('connection', (ws) => {
    let activeRoomId: string | null = null;

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as {
          type?: string;
          variant?: ChessVariant;
          timeControl?: string;
          token?: string | null;
          roomId?: string;
          uci?: string;
          text?: string;
        };
        const ident = resolveSocketIdentity(msg.token);

        if (msg.type === 'queue:join') {
          const variant: ChessVariant =
            msg.variant && VALID_VARIANTS.has(msg.variant) ? msg.variant : 'standard';
          const tc =
            typeof msg.timeControl === 'string' && /^\d{1,2}\+\d{1,2}$/.test(msg.timeControl)
              ? msg.timeControl
              : '5+0';
          arenaQueue = arenaQueue.filter((q) => q.ws !== ws && q.ws.readyState === WebSocket.OPEN);

          const matchIdx = arenaQueue.findIndex(
            (q) => q.variant === variant && q.timeControl === tc
          );
          if (matchIdx >= 0) {
            const opponent = arenaQueue.splice(matchIdx, 1)[0];
            const swap = Math.random() < 0.5;
            const room = createArenaRoom({
              variant,
              timeControl: tc,
              whiteWs: swap ? ws : opponent.ws,
              whiteName: swap ? ident.name : opponent.name,
              whiteIsGuest: swap ? ident.isGuest : opponent.isGuest,
              blackWs: swap ? opponent.ws : ws,
              blackName: swap ? opponent.name : ident.name,
              blackIsGuest: swap ? opponent.isGuest : ident.isGuest,
            });
            activeRoomId = room.id;
            room.whiteWs?.send(
              JSON.stringify({ type: 'room:assigned', roomId: room.id, myColor: 'w' })
            );
            room.blackWs?.send(
              JSON.stringify({ type: 'room:assigned', roomId: room.id, myColor: 'b' })
            );
            broadcastArenaRoom(room);
          } else {
            arenaQueue.push({
              ws,
              variant,
              timeControl: tc,
              name: ident.name,
              isGuest: ident.isGuest,
            });
            ws.send(JSON.stringify({ type: 'queue:waiting', variant, timeControl: tc }));
          }
          return;
        }

        if (msg.type === 'queue:leave') {
          arenaQueue = arenaQueue.filter((q) => q.ws !== ws);
          return;
        }

        if (msg.type === 'room:create') {
          const variant: ChessVariant =
            msg.variant && VALID_VARIANTS.has(msg.variant) ? msg.variant : 'standard';
          const tc =
            typeof msg.timeControl === 'string' && /^\d{1,2}\+\d{1,2}$/.test(msg.timeControl)
              ? msg.timeControl
              : '5+0';
          const room = createArenaRoom({
            variant,
            timeControl: tc,
            whiteWs: ws,
            whiteName: ident.name,
            whiteIsGuest: ident.isGuest,
          });
          activeRoomId = room.id;
          ws.send(JSON.stringify({ type: 'room:assigned', roomId: room.id, myColor: 'w' }));
          broadcastArenaRoom(room);
          return;
        }

        if (msg.type === 'room:join' && typeof msg.roomId === 'string') {
          const room = arenaRooms.get(msg.roomId.trim());
          if (!room) {
            ws.send(JSON.stringify({ type: 'arena:error', error: 'Challenge room not found.' }));
            return;
          }
          activeRoomId = room.id;
          if (room.whiteWs === ws) {
            ws.send(JSON.stringify({ type: 'room:assigned', roomId: room.id, myColor: 'w' }));
          } else if (!room.blackWs || room.blackWs.readyState !== WebSocket.OPEN) {
            room.blackWs = ws;
            room.blackName = ident.name;
            room.blackIsGuest = ident.isGuest;
            room.status = 'active';
            room.lastTickAt = Date.now();
            ws.send(JSON.stringify({ type: 'room:assigned', roomId: room.id, myColor: 'b' }));
          } else {
            room.spectators.add(ws);
            ws.send(
              JSON.stringify({ type: 'room:assigned', roomId: room.id, myColor: 'spectator' })
            );
          }
          broadcastArenaRoom(room);
          return;
        }

        if (msg.type === 'room:spectate' && typeof msg.roomId === 'string') {
          const room = arenaRooms.get(msg.roomId.trim());
          if (!room) {
            ws.send(JSON.stringify({ type: 'arena:error', error: 'Live game not found.' }));
            return;
          }
          activeRoomId = room.id;
          room.spectators.add(ws);
          ws.send(
            JSON.stringify({ type: 'room:assigned', roomId: room.id, myColor: 'spectator' })
          );
          broadcastArenaRoom(room);
          return;
        }

        const roomId = typeof msg.roomId === 'string' ? msg.roomId : activeRoomId;
        if (!roomId) return;
        const room = arenaRooms.get(roomId);
        if (!room) return;
        const role = getSocketRole(room, ws);

        if (msg.type === 'room:move' && role && room.status === 'active') {
          tickRoomClock(room);
          if (room.status !== 'active') {
            broadcastArenaRoom(room);
            return;
          }
          if (room.state.turn !== role || typeof msg.uci !== 'string') return;
          const mv = uciToMove(room.state, msg.uci.trim());
          if (!mv) return;
          const applied = makeMove(room.state, mv);
          if (role === 'w') {
            room.whiteMs += room.incMs;
          } else {
            room.blackMs += room.incMs;
          }
          room.state = applied.next;
          room.historyStates.push(applied.next);
          room.moves.push({ ...mv, san: applied.san, uci: applied.uci });
          room.fens.push(toFen(applied.next));
          room.drawOfferBy = null;
          room.takebackOfferBy = null;

          const res = evaluateGameResult(room.state);
          if (res) {
            room.status = 'finished';
            room.winner = res.winner;
            room.resultReason = res.reason;
            if (res.winner === 'w') room.series.w += 1;
            else if (res.winner === 'b') room.series.b += 1;
            else room.series.draws += 1;
          }
          broadcastArenaRoom(room);
          return;
        }

        if (msg.type === 'room:resign' && role && room.status === 'active') {
          room.status = 'finished';
          room.winner = role === 'w' ? 'b' : 'w';
          room.resultReason = `${role === 'w' ? 'White' : 'Black'} resigned`;
          if (room.winner === 'w') room.series.w += 1;
          else room.series.b += 1;
          broadcastArenaRoom(room);
          return;
        }

        if (msg.type === 'room:draw_offer' && role && room.status === 'active') {
          room.drawOfferBy = role;
          broadcastArenaRoom(room);
          return;
        }

        if (
          msg.type === 'room:draw_accept' &&
          role &&
          room.status === 'active' &&
          room.drawOfferBy &&
          room.drawOfferBy !== role
        ) {
          room.status = 'finished';
          room.winner = 'draw';
          room.resultReason = 'Draw by mutual agreement';
          room.series.draws += 1;
          room.drawOfferBy = null;
          broadcastArenaRoom(room);
          return;
        }

        if (
          msg.type === 'room:takeback_request' &&
          role &&
          room.status === 'active' &&
          room.moves.length > 0
        ) {
          room.takebackOfferBy = role;
          broadcastArenaRoom(room);
          return;
        }

        if (
          msg.type === 'room:takeback_accept' &&
          role &&
          room.status === 'active' &&
          room.takebackOfferBy &&
          room.takebackOfferBy !== role &&
          room.historyStates.length > 1
        ) {
          room.historyStates.pop();
          room.moves.pop();
          room.fens.pop();
          room.state = room.historyStates[room.historyStates.length - 1];
          room.takebackOfferBy = null;
          broadcastArenaRoom(room);
          return;
        }

        if (msg.type === 'room:rematch' && role && room.status === 'finished') {
          room.rematchVotes[role] = true;
          if (room.rematchVotes.w && room.rematchVotes.b) {
            // Swap colors for fair Best-of-3 series
            const prevWhiteWs = room.whiteWs;
            const prevWhiteName = room.whiteName;
            const prevWhiteGuest = room.whiteIsGuest;
            room.whiteWs = room.blackWs;
            room.whiteName = room.blackName;
            room.whiteIsGuest = room.blackIsGuest;
            room.blackWs = prevWhiteWs;
            room.blackName = prevWhiteName;
            room.blackIsGuest = prevWhiteGuest;

            const prevSeriesW = room.series.w;
            room.series = {
              w: room.series.b,
              b: prevSeriesW,
              draws: room.series.draws,
              round: room.series.round + 1,
            };

            const nextState = createInitialState(room.variant);
            room.state = nextState;
            room.initialFen = toFen(nextState);
            room.historyStates = [nextState];
            room.moves = [];
            room.fens = [room.initialFen];
            room.whiteMs = room.baseMs;
            room.blackMs = room.baseMs;
            room.lastTickAt = Date.now();
            room.status = 'active';
            room.winner = null;
            room.resultReason = null;
            room.drawOfferBy = null;
            room.takebackOfferBy = null;
            room.rematchVotes = { w: false, b: false };
            room.whiteWs?.send(
              JSON.stringify({ type: 'room:assigned', roomId: room.id, myColor: 'w' })
            );
            room.blackWs?.send(
              JSON.stringify({ type: 'room:assigned', roomId: room.id, myColor: 'b' })
            );
          }
          broadcastArenaRoom(room);
          return;
        }

        if (msg.type === 'room:chat' && typeof msg.text === 'string') {
          const cleanText = msg.text.trim().slice(0, 240);
          if (!cleanText) return;
          room.chat.push({
            id: `rc-${crypto.randomUUID().slice(0, 8)}`,
            author: ident.name,
            isGuest: ident.isGuest,
            text: cleanText,
            createdAt: new Date().toISOString(),
          });
          if (room.chat.length > 80) {
            room.chat = room.chat.slice(-80);
          }
          broadcastArenaRoom(room);
        }
      } catch {
        // Ignore malformed payloads
      }
    });

    ws.on('close', () => {
      arenaQueue = arenaQueue.filter((q) => q.ws !== ws);
      if (activeRoomId) {
        const room = arenaRooms.get(activeRoomId);
        if (room) {
          room.spectators.delete(ws);
          const role = getSocketRole(room, ws);
          if (role && room.status === 'active') {
            room.status = 'finished';
            room.winner = role === 'w' ? 'b' : 'w';
            room.resultReason = `${role === 'w' ? 'White' : 'Black'} disconnected`;
          }
          broadcastArenaRoom(room);
          if (
            (!room.whiteWs || room.whiteWs.readyState !== WebSocket.OPEN) &&
            (!room.blackWs || room.blackWs.readyState !== WebSocket.OPEN) &&
            room.spectators.size === 0
          ) {
            arenaRooms.delete(room.id);
          }
        }
      }
    });
  });

  // ==================== REAL-TIME 1v1 PUZZLE DUEL (/ws/puzzle-duel) ====================
  interface DuelMatch {
    id: string;
    p1Ws: WebSocket;
    p2Ws: WebSocket;
    p1Name: string;
    p2Name: string;
    p1Score: number;
    p2Score: number;
    timer: ReturnType<typeof setTimeout>;
  }

  let duelQueue: { ws: WebSocket; name: string; isGuest: boolean }[] = [];
  const duelMatches = new Map<string, DuelMatch>();
  const wssPuzzleDuel = new WebSocketServer({ noServer: true });

  wssPuzzleDuel.on('connection', (ws) => {
    let activeDuelId: string | null = null;

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as {
          type?: string;
          token?: string | null;
          matchId?: string;
          score?: number;
        };
        const ident = resolveSocketIdentity(msg.token);

        if (msg.type === 'duel:join') {
          duelQueue = duelQueue.filter((q) => q.ws !== ws && q.ws.readyState === WebSocket.OPEN);
          if (duelQueue.length > 0) {
            const opp = duelQueue.shift()!;
            const matchId = `duel-${crypto.randomUUID().slice(0, 8)}`;
            const shuffled = [...CURATED_PUZZLES].sort(() => Math.random() - 0.5).slice(0, 12);
            const timer = setTimeout(() => {
              const m = duelMatches.get(matchId);
              if (!m) return;
              const finishPayload = (
                myScore: number,
                oppScore: number,
                oppName: string
              ) =>
                JSON.stringify({
                  type: 'duel:finish',
                  matchId,
                  myScore,
                  oppScore,
                  oppName,
                  outcome:
                    myScore > oppScore ? 'win' : myScore < oppScore ? 'loss' : 'draw',
                });
              if (m.p1Ws.readyState === WebSocket.OPEN) {
                m.p1Ws.send(finishPayload(m.p1Score, m.p2Score, m.p2Name));
              }
              if (m.p2Ws.readyState === WebSocket.OPEN) {
                m.p2Ws.send(finishPayload(m.p2Score, m.p1Score, m.p1Name));
              }
              duelMatches.delete(matchId);
            }, 90_000);

            const match: DuelMatch = {
              id: matchId,
              p1Ws: opp.ws,
              p2Ws: ws,
              p1Name: opp.name,
              p2Name: ident.name,
              p1Score: 0,
              p2Score: 0,
              timer,
            };
            duelMatches.set(matchId, match);
            activeDuelId = matchId;

            if (opp.ws.readyState === WebSocket.OPEN) {
              opp.ws.send(
                JSON.stringify({
                  type: 'duel:start',
                  matchId,
                  durationSec: 90,
                  puzzles: shuffled,
                  opponentName: ident.name,
                  opponentIsGuest: ident.isGuest,
                })
              );
            }
            ws.send(
              JSON.stringify({
                type: 'duel:start',
                matchId,
                durationSec: 90,
                puzzles: shuffled,
                opponentName: opp.name,
                opponentIsGuest: opp.isGuest,
              })
            );
          } else {
            duelQueue.push({ ws, name: ident.name, isGuest: ident.isGuest });
            ws.send(JSON.stringify({ type: 'duel:waiting' }));
          }
          return;
        }

        if (msg.type === 'duel:leave') {
          duelQueue = duelQueue.filter((q) => q.ws !== ws);
          return;
        }

        if (msg.type === 'duel:progress') {
          const matchId = typeof msg.matchId === 'string' ? msg.matchId : activeDuelId;
          if (!matchId) return;
          const m = duelMatches.get(matchId);
          if (!m) return;
          const score = Math.max(0, Math.min(50, Math.round(Number(msg.score) || 0)));
          if (m.p1Ws === ws) {
            m.p1Score = score;
            if (m.p2Ws.readyState === WebSocket.OPEN) {
              m.p2Ws.send(JSON.stringify({ type: 'duel:opponent_progress', score }));
            }
          } else if (m.p2Ws === ws) {
            m.p2Score = score;
            if (m.p1Ws.readyState === WebSocket.OPEN) {
              m.p1Ws.send(JSON.stringify({ type: 'duel:opponent_progress', score }));
            }
          }
        }
      } catch {
        // Ignore malformed payloads
      }
    });

    ws.on('close', () => {
      duelQueue = duelQueue.filter((q) => q.ws !== ws);
      if (activeDuelId) {
        const m = duelMatches.get(activeDuelId);
        if (m) {
          clearTimeout(m.timer);
          const other = m.p1Ws === ws ? m.p2Ws : m.p1Ws;
          const myScore = m.p1Ws === ws ? m.p2Score : m.p1Score;
          const oppScore = m.p1Ws === ws ? m.p1Score : m.p2Score;
          const oppName = m.p1Ws === ws ? m.p1Name : m.p2Name;
          if (other.readyState === WebSocket.OPEN) {
            other.send(
              JSON.stringify({
                type: 'duel:finish',
                matchId: m.id,
                myScore,
                oppScore,
                oppName,
                outcome: 'win',
                reason: 'Opponent left duel',
              })
            );
          }
          duelMatches.delete(m.id);
        }
      }
    });
  });

  // ==================== VITE DEV / PROD STATIC ====================
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (req: Request, res: Response, next: NextFunction) => {
      if (req.path.startsWith('/api/')) {
        next();
        return;
      }
      res.sendFile(path.resolve(distDir, 'index.html'));
    });
  }

  const httpServer = http.createServer(app);
  httpServer.on('upgrade', (request, socket, head) => {
    try {
      const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
      if (url.pathname === '/ws/tournaments-chat') {
        wssTournamentChat.handleUpgrade(request, socket, head, (ws) => {
          wssTournamentChat.emit('connection', ws, request);
        });
      } else if (url.pathname === '/ws/arena') {
        wssArena.handleUpgrade(request, socket, head, (ws) => {
          wssArena.emit('connection', ws, request);
        });
      } else if (url.pathname === '/ws/puzzle-duel') {
        wssPuzzleDuel.handleUpgrade(request, socket, head, (ws) => {
          wssPuzzleDuel.emit('connection', ws, request);
        });
      } else {
        socket.destroy();
      }
    } catch {
      socket.destroy();
    }
  });

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Caissa server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
