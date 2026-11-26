import React, { useMemo, useState } from 'react';
import { GameResult, Move, UserPreferences } from '../types/chess';
import {
  PRACTICE_DRILLS,
  PracticeCategory,
  PracticeDrill,
} from '../data/practiceDrills';
import {
  evaluateGameResult,
  makeMove,
  parseFen,
  positionKey,
  toFen,
} from '../engine/chessEngine';
import { findBestMove } from '../engine/aiSearch';
import { ChessBoard } from './ChessBoard';
import { soundFX } from '../utils/sound';
import {
  CheckCircle2,
  Lightbulb,
  RotateCcw,
  Target,
} from 'lucide-react';

interface PracticeTrainerProps {
  prefs: UserPreferences;
}

const CATEGORIES: ('All' | PracticeCategory)[] = [
  'All',
  'Checkmate Patterns',
  'Piece Checkmates',
  'Tactics & Sacrifices',
  'Endgame Technique',
];

export const PracticeTrainer: React.FC<PracticeTrainerProps> = ({ prefs }) => {
  const [category, setCategory] = useState<'All' | PracticeCategory>('All');
  const [selectedId, setSelectedId] = useState<string>(PRACTICE_DRILLS[0].id);
  const [completedIds, setCompletedIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('caissa_practice_done_v1');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const activeDrill: PracticeDrill = useMemo(
    () => PRACTICE_DRILLS.find((d) => d.id === selectedId) || PRACTICE_DRILLS[0],
    [selectedId]
  );

  const [fen, setFen] = useState<string>(activeDrill.fen);
  const [posKeys, setPosKeys] = useState<string[]>([
    positionKey(parseFen(activeDrill.fen, 'standard')),
  ]);
  const [movesCount, setMovesCount] = useState(0);
  const [lastMove, setLastMove] = useState<{ from?: [number, number] | null; to: [number, number] } | null>(null);
  const [result, setResult] = useState<GameResult | null>(null);
  const [showHint, setShowHint] = useState(false);
  const [thinking, setThinking] = useState(false);

  const state = useMemo(() => parseFen(fen, 'standard'), [fen]);

  const selectDrill = (drill: PracticeDrill) => {
    setSelectedId(drill.id);
    setFen(drill.fen);
    setPosKeys([positionKey(parseFen(drill.fen, 'standard'))]);
    setMovesCount(0);
    setLastMove(null);
    setResult(null);
    setShowHint(false);
    setThinking(false);
  };

  const markCompleted = (id: string) => {
    setCompletedIds((prev) => {
      if (prev.includes(id)) return prev;
      const next = [...prev, id];
      try {
        localStorage.setItem('caissa_practice_done_v1', JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const handleMove = (mv: Move) => {
    if (result || thinking || state.turn !== 'w') return;

    const res = makeMove(state, mv);
    const nextFen = toFen(res.next);
    const nextKeys = [...posKeys, positionKey(res.next)];

    if (res.san.includes('+') || res.san.includes('#')) soundFX.check();
    else if (mv.captured) soundFX.capture();
    else soundFX.move();

    setFen(nextFen);
    setPosKeys(nextKeys);
    setMovesCount((c) => c + 1);
    setLastMove({ from: mv.from, to: mv.to });

    const term = evaluateGameResult(res.next, nextKeys);
    if (term) {
      setResult(term);
      if (term.winner === 'w') {
        soundFX.victory();
        markCompleted(activeDrill.id);
      } else {
        soundFX.defeat();
      }
      return;
    }

    if (res.next.turn === 'b') {
      setThinking(true);
      window.setTimeout(() => {
        const reply = findBestMove(res.next, activeDrill.skillLevel);
        if (!reply.move) {
          setThinking(false);
          return;
        }
        const res2 = makeMove(res.next, reply.move);
        const nextFen2 = toFen(res2.next);
        const nextKeys2 = [...nextKeys, positionKey(res2.next)];

        if (res2.san.includes('+') || res2.san.includes('#')) soundFX.check();
        else if (reply.move.captured) soundFX.capture();
        else soundFX.move();

        setFen(nextFen2);
        setPosKeys(nextKeys2);
        setLastMove({ from: reply.move.from, to: reply.move.to });
        setThinking(false);

        const term2 = evaluateGameResult(res2.next, nextKeys2);
        if (term2) {
          setResult(term2);
          if (term2.winner === 'w') {
            soundFX.victory();
            markCompleted(activeDrill.id);
          } else {
            soundFX.defeat();
          }
        }
      }, 280);
    }
  };

  const visibleDrills = useMemo(
    () =>
      category === 'All'
        ? PRACTICE_DRILLS
        : PRACTICE_DRILLS.filter((d) => d.category === category),
    [category]
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
      <div className="lg:col-span-4 space-y-3">
        <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Target className="w-4 h-4 text-emerald-600" />
              <h2 className="text-sm font-semibold text-stone-900 dark:text-zinc-100">
                Thematic Practice
              </h2>
            </div>
            <span className="text-xs font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
              {completedIds.length}/{PRACTICE_DRILLS.length} cleared
            </span>
          </div>

          <div className="flex flex-wrap gap-1">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setCategory(cat)}
                className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                  category === cat
                    ? 'bg-emerald-600 text-white'
                    : 'bg-stone-100 dark:bg-zinc-800 text-stone-600 dark:text-zinc-300'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          <div className="space-y-1.5 max-h-[420px] overflow-y-auto thin-scroll">
            {visibleDrills.map((d) => {
              const done = completedIds.includes(d.id);
              const active = d.id === activeDrill.id;
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => selectDrill(d)}
                  className={`w-full text-left p-2.5 rounded-lg border text-xs flex items-center justify-between gap-2 transition-colors ${
                    active
                      ? 'border-emerald-600 bg-emerald-50/70 dark:bg-emerald-950/30'
                      : 'border-stone-200 dark:border-zinc-800 hover:bg-stone-50 dark:hover:bg-zinc-800/50'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-stone-900 dark:text-zinc-100 truncate">
                      {d.title}
                    </div>
                    <div className="text-[11px] text-stone-500 dark:text-zinc-400">
                      {d.category}
                    </div>
                  </div>
                  {done && <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="lg:col-span-5 flex flex-col items-center gap-3">
        <div className="w-full max-w-[540px] flex items-center justify-between px-3 py-2 rounded-lg bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 text-xs">
          <span className="font-semibold text-stone-900 dark:text-zinc-100">
            {activeDrill.title}
          </span>
          <span className="font-mono tabular-nums text-stone-500 dark:text-zinc-400">
            {thinking ? 'Engine thinking...' : `Moves: ${movesCount}`}
          </span>
        </div>

        <ChessBoard
          state={state}
          onMove={handleMove}
          allowedColor="w"
          interactive={!result && !thinking && state.turn === 'w'}
          lastMove={lastMove}
          boardTheme={prefs.boardTheme}
          pieceSet={prefs.pieceSet}
          showCoordinates={prefs.showCoordinates}
          highlightLegal={prefs.highlightLegalMoves}
          moveMethod={prefs.moveMethod}
        />
      </div>

      <div className="lg:col-span-3 space-y-4">
        <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-5 space-y-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
              {activeDrill.category}
            </div>
            <h3 className="text-base font-bold text-stone-900 dark:text-zinc-100 mt-0.5">
              {activeDrill.title}
            </h3>
            <p className="text-xs text-stone-600 dark:text-zinc-400 mt-1.5 leading-relaxed">
              {activeDrill.description}
            </p>
          </div>

          {result && (
            <div
              className={`p-3 rounded-lg border text-xs font-medium ${
                result.winner === 'w'
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-200'
                  : 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-200'
              }`}
            >
              {result.winner === 'w'
                ? `Completed in ${movesCount} moves! (${result.reason})`
                : `${result.reason}. Reset and try again!`}
            </div>
          )}

          {showHint && (
            <div className="p-3 rounded-lg bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-xs text-amber-900 dark:text-amber-200">
              {activeDrill.hint}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setShowHint((h) => !h)}
              className="px-3 py-1.5 rounded-lg border border-stone-200 dark:border-zinc-700 text-xs font-medium flex items-center gap-1"
            >
              <Lightbulb className="w-3.5 h-3.5 text-amber-500" />
              {showHint ? 'Hide Hint' : 'Hint'}
            </button>
            <button
              type="button"
              onClick={() => selectDrill(activeDrill)}
              className="px-3 py-1.5 rounded-lg border border-stone-200 dark:border-zinc-700 text-xs font-medium flex items-center gap-1"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset
            </button>
            {result?.winner === 'w' && (
              <button
                type="button"
                onClick={() => {
                  const idx = PRACTICE_DRILLS.findIndex((d) => d.id === activeDrill.id);
                  const next = PRACTICE_DRILLS[(idx + 1) % PRACTICE_DRILLS.length];
                  selectDrill(next);
                }}
                className="w-full py-2 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
              >
                Next Practice Drill
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
