import React, { useEffect, useState } from 'react';
import {
  AuthUser,
  ChessVariant,
  DailyQuotaUsage,
  GameRecord,
  Move,
  PaymentMethod,
  PaymentOrderInfo,
  PaymentReceipt,
  PlanTier,
  Puzzle,
  RatingCategory,
  UserPreferences,
  UserRatings,
} from './types/chess';
import {
  canConsumeQuota,
  getPlanLimits,
  getTodayQuotaDate,
  normalizeQuotaUsage,
  PLAN_CATALOG,
} from './data/plans';
import { parseFen, parsePgn, VARIANTS } from './engine/chessEngine';
import { detectOpeningFromMoves } from './data/openings';
import { LANGUAGES, translate } from './data/i18n';
import { PlayView } from './components/PlayView';
import { AnalysisView } from './components/AnalysisView';
import { StudiesView } from './components/StudiesView';
import { PuzzlesView } from './components/PuzzlesView';
import { TournamentsView } from './components/TournamentsView';
import { CommunityView } from './components/CommunityView';
import { PreferencesModal } from './components/PreferencesModal';
import { AuthModal } from './components/AuthModal';
import { PlansModal } from './components/PlansModal';
import { soundFX } from './utils/sound';
import { Flame, Keyboard, SlidersHorizontal, User, X } from 'lucide-react';

type MainTab = 'play' | 'analysis' | 'puzzles' | 'tournaments' | 'community';

const DEFAULT_PREFS: UserPreferences = {
  theme: 'light',
  boardTheme: 'wood',
  pieceSet: 'classic',
  bgTheme: 'clean',
  language: 'en',
  soundEnabled: true,
  soundTheme: 'standard',
  voiceEnabled: false,
  showCoordinates: true,
  highlightLegalMoves: true,
  showLastMove: true,
  blindfoldPieces: false,
  pieceScale: 'normal',
  autoQueen: false,
  confirmMove: false,
  moveMethod: 'both',
  showRatings: true,
  isBot: false,
  username: 'CaissaPlayer',
};

const DEFAULT_RATINGS: UserRatings = {
  bullet: 1540,
  blitz: 1620,
  rapid: 1685,
  classical: 1710,
  chess960: 1590,
  history: [
    { date: '2026-11-01', category: 'blitz', rating: 1560 },
    { date: '2026-11-08', category: 'blitz', rating: 1585 },
    { date: '2026-11-15', category: 'blitz', rating: 1605 },
    { date: '2026-11-22', category: 'blitz', rating: 1620 },
  ],
};

const STREAK_STORAGE_KEY = 'caissa_daily_streak_v1';

interface DailyStreakRecord {
  count: number;
  lastDate: string;
}

function formatLocalCalendarDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getYesterdayCalendarDate(base = new Date()): string {
  const prev = new Date(base.getFullYear(), base.getMonth(), base.getDate() - 1);
  return formatLocalCalendarDate(prev);
}

function loadDailyStreakMap(): Record<string, DailyStreakRecord> {
  try {
    const raw = localStorage.getItem(STREAK_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, DailyStreakRecord>)
      : {};
  } catch {
    return {};
  }
}

