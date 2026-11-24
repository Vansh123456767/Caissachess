import {
  BoardState,
  CastlingRights,
  ChessVariant,
  CrazyhousePockets,
  GameResult,
  Move,
  Piece,
  PieceColor,
  PieceType,
  VariantInfo,
} from '../types/chess';

export const VARIANTS: VariantInfo[] = [
  {
    id: 'standard',
    name: 'Standard',
    shortDesc: 'Classic FIDE chess rules',
    rules: 'Checkmate the opponent king. Castling, en passant, and pawn promotion apply.',
  },
  {
    id: 'chess960',
    name: 'Chess960',
    shortDesc: 'Fischer Random back-rank',
    rules: '960 randomized starting positions with opposite-colored bishops and king between rooks.',
  },
  {
    id: 'kingOfTheHill',
    name: 'King of the Hill',
    shortDesc: 'Reach the center to win',
    rules: 'Win by checkmate or by safely bringing your King to d4, d5, e4, or e5.',
  },
  {
    id: 'threeCheck',
    name: 'Three-check',
    shortDesc: 'Check the king 3 times',
    rules: 'Win by checkmate or by delivering check three times over the course of the game.',
  },
  {
    id: 'antichess',
    name: 'Antichess',
    shortDesc: 'Lose all your pieces to win',
    rules: 'Captures are mandatory. Kings have no royal power, no castling, and stalemate is a win.',
  },
  {
    id: 'atomic',
    name: 'Atomic',
    shortDesc: 'Explosive captures',
    rules: 'Every capture explodes a 3x3 area, destroying non-pawns. Blow up the enemy king to win.',
  },
  {
    id: 'horde',
    name: 'Horde',
    shortDesc: '36 pawns vs full army',
    rules: 'White commands 36 pawns; Black plays a standard army. White wins by mate; Black by wiping out all pawns.',
  },
  {
    id: 'racingKings',
    name: 'Racing Kings',
    shortDesc: 'Race to the 8th rank',
    rules: 'No checks allowed. First king to reach the 8th rank wins (with equal-turn draw rule).',
  },
  {
    id: 'crazyhouse',
    name: 'Crazyhouse',
    shortDesc: 'Drop captured pieces',
    rules: 'Captured pieces switch allegiance into your reserve pocket and can be dropped onto empty squares.',
  },
];

export const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
export const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'];

export function coordToSq(row: number, col: number): string {
  return `${FILES[col]}${8 - row}`;
}

export function sqToCoord(sq: string): [number, number] {
  const col = FILES.indexOf(sq[0]);
  const row = 8 - parseInt(sq[1], 10);
  return [row, col];
}

export function emptyPockets(): CrazyhousePockets {
  return {
    w: { p: 0, n: 0, b: 0, r: 0, q: 0 },
    b: { p: 0, n: 0, b: 0, r: 0, q: 0 },
  };
}

export function cloneBoard(board: (Piece | null)[][]): (Piece | null)[][] {
  return board.map((r) => r.map((p) => (p ? { ...p } : null)));
}

export function cloneState(state: BoardState): BoardState {
  return {
    board: cloneBoard(state.board),
    turn: state.turn,
    castling: { ...state.castling },
    enPassant: state.enPassant ? [state.enPassant[0], state.enPassant[1]] : null,
    halfmoveClock: state.halfmoveClock,
    fullmoveNumber: state.fullmoveNumber,
    variant: state.variant,
    checksGiven: { ...state.checksGiven },
    pockets: {
      w: { ...state.pockets.w },
      b: { ...state.pockets.b },
    },
    kingStartFile: state.kingStartFile,
  };
}

export function generateChess960BackRank(): PieceType[] {
  const rank: (PieceType | null)[] = Array(8).fill(null);
  const darkSquares = [1, 3, 5, 7];
  const lightSquares = [0, 2, 4, 6];
  rank[darkSquares[Math.floor(Math.random() * 4)]] = 'b';
  rank[lightSquares[Math.floor(Math.random() * 4)]] = 'b';

  const emptyIndices = () => rank.map((v, i) => (v === null ? i : -1)).filter((i) => i !== -1);
  let emp = emptyIndices();
  rank[emp[Math.floor(Math.random() * emp.length)]] = 'q';

  emp = emptyIndices();
  rank[emp[Math.floor(Math.random() * emp.length)]] = 'n';
  emp = emptyIndices();
  rank[emp[Math.floor(Math.random() * emp.length)]] = 'n';

  emp = emptyIndices();
  rank[emp[0]] = 'r';
  rank[emp[1]] = 'k';
  rank[emp[2]] = 'r';
  return rank as PieceType[];
}

