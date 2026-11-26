import React, { useMemo } from 'react';
import { BoardState, PieceColor, PieceSetId } from '../types/chess';
import { computeMaterialSummary } from '../utils/material';
import { ChessPiece } from './ChessPiece';

interface MaterialStripProps {
  state: BoardState;
  side: PieceColor;
  pieceSet?: PieceSetId;
}

export const MaterialStrip: React.FC<MaterialStripProps> = ({
  state,
  side,
  pieceSet = 'classic',
}) => {
  const summary = useMemo(() => computeMaterialSummary(state), [state]);
  const captured = side === 'w' ? summary.capturedByWhite : summary.capturedByBlack;
  const oppColor: PieceColor = side === 'w' ? 'b' : 'w';
  const lead = side === 'w' ? summary.advantage : -summary.advantage;

  if (captured.length === 0 && lead <= 0) return null;

  return (
    <div className="flex items-center gap-1 min-h-4">
      <div className="flex items-center -space-x-1.5">
        {captured.map((pt, idx) => (
          <ChessPiece
            key={`${pt}-${idx}`}
            color={oppColor}
            type={pt}
            pieceSet={pieceSet}
            className="w-4 h-4"
          />
        ))}
      </div>
      {lead > 0 && (
        <span className="text-[11px] font-mono font-semibold tabular-nums text-stone-600 dark:text-zinc-300 ml-0.5">
          +{lead}
        </span>
      )}
    </div>
  );
};
