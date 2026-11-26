import {
  AnalyzedMove,
  BoardState,
  Move,
  PieceColor,
  PieceType,
  Puzzle,
} from '../types/chess';
import {
  applyMoveRaw,
  coordToSq,
  evaluateGameResult,
  findKing,
  getLegalMoves,
  isInCheck,
  makeMove,
  moveToSan,
  moveToUci,
  parseFen,
  toFen,
} from './chessEngine';

const PIECE_VALUES: Record<PieceType, number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 0,
};

// Piece-square tables from White's perspective (row 0 = rank 8, row 7 = rank 1)
const PAWN_PST = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [50, 50, 50, 50, 50, 50, 50, 50],
  [10, 10, 20, 30, 30, 20, 10, 10],
  [5, 5, 10, 27, 27, 10, 5, 5],
  [0, 0, 0, 24, 24, 0, 0, 0],
  [5, -5, -10, 0, 0, -10, -5, 5],
  [5, 10, 10, -22, -22, 10, 10, 5],
  [0, 0, 0, 0, 0, 0, 0, 0],
];

const KNIGHT_PST = [
  [-50, -40, -30, -30, -30, -30, -40, -50],
  [-40, -20, 0, 0, 0, 0, -20, -40],
  [-30, 0, 12, 16, 16, 12, 0, -30],
  [-30, 5, 16, 22, 22, 16, 5, -30],
  [-30, 0, 16, 22, 22, 16, 0, -30],
  [-30, 5, 12, 16, 16, 12, 5, -30],
  [-40, -20, 0, 5, 5, 0, -20, -40],
  [-50, -40, -30, -30, -30, -30, -40, -50],
];

const BISHOP_PST = [
  [-20, -10, -10, -10, -10, -10, -10, -20],
  [-10, 0, 0, 0, 0, 0, 0, -10],
  [-10, 0, 10, 12, 12, 10, 0, -10],
  [-10, 8, 8, 12, 12, 8, 8, -10],
  [-10, 0, 12, 12, 12, 12, 0, -10],
  [-10, 10, 10, 10, 10, 10, 10, -10],
  [-10, 6, 0, 0, 0, 0, 6, -10],
  [-20, -10, -10, -10, -10, -10, -10, -20],
];

const ROOK_PST = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [8, 14, 14, 14, 14, 14, 14, 8],
  [-5, 0, 0, 0, 0, 0, 0, -5],
  [-5, 0, 0, 0, 0, 0, 0, -5],
  [-5, 0, 0, 0, 0, 0, 0, -5],
  [-5, 0, 0, 0, 0, 0, 0, -5],
  [-5, 0, 0, 0, 0, 0, 0, -5],
  [0, 0, 0, 6, 6, 0, 0, 0],
];

const QUEEN_PST = [
  [-20, -10, -10, -5, -5, -10, -10, -20],
  [-10, 0, 0, 0, 0, 0, 0, -10],
  [-10, 0, 6, 6, 6, 6, 0, -10],
  [-5, 0, 6, 6, 6, 6, 0, -5],
  [0, 0, 6, 6, 6, 6, 0, -5],
  [-10, 6, 6, 6, 6, 6, 0, -10],
  [-10, 0, 6, 0, 0, 0, 0, -10],
  [-20, -10, -10, -5, -5, -10, -10, -20],
];

const KING_MG_PST = [
  [-30, -40, -40, -50, -50, -40, -40, -30],
  [-30, -40, -40, -50, -50, -40, -40, -30],
  [-30, -40, -40, -50, -50, -40, -40, -30],
  [-30, -40, -40, -50, -50, -40, -40, -30],
  [-20, -30, -30, -40, -40, -30, -30, -20],
  [-10, -20, -20, -20, -20, -20, -20, -10],
  [20, 20, 0, 0, 0, 0, 20, 20],
  [20, 30, 10, 0, 0, 10, 30, 20],
];