export function getInitialFen(variant: ChessVariant): string {
  switch (variant) {
    case 'horde':
      return 'rnbqkbnr/pppppppp/8/1PP2PP1/PPPPPPPP/PPPPPPPP/PPPPPPPP/PPPPPPPP w kq - 0 1';
    case 'racingKings':
      return '8/8/8/8/8/8/krbnNBRK/qrbnNBRQ w - - 0 1';
    case 'chess960': {
      const rank = generateChess960BackRank();
      const lower = rank.join('');
      const upper = lower.toUpperCase();
      return `${lower}/pppppppp/8/8/8/8/PPPPPPPP/${upper} w KQkq - 0 1`;
    }
    default:
      return 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  }
}

export function createInitialState(variant: ChessVariant = 'standard', customFen?: string): BoardState {
  const fen = customFen || getInitialFen(variant);
  return parseFen(fen, variant);
}

export function parseFen(fen: string, variant: ChessVariant = 'standard'): BoardState {
  const parts = fen.trim().split(/\s+/);
  const boardPart = parts[0] || '8/8/8/8/8/8/8/8';
  const turn: PieceColor = parts[1] === 'b' ? 'b' : 'w';
  const castlingStr = parts[2] || '-';
  const epStr = parts[3] || '-';
  const halfmoveClock = parseInt(parts[4] || '0', 10) || 0;
  const fullmoveNumber = parseInt(parts[5] || '1', 10) || 1;

  const board: (Piece | null)[][] = Array.from({ length: 8 }, () => Array(8).fill(null));
  const rows = boardPart.split('/');
  let wKingFile = 4;
  const wRookFiles: number[] = [];
  const bRookFiles: number[] = [];

  for (let r = 0; r < 8 && r < rows.length; r++) {
    let c = 0;
    for (let i = 0; i < rows[r].length && c < 8; i++) {
      const ch = rows[r][i];
      if (ch === '~') {
        if (c > 0 && board[r][c - 1]) {
          board[r][c - 1]!.promoted = true;
        }
        continue;
      }
      if (ch >= '1' && ch <= '8') {
        c += parseInt(ch, 10);
      } else {
        const color: PieceColor = ch === ch.toUpperCase() ? 'w' : 'b';
        const type = ch.toLowerCase() as PieceType;
        if (['p', 'n', 'b', 'r', 'q', 'k'].includes(type)) {
          board[r][c] = { color, type };
          if (r === 7 && color === 'w' && type === 'k') wKingFile = c;
          if (r === 7 && color === 'w' && type === 'r') wRookFiles.push(c);
          if (r === 0 && color === 'b' && type === 'r') bRookFiles.push(c);
        }
        c++;
      }
    }
  }

  const castling: CastlingRights = {
    wK: castlingStr.includes('K'),
    wQ: castlingStr.includes('Q'),
    bK: castlingStr.includes('k'),
    bQ: castlingStr.includes('q'),
    wKingsideRookFile: wRookFiles.filter((f) => f > wKingFile).pop() ?? 7,
    wQueensideRookFile: wRookFiles.filter((f) => f < wKingFile)[0] ?? 0,
    bKingsideRookFile: bRookFiles.filter((f) => f > wKingFile).pop() ?? 7,
    bQueensideRookFile: bRookFiles.filter((f) => f < wKingFile)[0] ?? 0,
  };

  let enPassant: [number, number] | null = null;
  if (epStr !== '-' && epStr.length === 2) {
    const [er, ec] = sqToCoord(epStr);
    if (er >= 0 && er < 8 && ec >= 0 && ec < 8) {
      enPassant = [er, ec];
    }
  }

  return {
    board,
    turn,
    castling,
    enPassant,
    halfmoveClock,
    fullmoveNumber,
    variant,
    checksGiven: { w: 0, b: 0 },
    pockets: emptyPockets(),
    kingStartFile: wKingFile,
  };
}

export function toFen(state: BoardState): string {
  const rows: string[] = [];
  for (let r = 0; r < 8; r++) {
    let rowStr = '';
    let empty = 0;
    for (let c = 0; c < 8; c++) {
      const p = state.board[r][c];
      if (!p) {
        empty++;
      } else {
        if (empty > 0) {
          rowStr += empty;
          empty = 0;
        }
        const ch = p.color === 'w' ? p.type.toUpperCase() : p.type;
        rowStr += ch;
      }
    }
    if (empty > 0) rowStr += empty;
    rows.push(rowStr);
  }
  let castlingStr = '';
  if (state.castling.wK) castlingStr += 'K';
  if (state.castling.wQ) castlingStr += 'Q';
  if (state.castling.bK) castlingStr += 'k';
  if (state.castling.bQ) castlingStr += 'q';
  if (!castlingStr) castlingStr = '-';

  const epStr = state.enPassant ? coordToSq(state.enPassant[0], state.enPassant[1]) : '-';
  return `${rows.join('/')} ${state.turn} ${castlingStr} ${epStr} ${state.halfmoveClock} ${state.fullmoveNumber}`;
}

