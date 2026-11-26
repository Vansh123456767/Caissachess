import React, { useEffect, useState } from 'react';
import { soundFX } from '../utils/sound';
import { ArrowLeftRight, Pause, Play, RotateCcw } from 'lucide-react';

interface ClockPreset {
  id: string;
  label: string;
  whiteSec: number;
  blackSec: number;
  incSec: number;
  mode: 'fischer' | 'bronstein';
}

const CLOCK_PRESETS: ClockPreset[] = [
  { id: 'bullet-1-0', label: '1+0 Bullet', whiteSec: 60, blackSec: 60, incSec: 0, mode: 'fischer' },
  { id: 'blitz-3-2', label: '3+2 Blitz', whiteSec: 180, blackSec: 180, incSec: 2, mode: 'fischer' },
  { id: 'blitz-5-3', label: '5+3 Blitz', whiteSec: 300, blackSec: 300, incSec: 3, mode: 'fischer' },
  { id: 'rapid-10-5', label: '10+5 Rapid', whiteSec: 600, blackSec: 600, incSec: 5, mode: 'fischer' },
  { id: 'classical-30', label: '30+30 Classical', whiteSec: 1800, blackSec: 1800, incSec: 30, mode: 'fischer' },
  { id: 'armageddon', label: 'Armageddon 5 vs 4', whiteSec: 300, blackSec: 240, incSec: 0, mode: 'fischer' },
];