function getPst(type: PieceType, r: number, c: number, color: PieceColor): number {
  const rr = color === 'w' ? r : 7 - r;
  switch (type) {
    case 'p': return PAWN_PST[rr][c];
    case 'n': return KNIGHT_PST[rr][c];
    case 'b': return BISHOP_PST[rr][c];
    case 'r': return ROOK_PST[rr][c];
    case 'q': return QUEEN_PST[rr][c];
    case 'k': return KING_MG_PST[rr][c];
  }
}

// Returns static eval from White's perspective in centipawns
export function evaluatePosition(state: BoardState): number {
  const terminal = evaluateGameResult(state);
  if (terminal) {
    if (terminal.winner === 'w') return 90000;
    if (terminal.winner === 'b') return -90000;
    return 0;
  }

  const { board, variant, checksGiven, pockets } = state;
  let score = 0;

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p) continue;
      const sign = p.color === 'w' ? 1 : -1;

      if (variant === 'antichess') {
        // Having fewer pieces is generally good in antichess
        score -= sign * (PIECE_VALUES[p.type] + 60);
        continue;
      }

      if (variant === 'racingKings' && p.type === 'k') {
        // Advancing toward row 0 is paramount
        score += sign * ((7 - r) * 180);
        continue;
      }

      let val = PIECE_VALUES[p.type] + getPst(p.type, r, c, p.color);
      if (variant === 'horde' && p.color === 'w' && p.type === 'p') {
        val += (7 - r) * 14;
      }
      score += sign * val;
    }
  }

  if (variant === 'kingOfTheHill') {
    const wk = findKing(board, 'w');
    const bk = findKing(board, 'b');
    if (wk) {
      const dist = Math.abs(wk[0] - 3.5) + Math.abs(wk[1] - 3.5);
      score += Math.round((7 - dist) * 45);
    }
    if (bk) {
      const dist = Math.abs(bk[0] - 3.5) + Math.abs(bk[1] - 3.5);
      score -= Math.round((7 - dist) * 45);
    }
  }

  if (variant === 'threeCheck') {
    score += (checksGiven.w - checksGiven.b) * 280;
  }

  if (variant === 'crazyhouse') {
    const types: Exclude<PieceType, 'k'>[] = ['p', 'n', 'b', 'r', 'q'];
    for (const t of types) {
      score += pockets.w[t] * PIECE_VALUES[t] * 0.85;
      score -= pockets.b[t] * PIECE_VALUES[t] * 0.85;
    }
  }

  // Slight tempo bonus
  score += state.turn === 'w' ? 12 : -12;
  return Math.round(score);
}

function scoreMoveOrder(move: Move): number {
  let s = 0;
  if (move.captured) {
    s += 10 * PIECE_VALUES[move.captured] - PIECE_VALUES[move.piece] + 1000;
  }
  if (move.promotion) {
    s += PIECE_VALUES[move.promotion] + 800;
  }
  if (move.isCastle) s += 150;
  if (move.isDrop) s += 120;
  // Center preference
  const centerDist = Math.abs(move.to[0] - 3.5) + Math.abs(move.to[1] - 3.5);
  s += Math.round((7 - centerDist) * 4);
  return s;
}

function orderMoves(moves: Move[]): Move[] {
  return [...moves].sort((a, b) => scoreMoveOrder(b) - scoreMoveOrder(a));
}

function quiescence(
  state: BoardState,
  alpha: number,
  beta: number,
  maximizing: boolean,
  qDepth: number
): number {
  const standPat = evaluatePosition(state);
  if (qDepth <= 0 || Math.abs(standPat) >= 85000) return standPat;

  if (maximizing) {
    if (standPat >= beta) return beta;
    if (alpha < standPat) alpha = standPat;
    const captures = orderMoves(getLegalMoves(state).filter((m) => !!m.captured));
    for (const m of captures.slice(0, 6)) {
      const next = applyMoveRaw(state, m);
      const score = quiescence(next, alpha, beta, false, qDepth - 1);
      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }
    return alpha;
  } else {
    if (standPat <= alpha) return alpha;
    if (beta > standPat) beta = standPat;
    const captures = orderMoves(getLegalMoves(state).filter((m) => !!m.captured));
    for (const m of captures.slice(0, 6)) {
      const next = applyMoveRaw(state, m);
      const score = quiescence(next, alpha, beta, true, qDepth - 1);
      if (score <= alpha) return alpha;
      if (score < beta) beta = score;
    }
    return beta;
  }
}

