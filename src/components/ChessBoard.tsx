import React, { useMemo, useRef, useState } from 'react';
import {
  BoardAnnotation,
  BoardState,
  BoardThemeId,
  Move,
  PieceColor,
  PieceSetId,
  PieceType,
} from '../types/chess';
import {
  coordToSq,
  FILES,
  findKing,
  getLegalMoves,
  isInCheck,
  RANKS,
  sqToCoord,
} from '../engine/chessEngine';
import { ChessPiece } from './ChessPiece';

export const BOARD_THEMES: Record<
  BoardThemeId,
  { name: string; light: string; dark: string; lastMove: string; coordLight: string; coordDark: string }
> = {
  wood: {
    name: 'Classic Maple',
    light: '#f0d9b5',
    dark: '#b58863',
    lastMove: 'rgba(205, 210, 106, 0.55)',
    coordLight: '#916745',
    coordDark: '#f0d9b5',
  },
  green: {
    name: 'Tournament Green',
    light: '#eeeed2',
    dark: '#769656',
    lastMove: 'rgba(246, 246, 105, 0.52)',
    coordLight: '#5a783d',
    coordDark: '#eeeed2',
  },
  blue: {
    name: 'Ocean Slate',
    light: '#dee3e6',
    dark: '#8ca2ad',
    lastMove: 'rgba(130, 196, 232, 0.5)',
    coordLight: '#5e7682',
    coordDark: '#dee3e6',
  },
  walnut: {
    name: 'Dark Walnut',
    light: '#d8c3a5',
    dark: '#7f5539',
    lastMove: 'rgba(219, 175, 86, 0.45)',
    coordLight: '#654028',
    coordDark: '#d8c3a5',
  },
  coral: {
    name: 'Terracotta',
    light: '#f5e6d8',
    dark: '#b86b52',
    lastMove: 'rgba(245, 200, 90, 0.48)',
    coordLight: '#8e4c37',
    coordDark: '#f5e6d8',
  },
  monochrome: {
    name: 'Newspaper Ink',
    light: '#f4f4f5',
    dark: '#71717a',
    lastMove: 'rgba(16, 185, 129, 0.35)',
    coordLight: '#52525b',
    coordDark: '#f4f4f5',
  },
};

interface ChessBoardProps {
  state: BoardState;
  onMove?: (move: Move) => void;
  flipped?: boolean;
  interactive?: boolean;
  allowedColor?: PieceColor | 'both';
  boardTheme?: BoardThemeId;
  pieceSet?: PieceSetId;
  showCoordinates?: boolean;
  highlightLegal?: boolean;
  lastMove?: { from?: [number, number] | null; to: [number, number] } | null;
  targetSquares?: string[]; // For lessons
  suggestedArrows?: { from: string; to: string; color?: string }[];
  annotations?: BoardAnnotation;
  onUpdateAnnotations?: (next: BoardAnnotation) => void;
  allowAnnotations?: boolean;
  maxWidthClass?: string;
}