export function positionKey(state: BoardState): string {
  const fenParts = toFen(state).split(' ');
  const pocketsKey =
    state.variant === 'crazyhouse'
      ? `|${JSON.stringify(state.pockets)}`
      : '';
  return `${fenParts[0]} ${fenParts[1]} ${fenParts[2]} ${fenParts[3]}${pocketsKey}`;
}

function inside(r: number, c: number): boolean {
  return r >= 0 && r < 8 && c >= 0 && c < 8;
}

export function findKing(board: (Piece | null)[][], color: PieceColor): [number, number] | null {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p && p.color === color && p.type === 'k') return [r, c];
    }
  }
  return null;
}

export function kingsAdjacent(board: (Piece | null)[][]): boolean {
  const wk = findKing(board, 'w');
  const bk = findKing(board, 'b');
  if (!wk || !bk) return false;
  return Math.abs(wk[0] - bk[0]) <= 1 && Math.abs(wk[1] - bk[1]) <= 1;
}

export function isSquareAttacked(
  board: (Piece | null)[][],
  targetR: number,
  targetC: number,
  byColor: PieceColor
): boolean {
  // Pawns
  const pawnDir = byColor === 'w' ? 1 : -1;
  for (const dc of [-1, 1]) {
    const pr = targetR + pawnDir;
    const pc = targetC + dc;
    if (inside(pr, pc)) {
      const p = board[pr][pc];
      if (p && p.color === byColor && p.type === 'p') return true;
    }
  }
  // Knights
  const knightOffsets = [
    [-2, -1], [-2, 1], [-1, -2], [-1, 2],
    [1, -2], [1, 2], [2, -1], [2, 1],
  ];
  for (const [dr, dc] of knightOffsets) {
    const nr = targetR + dr;
    const nc = targetC + dc;
    if (inside(nr, nc)) {
      const p = board[nr][nc];
      if (p && p.color === byColor && p.type === 'n') return true;
    }
  }
  // King
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const kr = targetR + dr;
      const kc = targetC + dc;
      if (inside(kr, kc)) {
        const p = board[kr][kc];
        if (p && p.color === byColor && p.type === 'k') return true;
      }
    }
  }
  // Orthogonals (Rook / Queen)
  const ortho = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  for (const [dr, dc] of ortho) {
    let r = targetR + dr;
    let c = targetC + dc;
    while (inside(r, c)) {
      const p = board[r][c];
      if (p) {
        if (p.color === byColor && (p.type === 'r' || p.type === 'q')) return true;
        break;
      }
      r += dr;
      c += dc;
    }
  }
  // Diagonals (Bishop / Queen)
  const diag = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  for (const [dr, dc] of diag) {
    let r = targetR + dr;
    let c = targetC + dc;
    while (inside(r, c)) {
      const p = board[r][c];
      if (p) {
        if (p.color === byColor && (p.type === 'b' || p.type === 'q')) return true;
        break;
      }
      r += dr;
      c += dc;
    }
  }
  return false;
}

export function isInCheck(board: (Piece | null)[][], color: PieceColor, variant: ChessVariant): boolean {
  if (variant === 'antichess') return false;
  const k = findKing(board, color);
  if (!k) return false;
  if (variant === 'atomic' && kingsAdjacent(board)) return false;
  const enemy: PieceColor = color === 'w' ? 'b' : 'w';
  return isSquareAttacked(board, k[0], k[1], enemy);
}