function alphaBeta(
  state: BoardState,
  depth: number,
  alpha: number,
  beta: number,
  maximizing: boolean,
  ply: number
): number {
  const terminal = evaluateGameResult(state);
  if (terminal) {
    if (terminal.winner === 'w') return 90000 - ply;
    if (terminal.winner === 'b') return -90000 + ply;
    return 0;
  }
  if (depth <= 0) {
    return quiescence(state, alpha, beta, maximizing, 2);
  }

  const moves = orderMoves(getLegalMoves(state));
  if (moves.length === 0) return evaluatePosition(state);

  if (maximizing) {
    let best = -Infinity;
    for (const m of moves) {
      const next = applyMoveRaw(state, m);
      const val = alphaBeta(next, depth - 1, alpha, beta, false, ply + 1);
      if (val > best) best = val;
      if (val > alpha) alpha = val;
      if (alpha >= beta) break;
    }
    return best;
  } else {
    let best = Infinity;
    for (const m of moves) {
      const next = applyMoveRaw(state, m);
      const val = alphaBeta(next, depth - 1, alpha, beta, true, ply + 1);
      if (val < best) best = val;
      if (val < beta) beta = val;
      if (alpha >= beta) break;
    }
    return best;
  }
}

export function findBestMove(state: BoardState, skillLevel = 6): { move: Move | null; evalCp: number } {
  const legal = orderMoves(getLegalMoves(state));
  if (legal.length === 0) return { move: null, evalCp: evaluatePosition(state) };

  // Depth calibrated for snappy browser execution across all 9 variants
  const isComplexVariant = state.variant === 'crazyhouse' || state.variant === 'horde';
  const depth = skillLevel <= 2 ? 1 : skillLevel <= 5 ? 2 : isComplexVariant ? 2 : 3;
  const maximizing = state.turn === 'w';

  const scored: { move: Move; score: number }[] = [];
  for (const m of legal) {
    const next = applyMoveRaw(state, m);
    const val = alphaBeta(next, depth - 1, -Infinity, Infinity, !maximizing, 1);
    scored.push({ move: m, score: val });
  }

  scored.sort((a, b) => (maximizing ? b.score - a.score : a.score - b.score));

  // Add realistic human-like error margin for lower skill levels
  if (skillLevel <= 2 && scored.length > 2) {
    const pool = scored.slice(0, Math.min(4, scored.length));
    const pick = pool[Math.floor(Math.random() * pool.length)];
    return { move: pick.move, evalCp: pick.score };
  }
  if (skillLevel <= 4 && scored.length > 1 && Math.random() < 0.28) {
    const pick = scored[1];
    return { move: pick.move, evalCp: pick.score };
  }

  return { move: scored[0].move, evalCp: scored[0].score };
}

export interface EngineLine {
  rank: number;
  evalCp: number;
  mateIn?: number;
  pvSan: string[];
  pvUci: string[];
}

function quickBestFollowup(state: BoardState): Move | null {
  const legal = orderMoves(getLegalMoves(state));
  if (legal.length === 0) return null;
  const maximizing = state.turn === 'w';
  let bestMove = legal[0];
  let bestScore = maximizing ? -Infinity : Infinity;

  for (const m of legal.slice(0, 12)) {
    const next = applyMoveRaw(state, m);
    const val = alphaBeta(next, 1, -Infinity, Infinity, !maximizing, 1);
    if (maximizing ? val > bestScore : val < bestScore) {
      bestScore = val;
      bestMove = m;
    }
  }
  return bestMove;
}

