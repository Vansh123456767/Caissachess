import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AuthUser, Move, Puzzle, UserPreferences } from '../types/chess';
import { CURATED_PUZZLES } from '../data/puzzlesAndLessons';
import { VISUALIZATION_DRILLS } from '../data/wildModes';
import { makeMove, moveToUci, parseFen, sanToMove, toFen, uciToMove } from '../engine/chessEngine';
import { ChessBoard } from './ChessBoard';
import { soundFX } from '../utils/sound';
import {
  Brain,
  CheckCircle2,
  Clock,
  Flame,
  Plus,
  RotateCcw,
  Swords,
  Trophy,
  Zap,
} from 'lucide-react';

export type ExtendedTrainingMode = 'duel' | 'blunder-drill' | 'visualize' | 'scramble' | 'maker';

interface PuzzleTrainingModesProps {
  mode: ExtendedTrainingMode;
  prefs: UserPreferences;
  authUser: AuthUser | null;
  authToken?: string | null;
  userGamePuzzles: Puzzle[];
  customPuzzles: Puzzle[];
  onPuzzleSolved?: () => void;
  onCustomPuzzleCreated: (p: Puzzle) => void;
}

const BLUNDER_MASTERY_KEY = 'caissa_blunder_mastery_v1';
const SCRAMBLE_BEST_KEY = 'caissa_scramble_best_v1';