function generatePseudoMoves(state: BoardState): Move[] {
  const moves: Move[] = [];
  const { board, turn, variant, castling, enPassant, pockets } = state;
  const enemy: PieceColor = turn === 'w' ? 'b' : 'w';
  const promoPieces: PieceType[] =
    variant === 'antichess' ? ['q', 'r', 'b', 'n', 'k'] : ['q', 'r', 'b', 'n'];

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p || p.color !== turn) continue;

      if (p.type === 'p') {
        const dir = turn === 'w' ? -1 : 1;
        const startRow = turn === 'w' ? 6 : 1;
        const promoRow = turn === 'w' ? 0 : 7;
        const canDouble = r === startRow || (variant === 'horde' && turn === 'w' && r === 7);

        // Single step
        if (inside(r + dir, c) && !board[r + dir][c]) {
          if (r + dir === promoRow) {
            for (const pr of promoPieces) {
              moves.push({ from: [r, c], to: [r + dir, c], piece: 'p', color: turn, promotion: pr });
            }
          } else {
            moves.push({ from: [r, c], to: [r + dir, c], piece: 'p', color: turn });
            // Double step
            if (canDouble && inside(r + dir * 2, c) && !board[r + dir * 2][c]) {
              moves.push({ from: [r, c], to: [r + dir * 2, c], piece: 'p', color: turn });
            }
          }
        }
        // Captures
        for (const dc of [-1, 1]) {
          const nr = r + dir;
          const nc = c + dc;
          if (!inside(nr, nc)) continue;
          const target = board[nr][nc];
          if (target && target.color === enemy) {
            if (nr === promoRow) {
              for (const pr of promoPieces) {
                moves.push({
                  from: [r, c],
                  to: [nr, nc],
                  piece: 'p',
                  color: turn,
                  captured: target.type,
                  promotion: pr,
                });
              }
            } else {
              moves.push({
                from: [r, c],
                to: [nr, nc],
                piece: 'p',
                color: turn,
                captured: target.type,
              });
            }
          } else if (enPassant && enPassant[0] === nr && enPassant[1] === nc) {
            moves.push({
              from: [r, c],
              to: [nr, nc],
              piece: 'p',
              color: turn,
              captured: 'p',
              isEnPassant: true,
            });
          }
        }
      } else if (p.type === 'n') {
        const offs = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
        for (const [dr, dc] of offs) {
          const nr = r + dr;
          const nc = c + dc;
          if (!inside(nr, nc)) continue;
          const t = board[nr][nc];
          if (!t || t.color === enemy) {
            moves.push({
              from: [r, c],
              to: [nr, nc],
              piece: 'n',
              color: turn,
              captured: t ? t.type : undefined,
            });
          }
        }
      } else if (p.type === 'b' || p.type === 'r' || p.type === 'q') {
        const dirs: [number, number][] = [];
        if (p.type === 'b' || p.type === 'q') dirs.push([-1, -1], [-1, 1], [1, -1], [1, 1]);
        if (p.type === 'r' || p.type === 'q') dirs.push([-1, 0], [1, 0], [0, -1], [0, 1]);
        for (const [dr, dc] of dirs) {
          let nr = r + dr;
          let nc = c + dc;
          while (inside(nr, nc)) {
            const t = board[nr][nc];
            if (!t) {
              moves.push({ from: [r, c], to: [nr, nc], piece: p.type, color: turn });
            } else {
              if (t.color === enemy) {
                moves.push({ from: [r, c], to: [nr, nc], piece: p.type, color: turn, captured: t.type });
              }
              break;
            }
            nr += dr;
            nc += dc;
          }
        }
      } else if (p.type === 'k') {
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const nr = r + dr;
            const nc = c + dc;
            if (!inside(nr, nc)) continue;
            const t = board[nr][nc];
            if (!t || t.color === enemy) {
              if (variant === 'atomic' && t) continue; // Atomic kings cannot capture
              moves.push({
                from: [r, c],
                to: [nr, nc],
                piece: 'k',
                color: turn,
                captured: t ? t.type : undefined,
              });
            }
          }
        }

        // Castling (not allowed in antichess or racingKings)
        if (variant !== 'antichess' && variant !== 'racingKings') {
          const homeRow = turn === 'w' ? 7 : 0;
          if (r === homeRow) {
            // Kingside
            const canK = turn === 'w' ? castling.wK : castling.bK;
            const rookKFile =
              turn === 'w'
                ? (castling.wKingsideRookFile ?? 7)
                : (castling.bKingsideRookFile ?? 7);
            if (canK && board[homeRow][rookKFile]?.type === 'r' && board[homeRow][rookKFile]?.color === turn) {
              if (canCastle(state, r, c, rookKFile, 6, 5)) {
                const destCol = variant === 'chess960' ? 6 : 6;
                moves.push({ from: [r, c], to: [homeRow, destCol], piece: 'k', color: turn, isCastle: 'K' });
              }
            }
            // Queenside
            const canQ = turn === 'w' ? castling.wQ : castling.bQ;
            const rookQFile =
              turn === 'w'
                ? (castling.wQueensideRookFile ?? 0)
                : (castling.bQueensideRookFile ?? 0);
            if (canQ && board[homeRow][rookQFile]?.type === 'r' && board[homeRow][rookQFile]?.color === turn) {
              if (canCastle(state, r, c, rookQFile, 2, 3)) {
                moves.push({ from: [r, c], to: [homeRow, 2], piece: 'k', color: turn, isCastle: 'Q' });
              }
            }
          }
        }
      }
    }
  }

  // Crazyhouse drops
  if (variant === 'crazyhouse') {
    const pocket = pockets[turn];
    const dropTypes: Exclude<PieceType, 'k'>[] = ['p', 'n', 'b', 'r', 'q'];
    for (const dt of dropTypes) {
      if (pocket[dt] <= 0) continue;
      for (let r = 0; r < 8; r++) {
        if (dt === 'p' && (r === 0 || r === 7)) continue;
        for (let c = 0; c < 8; c++) {
          if (!board[r][c]) {
            moves.push({
              from: null,
              to: [r, c],
              piece: dt,
              color: turn,
              isDrop: true,
            });
          }
        }
      }
    }
  }

  return moves;
}