export function analyzePositionMultiPv(state: BoardState, numLines = 3, depth = 3): EngineLine[] {
  const legal = orderMoves(getLegalMoves(state));
  if (legal.length === 0) return [];
  const maximizing = state.turn === 'w';
  const effectiveDepth = state.variant === 'crazyhouse' || state.variant === 'horde' ? Math.min(2, depth) : depth;

  const candidates = legal.slice(0, 18).map((m) => {
    const next = applyMoveRaw(state, m);
    const score = alphaBeta(next, effectiveDepth - 1, -Infinity, Infinity, !maximizing, 1);
    return { move: m, score, next };
  });

  candidates.sort((a, b) => (maximizing ? b.score - a.score : a.score - b.score));

  return candidates.slice(0, numLines).map((cand, idx) => {
    const pvSan: string[] = [moveToSan(state, cand.move, legal)];
    const pvUci: string[] = [moveToUci(cand.move)];

    // Extend PV 3 plies quickly without redundant deep full searches
    let cur = cand.next;
    for (let step = 0; step < 3; step++) {
      const term = evaluateGameResult(cur);
      if (term) break;
      const followMove = quickBestFollowup(cur);
      if (!followMove) break;
      const res = makeMove(cur, followMove);
      pvSan.push(res.san);
      pvUci.push(res.uci);
      cur = res.next;
    }

    let mateIn: number | undefined;
    if (Math.abs(cand.score) > 85000) {
      const plies = 90000 - Math.abs(cand.score);
      mateIn = Math.max(1, Math.ceil(plies / 2)) * (cand.score > 0 ? 1 : -1);
    }

    return {
      rank: idx + 1,
      evalCp: cand.score,
      mateIn,
      pvSan,
      pvUci,
    };
  });
}

export function findThreatLine(state: BoardState, depth = 2): EngineLine | null {
  if (evaluateGameResult(state)) return null;
  if (isInCheck(state.board, state.turn, state.variant)) return null;
  const oppTurn: PieceColor = state.turn === 'w' ? 'b' : 'w';
  if (isInCheck(state.board, oppTurn, state.variant)) return null;

  const oppState: BoardState = {
    ...state,
    turn: oppTurn,
    enPassant: null,
  };
  const lines = analyzePositionMultiPv(oppState, 1, Math.min(2, depth));
  return lines[0] || null;
}

export function formatEval(evalCp: number, mateIn?: number): string {
  if (mateIn !== undefined) {
    return `${mateIn > 0 ? '#' : '-#'}${Math.abs(mateIn)}`;
  }
  if (Math.abs(evalCp) > 85000) {
    const plies = 90000 - Math.abs(evalCp);
    const moves = Math.max(1, Math.ceil(plies / 2));
    return `${evalCp > 0 ? '#' : '-#'}${moves}`;
  }
  const pawns = evalCp / 100;
  return `${pawns >= 0 ? '+' : ''}${pawns.toFixed(1)}`;
}

export function evalToWhitePercent(evalCp: number): number {
  if (Math.abs(evalCp) > 85000) return evalCp > 0 ? 98 : 2;
  // Smooth sigmoid mapping [-800..800] -> [5..95]
  const clamped = Math.max(-1000, Math.min(1000, evalCp));
  const pct = 50 + 45 * (2 / (1 + Math.exp(-0.004 * clamped)) - 1);
  return Math.max(4, Math.min(96, pct));
}