export const PuzzleTrainingModes: React.FC<PuzzleTrainingModesProps> = ({
  mode,
  prefs,
  authUser,
  authToken = null,
  userGamePuzzles,
  customPuzzles,
  onPuzzleSolved,
  onCustomPuzzleCreated,
}) => {
  // ==================== 1. LIVE 1v1 PUZZLE DUEL ====================
  const [duelStatus, setDuelStatus] = useState<'idle' | 'waiting' | 'active' | 'finished'>('idle');
  const [duelMatchId, setDuelMatchId] = useState<string | null>(null);
  const [duelPuzzles, setDuelPuzzles] = useState<Puzzle[]>([]);
  const [duelIdx, setDuelIdx] = useState(0);
  const [duelStep, setDuelStep] = useState(0);
  const [duelFen, setDuelFen] = useState(CURATED_PUZZLES[0].fen);
  const [duelScore, setDuelScore] = useState(0);
  const [duelOppScore, setDuelOppScore] = useState(0);
  const [duelOppName, setDuelOppName] = useState('Opponent');
  const [duelTimeLeft, setDuelTimeLeft] = useState(90);
  const [duelOutcome, setDuelOutcome] = useState<'win' | 'loss' | 'draw' | null>(null);
  const duelWsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    return () => {
      duelWsRef.current?.close();
      duelWsRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (duelStatus !== 'active') return;
    const id = window.setInterval(() => {
      setDuelTimeLeft((t) => Math.max(0, t - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [duelStatus]);

  const startLiveDuelSearch = () => {
    duelWsRef.current?.close();
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.host}/ws/puzzle-duel`);
    duelWsRef.current = ws;
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ type: 'duel:join', token: authToken }));
    });
    ws.addEventListener('message', (ev) => {
      try {
        const msg = JSON.parse(ev.data) as {
          type?: string;
          matchId?: string;
          durationSec?: number;
          puzzles?: Puzzle[];
          opponentName?: string;
          score?: number;
          myScore?: number;
          oppScore?: number;
          outcome?: 'win' | 'loss' | 'draw';
        };
        if (msg.type === 'duel:waiting') {
          setDuelStatus('waiting');
        } else if (msg.type === 'duel:start' && Array.isArray(msg.puzzles) && msg.puzzles.length > 0) {
          setDuelMatchId(msg.matchId || null);
          setDuelPuzzles(msg.puzzles);
          setDuelIdx(0);
          setDuelStep(0);
          setDuelFen(msg.puzzles[0].fen);
          setDuelScore(0);
          setDuelOppScore(0);
          setDuelOppName(msg.opponentName || 'Opponent');
          setDuelTimeLeft(msg.durationSec || 90);
          setDuelOutcome(null);
          setDuelStatus('active');
        } else if (msg.type === 'duel:opponent_progress' && typeof msg.score === 'number') {
          setDuelOppScore(msg.score);
        } else if (msg.type === 'duel:finish') {
          setDuelOutcome(msg.outcome || 'draw');
          if (typeof msg.oppScore === 'number') setDuelOppScore(msg.oppScore);
          setDuelStatus('finished');
          if (msg.outcome === 'win') soundFX.victory();
          else if (msg.outcome === 'loss') soundFX.defeat();
        }
      } catch {
        // ignore
      }
    });
  };

  const cancelLiveDuelSearch = () => {
    duelWsRef.current?.send(JSON.stringify({ type: 'duel:leave' }));
    duelWsRef.current?.close();
    duelWsRef.current = null;
    setDuelStatus('idle');
  };

  const duelCurrentPuzzle = duelPuzzles[duelIdx % Math.max(1, duelPuzzles.length)] || CURATED_PUZZLES[0];
  const duelBoardState = useMemo(() => parseFen(duelFen, 'standard'), [duelFen]);

  const handleDuelMove = (mv: Move) => {
    if (duelStatus !== 'active') return;
    const playedUci = moveToUci(mv).toLowerCase();
    const expectedUci = duelCurrentPuzzle.solutionUci[duelStep]?.toLowerCase();
    if (playedUci !== expectedUci) {
      soundFX.error();
      const nextIdx = (duelIdx + 1) % duelPuzzles.length;
      setDuelIdx(nextIdx);
      setDuelStep(0);
      setDuelFen(duelPuzzles[nextIdx].fen);
      return;
    }
    const res1 = makeMove(duelBoardState, mv);
    const nextStep = duelStep + 1;
    if (nextStep >= duelCurrentPuzzle.solutionUci.length) {
      soundFX.victory();
      onPuzzleSolved?.();
      const nextScore = duelScore + 1;
      setDuelScore(nextScore);
      duelWsRef.current?.send(
        JSON.stringify({ type: 'duel:progress', matchId: duelMatchId, score: nextScore })
      );
      const nextIdx = (duelIdx + 1) % duelPuzzles.length;
      setDuelIdx(nextIdx);
      setDuelStep(0);
      setDuelFen(duelPuzzles[nextIdx].fen);
    } else {
      soundFX.move();
      const nextSt = res1.next;
      const oppUci = duelCurrentPuzzle.solutionUci[nextStep];
      const oppMv = oppUci ? uciToMove(nextSt, oppUci) : null;
      if (oppMv) {
        const res2 = makeMove(nextSt, oppMv);
        setDuelFen(toFen(res2.next));
        setDuelStep(nextStep + 1);
      } else {
        setDuelFen(toFen(nextSt));
        setDuelStep(nextStep);
      }
    }
  };

  // ==================== 2. MY BLUNDER TRAINER ====================
  const [masteryMap, setMasteryMap] = useState<Record<string, number>>(() => {
    try {
      const raw = localStorage.getItem(BLUNDER_MASTERY_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });
  const blunderPool = useMemo(() => {
    const base = userGamePuzzles.length > 0 ? userGamePuzzles : CURATED_PUZZLES.slice(0, 6);
    return [...base].sort((a, b) => (masteryMap[a.id] || 0) - (masteryMap[b.id] || 0));
  }, [userGamePuzzles, masteryMap]);

  const [blunderIdx, setBlunderIdx] = useState(0);
  const [blunderStep, setBlunderStep] = useState(0);
  const [blunderFen, setBlunderFen] = useState(() => blunderPool[0]?.fen || CURATED_PUZZLES[0].fen);
  const [blunderFeedback, setBlunderFeedback] = useState<'idle' | 'wrong' | 'solved'>('idle');

  const currentBlunder = blunderPool[blunderIdx % blunderPool.length] || CURATED_PUZZLES[0];

  useEffect(() => {
    if (mode === 'blunder-drill') {
      setBlunderFen(currentBlunder.fen);
      setBlunderStep(0);
      setBlunderFeedback('idle');
    }
  }, [mode, blunderIdx, currentBlunder.fen]);

  const blunderState = useMemo(() => parseFen(blunderFen, 'standard'), [blunderFen]);

  const updateMastery = (id: string, delta: number) => {
    setMasteryMap((prev) => {
      const nextVal = Math.max(0, Math.min(3, delta === -99 ? 0 : (prev[id] || 0) + delta));
      const next = { ...prev, [id]: nextVal };
      try {
        localStorage.setItem(BLUNDER_MASTERY_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const handleBlunderMove = (mv: Move) => {
    if (blunderFeedback === 'solved') return;
    const played = moveToUci(mv).toLowerCase();
    const expected = currentBlunder.solutionUci[blunderStep]?.toLowerCase();
    if (played !== expected) {
      soundFX.error();
      setBlunderFeedback('wrong');
      updateMastery(currentBlunder.id, -99);
      return;
    }
    const res1 = makeMove(blunderState, mv);
    const nextStep = blunderStep + 1;
    if (nextStep >= currentBlunder.solutionUci.length) {
      soundFX.victory();
      onPuzzleSolved?.();
      updateMastery(currentBlunder.id, 1);
      setBlunderFen(toFen(res1.next));
      setBlunderFeedback('solved');
    } else {
      soundFX.move();
      const oppUci = currentBlunder.solutionUci[nextStep];
      const oppMv = oppUci ? uciToMove(res1.next, oppUci) : null;
      if (oppMv) {
        const res2 = makeMove(res1.next, oppMv);
        setBlunderFen(toFen(res2.next));
        setBlunderStep(nextStep + 1);
      } else {
        setBlunderFen(toFen(res1.next));
        setBlunderStep(nextStep);
      }
      setBlunderFeedback('idle');
    }
  };

  // ==================== 3. VISUALIZATION DRILL ====================
  const [visIdx, setVisIdx] = useState(0);
  const [visPicked, setVisPicked] = useState<string | null>(null);
  const currentVis = VISUALIZATION_DRILLS[visIdx % VISUALIZATION_DRILLS.length];
  const visState = useMemo(() => parseFen(currentVis.fen, 'standard'), [currentVis.fen]);

  // ==================== 4. TIME-SCRAMBLE ENDURANCE ====================
  const scramblePool = useMemo(
    () => [...CURATED_PUZZLES, ...customPuzzles].sort((a, b) => a.rating - b.rating),
    [customPuzzles]
  );
  const [scrambleActive, setScrambleActive] = useState(false);
  const [scrambleTimeTenths, setScrambleTimeTenths] = useState(150); // 15.0s
  const [scrambleScore, setScrambleScore] = useState(0);
  const [scrambleIdx, setScrambleIdx] = useState(0);
  const [scrambleStep, setScrambleStep] = useState(0);
  const [scrambleFen, setScrambleFen] = useState(scramblePool[0]?.fen || CURATED_PUZZLES[0].fen);
  const [scrambleBest, setScrambleBest] = useState<number>(() => {
    try {
      return parseInt(localStorage.getItem(SCRAMBLE_BEST_KEY) || '0', 10) || 0;
    } catch {
      return 0;
    }
  });

  useEffect(() => {
    if (mode !== 'scramble' || !scrambleActive) return;
    const id = window.setInterval(() => {
      setScrambleTimeTenths((t) => {
        if (t <= 1) {
          setScrambleActive(false);
          soundFX.defeat();
          return 0;
        }
        return t - 1;
      });
    }, 100);
    return () => window.clearInterval(id);
  }, [mode, scrambleActive]);

  const currentScramble = scramblePool[scrambleIdx % scramblePool.length] || CURATED_PUZZLES[0];
  const scrambleState = useMemo(() => parseFen(scrambleFen, 'standard'), [scrambleFen]);

  const startScramble = () => {
    setScrambleScore(0);
    setScrambleIdx(0);
    setScrambleStep(0);
    setScrambleFen(scramblePool[0].fen);
    setScrambleTimeTenths(150);
    setScrambleActive(true);
  };

  const handleScrambleMove = (mv: Move) => {
    if (!scrambleActive) return;
    const played = moveToUci(mv).toLowerCase();
    const expected = currentScramble.solutionUci[scrambleStep]?.toLowerCase();
    if (played !== expected) {
      soundFX.error();
      setScrambleTimeTenths((t) => Math.max(0, t - 30)); // -3s penalty on mistake
      return;
    }
    const res1 = makeMove(scrambleState, mv);
    const nextStep = scrambleStep + 1;
    if (nextStep >= currentScramble.solutionUci.length) {
      soundFX.victory();
      onPuzzleSolved?.();
      const nextScore = scrambleScore + 1;
      setScrambleScore(nextScore);
      if (nextScore > scrambleBest) {
        setScrambleBest(nextScore);
        try {
          localStorage.setItem(SCRAMBLE_BEST_KEY, String(nextScore));
        } catch {
          // ignore
        }
      }
      setScrambleTimeTenths((t) => Math.min(450, t + 30)); // +3.0s reward!
      const nextIdx = (scrambleIdx + 1) % scramblePool.length;
      setScrambleIdx(nextIdx);
      setScrambleStep(0);
      setScrambleFen(scramblePool[nextIdx].fen);
    } else {
      soundFX.move();
      const oppUci = currentScramble.solutionUci[nextStep];
      const oppMv = oppUci ? uciToMove(res1.next, oppUci) : null;
      if (oppMv) {
        const res2 = makeMove(res1.next, oppMv);
        setScrambleFen(toFen(res2.next));
        setScrambleStep(nextStep + 1);
      } else {
        setScrambleFen(toFen(res1.next));
        setScrambleStep(nextStep);
      }
    }
  };

  // ==================== 5. CUSTOM PUZZLE MAKER ====================
  const [makerTitle, setMakerTitle] = useState('Smothered Knight Trap');
  const [makerFen, setMakerFen] = useState('6k1/5ppp/8/8/8/5N2/5PPP/4R1K1 w - - 0 1');
  const [makerMoves, setMakerMoves] = useState('Re8#');
  const [makerRating, setMakerRating] = useState(1450);
  const [makerTheme, setMakerTheme] = useState('Back Rank');
  const [makerStatus, setMakerStatus] = useState<string | null>(null);
  const [makerError, setMakerError] = useState<string | null>(null);

  const makerPreviewState = useMemo(() => {
    try {
      return parseFen(makerFen, 'standard');
    } catch {
      return null;
    }
  }, [makerFen]);

  const handlePublishCustomPuzzle = async (e: React.FormEvent) => {
    e.preventDefault();
    setMakerStatus(null);
    setMakerError(null);
    if (!makerPreviewState) {
      setMakerError('Invalid FEN string.');
      return;
    }
    const tokens = makerMoves
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (tokens.length === 0) {
      setMakerError('Enter at least 1 winning move (SAN like "Re8#" or UCI like "e1e8").');
      return;
    }

    const uciLine: string[] = [];
    let sim = makerPreviewState;
    for (const tok of tokens) {
      const mv = sanToMove(sim, tok) || uciToMove(sim, tok);
      if (!mv) {
        setMakerError(`Illegal move "${tok}" from current sequence.`);
        return;
      }
      const res = makeMove(sim, mv);
      uciLine.push(res.uci);
      sim = res.next;
    }

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authToken) headers.Authorization = `Bearer ${authToken}`;
      const resp = await fetch('/api/puzzles/custom', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          title: makerTitle,
          fen: makerFen,
          solutionUci: uciLine,
          rating: makerRating,
          themes: [makerTheme || 'Custom', 'Community'],
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data?.puzzle) {
        setMakerError(data?.error || 'Could not publish puzzle.');
        return;
      }
      onCustomPuzzleCreated(data.puzzle as Puzzle);
      setMakerStatus(`Published "${data.puzzle.title}" to community tactics!`);
    } catch {
      setMakerError('Unable to reach server to publish custom puzzle.');
    }
  };

  // ==================== RENDER PER MODE ====================
  if (mode === 'duel') {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <div className="lg:col-span-7 flex flex-col items-center gap-3">
          <div className="w-full max-w-[540px] flex items-center justify-between px-3 py-2 rounded-lg bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 text-xs">
            <span className="font-semibold text-stone-900 dark:text-zinc-100">
              {authUser ? authUser.username : 'Anonymous'} ({duelScore}) vs {duelOppName} ({duelOppScore})
            </span>
            <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
              {duelTimeLeft}s
            </span>
          </div>
          <ChessBoard
            state={duelBoardState}
            onMove={handleDuelMove}
            flipped={duelCurrentPuzzle.playerColor === 'b'}
            allowedColor={duelCurrentPuzzle.playerColor}
            interactive={duelStatus === 'active'}
            boardTheme={prefs.boardTheme}
            pieceSet={prefs.pieceSet}
            showCoordinates={prefs.showCoordinates}
            highlightLegal={prefs.highlightLegalMoves}
          />
        </div>
        <div className="lg:col-span-5 bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-stone-900 dark:text-zinc-100 flex items-center gap-2">
              <Swords className="w-4 h-4 text-emerald-600" />
              Live 1v1 Human Puzzle Duel
            </h2>
            <span className="text-xs font-mono text-stone-500">90s Sprint</span>
          </div>
          <p className="text-xs text-stone-600 dark:text-zinc-400">
            Match against another real online player solving the exact same puzzle stream over WebSocket.
          </p>
          {duelStatus === 'idle' && (
            <button
              type="button"
              onClick={startLiveDuelSearch}
              className="w-full py-2.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
            >
              Find Live Duel Opponent
            </button>
          )}
          {duelStatus === 'waiting' && (
            <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 flex items-center justify-between text-xs">
              <span>Searching for another live challenger...</span>
              <button
                type="button"
                onClick={cancelLiveDuelSearch}
                className="px-2.5 py-1 rounded border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 font-semibold"
              >
                Cancel
              </button>
            </div>
          )}
          {duelStatus === 'finished' && (
            <div className="p-4 rounded-lg bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 space-y-2 text-xs">
              <div className="font-bold text-sm flex items-center gap-1.5">
                <Trophy className="w-4 h-4 text-amber-500" />
                {duelOutcome === 'win'
                  ? 'You Won the Puzzle Duel!'
                  : duelOutcome === 'loss'
                  ? `${duelOppName} Won`
                  : 'Duel Drawn!'}
              </div>
              <div className="font-mono">
                Final Score: You {duelScore} — {duelOppScore} {duelOppName}
              </div>
              <button
                type="button"
                onClick={startLiveDuelSearch}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-semibold"
              >
                Rematch Queue
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (mode === 'blunder-drill') {
    const mastery = masteryMap[currentBlunder.id] || 0;
    return (
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <div className="lg:col-span-7 flex flex-col items-center gap-3">
          <ChessBoard
            state={blunderState}
            onMove={handleBlunderMove}
            flipped={currentBlunder.playerColor === 'b'}
            allowedColor={currentBlunder.playerColor}
            interactive={blunderFeedback !== 'solved'}
            boardTheme={prefs.boardTheme}
            pieceSet={prefs.pieceSet}
            showCoordinates={prefs.showCoordinates}
            highlightLegal={prefs.highlightLegalMoves}
          />
        </div>
        <div className="lg:col-span-5 bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-stone-900 dark:text-zinc-100 flex items-center gap-2">
              <Flame className="w-4 h-4 text-amber-500" />
              My Blunder Trainer (Spaced Repetition)
            </h2>
            <span className="font-mono text-xs font-semibold text-emerald-600">
              Mastery {mastery}/3
            </span>
          </div>
          <p className="text-xs text-stone-600 dark:text-zinc-400">
            {userGamePuzzles.length > 0
              ? `Training ${userGamePuzzles.length} tactical mistakes extracted from your own games.`
              : 'Analyze a game in Analysis Studio to extract your personal blunders, or drill curated weaknesses below.'}
          </p>
          <div className="p-3 rounded-lg bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 text-xs space-y-1">
            <div className="font-semibold text-stone-900 dark:text-zinc-100">
              {currentBlunder.title} ({currentBlunder.rating})
            </div>
            <div className="text-stone-500">
              Side to move: {currentBlunder.playerColor === 'w' ? 'White' : 'Black'}
            </div>
          </div>
          {blunderFeedback === 'wrong' && (
            <div className="text-xs text-red-600 dark:text-red-400 font-medium">
              Not quite — mastery reset to 0/3. Try finding the best tactical punishment!
            </div>
          )}
          {blunderFeedback === 'solved' && (
            <div className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4" />
              Clean solve! Mastery increased to {mastery}/3.
            </div>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setBlunderFen(currentBlunder.fen);
                setBlunderStep(0);
                setBlunderFeedback('idle');
              }}
              className="flex-1 py-2 px-3 rounded-lg border border-stone-200 dark:border-zinc-700 text-xs font-semibold flex items-center justify-center gap-1"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Retry
            </button>
            <button
              type="button"
              onClick={() => setBlunderIdx((i) => i + 1)}
              className="flex-1 py-2 px-3 rounded-lg bg-emerald-600 text-white text-xs font-semibold"
            >
              Next Weak Position
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (mode === 'visualize') {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <div className="lg:col-span-7 flex flex-col items-center gap-3">
          <ChessBoard
            state={visState}
            interactive={false}
            boardTheme={prefs.boardTheme}
            pieceSet={prefs.pieceSet}
            showCoordinates={prefs.showCoordinates}
          />
        </div>
        <div className="lg:col-span-5 bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-stone-900 dark:text-zinc-100 flex items-center gap-2">
              <Brain className="w-4 h-4 text-emerald-600" />
              Blindfold & Visualization Drill
            </h2>
            <span className="font-mono text-xs text-stone-500">
              {(visIdx % VISUALIZATION_DRILLS.length) + 1}/{VISUALIZATION_DRILLS.length}
            </span>
          </div>
          <div className="p-3 rounded-lg bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 space-y-2">
            <div className="text-xs font-bold text-stone-900 dark:text-zinc-100">
              {currentVis.title}
            </div>
            <div className="text-xs text-stone-500">Visualize these moves from the board:</div>
            <div className="flex flex-wrap gap-1.5 font-mono text-xs font-semibold text-emerald-700 dark:text-emerald-300">
              {currentVis.moveSequenceSan.map((m, idx) => (
                <span
                  key={idx}
                  className="px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800"
                >
                  {m}
                </span>
              ))}
            </div>
          </div>
          <p className="text-xs font-semibold text-stone-800 dark:text-zinc-200">
            {currentVis.question}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {currentVis.options.map((opt) => {
              const picked = visPicked === opt;
              const isCorrect = opt === currentVis.correctOption;
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => {
                    setVisPicked(opt);
                    if (isCorrect) soundFX.victory();
                    else soundFX.error();
                  }}
                  className={`py-2 px-3 rounded-lg border text-xs font-semibold text-left ${
                    !visPicked
                      ? 'border-stone-200 dark:border-zinc-700 hover:border-emerald-500'
                      : isCorrect
                      ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300'
                      : picked
                      ? 'border-red-500 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300'
                      : 'border-stone-200 dark:border-zinc-800 opacity-60'
                  }`}
                >
                  {opt}
                </button>
              );
            })}
          </div>
          {visPicked && (
            <div className="p-3 rounded-lg bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 text-xs text-stone-700 dark:text-zinc-300">
              {currentVis.explanation}
            </div>
          )}
          <button
            type="button"
            onClick={() => {
              setVisPicked(null);
              setVisIdx((i) => i + 1);
            }}
            className="w-full py-2 px-4 rounded-lg bg-stone-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-semibold"
          >
            Next Visualization Challenge
          </button>
        </div>
      </div>
    );
  }

  if (mode === 'scramble') {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <div className="lg:col-span-7 flex flex-col items-center gap-3">
          <div className="w-full max-w-[540px] flex items-center justify-between px-3 py-2 rounded-lg bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 text-xs">
            <span className="font-semibold">
              {currentScramble.title} ({currentScramble.rating})
            </span>
            <span className="font-mono font-bold text-amber-600 dark:text-amber-400">
              {(scrambleTimeTenths / 10).toFixed(1)}s
            </span>
          </div>
          <ChessBoard
            state={scrambleState}
            onMove={handleScrambleMove}
            flipped={currentScramble.playerColor === 'b'}
            allowedColor={currentScramble.playerColor}
            interactive={scrambleActive}
            boardTheme={prefs.boardTheme}
            pieceSet={prefs.pieceSet}
            showCoordinates={prefs.showCoordinates}
            highlightLegal={prefs.highlightLegalMoves}
          />
        </div>
        <div className="lg:col-span-5 bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-stone-900 dark:text-zinc-100 flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-500" />
              Time-Scramble Endurance
            </h2>
            <span className="font-mono text-xs text-stone-500">Best: {scrambleBest}</span>
          </div>
          <p className="text-xs text-stone-600 dark:text-zinc-400">
            Start with <strong>15.0 seconds</strong>. Every solved tactic adds <strong>+3.0s</strong> as puzzles escalate in rating. Mistakes deduct 3.0s!
          </p>
          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="p-3 rounded-lg bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800">
              <div className="text-[11px] text-stone-500">Solved</div>
              <div className="font-mono text-xl font-bold text-emerald-600">{scrambleScore}</div>
            </div>
            <div className="p-3 rounded-lg bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800">
              <div className="text-[11px] text-stone-500">Clock</div>
              <div className="font-mono text-xl font-bold text-amber-600 flex items-center justify-center gap-1">
                <Clock className="w-4 h-4" />
                {(scrambleTimeTenths / 10).toFixed(1)}s
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={startScramble}
            className="w-full py-2.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
          >
            {scrambleActive ? 'Restart Scramble Run' : 'Start 15s Time-Scramble'}
          </button>
        </div>
      </div>
    );
  }

  // mode === 'maker'
  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
      <div className="lg:col-span-7 flex flex-col items-center gap-3">
        <ChessBoard
          state={makerPreviewState || parseFen('8/8/8/8/8/8/8/8 w - - 0 1', 'standard')}
          interactive={false}
          boardTheme={prefs.boardTheme}
          pieceSet={prefs.pieceSet}
          showCoordinates={prefs.showCoordinates}
        />
      </div>
      <div className="lg:col-span-5 bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-5 space-y-4">
        <h2 className="text-base font-bold text-stone-900 dark:text-zinc-100 flex items-center gap-2">
          <Plus className="w-4 h-4 text-emerald-600" />
          Custom Puzzle Maker & Publisher
        </h2>
        <form onSubmit={handlePublishCustomPuzzle} className="space-y-3 text-xs">
          <div>
            <label className="block font-medium text-stone-600 dark:text-zinc-400 mb-1">
              Puzzle Title
            </label>
            <input
              type="text"
              value={makerTitle}
              onChange={(e) => setMakerTitle(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-950"
            />
          </div>
          <div>
            <label className="block font-medium text-stone-600 dark:text-zinc-400 mb-1">
              Starting FEN
            </label>
            <input
              type="text"
              value={makerFen}
              onChange={(e) => setMakerFen(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-950 font-mono text-[11px]"
            />
          </div>
          <div>
            <label className="block font-medium text-stone-600 dark:text-zinc-400 mb-1">
              Winning Move Sequence (space-separated SAN or UCI)
            </label>
            <input
              type="text"
              value={makerMoves}
              onChange={(e) => setMakerMoves(e.target.value)}
              placeholder="e.g. Qxf7+ Rxf7 Re8#"
              className="w-full px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-950 font-mono"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-stone-600 dark:text-zinc-400 mb-1">
                Rating
              </label>
              <input
                type="number"
                min={600}
                max={2800}
                value={makerRating}
                onChange={(e) => setMakerRating(Number(e.target.value) || 1500)}
                className="w-full px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-950 font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-stone-600 dark:text-zinc-400 mb-1">
                Theme
              </label>
              <input
                type="text"
                value={makerTheme}
                onChange={(e) => setMakerTheme(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-950"
              />
            </div>
          </div>
          {makerError && (
            <div className="text-red-600 dark:text-red-400 font-medium">{makerError}</div>
          )}
          {makerStatus && (
            <div className="text-emerald-600 dark:text-emerald-400 font-semibold">{makerStatus}</div>
          )}
          <button
            type="submit"
            className="w-full py-2.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
          >
            Publish to Caissa Tactics Pool ({customPuzzles.length} community puzzles)
          </button>
        </form>
      </div>
    </div>
  );
};