function canCastle(
  state: BoardState,
  row: number,
  kingFile: number,
  rookFile: number,
  kingDestFile: number,
  rookDestFile: number
): boolean {
  const { board, turn, variant } = state;
  const enemy: PieceColor = turn === 'w' ? 'b' : 'w';
  if (isInCheck(board, turn, variant)) return false;

  // All squares between kingFile and kingDestFile, and between rookFile and rookDestFile, must be empty (ignoring king & rook)
  const minK = Math.min(kingFile, kingDestFile);
  const maxK = Math.max(kingFile, kingDestFile);
  for (let c = minK; c <= maxK; c++) {
    if (c !== kingFile && c !== rookFile && board[row][c]) return false;
  }
  const minR = Math.min(rookFile, rookDestFile);
  const maxR = Math.max(rookFile, rookDestFile);
  for (let c = minR; c <= maxR; c++) {
    if (c !== kingFile && c !== rookFile && board[row][c]) return false;
  }

  // King path must not be attacked
  const step = kingDestFile >= kingFile ? 1 : -1;
  for (let c = kingFile; c !== kingDestFile + step; c += step) {
    if (isSquareAttacked(board, row, c, enemy)) return false;
  }
  return true;
}

export function applyMoveRaw(state: BoardState, move: Move): BoardState {
  const next = cloneState(state);
  const { board, variant } = next;
  const enemy: PieceColor = move.color === 'w' ? 'b' : 'w';

  let capturedPiece: Piece | null = null;

  if (move.isDrop) {
    board[move.to[0]][move.to[1]] = { color: move.color, type: move.piece };
    const dt = move.piece as Exclude<PieceType, 'k'>;
    next.pockets[move.color][dt] = Math.max(0, next.pockets[move.color][dt] - 1);
    next.enPassant = null;
    next.halfmoveClock++;
  } else if (move.from) {
    const [fr, fc] = move.from;
    const [tr, tc] = move.to;
    const moving = board[fr][fc]!;

    if (move.isCastle) {
      const homeRow = move.color === 'w' ? 7 : 0;
      const rookFile =
        move.isCastle === 'K'
          ? (move.color === 'w' ? (next.castling.wKingsideRookFile ?? 7) : (next.castling.bKingsideRookFile ?? 7))
          : (move.color === 'w' ? (next.castling.wQueensideRookFile ?? 0) : (next.castling.bQueensideRookFile ?? 0));
      const rook = board[homeRow][rookFile];
      board[fr][fc] = null;
      board[homeRow][rookFile] = null;
      board[homeRow][move.isCastle === 'K' ? 6 : 2] = moving;
      board[homeRow][move.isCastle === 'K' ? 5 : 3] = rook;
      if (move.color === 'w') {
        next.castling.wK = false;
        next.castling.wQ = false;
      } else {
        next.castling.bK = false;
        next.castling.bQ = false;
      }
      next.enPassant = null;
      next.halfmoveClock++;
    } else {
      capturedPiece = board[tr][tc];
      if (move.isEnPassant) {
        const epRow = move.color === 'w' ? tr + 1 : tr - 1;
        capturedPiece = board[epRow][tc];
        board[epRow][tc] = null;
      }

      board[fr][fc] = null;
      if (move.promotion) {
        board[tr][tc] = { color: move.color, type: move.promotion, promoted: true };
      } else {
        board[tr][tc] = moving;
      }

      // Atomic explosion!
      if (variant === 'atomic' && capturedPiece) {
        board[tr][tc] = null;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const er = tr + dr;
            const ec = tc + dc;
            if (inside(er, ec)) {
              const victim = board[er][ec];
              if (victim && victim.type !== 'p') {
                board[er][ec] = null;
              }
            }
          }
        }
      }

      // Crazyhouse capture pocket
      if (variant === 'crazyhouse' && capturedPiece && capturedPiece.type !== 'k') {
        const pocketType: Exclude<PieceType, 'k'> = capturedPiece.promoted
          ? 'p'
          : (capturedPiece.type as Exclude<PieceType, 'k'>);
        next.pockets[move.color][pocketType]++;
      }

      // En passant square
      if (moving.type === 'p' && Math.abs(tr - fr) === 2) {
        next.enPassant = [(fr + tr) / 2, fc];
      } else {
        next.enPassant = null;
      }

      // Halfmove clock
      if (moving.type === 'p' || capturedPiece) {
        next.halfmoveClock = 0;
      } else {
        next.halfmoveClock++;
      }

      // Update castling rights
      if (moving.type === 'k') {
        if (move.color === 'w') {
          next.castling.wK = false;
          next.castling.wQ = false;
        } else {
          next.castling.bK = false;
          next.castling.bQ = false;
        }
      }
      if (moving.type === 'r') {
        if (move.color === 'w' && fr === 7) {
          if (fc === (next.castling.wKingsideRookFile ?? 7)) next.castling.wK = false;
          if (fc === (next.castling.wQueensideRookFile ?? 0)) next.castling.wQ = false;
        }
        if (move.color === 'b' && fr === 0) {
          if (fc === (next.castling.bKingsideRookFile ?? 7)) next.castling.bK = false;
          if (fc === (next.castling.bQueensideRookFile ?? 0)) next.castling.bQ = false;
        }
      }
      // If a rook is captured on its home square
      if (tr === 7 && tc === (next.castling.wKingsideRookFile ?? 7)) next.castling.wK = false;
      if (tr === 7 && tc === (next.castling.wQueensideRookFile ?? 0)) next.castling.wQ = false;
      if (tr === 0 && tc === (next.castling.bKingsideRookFile ?? 7)) next.castling.bK = false;
      if (tr === 0 && tc === (next.castling.bQueensideRookFile ?? 0)) next.castling.bQ = false;
    }
  }

  // Three-check counter
  if (variant === 'threeCheck' && isInCheck(next.board, enemy, variant)) {
    next.checksGiven[move.color]++;
  }

  if (move.color === 'b') {
    next.fullmoveNumber++;
  }
  next.turn = enemy;
  return next;
}

