import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  DailyQuotaUsage,
  GameResult,
  Move,
  PlanTier,
  Puzzle,
  UserPreferences,
} from '../types/chess';
import {
  canConsumeQuota,
  getPlanLimits,
  normalizeQuotaUsage,
  PLAN_CATALOG,
} from '../data/plans';
import {
  CHESS_LESSONS,
  CURATED_PUZZLES,
  getPuzzleDifficulty,
  type PuzzleDifficulty,
  type PuzzleSortOrder,
} from '../data/puzzlesAndLessons';
import {
  DAILY_PUZZLE_DATABASE,
  DailyPuzzleEntry,
  formatLocalDateKey,
  getDailyPuzzleForDate,
} from '../data/dailyPuzzles';
import {
  ENDGAME_CATEGORIES,
  EndgameCategoryId,
  generateEndgamePosition,
} from '../data/endgameTrainer';
import {
  evaluateGameResult,
  makeMove,
  moveToUci,
  parseFen,
  positionKey,
  toFen,
  uciToMove,
} from '../engine/chessEngine';
import { findBestMove, probeTablebase } from '../engine/aiSearch';
import { ChessBoard } from './ChessBoard';
import { CoordinatesTrainer } from './CoordinatesTrainer';
import { PracticeTrainer } from './PracticeTrainer';
import {
  DailyLeaderboard,
  DailyLeaderboardEntry,
  loadLeaderboard,
  saveLeaderboard,
} from './DailyLeaderboard';
import { isBotAccount } from '../utils/botFilter';
import { soundFX } from '../utils/sound';
import {
  AlertTriangle,
  ArrowUpDown,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Crown,
  Eye,
  Flame,
  GraduationCap,
  HelpCircle,
  Layers,
  Lightbulb,
  Microscope,
  Play,
  RotateCcw,
  Shuffle,
  Timer,
  Trophy,
  Zap,
} from 'lucide-react';

interface PuzzlesViewProps {
  prefs: UserPreferences;
  userGamePuzzles: Puzzle[];
  planTier: PlanTier;
  dailyUsage: DailyQuotaUsage;
  onConsumePuzzleQuota: () => Promise<{ allowed: boolean; error?: string }>;
  onOpenPlans: () => void;
  onOpenInAnalysis?: (fen: string) => void;
}

type PuzzleSubTab =
  | 'daily'
  | 'tactics'
  | 'blitz'
  | 'streak'
  | 'storm'
  | 'racer'
  | 'practice'
  | 'endgame'
  | 'coordinates'
  | 'lessons'
  | 'dashboard';

interface PuzzleHistoryEntry {
  id: string;
  title: string;
  rating: number;
  themes: string[];
  solved: boolean;
  date: string;
}

interface BlitzPreset {
  id: string;
  label: string;
  targetCount: number;
  totalSeconds: number;
}

const BLITZ_PRESETS: BlitzPreset[] = [
  { id: 'sprint-5', label: '5 Puzzles · 60s', targetCount: 5, totalSeconds: 60 },
  { id: 'series-10', label: '10 Puzzles · 120s', targetCount: 10, totalSeconds: 120 },
  { id: 'marathon-15', label: '15 Puzzles · 180s', targetCount: 15, totalSeconds: 180 },
];

function formatDurationMs(ms: number): string {
  const safe = Math.max(0, ms);
  const totalSec = safe / 1000;
  if (totalSec < 60) {
    return `${totalSec.toFixed(1)}s`;
  }
  const mins = Math.floor(totalSec / 60);
  const rem = (totalSec % 60).toFixed(1).padStart(4, '0');
  return `${mins}:${rem}`;
}