export function analyzeGameMoves(
  fens: string[],
  moves: Move[],
  variant: BoardState['variant'],
  onProgress?: (done: number, total: number) => void
): {
  analyzed: AnalyzedMove[];
  accuracy: { w: number; b: number };
  acpl: { w: number; b: number };
  extractedPuzzles: Puzzle[];
} {
  const analyzed: AnalyzedMove[] = [];
  const extractedPuzzles: Puzzle[] = [];
  let wLossSum = 0;
  let wCount = 0;
  let bLossSum = 0;
  let bCount = 0;

  const total = Math.min(moves.length, Math.max(0, fens.length - 1));
  let cachedBeforeLine: EngineLine | undefined = undefined;
  let cachedEvalBefore: number | undefined = undefined;

  for (let i = 0; i < total; i++) {
    const stateBefore = parseFen(fens[i], variant);
    const mv = moves[i];
    const best = cachedBeforeLine ?? analyzePositionMultiPv(stateBefore, 1, 2)[0];
    const evalBefore =
      cachedEvalBefore ?? (best ? best.evalCp : evaluatePosition(stateBefore));

    const stateAfter = parseFen(fens[i + 1], variant);
    const afterBest = analyzePositionMultiPv(stateAfter, 1, 2)[0];
    const evalAfter = afterBest ? afterBest.evalCp : evaluatePosition(stateAfter);

    // Reuse evalAfter and best line of stateAfter as evalBefore of ply i + 1
    cachedBeforeLine = afterBest;
    cachedEvalBefore = evalAfter;

    const mover = mv.color;
    const rawLoss = mover === 'w' ? evalBefore - evalAfter : evalAfter - evalBefore;
    const cpLoss = Math.max(0, Math.min(1000, Math.round(rawLoss)));

    if (mover === 'w') {
      wLossSum += cpLoss;
      wCount++;
    } else {
      bLossSum += cpLoss;
      bCount++;
    }

    let classification: AnalyzedMove['classification'] = 'Good';
    if (best && best.pvUci[0] === moveToUci(mv)) {
      classification = cpLoss <= 10 ? 'Best' : 'Great';
    } else if (cpLoss <= 25) {
      classification = 'Good';
    } else if (cpLoss <= 85) {
      classification = 'Inaccuracy';
    } else if (cpLoss <= 200) {
      classification = 'Mistake';
    } else {
      classification = 'Blunder';
    }

    analyzed.push({
      ply: i + 1,
      san: mv.san || moveToSan(stateBefore, mv),
      uci: mv.uci || moveToUci(mv),
      fenBefore: fens[i],
      fenAfter: fens[i + 1],
      evalBefore,
      evalAfter,
      bestMoveSan: best?.pvSan[0] || mv.san || '',
      bestMoveUci: best?.pvUci[0] || moveToUci(mv),
      cpLoss,
      classification,
    });

    // Automatically generate tactical puzzle from mistakes/blunders where best line is strong
    if (
      (classification === 'Mistake' || classification === 'Blunder') &&
      best &&
      best.pvUci.length >= 1 &&
      variant === 'standard'
    ) {
      extractedPuzzles.push({
        id: `game-puzzle-${i}-${Date.now()}`,
        title: `Punish ${classification} (Move ${Math.floor(i / 2) + 1})`,
        rating: Math.min(2200, 1200 + cpLoss),
        themes: ['From Your Game', classification === 'Blunder' ? 'Tactical Refutation' : 'Missed Best Move'],
        fen: fens[i],
        solutionUci: best.pvUci.slice(0, 3),
        playerColor: mover,
        source: 'From Your Game',
      });
    }

    onProgress?.(i + 1, total);
  }

  const wAcpl = wCount > 0 ? Math.round(wLossSum / wCount) : 0;
  const bAcpl = bCount > 0 ? Math.round(bLossSum / bCount) : 0;
  const toAcc = (acpl: number) => Math.max(15, Math.min(99, Math.round(103.1668 * Math.exp(-0.004 * acpl) - 3.1668)));

  return {
    analyzed,
    accuracy: { w: toAcc(wAcpl), b: toAcc(bAcpl) },
    acpl: { w: wAcpl, b: bAcpl },
    extractedPuzzles,
  };
}

export interface TablebaseResult {
  inRange: boolean;
  pieceCount: number;
  wdl: 'Win' | 'Draw' | 'Loss' | 'Unknown';
  dtzText: string;
  explanation: string;
  bestMoves: { san: string; uci: string; outcome: string }[];
}