export function getLegalMoves(state: BoardState): Move[] {
  const pseudo = generatePseudoMoves(state);
  const { variant, turn } = state;
  const enemy: PieceColor = turn === 'w' ? 'b' : 'w';

  if (variant === 'antichess') {
    const captures = pseudo.filter((m) => !!m.captured);
    return captures.length > 0 ? captures : pseudo;
  }

  const legal: Move[] = [];
  for (const m of pseudo) {
    const next = applyMoveRaw(state, m);

    if (variant === 'atomic') {
      const myKing = findKing(next.board, turn);
      if (!myKing) continue; // Cannot blow up own king
      const oppKing = findKing(next.board, enemy);
      if (!oppKing) {
        legal.push(m); // Blew up opponent king = instant win
        continue;
      }
      if (kingsAdjacent(next.board)) {
        legal.push(m); // Adjacent kings are immune to check in atomic
        continue;
      }
      if (!isInCheck(next.board, turn, variant)) {
        legal.push(m);
      }
      continue;
    }

    if (variant === 'racingKings') {
      // Neither side may be in check!
      if (isInCheck(next.board, turn, variant) || isInCheck(next.board, enemy, variant)) {
        continue;
      }
      legal.push(m);
      continue;
    }

    if (variant === 'horde' && turn === 'w') {
      // White has no king in Horde
      legal.push(m);
      continue;
    }

    if (!isInCheck(next.board, turn, variant)) {
      legal.push(m);
    }
  }
  return legal;
}

export function moveToUci(m: Move): string {
  if (m.isDrop) {
    return `${m.piece.toUpperCase()}@${coordToSq(m.to[0], m.to[1])}`;
  }
  const fromSq = coordToSq(m.from![0], m.from![1]);
  const toSq = coordToSq(m.to[0], m.to[1]);
  return `${fromSq}${toSq}${m.promotion || ''}`;
}

export function moveToSan(state: BoardState, move: Move, allLegal?: Move[]): string {
  if (move.san) return move.san;
  const legal = allLegal || getLegalMoves(state);

  let san = '';
  if (move.isDrop) {
    const pieceChar = move.piece === 'p' ? '' : move.piece.toUpperCase();
    san = `${pieceChar}@${coordToSq(move.to[0], move.to[1])}`;
  } else if (move.isCastle) {
    san = move.isCastle === 'K' ? 'O-O' : 'O-O-O';
  } else {
    const dest = coordToSq(move.to[0], move.to[1]);
    if (move.piece === 'p') {
      if (move.captured) {
        san = `${FILES[move.from![1]]}x${dest}`;
      } else {
        san = dest;
      }
      if (move.promotion) {
        san += `=${move.promotion.toUpperCase()}`;
      }
    } else {
      const pChar = move.piece.toUpperCase();
      // Disambiguation
      const others = legal.filter(
        (m) =>
          !m.isDrop &&
          m.piece === move.piece &&
          m.to[0] === move.to[0] &&
          m.to[1] === move.to[1] &&
          (m.from![0] !== move.from![0] || m.from![1] !== move.from![1])
      );
      let disambig = '';
      if (others.length > 0) {
        const sameFile = others.some((m) => m.from![1] === move.from![1]);
        const sameRank = others.some((m) => m.from![0] === move.from![0]);
        if (!sameFile) {
          disambig = FILES[move.from![1]];
        } else if (!sameRank) {
          disambig = RANKS[move.from![0]];
        } else {
          disambig = coordToSq(move.from![0], move.from![1]);
        }
      }
      san = `${pChar}${disambig}${move.captured ? 'x' : ''}${dest}`;
    }
  }

  const next = applyMoveRaw(state, move);
  const opp: PieceColor = move.color === 'w' ? 'b' : 'w';
  if (state.variant !== 'antichess' && isInCheck(next.board, opp, state.variant)) {
    const oppMoves = getLegalMoves(next);
    san += oppMoves.length === 0 ? '#' : '+';
  }
  return san;
}

