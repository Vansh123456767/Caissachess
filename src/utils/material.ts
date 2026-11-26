import { BoardState, PieceColor, PieceType } from '../types/chess';

const PIECE_VALUES: Record<Exclude<PieceType, 'k'>, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
};

const STARTING_COUNTS: Record<Exclude<PieceType, 'k'>, number> = {
  q: 1,
  r: 2,
  b: 2,
  n: 2,
  p: 8,
};

export interface MaterialSummary {
  /** Opponent pieces captured by White (so White's captured spoils, rendered in Black color) */
  capturedByWhite: Exclude<PieceType, 'k'>[];
  /** Opponent pieces captured by Black (rendered in White color) */
  capturedByBlack: Exclude<PieceType, 'k'>[];
  /** Net material advantage in pawns (>0 White ahead, <0 Black ahead) */
  advantage: number;
}

export function computeMaterialSummary(state: BoardState): MaterialSummary {
  const counts: Record<PieceColor, Record<Exclude<PieceType, 'k'>, number>> = {
    w: { q: 0, r: 0, b: 0, n: 0, p: 0 },
    b: { q: 0, r: 0, b: 0, n: 0, p: 0 },
  };

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = state.board[r][c];
      if (!p || p.type === 'k') continue;
      counts[p.color][p.type] += 1;
    }
  }

  let wVal = 0;
  let bVal = 0;
  const order: Exclude<PieceType, 'k'>[] = ['q', 'r', 'b', 'n', 'p'];

  for (const pt of order) {
    wVal += counts.w[pt] * PIECE_VALUES[pt];
    bVal += counts.b[pt] * PIECE_VALUES[pt];
  }

  // Standard capture trays only apply cleanly to standard-ish material games
  const capturedByWhite: Exclude<PieceType, 'k'>[] = [];
  const capturedByBlack: Exclude<PieceType, 'k'>[] = [];

  if (state.variant !== 'horde') {
    for (const pt of order) {
      const missingBlack = Math.max(0, STARTING_COUNTS[pt] - counts.b[pt]);
      for (let i = 0; i < missingBlack; i++) capturedByWhite.push(pt);
      const missingWhite = Math.max(0, STARTING_COUNTS[pt] - counts.w[pt]);
      for (let i = 0; i < missingWhite; i++) capturedByBlack.push(pt);
    }
  }

  return {
    capturedByWhite,
    capturedByBlack,
    advantage: wVal - bVal,
  };
}