function recordUserLoginStreak(username: string): number {
  const key = username.trim().toLowerCase() || 'player';
  const now = new Date();
  const today = formatLocalCalendarDate(now);
  const yesterday = getYesterdayCalendarDate(now);
  const map = loadDailyStreakMap();
  const existing = map[key];

  let nextCount = 1;
  if (existing && typeof existing.count === 'number' && existing.count >= 1) {
    if (existing.lastDate === today) {
      nextCount = existing.count;
    } else if (existing.lastDate === yesterday) {
      nextCount = existing.count + 1;
    }
  }

  map[key] = { count: nextCount, lastDate: today };
  try {
    localStorage.setItem(STREAK_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore storage quota errors
  }
  return nextCount;
}

function buildInitialGames(): GameRecord[] {
  const sample1 = `[Event "Rapid Club Match"]\n[White "CaissaPlayer"]\n[Black "Elena_Tactics"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 Na5 10. Bc2 c5 11. d4 Qc7 1-0`;
  const sample2 = `[Event "Blitz Training"]\n[White "Marcus_960"]\n[Black "CaissaPlayer"]\n[Result "0-1"]\n\n1. d4 Nf6 2. c4 g6 3. Nc3 Bg7 4. e4 d6 5. Nf3 O-O 6. Be2 e5 7. O-O Nc6 8. d5 Ne7 0-1`;

  const p1 = parsePgn(sample1);
  const p2 = parsePgn(sample2);
  const op1 = detectOpeningFromMoves(p1.moves.map((m) => m.san || ''));
  const op2 = detectOpeningFromMoves(p2.moves.map((m) => m.san || ''));

  return [
    {
      id: 'seed-1',
      white: 'CaissaPlayer',
      black: 'Elena_Tactics',
      whiteElo: 1620,
      blackElo: 1780,
      variant: 'standard',
      timeControl: '10+0',
      result: '1-0',
      reason: 'Checkmate',
      date: '2026-11-20',
      moves: p1.moves,
      fens: p1.fens,
      pgn: sample1,
      openingEco: op1.eco,
      openingName: op1.name,
      userColor: 'w',
    },
    {
      id: 'seed-2',
      white: 'Marcus_960',
      black: 'CaissaPlayer',
      whiteElo: 1945,
      blackElo: 1620,
      variant: 'standard',
      timeControl: '3+2',
      result: '0-1',
      reason: 'Resignation',
      date: '2026-11-22',
      moves: p2.moves,
      fens: p2.fens,
      pgn: sample2,
      openingEco: op2.eco,
      openingName: op2.name,
      userColor: 'b',
    },
  ];
}

export default function App() {
  const [prefs, setPrefs] = useState<UserPreferences>(() => {
    try {
      const raw = localStorage.getItem('caissa_prefs_v1');
      if (raw) return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
    } catch {
      // ignore
    }
    return DEFAULT_PREFS;
  });

  const [userRatings, setUserRatings] = useState<UserRatings>(() => {
    try {
      const raw = localStorage.getItem('caissa_ratings_v1');
      if (raw) return { ...DEFAULT_RATINGS, ...JSON.parse(raw) };
    } catch {
      // ignore
    }
    return DEFAULT_RATINGS;
  });

  const [activeTab, setActiveTab] = useState<MainTab>('play');
  const [analysisSection, setAnalysisSection] = useState<'tools' | 'studies'>('tools');
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  // Server-verified session held strictly in React state (never localStorage)
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [dailyStreak, setDailyStreak] = useState<number>(0);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<'login' | 'register'>('login');
  const [plansModalOpen, setPlansModalOpen] = useState(false);

  const loadGuestPlanState = (): { plan: PlanTier; usage: DailyQuotaUsage } => {
    try {
      const raw = localStorage.getItem('caissa_guest_plan_v1');
      if (raw) {
        const parsed = JSON.parse(raw) as { plan?: PlanTier; usage?: DailyQuotaUsage };
        const plan: PlanTier =
          parsed.plan === 'pro' || parsed.plan === 'max' ? parsed.plan : 'free';
        return { plan, usage: normalizeQuotaUsage(parsed.usage) };
      }
    } catch {
      // ignore
    }
    return {
      plan: 'free',
      usage: { date: getTodayQuotaDate(), analysisUsed: 0, puzzlesUsed: 0 },
    };
  };

  const loadGuestReceipts = (): PaymentReceipt[] => {
    try {
      const raw = localStorage.getItem('caissa_guest_receipts_v1');
      if (raw) {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      }
    } catch {
      // ignore
    }
    return [];
  };

  const [planTier, setPlanTier] = useState<PlanTier>(() => loadGuestPlanState().plan);
  const [dailyUsage, setDailyUsage] = useState<DailyQuotaUsage>(() => loadGuestPlanState().usage);
  const [paymentReceipts, setPaymentReceipts] = useState<PaymentReceipt[]>(() =>
    loadGuestReceipts()
  );

  useEffect(() => {
    if (!authUser) {
      try {
        localStorage.setItem(
          'caissa_guest_plan_v1',
          JSON.stringify({ plan: planTier, usage: normalizeQuotaUsage(dailyUsage) })
        );
      } catch {
        // ignore
      }
    }
  }, [planTier, dailyUsage, authUser]);

  useEffect(() => {
    if (!authUser) {
      try {
        localStorage.setItem('caissa_guest_receipts_v1', JSON.stringify(paymentReceipts));
      } catch {
        // ignore
      }
    }
  }, [paymentReceipts, authUser]);

  const openAuthModal = (mode: 'login' | 'register' = 'login') => {
    setAuthModalMode(mode);
    setAuthModalOpen(true);
  };

  const handleAuthSuccess = (token: string, user: AuthUser) => {
    setAuthToken(token);
    setAuthUser(user);
    setDailyStreak(recordUserLoginStreak(user.username));
    setPrefs((prev) => ({ ...prev, username: user.username }));
    if (user.plan) setPlanTier(user.plan);
    if (user.quota) setDailyUsage(normalizeQuotaUsage(user.quota));
    fetch('/api/payments/history', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d?.receipts)) {
          setPaymentReceipts(d.receipts);
        }
      })
      .catch(() => {
        setPaymentReceipts([]);
      });
  };

  const handleLogout = async () => {
    const token = authToken;
    setAuthToken(null);
    setAuthUser(null);
    setDailyStreak(0);
    setPrefs((prev) => ({ ...prev, username: DEFAULT_PREFS.username }));
    const guest = loadGuestPlanState();
    setPlanTier(guest.plan);
    setDailyUsage(guest.usage);
    setPaymentReceipts(loadGuestReceipts());
    if (token) {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        // Ignore network errors on logout
      }
    }
  };

  const handleDowngradeToFree = async (): Promise<{ ok: boolean; error?: string }> => {
    if (authToken) {
      try {
        const resp = await fetch('/api/account/plan', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({ plan: 'free' }),
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          return { ok: false, error: data?.error || 'Could not switch to Free plan.' };
        }
        setPlanTier('free');
        if (data.quota) setDailyUsage(normalizeQuotaUsage(data.quota));
        if (data.user) setAuthUser(data.user);
        return { ok: true };
      } catch {
        return { ok: false, error: 'Unable to reach server.' };
      }
    }
    setPlanTier('free');
    setDailyUsage((prev) => normalizeQuotaUsage(prev));
    return { ok: true };
  };

  const handleCreatePaymentOrder = async (
    plan: Exclude<PlanTier, 'free'>
  ): Promise<{ ok: boolean; order?: PaymentOrderInfo; error?: string }> => {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (authToken) {
        headers.Authorization = `Bearer ${authToken}`;
      }
      const resp = await fetch('/api/payments/create-order', {
        method: 'POST',
        headers,
        body: JSON.stringify({ plan }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data?.orderId) {
        return { ok: false, error: data?.error || 'Could not start checkout.' };
      }
      return { ok: true, order: data as PaymentOrderInfo };
    } catch {
      return { ok: false, error: 'Unable to reach payment server.' };
    }
  };

  const handleVerifyPayment = async (payload: {
    order: PaymentOrderInfo;
    method: PaymentMethod;
    upiId?: string;
    bankName?: string;
    otpCode?: string;
    razorpayOrderId?: string;
    razorpayPaymentId?: string;
    razorpaySignature?: string;
  }): Promise<{ ok: boolean; receipt?: PaymentReceipt; error?: string }> => {
    const {
      order,
      method,
      upiId,
      bankName,
      otpCode,
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
    } = payload;

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (authToken) {
        headers.Authorization = `Bearer ${authToken}`;
      }
      const resp = await fetch('/api/payments/verify', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          orderId: order.orderId,
          orderToken: order.orderToken,
          method,
          upiId,
          bankName,
          otpCode,
          razorpayOrderId,
          razorpayPaymentId,
          razorpaySignature,
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data?.receipt) {
        return { ok: false, error: data?.error || 'Payment verification failed.' };
      }
      setPlanTier(data.plan || order.plan);
      if (data.quota) setDailyUsage(normalizeQuotaUsage(data.quota));
      if (data.user) setAuthUser(data.user);
      setPaymentReceipts((prev) => [data.receipt as PaymentReceipt, ...prev]);
      return { ok: true, receipt: data.receipt as PaymentReceipt };
    } catch {
      return { ok: false, error: 'Unable to reach payment server.' };
    }
  };

  const handleConsumeQuota = async (
    kind: 'analysis' | 'puzzle'
  ): Promise<{ allowed: boolean; error?: string }> => {
    const norm = normalizeQuotaUsage(dailyUsage);
    if (!canConsumeQuota(planTier, norm, kind)) {
      const limits = getPlanLimits(planTier);
      const cap = kind === 'analysis' ? limits.analysisPerDay : limits.puzzlesPerDay;
      return {
        allowed: false,
        error: `Daily ${kind} limit reached (${cap}/day on ${PLAN_CATALOG[planTier].name}). Upgrade to Pro or Max for more.`,
      };
    }

    if (authToken) {
      try {
        const resp = await fetch('/api/account/usage', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({ kind }),
        });
        const data = await resp.json().catch(() => ({}));
        if (data?.quota) {
          setDailyUsage(normalizeQuotaUsage(data.quota));
        }
        if (!resp.ok) {
          return {
            allowed: false,
            error: data?.error || 'Daily quota exceeded.',
          };
        }
        return { allowed: true };
      } catch {
        return { allowed: false, error: 'Unable to verify quota with server.' };
      }
    }

    const updated: DailyQuotaUsage = {
      date: norm.date,
      analysisUsed: norm.analysisUsed + (kind === 'analysis' ? 1 : 0),
      puzzlesUsed: norm.puzzlesUsed + (kind === 'puzzle' ? 1 : 0),
    };
    setDailyUsage(updated);
    return { allowed: true };
  };

  const [games, setGames] = useState<GameRecord[]>(() => {
    try {
      const raw = localStorage.getItem('caissa_games_v1');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // ignore
    }
    return buildInitialGames();
  });

  const [userGamePuzzles, setUserGamePuzzles] = useState<Puzzle[]>(() => {
    try {
      const raw = localStorage.getItem('caissa_user_puzzles_v1');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  // Cross-tab payloads
  const [playPayload, setPlayPayload] = useState<{
    variant: ChessVariant;
    fen?: string | null;
    key: number;
  }>({ variant: 'standard', fen: null, key: 0 });

  const [analysisPayload, setAnalysisPayload] = useState<{
    fen?: string;
    moves?: Move[];
    fens?: string[];
    variant: ChessVariant;
  } | null>(null);

  // Deep-link URL hash parser (#play=<variant>&fen=<encoded> / #analysis=<variant>&fen=<encoded>)
  useEffect(() => {
    const applyHashRoute = () => {
      const rawHash = window.location.hash;
      if (!rawHash || rawHash.length < 2) return;
      const params = new URLSearchParams(rawHash.slice(1));
      const validIds = new Set(VARIANTS.map((v) => v.id));

      const playVar = params.get('play');
      const analysisVar = params.get('analysis');
      const rawFen = params.get('fen');

      if (playVar && validIds.has(playVar as ChessVariant)) {
        const variant = playVar as ChessVariant;
        let validatedFen: string | null = null;
        if (rawFen) {
          try {
            parseFen(rawFen, variant);
            validatedFen = rawFen;
          } catch {
            validatedFen = null;
          }
        }
        setPlayPayload({ variant, fen: validatedFen, key: Date.now() });
        setActiveTab('play');
      } else if (analysisVar && validIds.has(analysisVar as ChessVariant)) {
        const variant = analysisVar as ChessVariant;
        let validatedFen: string | undefined;
        if (rawFen) {
          try {
            parseFen(rawFen, variant);
            validatedFen = rawFen;
          } catch {
            validatedFen = undefined;
          }
        }
        setAnalysisPayload({ variant, fen: validatedFen });
        setAnalysisSection('tools');
        setActiveTab('analysis');
      }
    };

    applyHashRoute();
    window.addEventListener('hashchange', applyHashRoute);
    return () => window.removeEventListener('hashchange', applyHashRoute);
  }, []);

  // Global '?' Keyboard Shortcuts modal toggle
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) {
        return;
      }
      if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setShortcutsOpen((prev) => !prev);
      } else if (e.key === 'Escape') {
        setShortcutsOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Sync dark mode class on <html> and save preferences
  useEffect(() => {
    const root = document.documentElement;
    if (prefs.theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    const langObj = LANGUAGES.find((l) => l.code === prefs.language);
    root.dir = langObj?.dir || 'ltr';
    soundFX.enabled = prefs.soundEnabled;
    soundFX.theme = prefs.soundTheme || 'standard';

    try {
      localStorage.setItem('caissa_prefs_v1', JSON.stringify(prefs));
    } catch {
      // ignore
    }
  }, [prefs]);

  useEffect(() => {
    try {
      localStorage.setItem('caissa_ratings_v1', JSON.stringify(userRatings));
    } catch {
      // ignore
    }
  }, [userRatings]);

  useEffect(() => {
    try {
      localStorage.setItem('caissa_games_v1', JSON.stringify(games));
    } catch {
      // ignore
    }
  }, [games]);

  useEffect(() => {
    try {
      localStorage.setItem('caissa_user_puzzles_v1', JSON.stringify(userGamePuzzles));
    } catch {
      // ignore
    }
  }, [userGamePuzzles]);

  const handleApplyRatingDelta = (category: RatingCategory, delta: number) => {
    setUserRatings((prev) => {
      const nextVal = Math.max(400, prev[category] + delta);
      const today = new Date().toISOString().slice(0, 10);
      return {
        ...prev,
        [category]: nextVal,
        history: [...prev.history.slice(-29), { date: today, category, rating: nextVal }],
      };
    });
  };

  const t = (key: string) => translate(prefs.language, key);

  const bgClasses: Record<UserPreferences['bgTheme'], string> = {
    clean: 'bg-stone-50 dark:bg-zinc-950',
    'warm-linen': 'bg-[#f6f2ea] dark:bg-[#141210]',
    'obsidian-grid':
      'bg-stone-100 dark:bg-zinc-950 bg-[radial-gradient(#d6d3d1_1px,transparent_1px)] dark:bg-[radial-gradient(#27272a_1px,transparent_1px)] [background-size:20px_20px]',
    'forest-slate': 'bg-[#eef2ef] dark:bg-[#0e1512]',
  };

  const handleOpenAnalysis = (payload: {
    fen?: string;
    moves?: Move[];
    fens?: string[];
    variant: ChessVariant;
  }) => {
    setAnalysisPayload(payload);
    setAnalysisSection('tools');
    setActiveTab('analysis');
  };

  const handlePlayFromPosition = (fen: string, variant: ChessVariant) => {
    setPlayPayload({ variant, fen, key: Date.now() });
    setActiveTab('play');
  };

  const handleChallengeVariant = (variant: ChessVariant) => {
    setPlayPayload({ variant, fen: null, key: Date.now() });
    setActiveTab('play');
  };

  return (
    <div className={`min-h-screen flex flex-col transition-colors ${bgClasses[prefs.bgTheme]}`}>
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-40 border-b border-stone-200 dark:border-zinc-800 bg-white/95 dark:bg-zinc-950/95 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-8">
          {/* Zone 1: Single wordmark */}
          <button
            type="button"
            onClick={() => setActiveTab('play')}
            className="font-display text-xl font-bold tracking-tight text-stone-900 dark:text-zinc-100 whitespace-nowrap shrink-0 cursor-pointer"
          >
            Caissa
          </button>

          {/* Zone 2: 5 concise single-line nav links */}
          <nav className="flex items-center gap-5 sm:gap-7 overflow-x-auto thin-scroll">
            {([
              ['play', t('navPlay')],
              ['analysis', t('navAnalysis')],
              ['puzzles', t('navPuzzles')],
              ['tournaments', t('navTournaments')],
              ['community', t('navCommunity')],
            ] as [MainTab, string][]).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={`py-4 text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeTab === id
                    ? 'border-emerald-600 text-stone-900 dark:text-zinc-100'
                    : 'border-transparent text-stone-600 dark:text-zinc-400 hover:text-stone-900 dark:hover:text-zinc-100'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>

          {/* Zone 3: Account + Preferences */}
          <div className="shrink-0 flex items-center gap-2">
            {authUser ? (
              <>
                <button
                  type="button"
                  onClick={() => openAuthModal('login')}
                  className="px-3 py-1.5 rounded-lg border border-emerald-600/40 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer"
                >
                  <User className="w-3.5 h-3.5" />
                  <span>{authUser.username}</span>
                </button>
                <div
                  className="px-2.5 py-1.5 rounded-lg border border-amber-300/80 dark:border-amber-700/70 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 text-xs font-semibold whitespace-nowrap shrink-0 flex items-center gap-1.5 tabular-nums"
                  title={`Daily Streak: ${dailyStreak} consecutive ${dailyStreak === 1 ? 'day' : 'days'} logged in`}
                  aria-label={`Daily Streak: ${dailyStreak} days`}
                >
                  <Flame className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  <span>Daily Streak: {dailyStreak}</span>
                </div>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => openAuthModal('login')}
                  className="px-3 py-1.5 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-stone-700 dark:text-zinc-200 hover:bg-stone-100 dark:hover:bg-zinc-800 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Log In
                </button>
                <button
                  type="button"
                  onClick={() => openAuthModal('register')}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Sign Up
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => setPrefsOpen(true)}
              className="px-3 py-1.5 rounded-lg bg-stone-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-stone-800 dark:hover:bg-zinc-200 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer"
              title={t('preferences')}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span className="hidden md:inline">{t('preferences')}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Workspace */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6">
        {activeTab === 'play' && (
          <PlayView
            key={playPayload.key}
            prefs={prefs}
            games={games}
            userRatings={userRatings}
            initialVariant={playPayload.variant}
            initialFen={playPayload.fen}
            onGameCompleted={(rec) => setGames((prev) => [rec, ...prev])}
            onApplyRatingDelta={handleApplyRatingDelta}
            onSendToAnalysis={handleOpenAnalysis}
          />
        )}

        {activeTab === 'analysis' && (
          <div className="space-y-4">
            {/* Switch cleanly between Analysis Tools & Studies/Insights */}
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setAnalysisSection('tools')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                    analysisSection === 'tools'
                      ? 'border-emerald-600 bg-emerald-600 text-white'
                      : 'border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-stone-700 dark:text-zinc-300'
                  }`}
                >
                  {t('analysisBoard')} · Editor · Explorer · Tablebase
                </button>
                <button
                  type="button"
                  onClick={() => setAnalysisSection('studies')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                    analysisSection === 'studies'
                      ? 'border-emerald-600 bg-emerald-600 text-white'
                      : 'border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-stone-700 dark:text-zinc-300'
                  }`}
                >
                  {t('studies')} & {t('insights')}
                </button>
              </div>
            </div>

            {analysisSection === 'tools' ? (
              <AnalysisView
                prefs={prefs}
                games={games}
                incomingPayload={analysisPayload}
                onSaveExtractedPuzzles={(extracted) =>
                  setUserGamePuzzles((prev) => [...extracted, ...prev].slice(0, 50))
                }
                onPlayFromPosition={handlePlayFromPosition}
                onImportGameRecord={(rec) => setGames((prev) => [rec, ...prev])}
                planTier={planTier}
                dailyUsage={dailyUsage}
                onConsumeAnalysisQuota={() => handleConsumeQuota('analysis')}
                onOpenPlans={() => setPlansModalOpen(true)}
              />
            ) : (
              <StudiesView
                prefs={prefs}
                games={games}
                onOpenGameInAnalysis={(g) =>
                  handleOpenAnalysis({ moves: g.moves, fens: g.fens, variant: g.variant })
                }
              />
            )}
          </div>
        )}

        {activeTab === 'puzzles' && (
          <PuzzlesView
            prefs={prefs}
            userGamePuzzles={userGamePuzzles}
            planTier={planTier}
            dailyUsage={dailyUsage}
            onConsumePuzzleQuota={() => handleConsumeQuota('puzzle')}
            onOpenPlans={() => setPlansModalOpen(true)}
            onOpenInAnalysis={(fen) => handleOpenAnalysis({ fen, variant: 'standard' })}
          />
        )}

        {activeTab === 'tournaments' && (
          <TournamentsView
            prefs={prefs}
            authUser={authUser}
            authToken={authToken}
            onOpenAuth={openAuthModal}
          />
        )}

        {activeTab === 'community' && (
          <CommunityView
            prefs={prefs}
            games={games}
            userRatings={userRatings}
            onChallengeStart={handleChallengeVariant}
            onSendToAnalysis={(payload) => handleOpenAnalysis(payload)}
          />
        )}
      </main>

      {/* Quiet, Honest Footer */}
      <footer className="border-t border-stone-200 dark:border-zinc-800 py-4 px-4 sm:px-6 text-xs text-stone-500 dark:text-zinc-400">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <span>
            Caissa Chess · {t('zeroAds')} · Standard & 8 Variants · Local-first PGN & Studies
          </span>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setShortcutsOpen(true)}
              className="hover:text-stone-900 dark:hover:text-zinc-200 underline-offset-2 hover:underline flex items-center gap-1"
              title="Keyboard shortcuts (?)"
            >
              <Keyboard className="w-3.5 h-3.5" />
              Shortcuts (?)
            </button>
            <button
              type="button"
              onClick={() => setPlansModalOpen(true)}
              className="hover:text-stone-900 dark:hover:text-zinc-200 underline-offset-2 hover:underline"
            >
              Plan: {PLAN_CATALOG[planTier].name}
            </button>
            <button
              type="button"
              onClick={() =>
                setPrefs((p) => ({ ...p, theme: p.theme === 'light' ? 'dark' : 'light' }))
              }
              className="hover:text-stone-900 dark:hover:text-zinc-200 underline-offset-2 hover:underline"
            >
              Theme: {prefs.theme === 'light' ? 'Light' : 'Dark'}
            </button>
            <button
              type="button"
              onClick={() => setPrefsOpen(true)}
              className="hover:text-stone-900 dark:hover:text-zinc-200 underline-offset-2 hover:underline"
            >
              Language: {LANGUAGES.find((l) => l.code === prefs.language)?.nativeName || 'English'}
            </button>
          </div>
        </div>
      </footer>

      <PreferencesModal
        open={prefsOpen}
        onClose={() => setPrefsOpen(false)}
        prefs={prefs}
        onChange={setPrefs}
      />

      <AuthModal
        open={authModalOpen}
        initialMode={authModalMode}
        onClose={() => setAuthModalOpen(false)}
        authUser={authUser}
        authToken={authToken}
        onAuthSuccess={handleAuthSuccess}
        onLogout={handleLogout}
        planTier={planTier}
        onOpenPlans={() => setPlansModalOpen(true)}
      />

      <PlansModal
        open={plansModalOpen}
        onClose={() => setPlansModalOpen(false)}
        currentPlan={planTier}
        usage={dailyUsage}
        authUser={authUser}
        receipts={paymentReceipts}
        onDowngradeFree={handleDowngradeToFree}
        onCreatePaymentOrder={handleCreatePaymentOrder}
        onVerifyPayment={handleVerifyPayment}
        onOpenAuth={openAuthModal}
      />

      {/* Global '?' Keyboard Shortcuts Modal */}
      {shortcutsOpen && (
        <div
          className="fixed inset-0 z-50 bg-zinc-950/60 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setShortcutsOpen(false)}
        >
          <div
            className="w-full max-w-lg bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-6 space-y-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-stone-200 dark:border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <Keyboard className="w-4 h-4 text-emerald-600" />
                <h2 className="text-base font-bold text-stone-900 dark:text-zinc-100">
                  Keyboard & Board Shortcuts
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setShortcutsOpen(false)}
                className="p-1.5 rounded-lg hover:bg-stone-100 dark:hover:bg-zinc-800 text-stone-500"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div className="space-y-2">
                <div className="font-semibold uppercase tracking-wider text-[11px] text-stone-500 dark:text-zinc-400">
                  Move Navigation
                </div>
                <div className="space-y-1.5">
                  {[
                    ['← / →', 'Previous / Next move'],
                    ['↑ / ↓', 'Start / End of game'],
                    ['Space', 'Play top engine move (Analysis)'],
                    ['F', 'Flip board orientation'],
                    ['X', 'Toggle engine threat arrow'],
                    ['Z', 'Toggle Zen focus mode'],
                  ].map(([key, desc]) => (
                    <div key={key} className="flex items-center justify-between gap-2">
                      <span className="text-stone-700 dark:text-zinc-300">{desc}</span>
                      <kbd className="px-2 py-0.5 rounded border border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-950 font-mono text-[11px] text-stone-800 dark:text-zinc-200 shrink-0">
                        {key}
                      </kbd>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <div className="font-semibold uppercase tracking-wider text-[11px] text-stone-500 dark:text-zinc-400">
                  Board Annotations & Help
                </div>
                <div className="space-y-1.5">
                  {[
                    ['Right-Click', 'Green circle / arrow'],
                    ['Shift + Right', 'Red circle / arrow'],
                    ['Alt + Right', 'Blue circle / arrow'],
                    ['Shift+Alt+Right', 'Yellow circle / arrow'],
                    ['?', 'Toggle this shortcuts modal'],
                  ].map(([key, desc]) => (
                    <div key={key} className="flex items-center justify-between gap-2">
                      <span className="text-stone-700 dark:text-zinc-300">{desc}</span>
                      <kbd className="px-2 py-0.5 rounded border border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-950 font-mono text-[11px] text-stone-800 dark:text-zinc-200 shrink-0">
                        {key}
                      </kbd>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="text-[11px] text-stone-500 dark:text-zinc-400 border-t border-stone-100 dark:border-zinc-800 pt-3 flex items-center justify-between">
              <span>Multi-premove queue: make moves while opponent thinks; right-click clears.</span>
              <button
                type="button"
                onClick={() => setShortcutsOpen(false)}
                className="px-3 py-1 rounded-lg bg-stone-900 dark:bg-zinc-100 text-white dark:text-zinc-900 font-semibold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