export function makeMove(state: BoardState, move: Move): { next: BoardState; san: string; uci: string } {
  const san = moveToSan(state, move);
  const uci = moveToUci(move);
  const next = applyMoveRaw(state, move);
  return { next, san, uci };
}

export function sanToMove(state: BoardState, sanInput: string): Move | null {
  const clean = sanInput.replace(/[+#?!]+$/g, '').trim();
  const legal = getLegalMoves(state);
  for (const m of legal) {
    const mSan = moveToSan(state, m, legal).replace(/[+#?!]+$/g, '');
    if (mSan === clean) {
      return { ...m, san: moveToSan(state, m, legal), uci: moveToUci(m) };
    }
  }
  // Fallback for UCI input
  for (const m of legal) {
    if (moveToUci(m) === clean.toLowerCase()) {
      return { ...m, san: moveToSan(state, m, legal), uci: moveToUci(m) };
    }
  }
  return null;
}

export function uciToMove(state: BoardState, uci: string): Move | null {
  const legal = getLegalMoves(state);
  for (const m of legal) {
    if (moveToUci(m).toLowerCase() === uci.toLowerCase()) {
      return { ...m, san: moveToSan(state, m, legal), uci: moveToUci(m) };
    }
  }
  return null;
}

export function hasInsufficientMaterial(state: BoardState): boolean {
  if (state.variant !== 'standard' && state.variant !== 'chess960') return false;
  const pieces: { color: PieceColor; type: PieceType; sqColor: number }[] = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = state.board[r][c];
      if (p && p.type !== 'k') {
        pieces.push({ color: p.color, type: p.type, sqColor: (r + c) % 2 });
      }
    }
  }
  if (pieces.length === 0) return true;
  if (pieces.length === 1 && (pieces[0].type === 'n' || pieces[0].type === 'b')) return true;
  if (
    pieces.length === 2 &&
    pieces[0].type === 'b' &&
    pieces[1].type === 'b' &&
    pieces[0].sqColor === pieces[1].sqColor
  ) {
    return true;
  }
  return false;
}

export function evaluateGameResult(
  state: BoardState,
  historyKeys?: string[]
): GameResult | null {
  const { variant, board, turn, checksGiven } = state;

  // Variant instant win checks
  if (variant === 'atomic') {
    const wk = findKing(board, 'w');
    const bk = findKing(board, 'b');
    if (!bk) return { status: 'variant_win', winner: 'w', reason: 'Black king exploded' };
    if (!wk) return { status: 'variant_win', winner: 'b', reason: 'White king exploded' };
  }

  if (variant === 'kingOfTheHill') {
    const center = ['d4', 'd5', 'e4', 'e5'];
    const wk = findKing(board, 'w');
    const bk = findKing(board, 'b');
    if (wk && center.includes(coordToSq(wk[0], wk[1]))) {
      return { status: 'variant_win', winner: 'w', reason: 'White reached the center hill' };
    }
    if (bk && center.includes(coordToSq(bk[0], bk[1]))) {
      return { status: 'variant_win', winner: 'b', reason: 'Black reached the center hill' };
    }
  }

  if (variant === 'threeCheck') {
    if (checksGiven.w >= 3) {
      return { status: 'variant_win', winner: 'w', reason: 'White delivered 3 checks' };
    }
    if (checksGiven.b >= 3) {
      return { status: 'variant_win', winner: 'b', reason: 'Black delivered 3 checks' };
    }
  }

  if (variant === 'horde') {
    let whitePieces = 0;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (board[r][c]?.color === 'w') whitePieces++;
      }
    }
    if (whitePieces === 0) {
      return { status: 'variant_win', winner: 'b', reason: 'All White horde pieces eliminated' };
    }
  }

  if (variant === 'antichess') {
    let wCount = 0;
    let bCount = 0;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (board[r][c]?.color === 'w') wCount++;
        if (board[r][c]?.color === 'b') bCount++;
      }
    }
    if (wCount === 0) return { status: 'variant_win', winner: 'w', reason: 'White lost all pieces' };
    if (bCount === 0) return { status: 'variant_win', winner: 'b', reason: 'Black lost all pieces' };
  }

  if (variant === 'racingKings') {
    const wk = findKing(board, 'w');
    const bk = findKing(board, 'b');
    const wOn8 = wk && wk[0] === 0;
    const bOn8 = bk && bk[0] === 0;
    if (wOn8 && bOn8) {
      return { status: 'draw_agreement', winner: 'draw', reason: 'Both kings reached the 8th rank' };
    }
    if (bOn8) {
      return { status: 'variant_win', winner: 'b', reason: 'Black king reached the 8th rank' };
    }
    // White reached 8th rank: if Black is not able to reach on this reply, White wins; if turn === 'w', Black already played!
    if (wOn8 && turn === 'w') {
      return { status: 'variant_win', winner: 'w', reason: 'White king reached the 8th rank' };
    }
    if (wOn8 && turn === 'b') {
      // Check if Black has any move to rank 8
      const bMoves = getLegalMoves(state);
      const canReach = bMoves.some((m) => m.piece === 'k' && m.to[0] === 0);
      if (!canReach) {
        return { status: 'variant_win', winner: 'w', reason: 'White king reached the 8th rank' };
      }
    }
  }

  const legal = getLegalMoves(state);
  if (legal.length === 0) {
    if (variant === 'antichess') {
      return { status: 'variant_win', winner: turn, reason: `${turn === 'w' ? 'White' : 'Black'} stalemated (wins Antichess)` };
    }
    if (isInCheck(board, turn, variant)) {
      const winner: PieceColor = turn === 'w' ? 'b' : 'w';
      return {
        status: 'checkmate',
        winner,
        reason: `Checkmate — ${winner === 'w' ? 'White' : 'Black'} wins`,
      };
    }
    return { status: 'stalemate', winner: 'draw', reason: 'Draw by stalemate' };
  }

  if (state.halfmoveClock >= 100) {
    return { status: 'draw_50move', winner: 'draw', reason: 'Draw by 50-move rule' };
  }

  if (hasInsufficientMaterial(state)) {
    return { status: 'draw_insufficient', winner: 'draw', reason: 'Draw by insufficient material' };
  }

  if (historyKeys && historyKeys.length >= 5) {
    const current = positionKey(state);
    const matches = historyKeys.filter((k) => k === current).length;
    if (matches >= 3) {
      return { status: 'draw_repetition', winner: 'draw', reason: 'Draw by threefold repetition' };
    }
  }

  return null;
}

