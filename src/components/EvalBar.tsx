import React from 'react';
import { evalToWhitePercent, formatEval } from '../engine/aiSearch';

interface EvalBarProps {
  evalCp: number;
  mateIn?: number;
  flipped?: boolean;
  className?: string;
}

export const EvalBar: React.FC<EvalBarProps> = ({
  evalCp,
  mateIn,
  flipped = false,
  className = '',
}) => {
  const whitePct = evalToWhitePercent(evalCp);
  const label = formatEval(evalCp, mateIn);
  const whiteWinning = evalCp >= 0;

  return (
    <div
      className={`relative w-7 rounded-md overflow-hidden border border-stone-300 dark:border-zinc-700 bg-zinc-900 select-none flex flex-col ${className}`}
      title={`Evaluation: ${label}`}
    >
      {/* Top fill (Black unless flipped) */}
      <div
        className="w-full transition-all duration-300 ease-out"
        style={{
          height: `${flipped ? whitePct : 100 - whitePct}%`,
          backgroundColor: flipped ? '#f5f5f4' : '#18181b',
        }}
      />
      {/* Bottom fill (White unless flipped) */}
      <div
        className="w-full transition-all duration-300 ease-out"
        style={{
          height: `${flipped ? 100 - whitePct : whitePct}%`,
          backgroundColor: flipped ? '#18181b' : '#f5f5f4',
        }}
      />
      <span
        className={`absolute left-0 right-0 text-center font-mono text-[10px] font-semibold px-0.5 leading-tight ${
          whiteWinning
            ? flipped
              ? 'top-1.5 text-zinc-900'
              : 'bottom-1.5 text-zinc-900'
            : flipped
            ? 'bottom-1.5 text-stone-100'
            : 'top-1.5 text-stone-100'
        }`}
      >
        {label}
      </span>
    </div>
  );
};
