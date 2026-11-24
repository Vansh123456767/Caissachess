import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import {
  CURATED_PUZZLES,
  getPuzzleDifficulty,
  type PuzzleDifficulty,
  type PuzzleSortOrder,
} from './src/data/puzzleCatalog.ts';

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

interface StoreData {
  users: StoredUser[];
  tournaments: StoredTournament[];
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
      players: [
        { id: 'p1', name: 'GM_Aurelia', rating: 2480, score: 14, streak: 3, gamesPlayed: 5 },
        { id: 'p2', name: 'Marcus_960', rating: 1945, score: 10, streak: 2, gamesPlayed: 5 },
        { id: 'p3', name: 'Elena_Tactics', rating: 1780, score: 8, streak: 0, gamesPlayed: 4 },
        { id: 'p4', name: 'Viktor_Rapid', rating: 1620, score: 5, streak: 1, gamesPlayed: 4 },
        { id: 'p5', name: 'Aria_Club', rating: 1440, score: 3, streak: 0, gamesPlayed: 4 },
      ],
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
      createdBy: 'EightVariants',
      players: [
        { id: 'c1', name: 'DropMaster', rating: 2110, score: 12, streak: 2, gamesPlayed: 4 },
        { id: 'c2', name: 'EightVariants', rating: 1890, score: 9, streak: 1, gamesPlayed: 4 },
        { id: 'c3', name: 'PocketRook', rating: 1650, score: 4, streak: 0, gamesPlayed: 3 },
      ],
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
      players: [
        { id: 's1', name: 'IM_Soren', rating: 2350, score: 0, streak: 0, gamesPlayed: 0, buchholz: 0 },
        { id: 's2', name: 'Nadia_K', rating: 1740, score: 0, streak: 0, gamesPlayed: 0, buchholz: 0 },
        { id: 's3', name: 'Theo_Endgame', rating: 1860, score: 0, streak: 0, gamesPlayed: 0, buchholz: 0 },
        { id: 's4', name: 'ClaraV', rating: 1580, score: 0, streak: 0, gamesPlayed: 0, buchholz: 0 },
        { id: 's5', name: 'Henrik_FM', rating: 2190, score: 0, streak: 0, gamesPlayed: 0, buchholz: 0 },
      ],
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
      return {
        users: Array.isArray(parsed.users) ? parsed.users : [],
        tournaments:
          Array.isArray(parsed.tournaments) && parsed.tournaments.length > 0
            ? parsed.tournaments
            : createDefaultTournaments(),
      };
    }
  } catch {
    // Fallback to clean seeded store
  }
  const initial: StoreData = {
    users: [],
    tournaments: createDefaultTournaments(),
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

function toPublicUser(u: StoredUser) {
  return {
    id: u.id,
    username: u.username,
    rating: u.rating,
    createdAt: u.createdAt,
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
  const joined = userId ? t.players.some((p) => p.userId === userId) : false;
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
    players: t.players.map((p) => ({
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

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '100kb' }));

  // ==================== AUTHENTICATION ROUTES ====================
  app.post('/api/auth/register', (req: Request, res: Response) => {
    if (!checkAuthRateLimit(req, res)) return;
    const rawUsername = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    const rawPassword = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(rawUsername)) {
      res.status(400).json({
        error: 'Username must be 3 to 32 characters using letters, numbers, _, ., or -.',
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

    const user: StoredUser = {
      id: `usr-${crypto.randomUUID()}`,
      username: rawUsername,
      usernameLower: lower,
      passwordHash: hashPassword(rawPassword),
      rating: 1620,
      createdAt: new Date().toISOString(),
    };
    store.users.push(user);
    saveStore(store);

    const token = signToken(user);
    res.status(201).json({ token, user: toPublicUser(user) });
  });

  app.post('/api/auth/login', (req: Request, res: Response) => {
    if (!checkAuthRateLimit(req, res)) return;
    const rawUsername = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
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
      players: [
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
        { id: `b1-${Date.now()}`, name: 'Elena_Tactics', rating: 1780, score: 0, streak: 0, gamesPlayed: 0, buchholz: 0 },
        { id: `b2-${Date.now()}`, name: 'Marcus_960', rating: 1945, score: 0, streak: 0, gamesPlayed: 0, buchholz: 0 },
        { id: `b3-${Date.now()}`, name: 'Aria_Club', rating: 1440, score: 0, streak: 0, gamesPlayed: 0, buchholz: 0 },
      ],
    };

    store.tournaments.unshift(created);
    saveStore(store);
    res.status(201).json({ tournament: formatTournamentForClient(created, user.id) });
  });

  app.post('/api/tournaments/:id/join', requireAuth, (req: AuthedRequest, res: Response) => {
    const user = req.authUser!;
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
      if (!p.userId) {
        const botGain = isSwiss
          ? [0, 0.5, 1][Math.floor(Math.random() * 3)]
          : [0, 1, 2][Math.floor(Math.random() * 3)];
        return {
          ...p,
          score: p.score + botGain,
          gamesPlayed: p.gamesPlayed + 1,
          buchholz: (p.buchholz || 0) + (botGain > 0 ? 1 : 0.5),
        };
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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Caissa server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