export function exportPgn(params: {
  white?: string;
  black?: string;
  variant?: ChessVariant;
  result?: string;
  event?: string;
  initialFen?: string;
  moves: Move[];
}): string {
  const headers: string[] = [
    `[Event "${params.event || 'Caissa Chess Game'}"]`,
    `[Site "Caissa"]`,
    `[Date "${new Date().toISOString().slice(0, 10)}"]`,
    `[White "${params.white || 'White'}"]`,
    `[Black "${params.black || 'Black'}"]`,
    `[Result "${params.result || '*'}"]`,
  ];
  if (params.variant && params.variant !== 'standard') {
    headers.push(`[Variant "${params.variant}"]`);
  }
  if (params.initialFen) {
    headers.push(`[FEN "${params.initialFen}"]`);
    headers.push(`[SetUp "1"]`);
  }

  const tokens: string[] = [];
  params.moves.forEach((m, idx) => {
    if (idx % 2 === 0) {
      tokens.push(`${Math.floor(idx / 2) + 1}.`);
    }
    tokens.push(m.san || moveToUci(m));
  });
  tokens.push(params.result || '*');

  return `${headers.join('\n')}\n\n${tokens.join(' ')}`;
}

export function parsePgn(pgnText: string): {
  headers: Record<string, string>;
  variant: ChessVariant;
  initialFen?: string;
  moves: Move[];
  fens: string[];
  result: string;
} {
  const headers: Record<string, string> = {};
  const headerRegex = /\[(\w+)\s+"([^"]*)"\]/g;
  let match: RegExpExecArray | null;
  while ((match = headerRegex.exec(pgnText)) !== null) {
    headers[match[1]] = match[2];
  }

  let variant: ChessVariant = 'standard';
  if (headers['Variant']) {
    const vLower = headers['Variant'].toLowerCase();
    const found = VARIANTS.find(
      (v) => v.id.toLowerCase() === vLower || v.name.toLowerCase() === vLower
    );
    if (found) variant = found.id;
  }

  const initialFen = headers['FEN'];
  let state = createInitialState(variant, initialFen);
  const fens: string[] = [toFen(state)];
  const moves: Move[] = [];

  // Strip headers, comments, NAGs, and nested variations
  let body = pgnText.replace(/\[[^\]]*\]/g, ' ');
  body = body.replace(/\{[^}]*\}/g, ' ');
  body = body.replace(/\([^)]*\)/g, ' ');
  body = body.replace(/\$\d+/g, ' ');

  const rawTokens = body.split(/\s+/).filter(Boolean);
  let result = headers['Result'] || '*';

  for (const tok of rawTokens) {
    if (['1-0', '0-1', '1/2-1/2', '*'].includes(tok)) {
      result = tok;
      continue;
    }
    if (/^\d+\.+$/.test(tok)) continue;
    const cleanTok = tok.replace(/^\d+\.+/, '');
    if (!cleanTok) continue;
    const mv = sanToMove(state, cleanTok);
    if (mv) {
      const res = makeMove(state, mv);
      moves.push({ ...mv, san: res.san, uci: res.uci });
      state = res.next;
      fens.push(toFen(state));
    }
  }

  return { headers, variant, initialFen, moves, fens, result };
}