export const ChessBoard: React.FC<ChessBoardProps> = ({
  state,
  onMove,
  flipped = false,
  interactive = true,
  allowedColor = 'both',
  boardTheme = 'wood',
  pieceSet = 'classic',
  showCoordinates = true,
  highlightLegal = true,
  lastMove = null,
  targetSquares = [],
  suggestedArrows = [],
  annotations,
  onUpdateAnnotations,
  allowAnnotations = false,
  maxWidthClass = 'max-w-[540px]',
}) => {
  const [selectedSq, setSelectedSq] = useState<[number, number] | null>(null);
  const [selectedDrop, setSelectedDrop] = useState<Exclude<PieceType, 'k'> | null>(null);
  const [pendingPromo, setPendingPromo] = useState<{
    from: [number, number];
    to: [number, number];
    candidates: Move[];
  } | null>(null);

  const rightClickStart = useRef<string | null>(null);
  const theme = BOARD_THEMES[boardTheme] || BOARD_THEMES.wood;

  const legalMoves = useMemo(() => {
    if (!interactive) return [];
    if (allowedColor !== 'both' && state.turn !== allowedColor) return [];
    return getLegalMoves(state);
  }, [state, interactive, allowedColor]);

  const checkSq = useMemo(() => {
    if (!isInCheck(state.board, state.turn, state.variant)) return null;
    return findKing(state.board, state.turn);
  }, [state]);

  const movesFromSelected = useMemo(() => {
    if (selectedDrop) {
      return legalMoves.filter((m) => m.isDrop && m.piece === selectedDrop);
    }
    if (!selectedSq) return [];
    return legalMoves.filter(
      (m) => !m.isDrop && m.from && m.from[0] === selectedSq[0] && m.from[1] === selectedSq[1]
    );
  }, [legalMoves, selectedSq, selectedDrop]);

  const tryExecuteMoves = (matching: Move[], from?: [number, number], to?: [number, number]) => {
    if (matching.length === 0) return false;
    if (matching.length === 1) {
      setSelectedSq(null);
      setSelectedDrop(null);
      onMove?.(matching[0]);
      return true;
    }
    // Multiple moves to same target => promotion choices!
    if (from && to) {
      setPendingPromo({ from, to, candidates: matching });
      return true;
    }
    return false;
  };

  const handleSquareClick = (r: number, c: number) => {
    if (!interactive || !onMove) return;
    if (allowedColor !== 'both' && state.turn !== allowedColor) return;

    // 1. If a Crazyhouse drop piece is selected
    if (selectedDrop) {
      const dropMatch = legalMoves.filter(
        (m) => m.isDrop && m.piece === selectedDrop && m.to[0] === r && m.to[1] === c
      );
      if (dropMatch.length > 0) {
        tryExecuteMoves(dropMatch);
        return;
      }
      setSelectedDrop(null);
    }

    // 2. If a board square is already selected, try moving there
    if (selectedSq) {
      if (selectedSq[0] === r && selectedSq[1] === c) {
        setSelectedSq(null);
        return;
      }
      const matching = movesFromSelected.filter((m) => m.to[0] === r && m.to[1] === c);
      if (matching.length > 0) {
        tryExecuteMoves(matching, selectedSq, [r, c]);
        return;
      }
    }

    // 3. Otherwise select piece on this square if it belongs to turn
    const piece = state.board[r][c];
    if (piece && piece.color === state.turn) {
      setSelectedSq([r, c]);
      setSelectedDrop(null);
    } else {
      setSelectedSq(null);
    }
  };

  const handleDragStart = (r: number, c: number, e: React.DragEvent) => {
    if (!interactive) {
      e.preventDefault();
      return;
    }
    if (allowedColor !== 'both' && state.turn !== allowedColor) {
      e.preventDefault();
      return;
    }
    const p = state.board[r][c];
    if (!p || p.color !== state.turn) {
      e.preventDefault();
      return;
    }
    setSelectedSq([r, c]);
    setSelectedDrop(null);
    e.dataTransfer.setData('text/plain', `${r},${c}`);
  };

  const handleDropOnSquare = (r: number, c: number, e: React.DragEvent) => {
    e.preventDefault();
    if (!interactive || !onMove) return;
    const raw = e.dataTransfer.getData('text/plain');
    if (raw.startsWith('drop:')) {
      const pt = raw.slice(5) as Exclude<PieceType, 'k'>;
      const matching = legalMoves.filter(
        (m) => m.isDrop && m.piece === pt && m.to[0] === r && m.to[1] === c
      );
      if (matching.length > 0) {
        tryExecuteMoves(matching);
      }
      return;
    }
    const [fr, fc] = raw.split(',').map((n) => parseInt(n, 10));
    if (isNaN(fr) || isNaN(fc)) return;
    const matching = legalMoves.filter(
      (m) => !m.isDrop && m.from && m.from[0] === fr && m.from[1] === fc && m.to[0] === r && m.to[1] === c
    );
    if (matching.length > 0) {
      tryExecuteMoves(matching, [fr, fc], [r, c]);
    }
  };

  const handleMouseDownRight = (r: number, c: number, e: React.MouseEvent) => {
    if (!allowAnnotations || e.button !== 2) return;
    rightClickStart.current = coordToSq(r, c);
  };

  const handleMouseUpRight = (r: number, c: number, e: React.MouseEvent) => {
    if (!allowAnnotations || e.button !== 2 || !onUpdateAnnotations) return;
    const endSq = coordToSq(r, c);
    const startSq = rightClickStart.current;
    rightClickStart.current = null;
    if (!startSq) return;

    const current = annotations || { arrows: [], squares: [] };
    if (startSq === endSq) {
      const exists = current.squares.some((s) => s.square === endSq);
      const nextSquares = exists
        ? current.squares.filter((s) => s.square !== endSq)
        : [...current.squares, { square: endSq, color: 'rgba(16, 185, 129, 0.55)' }];
      onUpdateAnnotations({ ...current, squares: nextSquares });
    } else {
      const exists = current.arrows.some((a) => a.from === startSq && a.to === endSq);
      const nextArrows = exists
        ? current.arrows.filter((a) => !(a.from === startSq && a.to === endSq))
        : [...current.arrows, { from: startSq, to: endSq, color: '#10b981' }];
      onUpdateAnnotations({ ...current, arrows: nextArrows });
    }
  };

  const displayRows = flipped ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
  const displayCols = flipped ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];

  const getArrowCenterPct = (sq: string) => {
    const [r, c] = sqToCoord(sq);
    const vr = flipped ? 7 - r : r;
    const vc = flipped ? 7 - c : c;
    return { x: vc * 12.5 + 6.25, y: vr * 12.5 + 6.25 };
  };

  const allArrows = [
    ...suggestedArrows.map((a) => ({ from: a.from, to: a.to, color: a.color || '#059669' })),
    ...(annotations?.arrows || []),
  ];

  const renderPocket = (color: PieceColor) => {
    if (state.variant !== 'crazyhouse') return null;
    const pocket = state.pockets[color];
    const types: Exclude<PieceType, 'k'>[] = ['q', 'r', 'b', 'n', 'p'];
    const canPick = interactive && state.turn === color && (allowedColor === 'both' || allowedColor === color);

    return (
      <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-stone-100 dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800">
        <span className="text-xs font-medium text-stone-600 dark:text-zinc-400">
          {color === 'w' ? 'White Pocket' : 'Black Pocket'}
        </span>
        <div className="flex items-center gap-1.5">
          {types.map((pt) => {
            const count = pocket[pt];
            const isSelected = selectedDrop === pt && state.turn === color;
            return (
              <button
                key={pt}
                type="button"
                disabled={!canPick || count === 0}
                draggable={canPick && count > 0}
                onDragStart={(e) => {
                  if (!canPick || count === 0) return;
                  e.dataTransfer.setData('text/plain', `drop:${pt}`);
                  setSelectedDrop(pt);
                  setSelectedSq(null);
                }}
                onClick={() => {
                  if (!canPick || count === 0) return;
                  setSelectedDrop(isSelected ? null : pt);
                  setSelectedSq(null);
                }}
                className={`relative w-8 h-8 rounded flex items-center justify-center transition-all ${
                  count > 0 ? 'opacity-100' : 'opacity-25 cursor-default'
                } ${
                  isSelected
                    ? 'bg-emerald-500/25 ring-2 ring-emerald-500'
                    : canPick && count > 0
                    ? 'hover:bg-stone-200 dark:hover:bg-zinc-800 cursor-pointer'
                    : ''
                }`}
                title={count > 0 ? `Drop ${pt.toUpperCase()} (${count})` : undefined}
              >
                <ChessPiece color={color} type={pt} pieceSet={pieceSet} className="w-6 h-6" />
                {count > 1 && (
                  <span className="absolute -top-1 -right-1 text-[10px] font-mono font-bold bg-stone-800 text-white dark:bg-zinc-100 dark:text-zinc-900 px-1 rounded">
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className={`w-full ${maxWidthClass} flex flex-col gap-1.5 select-none`}>
      {renderPocket(flipped ? 'w' : 'b')}

      <div
        className="relative w-full aspect-square rounded-lg overflow-hidden shadow-md border border-stone-300 dark:border-zinc-700"
        onContextMenu={(e) => {
          if (allowAnnotations) e.preventDefault();
        }}
      >
        <div className="grid grid-cols-8 grid-rows-8 w-full h-full">
          {displayRows.map((r, vrIdx) =>
            displayCols.map((c, vcIdx) => {
              const isLight = (r + c) % 2 === 0;
              const sq = coordToSq(r, c);
              const piece = state.board[r][c];
              const isSelected = selectedSq && selectedSq[0] === r && selectedSq[1] === c;
              const isLast =
                lastMove &&
                ((lastMove.from && lastMove.from[0] === r && lastMove.from[1] === c) ||
                  (lastMove.to[0] === r && lastMove.to[1] === c));
              const isTarget =
                highlightLegal && movesFromSelected.some((m) => m.to[0] === r && m.to[1] === c);
              const isInCheckSq = checkSq && checkSq[0] === r && checkSq[1] === c;
              const isLessonTarget = targetSquares.includes(sq);
              const isKothCenter =
                state.variant === 'kingOfTheHill' && ['d4', 'd5', 'e4', 'e5'].includes(sq);
              const annotatedSq = annotations?.squares.find((s) => s.square === sq);

              return (
                <div
                  key={sq}
                  onClick={() => handleSquareClick(r, c)}
                  onMouseDown={(e) => handleMouseDownRight(r, c, e)}
                  onMouseUp={(e) => handleMouseUpRight(r, c, e)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => handleDropOnSquare(r, c, e)}
                  style={{
                    backgroundColor: isLight ? theme.light : theme.dark,
                  }}
                  className="relative flex items-center justify-center cursor-pointer"
                >
                  {/* Last Move tint */}
                  {isLast && (
                    <div
                      className="absolute inset-0 pointer-events-none"
                      style={{ backgroundColor: theme.lastMove }}
                    />
                  )}

                  {/* Selected square tint */}
                  {isSelected && (
                    <div className="absolute inset-0 bg-emerald-500/40 pointer-events-none" />
                  )}

                  {/* King of the Hill center target */}
                  {isKothCenter && (
                    <div className="absolute inset-1.5 border border-dashed border-amber-700/45 rounded pointer-events-none" />
                  )}

                  {/* Lesson target indicator */}
                  {isLessonTarget && (
                    <div className="absolute inset-1 border-2 border-emerald-500 rounded-md pointer-events-none" />
                  )}

                  {/* User right-click annotation */}
                  {annotatedSq && (
                    <div
                      className="absolute inset-0 pointer-events-none"
                      style={{ backgroundColor: annotatedSq.color }}
                    />
                  )}

                  {/* Check radial glow */}
                  {isInCheckSq && (
                    <div
                      className="absolute inset-0 pointer-events-none"
                      style={{
                        background:
                          'radial-gradient(circle, rgba(220,38,38,0.85) 0%, rgba(220,38,38,0.35) 55%, transparent 78%)',
                      }}
                    />
                  )}

                  {/* Coordinates */}
                  {showCoordinates && vcIdx === 0 && (
                    <span
                      className="absolute top-0.5 left-1 text-[10px] font-mono font-semibold leading-none pointer-events-none"
                      style={{ color: isLight ? theme.coordLight : theme.coordDark }}
                    >
                      {RANKS[r]}
                    </span>
                  )}
                  {showCoordinates && vrIdx === 7 && (
                    <span
                      className="absolute bottom-0.5 right-1 text-[10px] font-mono font-semibold leading-none pointer-events-none"
                      style={{ color: isLight ? theme.coordLight : theme.coordDark }}
                    >
                      {FILES[c]}
                    </span>
                  )}

                  {/* Piece */}
                  {piece && (
                    <div
                      draggable={interactive && (allowedColor === 'both' || allowedColor === state.turn)}
                      onDragStart={(e) => handleDragStart(r, c, e)}
                      className="relative z-10 w-[86%] h-[86%] transition-transform duration-100 active:scale-105"
                    >
                      <ChessPiece color={piece.color} type={piece.type} pieceSet={pieceSet} />
                    </div>
                  )}

                  {/* Legal move indicator */}
                  {isTarget && !piece && (
                    <div className="relative z-20 w-3.5 h-3.5 rounded-full bg-zinc-900/25 pointer-events-none" />
                  )}
                  {isTarget && piece && (
                    <div className="absolute inset-1 z-20 rounded-full border-[3.5px] border-zinc-900/30 pointer-events-none" />
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* SVG Arrow Overlay */}
        {allArrows.length > 0 && (
          <svg
            viewBox="0 0 100 100"
            className="absolute inset-0 w-full h-full pointer-events-none z-20"
          >
            <defs>
              <marker
                id="arrowhead-emerald"
                markerWidth="4"
                markerHeight="4"
                refX="2.5"
                refY="2"
                orient="auto"
              >
                <polygon points="0 0, 4 2, 0 4" fill="#059669" />
              </marker>
              <marker
                id="arrowhead-amber"
                markerWidth="4"
                markerHeight="4"
                refX="2.5"
                refY="2"
                orient="auto"
              >
                <polygon points="0 0, 4 2, 0 4" fill="#d97706" />
              </marker>
            </defs>
            {allArrows.map((arrow, i) => {
              const p1 = getArrowCenterPct(arrow.from);
              const p2 = getArrowCenterPct(arrow.to);
              const dx = p2.x - p1.x;
              const dy = p2.y - p1.y;
              const len = Math.hypot(dx, dy) || 1;
              const endX = p2.x - (dx / len) * 2.2;
              const endY = p2.y - (dy / len) * 2.2;
              const isAmber = arrow.color.includes('d977') || arrow.color.includes('amber');
              return (
                <line
                  key={`${arrow.from}-${arrow.to}-${i}`}
                  x1={p1.x}
                  y1={p1.y}
                  x2={endX}
                  y2={endY}
                  stroke={arrow.color}
                  strokeWidth="1.65"
                  strokeOpacity="0.82"
                  strokeLinecap="round"
                  markerEnd={isAmber ? 'url(#arrowhead-amber)' : 'url(#arrowhead-emerald)'}
                />
              );
            })}
          </svg>
        )}

        {/* Promotion Modal Overlay */}
        {pendingPromo && (
          <div className="absolute inset-0 z-30 bg-zinc-950/55 backdrop-blur-[2px] flex items-center justify-center">
            <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-700 rounded-xl p-3 shadow-xl flex flex-col items-center gap-2">
              <span className="text-xs font-semibold text-stone-700 dark:text-zinc-200">
                Choose Promotion
              </span>
              <div className="flex items-center gap-2">
                {pendingPromo.candidates.map((cand) => (
                  <button
                    key={cand.promotion}
                    type="button"
                    onClick={() => {
                      setPendingPromo(null);
                      setSelectedSq(null);
                      onMove?.(cand);
                    }}
                    className="w-12 h-12 rounded-lg bg-stone-100 dark:bg-zinc-800 hover:bg-emerald-500/20 border border-stone-200 dark:border-zinc-700 flex items-center justify-center transition-colors"
                  >
                    <ChessPiece
                      color={cand.color}
                      type={cand.promotion || 'q'}
                      pieceSet={pieceSet}
                      className="w-9 h-9"
                    />
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setPendingPromo(null)}
                className="text-xs text-stone-500 hover:text-stone-800 dark:text-zinc-400 dark:hover:text-zinc-200 mt-1"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {renderPocket(flipped ? 'b' : 'w')}
    </div>
  );
};