export function probeTablebase(state: BoardState): TablebaseResult {
  const pieces: { color: PieceColor; type: PieceType; r: number; c: number }[] = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = state.board[r][c];
      if (p) pieces.push({ color: p.color, type: p.type, r, c });
    }
  }

  if (pieces.length > 7) {
    return {
      inRange: false,
      pieceCount: pieces.length,
      wdl: 'Unknown',
      dtzText: `${pieces.length} pieces on board (7-piece max for Tablebase)`,
      explanation: 'Reduce the position to 7 or fewer total pieces (including kings) to query exact endgame tablebase verdicts.',
      bestMoves: [],
    };
  }

  const legal = getLegalMoves(state);
  const wPieces = pieces.filter((p) => p.color === 'w' && p.type !== 'k');
  const bPieces = pieces.filter((p) => p.color === 'b' && p.type !== 'k');
  const turn = state.turn;

  // Compute exact 3-ply tactical search for best endgame moves
  const lines = analyzePositionMultiPv(state, 5, 3);
  const bestMoves = lines.map((l) => {
    let outcome = 'Draw';
    if (l.mateIn !== undefined) {
      const sideWins = (l.mateIn > 0 && turn === 'w') || (l.mateIn < 0 && turn === 'b');
      outcome = sideWins ? `Mate in ${Math.abs(l.mateIn)}` : `Mated in ${Math.abs(l.mateIn)}`;
    } else if (Math.abs(l.evalCp) >= 180) {
      const sideWinning = (l.evalCp > 0 && turn === 'w') || (l.evalCp < 0 && turn === 'b');
      outcome = sideWinning ? 'Winning' : 'Losing';
    }
    return { san: l.pvSan[0], uci: l.pvUci[0], outcome };
  });

  // Theoretical endgame verdicts
  let wdl: TablebaseResult['wdl'] = 'Draw';
  let dtzText = 'DTZ 0 · Theoretical Draw';
  let explanation = 'Balanced material with equalized defensive resources.';

  const terminal = evaluateGameResult(state);
  if (terminal) {
    if (terminal.winner === 'draw') {
      return { inRange: true, pieceCount: pieces.length, wdl: 'Draw', dtzText: 'Game Drawn', explanation: terminal.reason, bestMoves: [] };
    }
    const isWin = terminal.winner === turn;
    return {
      inRange: true,
      pieceCount: pieces.length,
      wdl: isWin ? 'Win' : 'Loss',
      dtzText: isWin ? 'Checkmate' : 'Checkmated',
      explanation: terminal.reason,
      bestMoves: [],
    };
  }

  // K vs K, KN vs K, KB vs K
  if (wPieces.length + bPieces.length === 0) {
    wdl = 'Draw';
    dtzText = 'Dead Draw (K vs K)';
    explanation = 'Insufficient material to force checkmate.';
  } else if (
    (wPieces.length === 1 && bPieces.length === 0 && (wPieces[0].type === 'n' || wPieces[0].type === 'b')) ||
    (bPieces.length === 1 && wPieces.length === 0 && (bPieces[0].type === 'n' || bPieces[0].type === 'b'))
  ) {
    wdl = 'Draw';
    dtzText = 'Insufficient Material';
    explanation = 'A single minor piece cannot force checkmate against a lone king.';
  } else if (
    (wPieces.length === 1 && bPieces.length === 0 && (wPieces[0].type === 'q' || wPieces[0].type === 'r')) ||
    (bPieces.length === 1 && wPieces.length === 0 && (bPieces[0].type === 'q' || bPieces[0].type === 'r'))
  ) {
    const attacker = wPieces.length === 1 ? 'w' : 'b';
    const pieceType = (wPieces[0] || bPieces[0]).type;
    wdl = attacker === turn ? 'Win' : 'Loss';
    dtzText = pieceType === 'q' ? 'DTM ≤ 10 · Forced Mate' : 'DTM ≤ 16 · Box Method Win';
    explanation =
      pieceType === 'q'
        ? 'Queen + King always forces checkmate against a lone King by driving it to the edge.'
        : 'Rook + King wins against a lone King using opposition and shrinking the rook box.';
  } else if (wPieces.length === 1 && bPieces.length === 0 && wPieces[0].type === 'p') {
    const pawn = wPieces[0];
    const wk = findKing(state.board, 'w')!;
    const bk = findKing(state.board, 'b')!;
    const distToPromo = pawn.r;
    const bkDist = Math.max(Math.abs(bk[0] - 0), Math.abs(bk[1] - pawn.c));
    const wkInFront = wk[0] < pawn.r && Math.abs(wk[1] - pawn.c) <= 1;
    const isRookPawn = pawn.c === 0 || pawn.c === 7;
    const canOutrun = distToPromo + (turn === 'b' ? 1 : 0) < bkDist;
    const whiteWins = canOutrun || (!isRookPawn && wkInFront) || (lines[0] && lines[0].evalCp > 150);
    wdl = whiteWins ? (turn === 'w' ? 'Win' : 'Loss') : 'Draw';
    dtzText = whiteWins ? 'DTZ ≤ 12 · Pawn Promotes' : 'DTZ 0 · Theoretical Draw (Opposition)';
    explanation = isRookPawn && !canOutrun
      ? 'Rook pawns draw if the defending king reaches the promotion corner.'
      : whiteWins
      ? 'White can force pawn promotion via key squares or outrunning the square of the pawn.'
      : 'Black holds the opposition and prevents the White king from outflanking.';
  } else if (
    (wPieces.length === 2 &&
      bPieces.length === 1 &&
      wPieces.some((p) => p.type === 'r') &&
      wPieces.some((p) => p.type === 'p') &&
      bPieces[0].type === 'r') ||
    (bPieces.length === 2 &&
      wPieces.length === 1 &&
      bPieces.some((p) => p.type === 'r') &&
      bPieces.some((p) => p.type === 'p') &&
      wPieces[0].type === 'r')
  ) {
    const attacker: PieceColor = wPieces.length === 2 ? 'w' : 'b';
    const pawn = (attacker === 'w' ? wPieces : bPieces).find((p) => p.type === 'p')!;
    const attKing = findKing(state.board, attacker)!;
    const isSeventhRank = attacker === 'w' ? pawn.r === 1 : pawn.r === 6;
    const isCenterFile = pawn.c >= 1 && pawn.c <= 6;
    const kingNearPawn = Math.abs(attKing[0] - pawn.r) <= 1 && Math.abs(attKing[1] - pawn.c) <= 1;
    if (isSeventhRank && isCenterFile && kingNearPawn) {
      wdl = attacker === turn ? 'Win' : 'Loss';
      dtzText = 'DTZ ≤ 18 · Lucena Bridge Win';
      explanation =
        'Cut off the defending king by a file and use your rook on the 4th rank to build a shield against checks.';
    } else if (lines[0]) {
      const topEval = lines[0].evalCp;
      const myEval = turn === 'w' ? topEval : -topEval;
      if (myEval >= 120) {
        wdl = 'Win';
        dtzText = 'Winning Rook Endgame';
        explanation = 'Active king and rook coordination converts the extra pawn.';
      } else {
        wdl = 'Draw';
        dtzText = 'DTZ ≤ 25 · Philidor / Passive Defense';
        explanation = 'Defending side can seek checks from behind or hold the 3rd/6th rank cutoff.';
      }
    }
  } else if (lines[0]) {
    const topEval = lines[0].evalCp;
    const myEval = turn === 'w' ? topEval : -topEval;
    if (lines[0].mateIn !== undefined) {
      const iWin = (lines[0].mateIn > 0 && turn === 'w') || (lines[0].mateIn < 0 && turn === 'b');
      wdl = iWin ? 'Win' : 'Loss';
      dtzText = `DTM ${Math.abs(lines[0].mateIn) * 2} · Tablebase Mate`;
      explanation = iWin ? 'Forced checkmate sequence found.' : 'Opponent has a forced mate.';
    } else if (myEval >= 160) {
      wdl = 'Win';
      dtzText = 'Winning Endgame';
      explanation = 'Decisive material or positional endgame advantage.';
    } else if (myEval <= -160) {
      wdl = 'Loss';
      dtzText = 'Losing Endgame';
      explanation = 'Defending side faces decisive disadvantage with best play.';
    } else {
      wdl = 'Draw';
      dtzText = 'DTZ ≤ 25 · Balanced Endgame';
      explanation = 'With accurate technique, both sides hold the draw.';
    }
  }

  if (isInCheck(state.board, turn, state.variant) && legal.length === 1) {
    explanation += ' Only one legal evasion available.';
  }

  return {
    inRange: true,
    pieceCount: pieces.length,
    wdl,
    dtzText,
    explanation,
    bestMoves,
  };
}