function formatTenths(ms: number): string {
  const safe = Math.max(0, ms);
  if (safe < 20_000) {
    const sec = Math.floor(safe / 1000);
    const tenths = Math.floor((safe % 1000) / 100);
    return `0:${sec.toString().padStart(2, '0')}.${tenths}`;
  }
  const totalSec = Math.ceil(safe / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export const OtbClockView: React.FC = () => {
  const [presetIdx, setPresetIdx] = useState(2); // 5+3 default
  const [customMin, setCustomMin] = useState(5);
  const [customInc, setCustomInc] = useState(3);
  const [delayMode, setDelayMode] = useState<'fischer' | 'bronstein'>('fischer');

  const [whiteMs, setWhiteMs] = useState(CLOCK_PRESETS[2].whiteSec * 1000);
  const [blackMs, setBlackMs] = useState(CLOCK_PRESETS[2].blackSec * 1000);
  const [incMs, setIncMs] = useState(CLOCK_PRESETS[2].incSec * 1000);
  const [turnStartMs, setTurnStartMs] = useState(CLOCK_PRESETS[2].whiteSec * 1000);

  const [activeSide, setActiveSide] = useState<'w' | 'b' | null>(null);
  const [paused, setPaused] = useState(false);
  const [flagged, setFlagged] = useState<'w' | 'b' | null>(null);
  const [movesCount, setMovesCount] = useState<{ w: number; b: number }>({ w: 0, b: 0 });
  const [rotatedTop, setRotatedTop] = useState(true);
  const [whiteBottom, setWhiteBottom] = useState(true);

  const applyPreset = (idx: number) => {
    const p = CLOCK_PRESETS[idx];
    setPresetIdx(idx);
    setDelayMode(p.mode);
    setWhiteMs(p.whiteSec * 1000);
    setBlackMs(p.blackSec * 1000);
    setIncMs(p.incSec * 1000);
    setTurnStartMs(p.whiteSec * 1000);
    setActiveSide(null);
    setPaused(false);
    setFlagged(null);
    setMovesCount({ w: 0, b: 0 });
  };

  const applyCustom = () => {
    const baseMs = Math.max(10, Math.round(customMin * 60)) * 1000;
    const iMs = Math.max(0, Math.round(customInc)) * 1000;
    setPresetIdx(-1);
    setWhiteMs(baseMs);
    setBlackMs(baseMs);
    setIncMs(iMs);
    setTurnStartMs(baseMs);
    setActiveSide(null);
    setPaused(false);
    setFlagged(null);
    setMovesCount({ w: 0, b: 0 });
  };

  const resetClock = () => {
    if (presetIdx >= 0) {
      applyPreset(presetIdx);
    } else {
      applyCustom();
    }
  };

  useEffect(() => {
    if (!activeSide || paused || flagged) return;
    const id = window.setInterval(() => {
      if (activeSide === 'w') {
        setWhiteMs((prev) => {
          const next = Math.max(0, prev - 100);
          if (next === 0) {
            setFlagged('w');
            soundFX.defeat();
          }
          return next;
        });
      } else {
        setBlackMs((prev) => {
          const next = Math.max(0, prev - 100);
          if (next === 0) {
            setFlagged('b');
            soundFX.defeat();
          }
          return next;
        });
      }
    }, 100);
    return () => window.clearInterval(id);
  }, [activeSide, paused, flagged]);

  const pressSide = (side: 'w' | 'b') => {
    if (flagged) return;
    if (paused) return;

    // First tap starts opponent's clock (White moves first if Black taps, or tap White to pass turn to Black)
    if (activeSide === null) {
      const nextActive = side === 'w' ? 'b' : 'w';
      setActiveSide(nextActive);
      setTurnStartMs(nextActive === 'w' ? whiteMs : blackMs);
      soundFX.clockTick();
      return;
    }

    if (activeSide !== side) return;
    soundFX.clockTick();

    if (side === 'w') {
      const spent = Math.max(0, turnStartMs - whiteMs);
      const bonus = delayMode === 'bronstein' ? Math.min(incMs, spent) : incMs;
      setWhiteMs((w) => w + bonus);
      setMovesCount((m) => ({ ...m, w: m.w + 1 }));
      setActiveSide('b');
      setTurnStartMs(blackMs);
    } else {
      const spent = Math.max(0, turnStartMs - blackMs);
      const bonus = delayMode === 'bronstein' ? Math.min(incMs, spent) : incMs;
      setBlackMs((b) => b + bonus);
      setMovesCount((m) => ({ ...m, b: m.b + 1 }));
      setActiveSide('w');
      setTurnStartMs(whiteMs);
    }
  };

  const topSide: 'w' | 'b' = whiteBottom ? 'b' : 'w';
  const bottomSide: 'w' | 'b' = whiteBottom ? 'w' : 'b';

  const renderPad = (side: 'w' | 'b', isTop: boolean) => {
    const ms = side === 'w' ? whiteMs : blackMs;
    const isActive = activeSide === side && !paused && !flagged;
    const isFlagged = flagged === side;
    const isLow = ms > 0 && ms < 20_000;

    return (
      <button
        type="button"
        onClick={() => pressSide(side)}
        className={`w-full rounded-2xl border-2 p-6 sm:p-8 flex flex-col items-center justify-center gap-2 transition-colors select-none cursor-pointer ${
          isTop && rotatedTop ? 'rotate-180' : ''
        } ${
          isFlagged
            ? 'border-red-600 bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300'
            : isActive
            ? 'border-emerald-600 bg-emerald-600 text-white shadow-lg'
            : 'border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-stone-900 dark:text-zinc-100 hover:bg-stone-50 dark:hover:bg-zinc-800/70'
        }`}
      >
        <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-wider opacity-85">
          <span>{side === 'w' ? 'White' : 'Black'}</span>
          <span>·</span>
          <span className="font-mono tabular-nums">Moves: {movesCount[side]}</span>
        </div>
        <div
          className={`font-mono font-bold tabular-nums text-5xl sm:text-6xl tracking-tight ${
            isLow && isActive ? 'text-amber-200' : isLow && !isFlagged ? 'text-red-600 dark:text-red-400' : ''
          }`}
        >
          {formatTenths(ms)}
        </div>
        <div className="text-xs opacity-80">
          {isFlagged
            ? 'Time Expired (Flagged)'
            : activeSide === null
            ? 'Tap to start opponent clock'
            : isActive
            ? 'Tap when move is complete'
            : 'Waiting for opponent'}
        </div>
      </button>
    );
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
      <div className="lg:col-span-7 flex flex-col items-center gap-3">
        <div className="w-full max-w-[540px] space-y-3">
          {renderPad(topSide, true)}

          <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-stone-100 dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800">
            <button
              type="button"
              onClick={() => setPaused((p) => !p)}
              disabled={!activeSide || !!flagged}
              className="px-3 py-1.5 rounded-lg bg-white dark:bg-zinc-800 border border-stone-200 dark:border-zinc-700 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-40 whitespace-nowrap shrink-0"
            >
              {paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
              {paused ? 'Resume' : 'Pause'}
            </button>

            <button
              type="button"
              onClick={() => setWhiteBottom((w) => !w)}
              className="px-3 py-1.5 rounded-lg bg-white dark:bg-zinc-800 border border-stone-200 dark:border-zinc-700 text-xs font-medium flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
              Swap Sides
            </button>

            <button
              type="button"
              onClick={resetClock}
              className="px-3 py-1.5 rounded-lg bg-stone-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset Clock
            </button>
          </div>

          {renderPad(bottomSide, false)}
        </div>
      </div>

      <div className="lg:col-span-5 space-y-4">
        <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-5 space-y-4">
          <div>
            <h2 className="text-base font-semibold text-stone-900 dark:text-zinc-100">
              Over-the-Board Chess Clock
            </h2>
            <p className="text-xs text-stone-500 dark:text-zinc-400 mt-0.5">
              Use your device as a tournament-grade physical chess clock with Fischer increment or Bronstein delay.
            </p>
          </div>

          <div>
            <div className="text-xs font-semibold text-stone-700 dark:text-zinc-300 mb-2">
              Standard Presets
            </div>
            <div className="grid grid-cols-2 gap-2">
              {CLOCK_PRESETS.map((p, idx) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => applyPreset(idx)}
                  className={`py-2 px-3 rounded-lg border text-xs font-semibold text-left transition-colors ${
                    presetIdx === idx
                      ? 'border-emerald-600 bg-emerald-50/70 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300'
                      : 'border-stone-200 dark:border-zinc-800 hover:bg-stone-50 dark:hover:bg-zinc-800'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="pt-3 border-t border-stone-100 dark:border-zinc-800 space-y-3">
            <div className="text-xs font-semibold text-stone-700 dark:text-zinc-300">
              Custom Clock & Delay Mode
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] text-stone-500 dark:text-zinc-400 mb-1">
                  Minutes per side
                </label>
                <input
                  type="number"
                  min={0.5}
                  max={180}
                  step={0.5}
                  value={customMin}
                  onChange={(e) => setCustomMin(Number(e.target.value))}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-950 font-mono text-xs"
                />
              </div>
              <div>
                <label className="block text-[11px] text-stone-500 dark:text-zinc-400 mb-1">
                  Increment / Delay (sec)
                </label>
                <input
                  type="number"
                  min={0}
                  max={60}
                  value={customInc}
                  onChange={(e) => setCustomInc(Number(e.target.value))}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-950 font-mono text-xs"
                />
              </div>
            </div>

            <div className="flex gap-2">
              {([
                ['fischer', 'Fischer Increment'],
                ['bronstein', 'Bronstein Delay'],
              ] as const).map(([m, lbl]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setDelayMode(m)}
                  className={`flex-1 py-1.5 px-2.5 rounded-lg border text-xs font-medium ${
                    delayMode === m
                      ? 'border-emerald-600 bg-emerald-600 text-white'
                      : 'border-stone-200 dark:border-zinc-700'
                  }`}
                >
                  {lbl}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={applyCustom}
              className="w-full py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
            >
              Apply Custom Clock
            </button>
          </div>

          <label className="flex items-center gap-2 text-xs text-stone-700 dark:text-zinc-300 pt-2 border-t border-stone-100 dark:border-zinc-800 cursor-pointer">
            <input
              type="checkbox"
              checked={rotatedTop}
              onChange={(e) => setRotatedTop(e.target.checked)}
              className="accent-emerald-600"
            />
            Flip top player clock 180° for face-to-face table play
          </label>
        </div>
      </div>
    </div>
  );
};
