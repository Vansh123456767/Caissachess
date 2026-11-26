import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BoardThemeId, PieceSetId, UserPreferences } from '../types/chess';
import { BOARD_THEMES } from './ChessBoard';
import { ChessPiece } from './ChessPiece';
import { coordToSq, createInitialState, FILES, RANKS } from '../engine/chessEngine';
import { soundFX } from '../utils/sound';
import { Crosshair, Keyboard, Play, RotateCcw, Trophy } from 'lucide-react';

interface CoordinatesTrainerProps {
  prefs: UserPreferences;
}

type OrientationMode = 'white' | 'black' | 'random';
type CoordsInputMode = 'click' | 'type';

function pickRandomSquare(exclude?: string): string {
  const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const ranks = ['1', '2', '3', '4', '5', '6', '7', '8'];
  let sq = 'e4';
  for (let i = 0; i < 6; i++) {
    const f = files[Math.floor(Math.random() * 8)];
    const r = ranks[Math.floor(Math.random() * 8)];
    sq = `${f}${r}`;
    if (sq !== exclude) break;
  }
  return sq;
}

export const CoordinatesTrainer: React.FC<CoordinatesTrainerProps> = ({ prefs }) => {
  const [orientation, setOrientation] = useState<OrientationMode>('white');
  const [inputMode, setInputMode] = useState<CoordsInputMode>('click');
  const [typedCoord, setTypedCoord] = useState('');
  const [showCoordsOnBoard, setShowCoordsOnBoard] = useState(false);
  const [showPieces, setShowPieces] = useState(false);

  const [status, setStatus] = useState<'idle' | 'active' | 'done'>('idle');
  const [remainingMs, setRemainingMs] = useState(30_000);
  const [targetSq, setTargetSq] = useState<string>(() => pickRandomSquare());
  const [roundFlipped, setRoundFlipped] = useState(false);

  const [score, setScore] = useState(0);
  const [attempts, setAttempts] = useState(0);
  const [reactionTimes, setReactionTimes] = useState<number[]>([]);
  const [flashSq, setFlashSq] = useState<{ sq: string; ok: boolean } | null>(null);
  const typeInputRef = useRef<HTMLInputElement | null>(null);

  const [bestScores, setBestScores] = useState<Record<OrientationMode, number>>(() => {
    try {
      const raw = localStorage.getItem('caissa_coords_best_v1');
      if (raw) return { white: 0, black: 0, random: 0, ...JSON.parse(raw) };
    } catch {
      // ignore
    }
    return { white: 0, black: 0, random: 0 };
  });

  const endAtRef = useRef<number>(0);
  const promptShownAtRef = useRef<number>(Date.now());
  const startingBoard = useMemo(() => createInitialState('standard').board, []);
  const theme = BOARD_THEMES[prefs.boardTheme as BoardThemeId] || BOARD_THEMES.wood;

  const isFlipped =
    orientation === 'black' ? true : orientation === 'white' ? false : roundFlipped;

  useEffect(() => {
    if (status !== 'active') return;
    const timer = window.setInterval(() => {
      const left = Math.max(0, endAtRef.current - Date.now());
      setRemainingMs(left);
      if (left <= 0) {
        setStatus('done');
        window.clearInterval(timer);
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [status]);

  useEffect(() => {
    if (status === 'done') {
      setBestScores((prev) => {
        if (score <= (prev[orientation] || 0)) return prev;
        const next = { ...prev, [orientation]: score };
        try {
          localStorage.setItem('caissa_coords_best_v1', JSON.stringify(next));
        } catch {
          // ignore
        }
        return next;
      });
    }
  }, [status, score, orientation]);

  const startSession = () => {
    const nextSq = pickRandomSquare();
    endAtRef.current = Date.now() + 30_000;
    promptShownAtRef.current = Date.now();
    setRemainingMs(30_000);
    setScore(0);
    setAttempts(0);
    setReactionTimes([]);
    setFlashSq(null);
    setTypedCoord('');
    setTargetSq(nextSq);
    if (orientation === 'random') {
      setRoundFlipped(Math.random() < 0.5);
    }
    setStatus('active');
    if (inputMode === 'type') {
      window.setTimeout(() => typeInputRef.current?.focus(), 40);
    }
  };

  const evaluateGuess = (guessedSq: string) => {
    if (status !== 'active') return;
    const now = Date.now();
    const ok = guessedSq.toLowerCase() === targetSq;
    setAttempts((a) => a + 1);
    setFlashSq({ sq: targetSq, ok });
    window.setTimeout(() => setFlashSq(null), 260);

    if (ok) {
      soundFX.move();
      const rt = Math.max(80, now - promptShownAtRef.current);
      setReactionTimes((prev) => [...prev, rt]);
      setScore((s) => s + 1);
      setTargetSq((prev) => pickRandomSquare(prev));
      if (orientation === 'random') {
        setRoundFlipped(Math.random() < 0.5);
      }
      promptShownAtRef.current = now;
    } else {
      soundFX.error();
    }
  };

  const handleSquareClick = (sq: string) => {
    if (status === 'idle') {
      startSession();
      return;
    }
    if (status !== 'active' || inputMode !== 'click') return;
    evaluateGuess(sq);
  };

  const handleTypedCoordChange = (val: string) => {
    const clean = val.toLowerCase().replace(/[^a-h1-8]/g, '').slice(0, 2);
    setTypedCoord(clean);
    if (status === 'active' && inputMode === 'type' && /^[a-h][1-8]$/.test(clean)) {
      evaluateGuess(clean);
      setTypedCoord('');
    }
  };

  const displayRows = isFlipped ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
  const displayCols = isFlipped ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];

  const accuracyPct = attempts > 0 ? Math.round((score / attempts) * 100) : 100;
  const avgMs =
    reactionTimes.length > 0
      ? Math.round(reactionTimes.reduce((a, b) => a + b, 0) / reactionTimes.length)
      : 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
      <div className="lg:col-span-7 flex flex-col items-center gap-3">
        <div className="w-full max-w-[540px] flex items-center justify-between px-3.5 py-2.5 rounded-lg bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800">
          <div className="flex items-center gap-2 text-xs text-stone-600 dark:text-zinc-400">
            <Crosshair className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span>
              {status === 'active'
                ? inputMode === 'click'
                  ? 'Click the square shown:'
                  : 'Type the highlighted square:'
                : status === 'done'
                ? 'Round finished'
                : 'Click Start Training or click any square'}
            </span>
          </div>
          <div className="flex items-center gap-3">
            {status === 'active' && inputMode === 'click' && (
              <span className="px-2.5 py-0.5 rounded bg-emerald-600 text-white font-mono text-base font-bold">
                {targetSq}
              </span>
            )}
            <span
              className={`font-mono tabular-nums text-base font-bold ${
                remainingMs <= 5000 && status === 'active'
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-stone-900 dark:text-zinc-100'
              }`}
            >
              {(remainingMs / 1000).toFixed(1)}s
            </span>
          </div>
        </div>

        <div className="relative w-full max-w-[540px] aspect-square rounded-lg overflow-hidden shadow-md border border-stone-300 dark:border-zinc-700 select-none">
          <div className="grid grid-cols-8 grid-rows-8 w-full h-full">
            {displayRows.map((r, vrIdx) =>
              displayCols.map((c, vcIdx) => {
                const isLight = (r + c) % 2 === 0;
                const sq = coordToSq(r, c);
                const piece = showPieces ? startingBoard[r][c] : null;
                const isFlashed = flashSq && flashSq.sq === sq;
                const isTypeTarget = status === 'active' && inputMode === 'type' && sq === targetSq;

                return (
                  <button
                    key={sq}
                    type="button"
                    onClick={() => handleSquareClick(sq)}
                    style={{ backgroundColor: isLight ? theme.light : theme.dark }}
                    className="relative flex items-center justify-center cursor-pointer hover:brightness-95 transition"
                  >
                    {isTypeTarget && (
                      <div className="absolute inset-0 bg-emerald-500/55 ring-3 ring-inset ring-emerald-300 pointer-events-none" />
                    )}
                    {isFlashed && (
                      <div
                        className={`absolute inset-0 pointer-events-none ${
                          flashSq.ok ? 'bg-emerald-500/60' : 'bg-red-500/60'
                        }`}
                      />
                    )}
                    {showCoordsOnBoard && vcIdx === 0 && (
                      <span
                        className="absolute top-0.5 left-1 text-[10px] font-mono font-semibold leading-none pointer-events-none"
                        style={{ color: isLight ? theme.coordLight : theme.coordDark }}
                      >
                        {RANKS[r]}
                      </span>
                    )}
                    {showCoordsOnBoard && vrIdx === 7 && (
                      <span
                        className="absolute bottom-0.5 right-1 text-[10px] font-mono font-semibold leading-none pointer-events-none"
                        style={{ color: isLight ? theme.coordLight : theme.coordDark }}
                      >
                        {FILES[c]}
                      </span>
                    )}
                    {piece && (
                      <ChessPiece
                        color={piece.color}
                        type={piece.type}
                        pieceSet={prefs.pieceSet as PieceSetId}
                        className="w-[82%] h-[82%] opacity-85"
                      />
                    )}
                  </button>
                );
              })
            )}
          </div>

          {/* Center floating target coordinate watermark while active in Click Mode */}
          {status === 'active' && inputMode === 'click' && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="px-5 py-2.5 rounded-xl bg-zinc-950/75 text-white font-mono text-3xl font-bold tracking-wider shadow-lg">
                {targetSq}
              </div>
            </div>
          )}
        </div>

        {inputMode === 'type' && (
          <div className="w-full max-w-[540px] flex items-center gap-2 px-3.5 py-2.5 rounded-lg bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800">
            <Keyboard className="w-4 h-4 text-emerald-600 shrink-0" />
            <input
              ref={typeInputRef}
              type="text"
              value={typedCoord}
              onChange={(e) => handleTypedCoordChange(e.target.value)}
              disabled={status !== 'active'}
              placeholder={status === 'active' ? 'Type highlighted square (e.g. e4)...' : 'Start training to type coordinates'}
              className="flex-1 bg-transparent text-xs font-mono text-stone-900 dark:text-zinc-100 outline-none"
              maxLength={2}
            />
          </div>
        )}
      </div>

      <div className="lg:col-span-5 space-y-4">
        <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-stone-900 dark:text-zinc-100">
              Coordinates Sight Trainer
            </h2>
            <span className="text-xs font-mono tabular-nums text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
              <Trophy className="w-3.5 h-3.5" />
              Best: {bestScores[orientation] || 0}
            </span>
          </div>

          <p className="text-xs text-stone-600 dark:text-zinc-400 leading-relaxed">
            Build instant algebraic board vision. Locate as many squares as possible in 30 seconds from White&apos;s, Black&apos;s, or alternating perspectives.
          </p>

          {/* Input Mode */}
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-stone-500 dark:text-zinc-400 mb-1.5">
              Input Mode
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              {([
                ['click', 'Click Square'],
                ['type', 'Type Coordinate'],
              ] as [CoordsInputMode, string][]).map(([id, lbl]) => (
                <button
                  key={id}
                  type="button"
                  disabled={status === 'active'}
                  onClick={() => setInputMode(id)}
                  className={`py-1.5 px-2 rounded-lg border text-xs font-semibold transition-colors disabled:opacity-50 ${
                    inputMode === id
                      ? 'border-emerald-600 bg-emerald-600 text-white'
                      : 'border-stone-200 dark:border-zinc-700 text-stone-700 dark:text-zinc-300'
                  }`}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </div>

          {/* Orientation */}
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-stone-500 dark:text-zinc-400 mb-1.5">
              Perspective
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {([
                ['white', 'White'],
                ['random', 'Random'],
                ['black', 'Black'],
              ] as [OrientationMode, string][]).map(([id, lbl]) => (
                <button
                  key={id}
                  type="button"
                  disabled={status === 'active'}
                  onClick={() => setOrientation(id)}
                  className={`py-1.5 px-2 rounded-lg border text-xs font-semibold transition-colors disabled:opacity-50 ${
                    orientation === id
                      ? 'border-emerald-600 bg-emerald-600 text-white'
                      : 'border-stone-200 dark:border-zinc-700 text-stone-700 dark:text-zinc-300'
                  }`}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </div>

          {/* Toggles */}
          <div className="flex flex-wrap gap-4 text-xs text-stone-700 dark:text-zinc-300">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showCoordsOnBoard}
                onChange={(e) => setShowCoordsOnBoard(e.target.checked)}
                className="accent-emerald-600"
              />
              Show Coordinates
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showPieces}
                onChange={(e) => setShowPieces(e.target.checked)}
                className="accent-emerald-600"
              />
              Show Starting Pieces
            </label>
          </div>

          {/* Live Metrics */}
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="p-2.5 rounded-lg bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800">
              <div className="text-[11px] text-stone-500 dark:text-zinc-400">Score</div>
              <div className="text-lg font-mono font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                {score}
              </div>
            </div>
            <div className="p-2.5 rounded-lg bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800">
              <div className="text-[11px] text-stone-500 dark:text-zinc-400">Accuracy</div>
              <div className="text-lg font-mono font-bold tabular-nums text-stone-900 dark:text-zinc-100">
                {accuracyPct}%
              </div>
            </div>
            <div className="p-2.5 rounded-lg bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800">
              <div className="text-[11px] text-stone-500 dark:text-zinc-400">Avg Speed</div>
              <div className="text-lg font-mono font-bold tabular-nums text-stone-900 dark:text-zinc-100">
                {avgMs > 0 ? `${avgMs}ms` : '--'}
              </div>
            </div>
          </div>

          {status === 'done' && (
            <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-xs text-emerald-800 dark:text-emerald-200">
              Session complete! You scored <strong>{score}</strong> square{score === 1 ? '' : 's'} with{' '}
              <strong>{accuracyPct}%</strong> accuracy.
            </div>
          )}

          <button
            type="button"
            onClick={startSession}
            className="w-full py-2.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center justify-center gap-1.5"
          >
            {status === 'active' ? (
              <>
                <RotateCcw className="w-4 h-4" />
                Restart 30s Drill
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                {status === 'done' ? 'Play Again (30s)' : 'Start 30s Training'}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