function DifficultyBadge({ rating }: { rating: number }) {
  const tier = getPuzzleDifficulty(rating);
  const config =
    tier === 'easy'
      ? {
          label: 'Easy',
          bars: 1,
          classes:
            'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
          barActive: 'bg-emerald-600 dark:bg-emerald-400',
        }
      : tier === 'medium'
      ? {
          label: 'Medium',
          bars: 2,
          classes:
            'bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800',
          barActive: 'bg-amber-600 dark:bg-amber-400',
        }
      : {
          label: 'Hard',
          bars: 3,
          classes:
            'bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800',
          barActive: 'bg-rose-600 dark:bg-rose-400',
        };

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[11px] font-semibold whitespace-nowrap shrink-0 ${config.classes}`}
      title={`Difficulty: ${config.label} (Rating ${rating})`}
    >
      <span className="inline-flex items-end gap-0.5 h-2.5" aria-hidden="true">
        <span
          className={`w-0.5 h-1 rounded-xs ${
            config.bars >= 1 ? config.barActive : 'bg-current opacity-25'
          }`}
        />
        <span
          className={`w-0.5 h-1.5 rounded-xs ${
            config.bars >= 2 ? config.barActive : 'bg-current opacity-25'
          }`}
        />
        <span
          className={`w-0.5 h-2.5 rounded-xs ${
            config.bars >= 3 ? config.barActive : 'bg-current opacity-25'
          }`}
        />
      </span>
      <span>{config.label}</span>
    </span>
  );
}

export const PuzzlesView: React.FC<PuzzlesViewProps> = ({
  prefs,
  userGamePuzzles,
  planTier,
  dailyUsage,
  onConsumePuzzleQuota,
  onOpenPlans,
  onOpenInAnalysis,
}) => {
  const [subTab, setSubTab] = useState<PuzzleSubTab>('daily');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'user'>('all');
  const [puzzleQuotaError, setPuzzleQuotaError] = useState<string | null>(null);
  const puzzleRoundCountedRef = useRef<boolean>(false);

  const normUsage = useMemo(() => normalizeQuotaUsage(dailyUsage), [dailyUsage]);
  const planLimits = useMemo(() => getPlanLimits(planTier), [planTier]);
  const hasPuzzleQuotaRemaining = canConsumeQuota(planTier, normUsage, 'puzzle');
  const [solvedPuzzleIds, setSolvedPuzzleIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('caissa_solved_puzzle_ids_v1');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  // Daily Puzzle state
  const todayKey = useMemo(() => formatLocalDateKey(new Date()), []);
  const [selectedDailyDate, setSelectedDailyDate] = useState<string>(todayKey);
  const [solvedDailyDates, setSolvedDailyDates] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('caissa_daily_solved_dates_v1');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [dailyHintStep, setDailyHintStep] = useState<boolean>(false);

  const dailySelection = useMemo(
    () => getDailyPuzzleForDate(selectedDailyDate),
    [selectedDailyDate]
  );
  const isTodaySelected = selectedDailyDate === todayKey;
  const isSelectedDailySolved = solvedDailyDates.includes(selectedDailyDate);

  const dailyStreak = useMemo(() => {
    let count = 0;
    const cursor = new Date();
    // If today isn't solved yet, check if yesterday started an active streak
    if (!solvedDailyDates.includes(formatLocalDateKey(cursor))) {
      cursor.setDate(cursor.getDate() - 1);
    }
    while (solvedDailyDates.includes(formatLocalDateKey(cursor))) {
      count++;
      cursor.setDate(cursor.getDate() - 1);
    }
    return count;
  }, [solvedDailyDates]);

  const isUserBot = isBotAccount({ name: prefs.username, isBot: prefs.isBot });

  // Daily Leaderboard state (persisted in localStorage; bots excluded)
  const [leaderboard, setLeaderboard] = useState<DailyLeaderboardEntry[]>(() =>
    loadLeaderboard(todayKey, prefs.username, isUserBot)
  );

  useEffect(() => {
    setLeaderboard((prev) => {
      if (isUserBot) {
        return prev.filter(
          (e) => !isBotAccount(e) && e.name.toLowerCase() !== prefs.username.toLowerCase()
        );
      }
      const hasUser = prev.some(
        (e) => e.name.toLowerCase() === prefs.username.toLowerCase()
      );
      if (hasUser) return prev.filter((e) => !isBotAccount(e));
      return loadLeaderboard(todayKey, prefs.username, false);
    });
  }, [prefs.username, isUserBot, todayKey]);

  useEffect(() => {
    saveLeaderboard(leaderboard);
  }, [leaderboard]);

  const recordLeaderboardSolve = () => {
    if (isUserBot) return;
    setLeaderboard((prev) => {
      const exists = prev.some(
        (e) => e.name.toLowerCase() === prefs.username.toLowerCase()
      );
      const base = exists ? prev : loadLeaderboard(todayKey, prefs.username, false);
      return base.map((entry) => {
        if (entry.name.toLowerCase() !== prefs.username.toLowerCase()) return entry;
        const resetDay = entry.lastUpdatedDate !== todayKey;
        const nextSolvedToday = (resetDay ? 0 : entry.solvedToday) + 1;
        const nextStreak = entry.currentStreak + 1;
        return {
          ...entry,
          solvedToday: nextSolvedToday,
          totalSolved: entry.totalSolved + 1,
          currentStreak: nextStreak,
          bestStreak: Math.max(entry.bestStreak, nextStreak),
          lastUpdatedDate: todayKey,
        };
      });
    });
  };

  const recordLeaderboardMiss = () => {
    if (isUserBot) return;
    setLeaderboard((prev) =>
      prev.map((entry) =>
        entry.name.toLowerCase() === prefs.username.toLowerCase()
          ? { ...entry, currentStreak: 0, lastUpdatedDate: todayKey }
          : entry
      )
    );
  };

  const resetUserLeaderboardStats = () => {
    setLeaderboard((prev) =>
      prev.map((entry) =>
        entry.name.toLowerCase() === prefs.username.toLowerCase()
          ? {
              ...entry,
              solvedToday: 0,
              totalSolved: 0,
              currentStreak: 0,
              bestStreak: 0,
              lastUpdatedDate: todayKey,
            }
          : entry
      )
    );
  };

  // Difficulty Filter, Theme Filter & Complexity Sort state (fetches dynamically from /api/puzzles)
  const [difficultyFilter, setDifficultyFilter] = useState<PuzzleDifficulty>('all');
  const [themeFilter, setThemeFilter] = useState<string>('all');
  const [sortOrder, setSortOrder] = useState<PuzzleSortOrder>('rating-asc');
  const [puzzleAttemptHistory, setPuzzleAttemptHistory] = useState<PuzzleHistoryEntry[]>(() => {
    try {
      const raw = localStorage.getItem('caissa_puzzle_history_v1');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [fetchedCuratedPuzzles, setFetchedCuratedPuzzles] = useState<Puzzle[]>(() =>
    [...CURATED_PUZZLES].sort((a, b) => a.rating - b.rating)
  );
  const [puzzleCounts, setPuzzleCounts] = useState(() => ({
    all: CURATED_PUZZLES.length,
    easy: CURATED_PUZZLES.filter((p) => getPuzzleDifficulty(p.rating) === 'easy').length,
    medium: CURATED_PUZZLES.filter((p) => getPuzzleDifficulty(p.rating) === 'medium').length,
    hard: CURATED_PUZZLES.filter((p) => getPuzzleDifficulty(p.rating) === 'hard').length,
  }));
  const [puzzlesLoading, setPuzzlesLoading] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem('caissa_puzzle_history_v1', JSON.stringify(puzzleAttemptHistory));
    } catch {
      // ignore
    }
  }, [puzzleAttemptHistory]);

  const availableThemes = useMemo(() => {
    const set = new Set<string>();
    [...CURATED_PUZZLES, ...userGamePuzzles].forEach((p) =>
      p.themes.forEach((th) => set.add(th))
    );
    return Array.from(set).sort();
  }, [userGamePuzzles]);

  useEffect(() => {
    let cancelled = false;
    const applyLocalFallback = () => {
      let next =
        difficultyFilter === 'all'
          ? [...CURATED_PUZZLES]
          : CURATED_PUZZLES.filter((p) => getPuzzleDifficulty(p.rating) === difficultyFilter);
      if (sortOrder === 'rating-asc') next.sort((a, b) => a.rating - b.rating);
      else if (sortOrder === 'rating-desc') next.sort((a, b) => b.rating - a.rating);
      if (!cancelled) {
        setFetchedCuratedPuzzles(next);
      }
    };

    const loadFilteredPuzzles = async () => {
      setPuzzlesLoading(true);
      try {
        const params = new URLSearchParams({
          difficulty: difficultyFilter,
          sort: sortOrder,
        });
        const resp = await fetch(`/api/puzzles?${params.toString()}`);
        if (!resp.ok) {
          applyLocalFallback();
          return;
        }
        const data = await resp.json();
        if (!cancelled && Array.isArray(data?.puzzles) && data.puzzles.length > 0) {
          setFetchedCuratedPuzzles(data.puzzles);
          if (data.counts) setPuzzleCounts(data.counts);
        } else {
          applyLocalFallback();
        }
      } catch {
        applyLocalFallback();
      } finally {
        if (!cancelled) setPuzzlesLoading(false);
      }
    };

    loadFilteredPuzzles();
    return () => {
      cancelled = true;
    };
  }, [difficultyFilter, sortOrder]);

  const allPuzzles = useMemo(() => {
    const filteredUser =
      difficultyFilter === 'all'
        ? userGamePuzzles
        : userGamePuzzles.filter((p) => getPuzzleDifficulty(p.rating) === difficultyFilter);

    let base =
      sourceFilter === 'user' && filteredUser.length > 0
        ? [...filteredUser]
        : sourceFilter === 'user'
        ? [...fetchedCuratedPuzzles]
        : [...filteredUser, ...fetchedCuratedPuzzles];

    if (themeFilter !== 'all') {
      const themed = base.filter((p) => p.themes.includes(themeFilter));
      if (themed.length > 0) base = themed;
    }

    if (sortOrder === 'rating-asc') {
      return [...base].sort((a, b) => a.rating - b.rating);
    }
    if (sortOrder === 'rating-desc') {
      return [...base].sort((a, b) => b.rating - a.rating);
    }
    return base;
  }, [sourceFilter, userGamePuzzles, fetchedCuratedPuzzles, difficultyFilter, themeFilter, sortOrder]);

  // Shared Puzzle Runner State
  const [puzzleIdx, setPuzzleIdx] = useState(0);
  const [stepIdx, setStepIdx] = useState(0);
  const [boardFen, setBoardFen] = useState<string>(() => CURATED_PUZZLES[0].fen);
  const [feedback, setFeedback] = useState<'idle' | 'correct' | 'wrong' | 'solved'>('idle');
  const [puzzleRating, setPuzzleRating] = useState(1450);

  // Streak state
  const [streakCount, setStreakCount] = useState(0);
  const [bestStreak, setBestStreak] = useState<number>(() => {
    try {
      return parseInt(localStorage.getItem('caissa_best_streak') || '0', 10) || 0;
    } catch {
      return 0;
    }
  });
  const [streakEnded, setStreakEnded] = useState(false);

  // Storm state
  const [stormActive, setStormActive] = useState(false);
  const [stormTime, setStormTime] = useState(180);
  const [stormScore, setStormScore] = useState(0);
  const [stormCombo, setStormCombo] = useState(0);

  // Racer state
  const [racerActive, setRacerActive] = useState(false);
  const [racerTime, setRacerTime] = useState(90);
  const [racerScore, setRacerScore] = useState(0);
  const [botScores, setBotScores] = useState<[number, number, number]>([0, 0, 0]);

  // Optional Competitive Solve Timer (tracks how fast a user solves a puzzle)
  const [competitiveTimerEnabled, setCompetitiveTimerEnabled] = useState<boolean>(true);
  const [solveElapsedMs, setSolveElapsedMs] = useState<number>(0);
  const [lastSolveMs, setLastSolveMs] = useState<number | null>(null);
  const [solveHistoryMs, setSolveHistoryMs] = useState<number[]>([]);
  const [bestSolveMs, setBestSolveMs] = useState<number | null>(() => {
    try {
      const raw = localStorage.getItem('caissa_best_puzzle_solve_ms_v1');
      if (!raw) return null;
      const n = Number(raw);
      return Number.isFinite(n) && n > 0 ? n : null;
    } catch {
      return null;
    }
  });
  const puzzleStartAtRef = useRef<number>(Date.now());

  // Blitz Mode (solve a series of puzzles under a total time constraint)
  const [blitzPresetIdx, setBlitzPresetIdx] = useState<number>(0);
  const [blitzStatus, setBlitzStatus] = useState<'idle' | 'active' | 'cleared' | 'timeout'>('idle');
  const [blitzRemainingMs, setBlitzRemainingMs] = useState<number>(BLITZ_PRESETS[0].totalSeconds * 1000);
  const [blitzSolvedCount, setBlitzSolvedCount] = useState<number>(0);
  const [blitzWrongCount, setBlitzWrongCount] = useState<number>(0);
  const [blitzSplitsMs, setBlitzSplitsMs] = useState<number[]>([]);
  const [blitzElapsedTotalMs, setBlitzElapsedTotalMs] = useState<number>(0);
  const [blitzBestTimes, setBlitzBestTimes] = useState<Record<string, number>>(() => {
    try {
      const raw = localStorage.getItem('caissa_blitz_best_v1');
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });
  const blitzDeadlineRef = useRef<number>(0);
  const blitzStartedAtRef = useRef<number>(0);

  const currentBlitzPreset = BLITZ_PRESETS[blitzPresetIdx] || BLITZ_PRESETS[0];

  const activePuzzle: Puzzle = useMemo(() => {
    if (subTab === 'daily') {
      return dailySelection.puzzle;
    }
    const sorted =
      subTab === 'streak'
        ? [...CURATED_PUZZLES].sort((a, b) => a.rating - b.rating)
        : allPuzzles;
    return sorted[puzzleIdx % sorted.length] || CURATED_PUZZLES[0];
  }, [allPuzzles, puzzleIdx, subTab, dailySelection]);

  const [solutionVisible, setSolutionVisible] = useState(false);
  const [themesDirectoryOpen, setThemesDirectoryOpen] = useState(false);

  const themeDirectoryCounts = useMemo(() => {
    const map = new Map<string, number>();
    [...CURATED_PUZZLES, ...userGamePuzzles].forEach((p) =>
      p.themes.forEach((th) => map.set(th, (map.get(th) || 0) + 1))
    );
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [userGamePuzzles]);

  const solutionSanLine = useMemo(() => {
    const sans: string[] = [];
    try {
      let st = parseFen(activePuzzle.fen, 'standard');
      for (const uci of activePuzzle.solutionUci) {
        const mv = uciToMove(st, uci);
        if (!mv) break;
        const r = makeMove(st, mv);
        sans.push(r.san);
        st = r.next;
      }
    } catch {
      // ignore
    }
    return sans;
  }, [activePuzzle]);

  // Reset board when puzzle or tab changes
  const loadPuzzleAt = (idx: number, pool?: Puzzle[]) => {
    puzzleRoundCountedRef.current = false;
    puzzleStartAtRef.current = Date.now();
    setSolveElapsedMs(0);
    setSolutionVisible(false);

    if (subTab === 'daily') {
      setStepIdx(0);
      setBoardFen(dailySelection.puzzle.fen);
      setFeedback('idle');
      setDailyHintStep(false);
      return;
    }
    const list =
      pool ||
      (subTab === 'streak'
        ? [...CURATED_PUZZLES].sort((a, b) => a.rating - b.rating)
        : allPuzzles);
    const safeLen = list.length || 1;
    const puz = list[idx % safeLen] || CURATED_PUZZLES[0];
    setPuzzleIdx(idx % safeLen);
    setStepIdx(0);
    setBoardFen(puz.fen);
    setFeedback('idle');
  };

  useEffect(() => {
    loadPuzzleAt(0);
    setLastSolveMs(null);
    if (subTab !== 'blitz') {
      setBlitzStatus('idle');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subTab, sourceFilter, selectedDailyDate, fetchedCuratedPuzzles]);

  // Competitive Solve Stopwatch (ticks while puzzle is active and unsolved)
  useEffect(() => {
    const isPuzzleWorkspace =
      subTab === 'daily' ||
      subTab === 'tactics' ||
      subTab === 'streak' ||
      (subTab === 'blitz' && blitzStatus === 'active');
    if (!competitiveTimerEnabled || !isPuzzleWorkspace) return;
    if (feedback === 'solved' || streakEnded) return;

    const id = window.setInterval(() => {
      setSolveElapsedMs(Date.now() - puzzleStartAtRef.current);
    }, 100);
    return () => window.clearInterval(id);
  }, [competitiveTimerEnabled, subTab, blitzStatus, feedback, streakEnded]);

  // Blitz Mode Total Countdown Clock
  useEffect(() => {
    if (subTab !== 'blitz' || blitzStatus !== 'active') return;
    const id = window.setInterval(() => {
      const rem = blitzDeadlineRef.current - Date.now();
      if (rem <= 0) {
        setBlitzRemainingMs(0);
        setBlitzElapsedTotalMs(currentBlitzPreset.totalSeconds * 1000);
        setBlitzStatus('timeout');
        soundFX.defeat();
      } else {
        setBlitzRemainingMs(rem);
      }
    }, 100);
    return () => window.clearInterval(id);
  }, [subTab, blitzStatus, currentBlitzPreset.totalSeconds]);

  // Storm Timer
  useEffect(() => {
    if (subTab !== 'storm' || !stormActive) return;
    const id = window.setInterval(() => {
      setStormTime((t) => {
        if (t <= 1) {
          setStormActive(false);
          soundFX.victory();
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [subTab, stormActive]);

  // Racer Timer + Rival Progress
  useEffect(() => {
    if (subTab !== 'racer' || !racerActive) return;
    const id = window.setInterval(() => {
      setRacerTime((t) => {
        if (t <= 1) {
          setRacerActive(false);
          soundFX.victory();
          return 0;
        }
        return t - 1;
      });
      setBotScores(([b1, b2, b3]) => [
        b1 + (Math.random() < 0.24 ? 1 : 0),
        b2 + (Math.random() < 0.19 ? 1 : 0),
        b3 + (Math.random() < 0.14 ? 1 : 0),
      ]);
    }, 1000);
    return () => window.clearInterval(id);
  }, [subTab, racerActive]);

  const startBlitzSeries = (presetIndex: number = blitzPresetIdx) => {
    if (!canConsumeQuota(planTier, normUsage, 'puzzle')) {
      setPuzzleQuotaError(
        `Daily puzzle limit reached (${planLimits.puzzlesPerDay}/day on ${PLAN_CATALOG[planTier].name}). Upgrade to Pro or Max to continue.`
      );
      return;
    }
    setPuzzleQuotaError(null);
    const preset = BLITZ_PRESETS[presetIndex] || BLITZ_PRESETS[0];
    setBlitzPresetIdx(presetIndex);
    setBlitzSolvedCount(0);
    setBlitzWrongCount(0);
    setBlitzSplitsMs([]);
    setBlitzElapsedTotalMs(0);
    const now = Date.now();
    blitzStartedAtRef.current = now;
    blitzDeadlineRef.current = now + preset.totalSeconds * 1000;
    setBlitzRemainingMs(preset.totalSeconds * 1000);
    setBlitzStatus('active');
    const startIdx = Math.floor(Math.random() * (allPuzzles.length || 1));
    loadPuzzleAt(startIdx);
  };

  const puzzleState = useMemo(() => parseFen(boardFen, 'standard'), [boardFen]);

  const handlePuzzleMove = (mv: Move) => {
    if (feedback === 'solved' || streakEnded) return;
    if (subTab === 'storm' && !stormActive) return;
    if (subTab === 'racer' && !racerActive) return;
    if (subTab === 'blitz' && blitzStatus !== 'active') return;

    if (!puzzleRoundCountedRef.current) {
      if (!canConsumeQuota(planTier, normUsage, 'puzzle')) {
        setPuzzleQuotaError(
          `Daily puzzle limit reached (${planLimits.puzzlesPerDay}/day on ${PLAN_CATALOG[planTier].name}). Upgrade to Pro or Max to keep training today.`
        );
        return;
      }
      setPuzzleQuotaError(null);
      puzzleRoundCountedRef.current = true;
      void onConsumePuzzleQuota().then((res) => {
        if (!res.allowed) {
          setPuzzleQuotaError(res.error || 'Daily puzzle limit reached.');
        }
      });
    }

    const playedUci = moveToUci(mv).toLowerCase();
    const expectedUci = activePuzzle.solutionUci[stepIdx]?.toLowerCase();

    if (playedUci !== expectedUci) {
      soundFX.error();
      setFeedback('wrong');
      recordLeaderboardMiss();
      setPuzzleAttemptHistory((prev) => [
        {
          id: activePuzzle.id,
          title: activePuzzle.title,
          rating: activePuzzle.rating,
          themes: activePuzzle.themes,
          solved: false,
          date: todayKey,
        },
        ...prev.slice(0, 79),
      ]);

      if (subTab === 'streak') {
        setStreakEnded(true);
      } else if (subTab === 'blitz') {
        setBlitzWrongCount((w) => w + 1);
        blitzDeadlineRef.current = Math.max(Date.now(), blitzDeadlineRef.current - 3000);
        setBlitzRemainingMs(Math.max(0, blitzDeadlineRef.current - Date.now()));
      } else if (subTab === 'storm') {
        setStormCombo(0);
        setStormTime((t) => Math.max(0, t - 5));
        loadPuzzleAt((puzzleIdx + 1) % allPuzzles.length);
      } else if (subTab === 'racer') {
        loadPuzzleAt((puzzleIdx + 1) % allPuzzles.length);
      }
      return;
    }

    // Correct move!
    const res1 = makeMove(puzzleState, mv);
    let nextFen = toFen(res1.next);
    const nextStep = stepIdx + 1;

    if (nextStep >= activePuzzle.solutionUci.length) {
      // Puzzle completely solved!
      const solvedInMs = Math.max(100, Date.now() - puzzleStartAtRef.current);
      setSolveElapsedMs(solvedInMs);
      if (competitiveTimerEnabled) {
        setLastSolveMs(solvedInMs);
        setSolveHistoryMs((prev) => [...prev.slice(-19), solvedInMs]);
        if (bestSolveMs === null || solvedInMs < bestSolveMs) {
          setBestSolveMs(solvedInMs);
          try {
            localStorage.setItem('caissa_best_puzzle_solve_ms_v1', String(solvedInMs));
          } catch {
            // ignore
          }
        }
      }

      soundFX.victory();
      setBoardFen(nextFen);
      setStepIdx(nextStep);
      setFeedback('solved');
      recordLeaderboardSolve();
      setPuzzleAttemptHistory((prev) => [
        {
          id: activePuzzle.id,
          title: activePuzzle.title,
          rating: activePuzzle.rating,
          themes: activePuzzle.themes,
          solved: true,
          date: todayKey,
        },
        ...prev.slice(0, 79),
      ]);

      if (!solvedPuzzleIds.includes(activePuzzle.id)) {
        const nextSolvedIds = [...solvedPuzzleIds, activePuzzle.id];
        setSolvedPuzzleIds(nextSolvedIds);
        try {
          localStorage.setItem('caissa_solved_puzzle_ids_v1', JSON.stringify(nextSolvedIds));
        } catch {
          // ignore
        }
      }

      if (subTab === 'daily') {
        setDailyHintStep(false);
        setPuzzleRating((r) => r + 18);
        if (!solvedDailyDates.includes(selectedDailyDate)) {
          const nextSolved = [...solvedDailyDates, selectedDailyDate];
          setSolvedDailyDates(nextSolved);
          try {
            localStorage.setItem('caissa_daily_solved_dates_v1', JSON.stringify(nextSolved));
          } catch {
            // ignore
          }
        }
      } else if (subTab === 'tactics') {
        setPuzzleRating((r) => r + 14);
      } else if (subTab === 'blitz') {
        const nextSolvedCount = blitzSolvedCount + 1;
        setBlitzSolvedCount(nextSolvedCount);
        setBlitzSplitsMs((prev) => [...prev, solvedInMs]);
        if (nextSolvedCount >= currentBlitzPreset.targetCount) {
          const totalUsed = Date.now() - blitzStartedAtRef.current;
          setBlitzElapsedTotalMs(totalUsed);
          setBlitzStatus('cleared');
          const prevBest = blitzBestTimes[currentBlitzPreset.id];
          if (!prevBest || totalUsed < prevBest) {
            const nextBests = { ...blitzBestTimes, [currentBlitzPreset.id]: totalUsed };
            setBlitzBestTimes(nextBests);
            try {
              localStorage.setItem('caissa_blitz_best_v1', JSON.stringify(nextBests));
            } catch {
              // ignore
            }
          }
        } else {
          window.setTimeout(() => loadPuzzleAt(puzzleIdx + 1), 350);
        }
      } else if (subTab === 'streak') {
        const nextStreak = streakCount + 1;
        setStreakCount(nextStreak);
        if (nextStreak > bestStreak) {
          setBestStreak(nextStreak);
          localStorage.setItem('caissa_best_streak', String(nextStreak));
        }
        window.setTimeout(() => loadPuzzleAt(puzzleIdx + 1), 500);
      } else if (subTab === 'storm') {
        const nextCombo = stormCombo + 1;
        setStormCombo(nextCombo);
        setStormScore((s) => s + 1);
        if (nextCombo % 5 === 0) setStormTime((t) => t + 4);
        window.setTimeout(() => loadPuzzleAt(puzzleIdx + 1), 350);
      } else if (subTab === 'racer') {
        setRacerScore((s) => s + 1);
        window.setTimeout(() => loadPuzzleAt(puzzleIdx + 1), 350);
      }
      return;
    }

    // Play opponent reply automatically
    soundFX.move();
    setBoardFen(nextFen);
    setFeedback('correct');
    setDailyHintStep(false);

    window.setTimeout(() => {
      const oppUci = activePuzzle.solutionUci[nextStep];
      const stAfterUser = parseFen(nextFen, 'standard');
      const oppMove = uciToMove(stAfterUser, oppUci);
      if (oppMove) {
        const res2 = makeMove(stAfterUser, oppMove);
        setBoardFen(toFen(res2.next));
        setStepIdx(nextStep + 1);
        setFeedback('idle');
      }
    }, 320);
  };

  const shiftDailyDate = (deltaDays: number) => {
    const [y, m, d] = selectedDailyDate.split('-').map((n) => parseInt(n, 10));
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + deltaDays);
    const nextKey = formatLocalDateKey(dt);
    if (nextKey <= todayKey) {
      setSelectedDailyDate(nextKey);
    }
  };

  const dailyHintArrow = useMemo(() => {
    if (subTab !== 'daily' || !dailyHintStep || feedback === 'solved') return [];
    const uci = activePuzzle.solutionUci[stepIdx];
    if (!uci || uci.length < 4) return [];
    return [{ from: uci.slice(0, 2), to: uci.slice(2, 4), color: '#d97706' }];
  }, [subTab, dailyHintStep, feedback, activePuzzle.solutionUci, stepIdx]);

  // ==================== CHESS LESSONS STATE ====================
  const [activeLessonIdx, setActiveLessonIdx] = useState(0);
  const [activeLessonStepIdx, setActiveLessonStepIdx] = useState(0);
  const [completedLessons, setCompletedLessons] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('caissa_completed_lessons_v1');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [lessonHintVisible, setLessonHintVisible] = useState(false);
  const [lessonStatus, setLessonStatus] = useState<'idle' | 'success' | 'retry'>('idle');

  const currentModule = CHESS_LESSONS[activeLessonIdx] || CHESS_LESSONS[0];
  const currentStep = currentModule.steps[activeLessonStepIdx] || currentModule.steps[0];
  const [lessonFen, setLessonFen] = useState(currentStep.fen);

  useEffect(() => {
    setLessonFen(currentStep.fen);
    setLessonStatus('idle');
    setLessonHintVisible(false);
  }, [currentStep]);

  const lessonState = useMemo(() => parseFen(lessonFen, 'standard'), [lessonFen]);

  const handleLessonMove = (mv: Move) => {
    if (lessonStatus === 'success') return;
    const uci = moveToUci(mv).toLowerCase();
    const expected = currentStep.solutionUci[0]?.toLowerCase();
    const res = makeMove(lessonState, mv);

    if (uci === expected || currentStep.targetSquares.some((sq) => uci.includes(sq))) {
      setLessonFen(toFen(res.next));
      setLessonStatus('success');
      soundFX.victory();
      if (!completedLessons.includes(currentStep.id)) {
        const nextComp = [...completedLessons, currentStep.id];
        setCompletedLessons(nextComp);
        localStorage.setItem('caissa_completed_lessons_v1', JSON.stringify(nextComp));
      }
    } else {
      soundFX.error();
      setLessonStatus('retry');
    }
  };

  // ==================== ENDGAME TRAINER STATE ====================
  const [endgameCategory, setEndgameCategory] = useState<EndgameCategoryId>('kq_k');
  const [initialEndgame] = useState(() => generateEndgamePosition('kq_k'));
  const [endgameStartFen, setEndgameStartFen] = useState<string>(initialEndgame.fen);
  const [endgameFen, setEndgameFen] = useState<string>(initialEndgame.fen);
  const [endgameNote, setEndgameNote] = useState<string>(initialEndgame.note);
  const [endgameMovesCount, setEndgameMovesCount] = useState<number>(0);
  const [endgameLastMove, setEndgameLastMove] = useState<{
    from?: [number, number] | null;
    to: [number, number];
  } | null>(null);
  const [endgameResult, setEndgameResult] = useState<GameResult | null>(null);
  const [endgameHint, setEndgameHint] = useState<boolean>(false);
  const [endgameThinking, setEndgameThinking] = useState<boolean>(false);
  const [endgamePosKeys, setEndgamePosKeys] = useState<string[]>(() => [
    positionKey(parseFen(initialEndgame.fen, 'standard')),
  ]);
  const [completedEndgames, setCompletedEndgames] = useState<Record<string, number>>(() => {
    try {
      const raw = localStorage.getItem('caissa_endgame_drills_v1');
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });

  const endgameTimerRef = useRef<number | null>(null);
  const endgameRunIdRef = useRef<number>(0);

  const clearEndgameTimer = () => {
    if (endgameTimerRef.current !== null) {
      window.clearTimeout(endgameTimerRef.current);
      endgameTimerRef.current = null;
    }
  };

  useEffect(() => {
    return () => clearEndgameTimer();
  }, []);

  const currentEndgameMeta = useMemo(
    () => ENDGAME_CATEGORIES.find((c) => c.id === endgameCategory) || ENDGAME_CATEGORIES[0],
    [endgameCategory]
  );

  const totalEndgamesCompleted = useMemo(
    () => Object.values(completedEndgames).reduce((acc, n) => acc + n, 0),
    [completedEndgames]
  );

  const startNewEndgame = (cat: EndgameCategoryId = endgameCategory) => {
    clearEndgameTimer();
    endgameRunIdRef.current += 1;
    const generated = generateEndgamePosition(cat);
    const startSt = parseFen(generated.fen, 'standard');
    setEndgameCategory(cat);
    setEndgameStartFen(generated.fen);
    setEndgameFen(generated.fen);
    setEndgameNote(generated.note);
    setEndgameMovesCount(0);
    setEndgameLastMove(null);
    setEndgameResult(null);
    setEndgameHint(false);
    setEndgameThinking(false);
    setEndgamePosKeys([positionKey(startSt)]);
  };

  const resetCurrentEndgame = () => {
    clearEndgameTimer();
    endgameRunIdRef.current += 1;
    const startSt = parseFen(endgameStartFen, 'standard');
    setEndgameFen(endgameStartFen);
    setEndgameMovesCount(0);
    setEndgameLastMove(null);
    setEndgameResult(null);
    setEndgameHint(false);
    setEndgameThinking(false);
    setEndgamePosKeys([positionKey(startSt)]);
  };

  const endgameState = useMemo(() => parseFen(endgameFen, 'standard'), [endgameFen]);

  const endgameTablebase = useMemo(
    () => probeTablebase(endgameState),
    [endgameState]
  );

  const endgameHintArrow = useMemo(() => {
    if (subTab !== 'endgame' || !endgameHint || endgameResult || endgameThinking) return [];
    const uci = endgameTablebase.bestMoves[0]?.uci;
    if (!uci || uci.length < 4) return [];
    return [{ from: uci.slice(0, 2), to: uci.slice(2, 4), color: '#d97706' }];
  }, [subTab, endgameHint, endgameResult, endgameThinking, endgameTablebase]);

  const recordEndgameCompletion = (cat: EndgameCategoryId) => {
    setCompletedEndgames((prev) => {
      const next = { ...prev, [cat]: (prev[cat] || 0) + 1 };
      try {
        localStorage.setItem('caissa_endgame_drills_v1', JSON.stringify(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
  };

  const handleEndgameMove = (mv: Move) => {
    if (endgameResult || endgameThinking) return;
    if (endgameState.turn !== 'w') return;

    const res = makeMove(endgameState, mv);
    const nextFen = toFen(res.next);
    const nextKeys = [...endgamePosKeys, positionKey(res.next)];
    const userLast = { from: mv.from, to: mv.to };

    if (res.san.includes('+') || res.san.includes('#')) soundFX.check();
    else if (mv.captured) soundFX.capture();
    else soundFX.move();

    setEndgameFen(nextFen);
    setEndgamePosKeys(nextKeys);
    setEndgameMovesCount((c) => c + 1);
    setEndgameLastMove(userLast);
    setEndgameHint(false);

    const terminal = evaluateGameResult(res.next, nextKeys);
    if (terminal) {
      setEndgameResult(terminal);
      if (terminal.winner === 'w') {
        soundFX.victory();
        recordEndgameCompletion(endgameCategory);
      } else {
        soundFX.defeat();
      }
      return;
    }

    if (res.next.turn === 'b') {
      const runId = endgameRunIdRef.current;
      setEndgameThinking(true);
      clearEndgameTimer();
      endgameTimerRef.current = window.setTimeout(() => {
        if (endgameRunIdRef.current !== runId) return;
        const reply = findBestMove(res.next, 7);
        if (!reply.move) {
          const fallbackTerm = evaluateGameResult(res.next, nextKeys);
          setEndgameThinking(false);
          if (fallbackTerm) {
            setEndgameResult(fallbackTerm);
            if (fallbackTerm.winner === 'w') {
              soundFX.victory();
              recordEndgameCompletion(endgameCategory);
            } else {
              soundFX.defeat();
            }
          }
          return;
        }

        const res2 = makeMove(res.next, reply.move);
        const nextFen2 = toFen(res2.next);
        const nextKeys2 = [...nextKeys, positionKey(res2.next)];

        if (res2.san.includes('+') || res2.san.includes('#')) soundFX.check();
        else if (reply.move.captured) soundFX.capture();
        else soundFX.move();

        setEndgameFen(nextFen2);
        setEndgamePosKeys(nextKeys2);
        setEndgameLastMove({ from: reply.move.from, to: reply.move.to });
        setEndgameThinking(false);

        const terminalAfter = evaluateGameResult(res2.next, nextKeys2);
        if (terminalAfter) {
          setEndgameResult(terminalAfter);
          if (terminalAfter.winner === 'w') {
            soundFX.victory();
            recordEndgameCompletion(endgameCategory);
          } else {
            soundFX.defeat();
          }
        }
      }, 320);
    }
  };

  return (
    <div className="space-y-6">
      {/* Sub-navigation */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-stone-200 dark:border-zinc-800 pb-3">
        <div className="flex items-center gap-1 p-1 bg-stone-100 dark:bg-zinc-900 rounded-lg overflow-x-auto">
          {([
            ['daily', 'Daily Puzzle'],
            ['tactics', 'Tactics'],
            ['blitz', 'Puzzle Blitz'],
            ['streak', 'Puzzle Streak'],
            ['storm', 'Puzzle Storm'],
            ['racer', 'Puzzle Racer'],
            ['practice', 'Practice'],
            ['endgame', 'Endgame Trainer'],
            ['coordinates', 'Coordinates'],
            ['lessons', 'Chess Basics Lessons'],
            ['dashboard', 'Puzzle Dashboard'],
          ] as [PuzzleSubTab, string][]).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setSubTab(id)}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                subTab === id
                  ? 'bg-white dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 shadow-sm'
                  : 'text-stone-600 dark:text-zinc-400 hover:text-stone-900 dark:hover:text-zinc-100'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs">
          <button
            type="button"
            onClick={() => {
              const next = !competitiveTimerEnabled;
              setCompetitiveTimerEnabled(next);
              if (next) {
                puzzleStartAtRef.current = Date.now();
                setSolveElapsedMs(0);
              }
            }}
            className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
              competitiveTimerEnabled
                ? 'border-emerald-600/50 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                : 'border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-stone-600 dark:text-zinc-400'
            }`}
            title="Toggle optional competitive puzzle solve timer"
          >
            <Clock className="w-3.5 h-3.5" />
            <span>Timer: {competitiveTimerEnabled ? 'ON' : 'OFF'}</span>
          </button>

          <button
            type="button"
            onClick={onOpenPlans}
            className={`px-2.5 py-1.5 rounded-lg border text-xs font-mono tabular-nums flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
              hasPuzzleQuotaRemaining
                ? 'border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-stone-700 dark:text-zinc-300 hover:bg-stone-50 dark:hover:bg-zinc-800'
                : 'border-amber-400 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300'
            }`}
          >
            <Crown className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            <span>
              {PLAN_CATALOG[planTier].name}: {normUsage.puzzlesUsed}/
              {planLimits.puzzlesPerDay === null ? '∞' : planLimits.puzzlesPerDay}
            </span>
          </button>

          <span className="font-mono tabular-nums text-stone-500 dark:text-zinc-400">
            Rating: <strong className="text-stone-900 dark:text-zinc-100">{puzzleRating}</strong>
          </span>
        </div>
      </div>

      {puzzleQuotaError && (
        <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 flex flex-wrap items-center justify-between gap-3 text-xs text-amber-900 dark:text-amber-200">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <span>{puzzleQuotaError}</span>
          </div>
          <button
            type="button"
            onClick={onOpenPlans}
            className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold whitespace-nowrap shrink-0"
          >
            Choose Plan (Pro ₹100 / Max ₹1,000)
          </button>
        </div>
      )}

      {/* ==================== PRACTICE / COORDINATES / DASHBOARD ==================== */}
      {subTab === 'dashboard' ? (
        (() => {
          const totalAttempts = puzzleAttemptHistory.length;
          const totalSolved = puzzleAttemptHistory.filter((h) => h.solved).length;
          const accPct = totalAttempts > 0 ? Math.round((totalSolved / totalAttempts) * 100) : 0;
          const themeMap = new Map<string, { solved: number; total: number }>();
          for (const h of puzzleAttemptHistory) {
            for (const th of h.themes) {
              const e = themeMap.get(th) || { solved: 0, total: 0 };
              e.total += 1;
              if (h.solved) e.solved += 1;
              themeMap.set(th, e);
            }
          }
          const themeStats = Array.from(themeMap.entries()).sort((a, b) => b[1].total - a[1].total);
          return (
            <div className="space-y-6">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-4">
                  <div className="text-xs text-stone-500 dark:text-zinc-400">Puzzle Rating</div>
                  <div className="text-2xl font-mono font-bold tabular-nums text-emerald-600 dark:text-emerald-400 mt-1">
                    {puzzleRating}
                  </div>
                </div>
                <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-4">
                  <div className="text-xs text-stone-500 dark:text-zinc-400">Overall Accuracy</div>
                  <div className="text-2xl font-mono font-bold tabular-nums text-stone-900 dark:text-zinc-100 mt-1">
                    {accPct}%
                  </div>
                  <div className="text-xs text-stone-500 dark:text-zinc-400 font-mono">
                    {totalSolved}/{totalAttempts} solved
                  </div>
                </div>
                <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-4">
                  <div className="text-xs text-stone-500 dark:text-zinc-400">Best Puzzle Streak</div>
                  <div className="text-2xl font-mono font-bold tabular-nums text-stone-900 dark:text-zinc-100 mt-1">
                    {bestStreak}
                  </div>
                </div>
                <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-4">
                  <div className="text-xs text-stone-500 dark:text-zinc-400">Unique Puzzles Cleared</div>
                  <div className="text-2xl font-mono font-bold tabular-nums text-stone-900 dark:text-zinc-100 mt-1">
                    {solvedPuzzleIds.length}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-5 space-y-3">
                  <h2 className="text-base font-semibold text-stone-900 dark:text-zinc-100">
                    Accuracy by Tactical Theme
                  </h2>
                  {themeStats.length === 0 ? (
                    <p className="text-xs text-stone-500 dark:text-zinc-400 py-4">
                      Solve puzzles in Tactics, Daily, Streak, or Blitz to see your theme radar.
                    </p>
                  ) : (
                    <div className="space-y-2.5 max-h-72 overflow-y-auto thin-scroll">
                      {themeStats.map(([theme, st]) => {
                        const pct = Math.round((st.solved / st.total) * 100);
                        return (
                          <div key={theme} className="space-y-1">
                            <div className="flex justify-between text-xs">
                              <span className="font-medium text-stone-800 dark:text-zinc-200">{theme}</span>
                              <span className="font-mono tabular-nums text-stone-500 dark:text-zinc-400">
                                {pct}% ({st.solved}/{st.total})
                              </span>
                            </div>
                            <div className="h-2 rounded bg-stone-100 dark:bg-zinc-800 overflow-hidden">
                              <div className="h-full bg-emerald-600" style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-5 space-y-3">
                  <h2 className="text-base font-semibold text-stone-900 dark:text-zinc-100">
                    Recent Puzzle History
                  </h2>
                  {puzzleAttemptHistory.length === 0 ? (
                    <p className="text-xs text-stone-500 dark:text-zinc-400 py-4">
                      No attempts logged yet.
                    </p>
                  ) : (
                    <div className="divide-y divide-stone-100 dark:divide-zinc-800 max-h-72 overflow-y-auto thin-scroll">
                      {puzzleAttemptHistory.slice(0, 15).map((h, i) => (
                        <div key={`${h.id}-${i}`} className="py-2 flex items-center justify-between gap-2 text-xs">
                          <div className="min-w-0">
                            <div className="font-medium text-stone-900 dark:text-zinc-100 truncate">
                              {h.title}
                            </div>
                            <div className="text-[11px] font-mono text-stone-500 dark:text-zinc-400">
                              {h.rating} · {h.themes.slice(0, 2).join(', ')}
                            </div>
                          </div>
                          <span
                            className={`font-semibold shrink-0 ${
                              h.solved ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                            }`}
                          >
                            {h.solved ? 'Solved' : 'Missed'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })()
      ) : subTab === 'practice' ? (
        <PracticeTrainer prefs={prefs} />
      ) : subTab === 'coordinates' ? (
        <CoordinatesTrainer prefs={prefs} />
      ) : subTab === 'endgame' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-7 flex flex-col items-center gap-3">
            <div className="w-full max-w-[540px] flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 rounded-lg bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-stone-900 dark:text-zinc-100">
                    {currentEndgameMeta.name}
                  </span>
                  <span className="text-xs font-mono text-stone-500 dark:text-zinc-400">
                    {currentEndgameMeta.code}
                  </span>
                </div>
                <div className="text-[11px] text-stone-500 dark:text-zinc-400 font-mono truncate">
                  {endgameNote}
                </div>
              </div>
              <div className="text-xs font-mono text-stone-600 dark:text-zinc-300 shrink-0">
                Moves: <strong className="text-stone-900 dark:text-zinc-100">{endgameMovesCount}</strong>
              </div>
            </div>

            <ChessBoard
              state={endgameState}
              onMove={handleEndgameMove}
              flipped={false}
              allowedColor="w"
              interactive={!endgameResult && !endgameThinking && endgameState.turn === 'w'}
              lastMove={endgameLastMove}
              suggestedArrows={endgameHintArrow}
              boardTheme={prefs.boardTheme}
              pieceSet={prefs.pieceSet}
              showCoordinates={prefs.showCoordinates}
              highlightLegal={prefs.highlightLegalMoves}
            />
          </div>

          <div className="lg:col-span-5 space-y-4">
            <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Crown className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <h2 className="text-base font-semibold text-stone-900 dark:text-zinc-100">
                    Tablebase Endgame Trainer
                  </h2>
                </div>
                <span className="text-xs font-mono text-stone-500 dark:text-zinc-400">
                  {totalEndgamesCompleted} won
                </span>
              </div>

              <p className="text-xs text-stone-600 dark:text-zinc-400 leading-relaxed">
                {currentEndgameMeta.goal}
              </p>

              {/* Result / Live Status Banner */}
              {endgameResult ? (
                endgameResult.winner === 'w' ? (
                  <div className="p-3.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 space-y-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-emerald-800 dark:text-emerald-200">
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>
                        Checkmate achieved in {endgameMovesCount} move{endgameMovesCount === 1 ? '' : 's'}!
                      </span>
                    </div>
                    <p className="text-xs text-emerald-700 dark:text-emerald-300">
                      {endgameResult.reason}. Generate a new tablebase position or drill another endgame pattern.
                    </p>
                  </div>
                ) : (
                  <div className="p-3.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 space-y-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-amber-800 dark:text-amber-200">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>
                        {endgameResult.winner === 'draw' ? 'Endgame Drawn' : 'Drill Lost'} · {endgameResult.reason}
                      </span>
                    </div>
                    <p className="text-xs text-amber-700 dark:text-amber-300">
                      Reset this exact starting position to retry your technique, or generate a fresh layout.
                    </p>
                  </div>
                )
              ) : (
                <div className="p-3 rounded-lg bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-stone-700 dark:text-zinc-300">
                      {endgameTablebase.pieceCount}-Piece Tablebase Verdict
                    </span>
                    <span
                      className={`font-mono font-semibold ${
                        endgameTablebase.wdl === 'Win'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : endgameTablebase.wdl === 'Loss'
                          ? 'text-red-600 dark:text-red-400'
                          : 'text-amber-600 dark:text-amber-400'
                      }`}
                    >
                      {endgameThinking
                        ? 'Defender thinking...'
                        : `${endgameTablebase.wdl} · ${endgameTablebase.dtzText}`}
                    </span>
                  </div>
                  <p className="text-[11px] text-stone-500 dark:text-zinc-400 leading-relaxed">
                    {endgameTablebase.explanation}
                  </p>
                </div>
              )}

              {/* Hint display */}
              {endgameHint && !endgameResult && endgameTablebase.bestMoves.length > 0 && (
                <div className="p-3 rounded-lg bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 space-y-1.5">
                  <div className="text-xs font-semibold text-amber-800 dark:text-amber-200">
                    Tablebase Optimal Moves
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs font-mono">
                    {endgameTablebase.bestMoves.slice(0, 3).map((bm) => (
                      <span
                        key={bm.uci}
                        className="px-2 py-0.5 rounded bg-white dark:bg-zinc-900 border border-amber-200 dark:border-amber-800 text-stone-800 dark:text-zinc-200"
                      >
                        {bm.san} ({bm.outcome})
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Action Controls */}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setEndgameHint((h) => !h)}
                  disabled={!!endgameResult || endgameThinking}
                  className="px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 text-xs font-medium flex items-center gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-40 hover:bg-stone-50 dark:hover:bg-zinc-800"
                >
                  <Lightbulb className="w-3.5 h-3.5 text-amber-500" />
                  {endgameHint ? 'Hide Hint' : 'Tablebase Hint'}
                </button>
                <button
                  type="button"
                  onClick={resetCurrentEndgame}
                  className="px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 text-xs font-medium flex items-center gap-1.5 whitespace-nowrap shrink-0 hover:bg-stone-50 dark:hover:bg-zinc-800"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Reset
                </button>
                <button
                  type="button"
                  onClick={() => startNewEndgame(endgameCategory)}
                  className="flex-1 py-2 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0"
                >
                  <Shuffle className="w-3.5 h-3.5" />
                  New Position
                </button>
              </div>

              <div className="text-[11px] text-stone-500 dark:text-zinc-400 border-t border-stone-100 dark:border-zinc-800 pt-3">
                <strong className="text-stone-700 dark:text-zinc-300">Technique Tip:</strong>{' '}
                {currentEndgameMeta.tip}
              </div>
            </div>

            {/* Category Selector */}
            <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-500 dark:text-zinc-400">
                  Theoretical Endgames
                </h3>
                <span className="text-[11px] font-mono text-stone-400 dark:text-zinc-500">
                  7-Piece Tablebase
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-1.5">
                {ENDGAME_CATEGORIES.map((cat) => {
                  const active = cat.id === endgameCategory;
                  const wins = completedEndgames[cat.id] || 0;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => startNewEndgame(cat.id)}
                      className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors flex items-center justify-between gap-3 ${
                        active
                          ? 'border-emerald-600 bg-emerald-50/70 dark:bg-emerald-950/30'
                          : 'border-stone-200 dark:border-zinc-800 hover:bg-stone-50 dark:hover:bg-zinc-800/50'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-stone-900 dark:text-zinc-100 truncate">
                          {cat.name}
                        </div>
                        <div className="text-[11px] text-stone-500 dark:text-zinc-400 font-mono">
                          {cat.code} · {cat.difficulty}
                        </div>
                      </div>
                      <div className="text-xs font-mono text-stone-500 dark:text-zinc-400 shrink-0">
                        {wins > 0 ? (
                          <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                            {wins} won
                          </span>
                        ) : (
                          'Drill'
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ) : subTab === 'lessons' ? (
        /* ==================== LESSONS WORKSPACE ==================== */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-4 space-y-2">
            <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-stone-900 dark:text-zinc-100">
                  Chess Curriculum
                </h2>
                <span className="text-xs font-mono text-emerald-600 dark:text-emerald-400">
                  {completedLessons.length} / {CHESS_LESSONS.reduce((acc, m) => acc + m.steps.length, 0)} done
                </span>
              </div>
              <div className="space-y-1.5">
                {CHESS_LESSONS.map((mod, idx) => {
                  const modDone = mod.steps.every((s) => completedLessons.includes(s.id));
                  return (
                    <button
                      key={mod.id}
                      type="button"
                      onClick={() => {
                        setActiveLessonIdx(idx);
                        setActiveLessonStepIdx(0);
                      }}
                      className={`w-full text-left p-2.5 rounded-lg border text-xs transition-colors flex items-center justify-between ${
                        idx === activeLessonIdx
                          ? 'border-emerald-600 bg-emerald-50/70 dark:bg-emerald-950/30'
                          : 'border-stone-200 dark:border-zinc-800 hover:bg-stone-50 dark:hover:bg-zinc-800/50'
                      }`}
                    >
                      <div>
                        <div className="font-semibold text-stone-900 dark:text-zinc-100">{mod.title}</div>
                        <div className="text-[11px] text-stone-500 dark:text-zinc-400">{mod.category}</div>
                      </div>
                      {modDone && <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="lg:col-span-5 flex flex-col items-center">
            <ChessBoard
              state={lessonState}
              onMove={handleLessonMove}
              interactive={lessonStatus !== 'success'}
              targetSquares={currentStep.targetSquares}
              boardTheme={prefs.boardTheme}
              pieceSet={prefs.pieceSet}
              showCoordinates={prefs.showCoordinates}
              highlightLegal={prefs.highlightLegalMoves}
            />
          </div>

          <div className="lg:col-span-3 space-y-4">
            <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-5 space-y-4">
              <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                <GraduationCap className="w-4 h-4" />
                <span className="text-xs font-semibold">{currentModule.category}</span>
              </div>
              <div>
                <h3 className="text-base font-bold text-stone-900 dark:text-zinc-100">
                  {currentStep.title}
                </h3>
                <p className="text-xs text-stone-600 dark:text-zinc-400 mt-1 leading-relaxed">
                  {currentStep.instruction}
                </p>
              </div>

              {lessonStatus === 'success' && (
                <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-xs text-emerald-800 dark:text-emerald-200 font-medium">
                  Well done! Exercise completed.
                </div>
              )}
              {lessonStatus === 'retry' && (
                <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-xs text-amber-800 dark:text-amber-200">
                  Try another move toward the highlighted target square.
                </div>
              )}

              {lessonHintVisible && (
                <div className="p-3 rounded-lg bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 text-xs text-stone-700 dark:text-zinc-300">
                  Hint: {currentStep.hint}
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setLessonHintVisible((v) => !v)}
                  className="px-3 py-1.5 rounded-lg border border-stone-200 dark:border-zinc-700 text-xs font-medium flex items-center gap-1"
                >
                  <HelpCircle className="w-3.5 h-3.5" />
                  Hint
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setLessonFen(currentStep.fen);
                    setLessonStatus('idle');
                  }}
                  className="px-3 py-1.5 rounded-lg border border-stone-200 dark:border-zinc-700 text-xs font-medium flex items-center gap-1"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Reset
                </button>
                {lessonStatus === 'success' && (
                  <button
                    type="button"
                    onClick={() => {
                      if (activeLessonStepIdx + 1 < currentModule.steps.length) {
                        setActiveLessonStepIdx((i) => i + 1);
                      } else if (activeLessonIdx + 1 < CHESS_LESSONS.length) {
                        setActiveLessonIdx((i) => i + 1);
                        setActiveLessonStepIdx(0);
                      }
                    }}
                    className="w-full py-2 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
                  >
                    Next Exercise
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* ==================== TACTICS / STREAK / STORM / RACER ==================== */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-7 flex flex-col items-center gap-3">
            <div className="w-full max-w-[540px] flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-lg bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800">
              <div className="min-w-0 flex items-center gap-2.5 flex-wrap">
                <span className="text-sm font-semibold text-stone-900 dark:text-zinc-100 truncate">
                  {activePuzzle.title}
                </span>
                <DifficultyBadge rating={activePuzzle.rating} />
                <span className="text-xs text-stone-500 dark:text-zinc-400 font-mono tabular-nums">
                  {activePuzzle.playerColor === 'w' ? 'White to move' : 'Black to move'} · {activePuzzle.rating}
                </span>
              </div>
              <div className="flex items-center gap-2.5 shrink-0 font-mono tabular-nums text-xs">
                {competitiveTimerEnabled && (
                  <span className="text-emerald-700 dark:text-emerald-300 font-semibold flex items-center gap-1">
                    <Timer className="w-3.5 h-3.5" />
                    {formatDurationMs(solveElapsedMs)}
                  </span>
                )}
                <span className="text-stone-500 dark:text-zinc-400">
                  {subTab === 'tactics'
                    ? `${(puzzleIdx % (allPuzzles.length || 1)) + 1}/${allPuzzles.length}`
                    : subTab === 'blitz'
                    ? `${blitzSolvedCount}/${currentBlitzPreset.targetCount}`
                    : activePuzzle.source || 'Curated'}
                </span>
              </div>
            </div>

            {/* Optional Competitive Speed Telemetry Strip */}
            {competitiveTimerEnabled && (subTab === 'daily' || subTab === 'tactics' || subTab === 'streak') && (
              <div className="w-full max-w-[540px] flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 rounded-lg bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 text-[11px] font-mono tabular-nums text-stone-600 dark:text-zinc-400">
                <span>
                  Solve Clock:{' '}
                  <strong className="text-stone-900 dark:text-zinc-100">
                    {formatDurationMs(solveElapsedMs)}
                  </strong>
                </span>
                <span>
                  Last:{' '}
                  <strong className="text-stone-900 dark:text-zinc-100">
                    {lastSolveMs !== null ? formatDurationMs(lastSolveMs) : '--'}
                  </strong>
                </span>
                <span>
                  Avg:{' '}
                  <strong className="text-stone-900 dark:text-zinc-100">
                    {solveHistoryMs.length > 0
                      ? formatDurationMs(
                          solveHistoryMs.reduce((a, b) => a + b, 0) / solveHistoryMs.length
                        )
                      : '--'}
                  </strong>
                </span>
                <span>
                  Best:{' '}
                  <strong className="text-emerald-600 dark:text-emerald-400">
                    {bestSolveMs !== null ? formatDurationMs(bestSolveMs) : '--'}
                  </strong>
                </span>
              </div>
            )}

            <ChessBoard
              state={puzzleState}
              onMove={handlePuzzleMove}
              flipped={activePuzzle.playerColor === 'b'}
              allowedColor={activePuzzle.playerColor}
              interactive={
                !streakEnded &&
                feedback !== 'solved' &&
                (subTab !== 'blitz' || blitzStatus === 'active') &&
                (subTab !== 'storm' || stormActive) &&
                (subTab !== 'racer' || racerActive)
              }
              suggestedArrows={dailyHintArrow}
              boardTheme={prefs.boardTheme}
              pieceSet={prefs.pieceSet}
              showCoordinates={prefs.showCoordinates}
              highlightLegal={prefs.highlightLegalMoves}
            />
          </div>

          <div className="lg:col-span-5 space-y-4">
            {/* DAILY PUZZLE PANEL */}
            {subTab === 'daily' && (() => {
              const dailyEntry = activePuzzle as DailyPuzzleEntry;
              return (
                <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-5 space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Calendar className="w-4 h-4 text-emerald-600 shrink-0" />
                      <h2 className="text-base font-semibold text-stone-900 dark:text-zinc-100 truncate">
                        {isTodaySelected ? "Today's Daily Puzzle" : `Daily Archive · ${selectedDailyDate}`}
                      </h2>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <DifficultyBadge rating={dailyEntry.rating} />
                      <span className="text-xs font-mono tabular-nums text-stone-500 dark:text-zinc-400">
                        {dailyEntry.rating}
                      </span>
                    </div>
                  </div>

                  {/* Date navigation & Daily Streak */}
                  <div className="flex items-center justify-between p-2.5 rounded-lg bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 text-xs">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => shiftDailyDate(-1)}
                        className="p-1 rounded hover:bg-stone-200 dark:hover:bg-zinc-800 text-stone-600 dark:text-zinc-300"
                        title="Previous day"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <span className="font-mono font-medium text-stone-800 dark:text-zinc-200">
                        {selectedDailyDate}
                      </span>
                      <button
                        type="button"
                        onClick={() => shiftDailyDate(1)}
                        disabled={isTodaySelected}
                        className="p-1 rounded hover:bg-stone-200 dark:hover:bg-zinc-800 text-stone-600 dark:text-zinc-300 disabled:opacity-30"
                        title="Next day"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                      {!isTodaySelected && (
                        <button
                          type="button"
                          onClick={() => setSelectedDailyDate(todayKey)}
                          className="ml-1 text-emerald-600 dark:text-emerald-400 font-medium hover:underline"
                        >
                          Today
                        </button>
                      )}
                    </div>

                    <div className="font-mono text-stone-600 dark:text-zinc-400">
                      Daily Streak: <strong className="text-stone-900 dark:text-zinc-100">{dailyStreak}</strong>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="text-sm font-semibold text-stone-900 dark:text-zinc-100">
                      {dailyEntry.title}
                    </div>
                    <p className="text-xs text-stone-600 dark:text-zinc-400 leading-relaxed">
                      {dailyEntry.story}
                    </p>
                    <div className="text-xs text-stone-500 dark:text-zinc-400 pt-0.5">
                      {dailyEntry.themes.join(' · ')}
                    </div>
                  </div>

                  {isSelectedDailySolved && feedback !== 'solved' && (
                    <div className="p-2.5 rounded-lg bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 text-xs text-emerald-800 dark:text-emerald-200 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>Completed for {selectedDailyDate}. Feel free to replay it anytime.</span>
                    </div>
                  )}

                  {feedback === 'solved' && (
                    <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-xs font-medium text-emerald-800 dark:text-emerald-200">
                      Daily Puzzle Solved{lastSolveMs !== null ? ` in ${formatDurationMs(lastSolveMs)}` : ''}! (+18 rating · {solvedDailyDates.length}/{DAILY_PUZZLE_DATABASE.length} archive days cleared)
                    </div>
                  )}
                  {feedback === 'wrong' && (
                    <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs font-medium text-red-800 dark:text-red-200">
                      Not the strongest move. Look for forcing checks, sacrifices, or tactical deflections.
                    </div>
                  )}

                  {solutionVisible && solutionSanLine.length > 0 && (
                    <div className="p-3 rounded-lg bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 text-xs space-y-1">
                      <div className="font-semibold text-stone-700 dark:text-zinc-300">Solution Line</div>
                      <div className="font-mono text-emerald-700 dark:text-emerald-400">
                        {solutionSanLine.join(' · ')}
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setDailyHintStep((h) => !h)}
                      disabled={feedback === 'solved'}
                      className="px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 text-xs font-medium flex items-center gap-1.5 disabled:opacity-40 whitespace-nowrap shrink-0"
                    >
                      <Lightbulb className="w-3.5 h-3.5 text-amber-500" />
                      {dailyHintStep ? 'Hide Hint' : 'Hint'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setSolutionVisible((v) => !v)}
                      className="px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 text-xs font-medium flex items-center gap-1.5 whitespace-nowrap shrink-0"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      {solutionVisible ? 'Hide Solution' : 'Solution'}
                    </button>
                    <button
                      type="button"
                      onClick={() => loadPuzzleAt(0)}
                      className="px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 text-xs font-medium flex items-center gap-1.5 whitespace-nowrap shrink-0"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Reset
                    </button>
                    {onOpenInAnalysis && (
                      <button
                        type="button"
                        onClick={() => onOpenInAnalysis(boardFen)}
                        className="px-3 py-2 rounded-lg bg-stone-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0"
                      >
                        <Microscope className="w-3.5 h-3.5" />
                        Analyze
                      </button>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* TACTICS PANEL */}
            {subTab === 'tactics' && (
              <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-base font-semibold text-stone-900 dark:text-zinc-100">
                    Tactical Training
                  </h2>
                  <div className="flex gap-1 p-1 bg-stone-100 dark:bg-zinc-800 rounded-lg text-xs">
                    <button
                      type="button"
                      onClick={() => setSourceFilter('all')}
                      className={`px-2.5 py-1 rounded font-medium whitespace-nowrap shrink-0 ${
                        sourceFilter === 'all' ? 'bg-white dark:bg-zinc-900 shadow-sm' : 'text-stone-500'
                      }`}
                    >
                      All Puzzles
                    </button>
                    <button
                      type="button"
                      onClick={() => setSourceFilter('user')}
                      className={`px-2.5 py-1 rounded font-medium whitespace-nowrap shrink-0 ${
                        sourceFilter === 'user' ? 'bg-white dark:bg-zinc-900 shadow-sm' : 'text-stone-500'
                      }`}
                    >
                      From My Games ({userGamePuzzles.length})
                    </button>
                  </div>
                </div>

                {/* Difficulty Filter & Complexity Sort */}
                <div className="p-3 rounded-lg bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-stone-500 dark:text-zinc-400">
                      Difficulty Filter
                    </span>
                    <span className="text-[11px] font-mono text-stone-400 dark:text-zinc-500">
                      {puzzlesLoading ? 'Fetching...' : `${allPuzzles.length} puzzles`}
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-1">
                    {(
                      [
                        ['all', `All (${puzzleCounts.all})`],
                        ['easy', `Easy (${puzzleCounts.easy})`],
                        ['medium', `Medium (${puzzleCounts.medium})`],
                        ['hard', `Hard (${puzzleCounts.hard})`],
                      ] as [PuzzleDifficulty, string][]
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setDifficultyFilter(id)}
                        className={`py-1.5 px-2 rounded-md text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 ${
                          difficultyFilter === id
                            ? 'bg-emerald-600 text-white'
                            : 'bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 text-stone-600 dark:text-zinc-300 hover:bg-stone-100 dark:hover:bg-zinc-800'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <span className="text-xs text-stone-600 dark:text-zinc-400 flex items-center gap-1">
                      <ArrowUpDown className="w-3.5 h-3.5" />
                      Theme & Sort
                    </span>
                    <div className="flex items-center gap-1.5">
                      <select
                        value={themeFilter}
                        onChange={(e) => {
                          setThemeFilter(e.target.value);
                          setPuzzleIdx(0);
                        }}
                        className="px-2 py-1 rounded-md border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-medium text-stone-800 dark:text-zinc-200 max-w-[130px]"
                      >
                        <option value="all">All Themes</option>
                        {availableThemes.map((th) => (
                          <option key={th} value={th}>
                            {th}
                          </option>
                        ))}
                      </select>
                      <select
                        value={sortOrder}
                        onChange={(e) => setSortOrder(e.target.value as PuzzleSortOrder)}
                        className="px-2.5 py-1 rounded-md border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-medium text-stone-800 dark:text-zinc-200"
                      >
                        <option value="rating-asc">Rating: Low to High</option>
                        <option value="rating-desc">Rating: High to Low</option>
                        <option value="default">Curated Order</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <button
                      type="button"
                      onClick={() => setThemesDirectoryOpen((v) => !v)}
                      className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1"
                    >
                      <Layers className="w-3 h-3" />
                      {themesDirectoryOpen ? 'Hide Themes Directory' : 'Browse Themes Directory'}
                    </button>
                    {themeFilter !== 'all' && (
                      <button
                        type="button"
                        onClick={() => {
                          setThemeFilter('all');
                          setPuzzleIdx(0);
                        }}
                        className="text-[11px] text-stone-500 hover:underline"
                      >
                        Clear theme ({themeFilter})
                      </button>
                    )}
                  </div>

                  {themesDirectoryOpen && (
                    <div className="pt-2 border-t border-stone-200 dark:border-zinc-800 grid grid-cols-2 gap-1.5 max-h-40 overflow-y-auto thin-scroll">
                      {themeDirectoryCounts.map(([th, count]) => (
                        <button
                          key={th}
                          type="button"
                          onClick={() => {
                            setThemeFilter(th);
                            setPuzzleIdx(0);
                            setThemesDirectoryOpen(false);
                          }}
                          className={`px-2 py-1 rounded border text-left text-[11px] flex items-center justify-between ${
                            themeFilter === th
                              ? 'border-emerald-600 bg-emerald-600 text-white'
                              : 'border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-stone-700 dark:text-zinc-300 hover:bg-stone-100 dark:hover:bg-zinc-800'
                          }`}
                        >
                          <span className="truncate">{th}</span>
                          <span className="font-mono opacity-80 ml-1">{count}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {sourceFilter === 'user' && userGamePuzzles.length === 0 && (
                  <p className="text-xs text-stone-500 dark:text-zinc-400 bg-stone-50 dark:bg-zinc-950 p-3 rounded-lg">
                    Play a game and run &ldquo;Request Engine Analysis&rdquo; in the Analysis tab to automatically extract puzzles from your mistakes! Showing curated puzzles meanwhile.
                  </p>
                )}

                <div className="flex items-center justify-between gap-2 text-xs text-stone-600 dark:text-zinc-400">
                  <span className="truncate">Themes: {activePuzzle.themes.join(' · ')}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <DifficultyBadge rating={activePuzzle.rating} />
                    <span className="font-mono tabular-nums">{activePuzzle.rating}</span>
                  </div>
                </div>

                {feedback === 'solved' && (
                  <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-xs font-medium text-emerald-800 dark:text-emerald-200">
                    Puzzle Solved{lastSolveMs !== null ? ` in ${formatDurationMs(lastSolveMs)}` : ''}! (+14 rating)
                  </div>
                )}
                {feedback === 'wrong' && (
                  <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs font-medium text-red-800 dark:text-red-200">
                    Incorrect move. Keep looking for the tactical refutation!
                  </div>
                )}
                {solutionVisible && solutionSanLine.length > 0 && (
                  <div className="p-3 rounded-lg bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 text-xs space-y-1">
                    <div className="font-semibold text-stone-700 dark:text-zinc-300">Solution Line</div>
                    <div className="font-mono text-emerald-700 dark:text-emerald-400">
                      {solutionSanLine.join(' · ')}
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      loadPuzzleAt((puzzleIdx - 1 + allPuzzles.length) % (allPuzzles.length || 1))
                    }
                    className="px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 text-xs font-medium whitespace-nowrap shrink-0"
                    title="Previous puzzle"
                  >
                    Prev
                  </button>
                  <button
                    type="button"
                    onClick={() => loadPuzzleAt(puzzleIdx)}
                    className="px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 text-xs font-medium whitespace-nowrap shrink-0"
                  >
                    Retry
                  </button>
                  <button
                    type="button"
                    onClick={() => setSolutionVisible((v) => !v)}
                    className="px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 text-xs font-medium flex items-center gap-1 whitespace-nowrap shrink-0"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    {solutionVisible ? 'Hide' : 'Solution'}
                  </button>
                  {onOpenInAnalysis && (
                    <button
                      type="button"
                      onClick={() => onOpenInAnalysis(boardFen)}
                      className="px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 text-xs font-medium flex items-center gap-1 whitespace-nowrap shrink-0"
                      title="Open position in Analysis Board"
                    >
                      <Microscope className="w-3.5 h-3.5" />
                      Analyze
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => loadPuzzleAt(puzzleIdx + 1)}
                    className="flex-1 py-2 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold whitespace-nowrap shrink-0"
                  >
                    Next Puzzle
                  </button>
                </div>
              </div>
            )}

            {/* PUZZLE BLITZ PANEL */}
            {subTab === 'blitz' && (
              <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Timer className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                    <h2 className="text-base font-semibold text-stone-900 dark:text-zinc-100">
                      Puzzle Blitz Series
                    </h2>
                  </div>
                  <span
                    className={`font-mono text-lg font-bold tabular-nums ${
                      blitzRemainingMs <= 10_000 && blitzStatus === 'active'
                        ? 'text-red-600 dark:text-red-400'
                        : 'text-stone-900 dark:text-zinc-100'
                    }`}
                  >
                    {formatDurationMs(blitzRemainingMs)}
                  </span>
                </div>

                {/* Time Constraint & Target Preset Selector */}
                <div className="space-y-1.5">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-stone-500 dark:text-zinc-400">
                    Series Format & Total Clock
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {BLITZ_PRESETS.map((preset, idx) => (
                      <button
                        key={preset.id}
                        type="button"
                        disabled={blitzStatus === 'active'}
                        onClick={() => {
                          setBlitzPresetIdx(idx);
                          setBlitzRemainingMs(preset.totalSeconds * 1000);
                          setBlitzStatus('idle');
                        }}
                        className={`py-2 px-2 rounded-lg border text-[11px] font-semibold transition-colors disabled:opacity-50 ${
                          blitzPresetIdx === idx
                            ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                            : 'border-stone-200 dark:border-zinc-800 text-stone-600 dark:text-zinc-300 hover:bg-stone-50 dark:hover:bg-zinc-800'
                        }`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Progress Bar & Counters */}
                <div className="space-y-2">
                  <div className="h-2 rounded-full bg-stone-100 dark:bg-zinc-800 overflow-hidden">
                    <div
                      className={`h-full transition-all duration-100 ${
                        blitzRemainingMs <= 10_000 ? 'bg-red-500' : 'bg-emerald-600'
                      }`}
                      style={{
                        width: `${Math.min(
                          100,
                          (blitzRemainingMs / (currentBlitzPreset.totalSeconds * 1000)) * 100
                        )}%`,
                      }}
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="p-2.5 rounded-lg bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800">
                      <div className="text-[11px] text-stone-500 dark:text-zinc-400">Series</div>
                      <div className="text-base font-mono font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                        {blitzSolvedCount}/{currentBlitzPreset.targetCount}
                      </div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800">
                      <div className="text-[11px] text-stone-500 dark:text-zinc-400">Mistakes</div>
                      <div className="text-base font-mono font-bold tabular-nums text-stone-900 dark:text-zinc-100">
                        {blitzWrongCount}
                      </div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800">
                      <div className="text-[11px] text-stone-500 dark:text-zinc-400">Best Time</div>
                      <div className="text-base font-mono font-bold tabular-nums text-stone-900 dark:text-zinc-100">
                        {blitzBestTimes[currentBlitzPreset.id]
                          ? formatDurationMs(blitzBestTimes[currentBlitzPreset.id])
                          : '--'}
                      </div>
                    </div>
                  </div>
                </div>

                {blitzStatus === 'cleared' && (
                  <div className="p-3.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-xs text-emerald-800 dark:text-emerald-200 space-y-1">
                    <div className="font-semibold">
                      Blitz Series Cleared! ({currentBlitzPreset.targetCount}/{currentBlitzPreset.targetCount} solved)
                    </div>
                    <div className="font-mono tabular-nums">
                      Total Time: {formatDurationMs(blitzElapsedTotalMs)} · Avg:{' '}
                      {formatDurationMs(blitzElapsedTotalMs / currentBlitzPreset.targetCount)}/puzzle
                    </div>
                  </div>
                )}

                {blitzStatus === 'timeout' && (
                  <div className="p-3.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-xs text-amber-800 dark:text-amber-200 space-y-1">
                    <div className="font-semibold">
                      Time Expired — Solved {blitzSolvedCount} of {currentBlitzPreset.targetCount}
                    </div>
                    <div>
                      Wrong moves subtract 3 seconds from your total clock. Try another Blitz run!
                    </div>
                  </div>
                )}

                {blitzStatus === 'active' && feedback === 'wrong' && (
                  <div className="p-2.5 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300">
                    Incorrect move (-3.0s penalty). Keep solving!
                  </div>
                )}

                {blitzSplitsMs.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-[11px] font-medium text-stone-500 dark:text-zinc-400">
                      Puzzle Split Times
                    </div>
                    <div className="flex flex-wrap gap-1.5 text-[11px] font-mono tabular-nums">
                      {blitzSplitsMs.map((ms, i) => (
                        <span
                          key={i}
                          className="px-2 py-0.5 rounded bg-stone-100 dark:bg-zinc-800 text-stone-700 dark:text-zinc-300"
                        >
                          #{i + 1}: {formatDurationMs(ms)}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <p className="text-xs text-stone-600 dark:text-zinc-400">
                  Solve all {currentBlitzPreset.targetCount} puzzles before the {currentBlitzPreset.totalSeconds}s total clock runs out. Mistakes deduct 3s.
                </p>

                <button
                  type="button"
                  onClick={() => startBlitzSeries(blitzPresetIdx)}
                  className="w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Play className="w-4 h-4" />
                  {blitzStatus === 'active'
                    ? 'Restart Blitz Series'
                    : blitzStatus === 'cleared' || blitzStatus === 'timeout'
                    ? 'Play Again'
                    : 'Start Blitz Series'}
                </button>
              </div>
            )}

            {/* PUZZLE STREAK PANEL */}
            {subTab === 'streak' && (
              <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Flame className="w-5 h-5 text-amber-500" />
                    <h2 className="text-base font-semibold text-stone-900 dark:text-zinc-100">
                      Puzzle Streak
                    </h2>
                  </div>
                  <span className="text-xs font-mono text-stone-500 dark:text-zinc-400">
                    Best: {bestStreak}
                  </span>
                </div>

                <div className="p-4 rounded-lg bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 text-center">
                  <div className="text-xs text-stone-500 dark:text-zinc-400">Current Streak</div>
                  <div className="text-4xl font-mono font-bold text-stone-900 dark:text-zinc-100 mt-1">
                    {streakCount}
                  </div>
                </div>

                {streakEnded ? (
                  <div className="space-y-3">
                    <p className="text-xs text-red-600 dark:text-red-400 font-medium text-center">
                      Streak ended at {streakCount}! One mistake resets the streak.
                    </p>
                    <div className="flex gap-2">
                      {onOpenInAnalysis && (
                        <button
                          type="button"
                          onClick={() => onOpenInAnalysis(boardFen)}
                          className="px-3 py-2.5 rounded-lg border border-stone-200 dark:border-zinc-700 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0"
                        >
                          <Microscope className="w-3.5 h-3.5" />
                          Analyze
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setStreakCount(0);
                          setStreakEnded(false);
                          loadPuzzleAt(0);
                        }}
                        className="flex-1 py-2.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold"
                      >
                        Start New Streak
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-stone-600 dark:text-zinc-400">
                    Solve puzzles of increasing difficulty consecutively without a single error.
                  </p>
                )}
              </div>
            )}

            {/* PUZZLE STORM PANEL */}
            {subTab === 'storm' && (
              <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Zap className="w-5 h-5 text-emerald-600" />
                    <h2 className="text-base font-semibold text-stone-900 dark:text-zinc-100">
                      Puzzle Storm (3:00)
                    </h2>
                  </div>
                  <span className="font-mono text-lg font-bold text-stone-900 dark:text-zinc-100">
                    {Math.floor(stormTime / 60)}:{(stormTime % 60).toString().padStart(2, '0')}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-lg bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 text-center">
                    <div className="text-xs text-stone-500 dark:text-zinc-400">Solved</div>
                    <div className="text-2xl font-mono font-bold text-emerald-600">{stormScore}</div>
                  </div>
                  <div className="p-3 rounded-lg bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 text-center">
                    <div className="text-xs text-stone-500 dark:text-zinc-400">Combo</div>
                    <div className="text-2xl font-mono font-bold text-amber-500">{stormCombo}x</div>
                  </div>
                </div>

                <p className="text-xs text-stone-600 dark:text-zinc-400">
                  Every 5 consecutive solves adds +4 seconds. Wrong moves subtract 5 seconds and reset combo.
                </p>

                <button
                  type="button"
                  onClick={() => {
                    setStormScore(0);
                    setStormCombo(0);
                    setStormTime(180);
                    setStormActive(true);
                    loadPuzzleAt(Math.floor(Math.random() * CURATED_PUZZLES.length));
                  }}
                  className="w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center justify-center gap-1.5"
                >
                  <Play className="w-4 h-4" />
                  {stormActive ? 'Restart Storm' : 'Start Puzzle Storm'}
                </button>
              </div>
            )}

            {/* PUZZLE RACER PANEL */}
            {subTab === 'racer' && (
              <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Trophy className="w-5 h-5 text-amber-500" />
                    <h2 className="text-base font-semibold text-stone-900 dark:text-zinc-100">
                      Puzzle Racer (90s Sprint)
                    </h2>
                  </div>
                  <span className="font-mono text-base font-bold flex items-center gap-1">
                    <Timer className="w-4 h-4" />
                    {racerTime}s
                  </span>
                </div>

                {/* Live Race Track */}
                <div className="space-y-2.5 py-2">
                  {[
                    { name: `${prefs.username} (You)`, score: racerScore, color: 'bg-emerald-600' },
                    { name: 'Elena_Tactics', score: botScores[0], color: 'bg-sky-600' },
                    { name: 'Marcus_960', score: botScores[1], color: 'bg-amber-600' },
                    { name: 'Sora_Fast', score: botScores[2], color: 'bg-stone-500' },
                  ].map((racer) => (
                    <div key={racer.name} className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="font-medium text-stone-800 dark:text-zinc-200">{racer.name}</span>
                        <span className="font-mono font-bold">{racer.score} / 15</span>
                      </div>
                      <div className="h-2.5 rounded-full bg-stone-100 dark:bg-zinc-800 overflow-hidden">
                        <div
                          className={`h-full transition-all duration-300 ${racer.color}`}
                          style={{ width: `${Math.min(100, (racer.score / 15) * 100)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setRacerScore(0);
                    setBotScores([0, 0, 0]);
                    setRacerTime(90);
                    setRacerActive(true);
                    loadPuzzleAt(0);
                  }}
                  className="w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center justify-center gap-1.5"
                >
                  <Play className="w-4 h-4" />
                  {racerActive ? 'Restart Race' : 'Join 4-Player Puzzle Race'}
                </button>
              </div>
            )}

            <DailyLeaderboard
              entries={leaderboard}
              currentUsername={prefs.username}
              isCurrentUserBot={isUserBot}
              dateKey={todayKey}
              onResetUserStats={resetUserLeaderboardStats}
            />
          </div>
        </div>
      )}

      {/* ==================== TACTICS PUZZLE CARDS BROWSER ==================== */}
      {subTab === 'tactics' && (
        <section className="space-y-3 pt-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-stone-900 dark:text-zinc-100">
                Puzzle Library
              </h3>
              <p className="text-xs text-stone-500 dark:text-zinc-400">
                Select any puzzle card to jump directly to the position. Easy (&lt;1300) · Medium (1300–1599) · Hard (1600+)
              </p>
            </div>
            <div className="flex items-center gap-3 text-xs text-stone-500 dark:text-zinc-400 font-mono tabular-nums">
              <span>{allPuzzles.length} shown</span>
              <span aria-hidden="true">·</span>
              <span>{solvedPuzzleIds.length} solved</span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {allPuzzles.map((puz, idx) => {
              const isSelected = activePuzzle.id === puz.id;
              const isSolved = solvedPuzzleIds.includes(puz.id);
              return (
                <button
                  key={puz.id}
                  type="button"
                  onClick={() => loadPuzzleAt(idx)}
                  className={`text-left rounded-xl border p-4 transition-colors space-y-2 cursor-pointer ${
                    isSelected
                      ? 'border-emerald-600 bg-emerald-50/50 dark:bg-emerald-950/25'
                      : 'border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-stone-300 dark:hover:border-zinc-700'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex items-center gap-1.5">
                      <span className="text-xs font-mono tabular-nums text-stone-400 dark:text-zinc-500 shrink-0">
                        #{idx + 1}
                      </span>
                      <span className="text-sm font-semibold text-stone-900 dark:text-zinc-100 truncate">
                        {puz.title}
                      </span>
                      {isSolved && (
                        <CheckCircle2
                          className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0"
                          aria-label="Solved"
                        />
                      )}
                    </div>
                    <DifficultyBadge rating={puz.rating} />
                  </div>

                  <div className="flex items-center gap-2 text-xs text-stone-500 dark:text-zinc-400 font-mono tabular-nums">
                    <span>Rating {puz.rating}</span>
                    <span aria-hidden="true">·</span>
                    <span>{puz.playerColor === 'w' ? 'White' : 'Black'} to move</span>
                  </div>

                  <div className="text-xs text-stone-600 dark:text-zinc-400 truncate">
                    {puz.themes.join(' · ')}
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
};
