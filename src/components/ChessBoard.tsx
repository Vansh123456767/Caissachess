import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BoardAnnotation,
  BoardState,
  BoardThemeId,
  Move,
  MoveMethodId,
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
  moveToSan,
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
  emerald: {
    name: 'Emerald Marble',
    light: '#e2f1e7',
    dark: '#2c6e49',
    lastMove: 'rgba(250, 204, 21, 0.45)',
    coordLight: '#1e4d33',
    coordDark: '#e2f1e7',
  },
  midnight: {
    name: 'Midnight Neon',
    light: '#273248',
    dark: '#141a29',
    lastMove: 'rgba(56, 189, 248, 0.4)',
    coordLight: '#94a3b8',
    coordDark: '#cbd5e1',
  },
  rosewood: {
    name: 'Tournament Rosewood',
    light: '#f3dccb',
    dark: '#8d3b32',
    lastMove: 'rgba(251, 191, 36, 0.45)',
    coordLight: '#6b2720',
    coordDark: '#f3dccb',
  },
  glass: {
    name: 'Minimalist Glass',
    light: '#f8fafc',
    dark: '#cbd5e1',
    lastMove: 'rgba(16, 185, 129, 0.35)',
    coordLight: '#64748b',
    coordDark: '#334155',
  },
};

export interface QueuedPremove {
  from: [number, number];
  to: [number, number];
}

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
  showLastMove?: boolean;
  pieceScale?: 'normal' | 'large';
  autoQueen?: boolean;
  confirmMove?: boolean;
  moveMethod?: MoveMethodId;
  blindfold?: boolean;
  premove?: QueuedPremove | null;
  onPremoveSet?: (next: QueuedPremove | null) => void;
  premoveQueue?: QueuedPremove[];
  onPremoveQueueChange?: (next: QueuedPremove[]) => void;
  lastMove?: { from?: [number, number] | null; to: [number, number] } | null;
  targetSquares?: string[]; // For lessons
  suggestedArrows?: { from: string; to: string; color?: string }[];
  annotations?: BoardAnnotation;
  onUpdateAnnotations?: (next: BoardAnnotation) => void;
  allowAnnotations?: boolean;
  maxWidthClass?: string;
  fogVisibleSquares?: Set<string> | null;
  duckSquare?: string | null;
  awaitingDuckPlacement?: boolean;
  onDuckPlace?: (sq: string) => void;
  restrictedPieceType?: PieceType | null;
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
  showLastMove = true,
  pieceScale = 'normal',
  autoQueen = false,
  confirmMove = false,
  moveMethod = 'both',
  blindfold = false,
  premove = null,
  onPremoveSet,
  premoveQueue,
  onPremoveQueueChange,
  lastMove = null,
  targetSquares = [],
  suggestedArrows = [],
  annotations,
  onUpdateAnnotations,
  allowAnnotations = false,
  maxWidthClass = 'max-w-[540px]',
  fogVisibleSquares = null,
  duckSquare = null,
  awaitingDuckPlacement = false,
  onDuckPlace,
  restrictedPieceType = null,
}) => {
  const [selectedSq, setSelectedSq] = useState<[number, number] | null>(null);
  const [selectedDrop, setSelectedDrop] = useState<Exclude<PieceType, 'k'> | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<{ move: Move; san: string } | null>(null);
  const [pendingPromo, setPendingPromo] = useState<{
    from: [number, number];
    to: [number, number];
    candidates: Move[];
  } | null>(null);

  useEffect(() => {
    setSelectedSq(null);
    setSelectedDrop(null);
    setPendingConfirm(null);
  }, [state.turn, state.fullmoveNumber]);

  const rightClickStart = useRef<string | null>(null);
  const theme = BOARD_THEMES[boardTheme] || BOARD_THEMES.wood;

  const legalMoves = useMemo(() => {
    if (!interactive || awaitingDuckPlacement) return [];
    if (allowedColor !== 'both' && state.turn !== allowedColor) return [];
    const base = getLegalMoves(state);
    return base.filter((m) => {
      if (restrictedPieceType && m.piece !== restrictedPieceType) return false;
      if (duckSquare) {
        const destSq = coordToSq(m.to[0], m.to[1]);
        if (destSq === duckSquare) return false;
      }
      return true;
    });
  }, [state, interactive, allowedColor, awaitingDuckPlacement, restrictedPieceType, duckSquare]);

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

  const canPremoveNow =
    interactive &&
    allowedColor !== 'both' &&
    state.turn !== allowedColor &&
    (!!onPremoveSet || !!onPremoveQueueChange);

  const effectivePremoveQueue = useMemo(() => {
    if (premoveQueue) return premoveQueue;
    return premove ? [premove] : [];
  }, [premoveQueue, premove]);

  const queuePremove = (item: QueuedPremove) => {
    if (onPremoveQueueChange) {
      onPremoveQueueChange([...effectivePremoveQueue.slice(-4), item]);
    } else {
      onPremoveSet?.(item);
    }
  };

  const clearPremoves = () => {
    if (onPremoveQueueChange) onPremoveQueueChange([]);
    onPremoveSet?.(null);
  };

  const dispatchOrConfirmMove = (mv: Move) => {
    setSelectedSq(null);
    setSelectedDrop(null);
    if (confirmMove) {
      const san = moveToSan(state, mv, legalMoves);
      setPendingConfirm({ move: mv, san });
    } else {
      onMove?.(mv);
    }
  };

  const tryExecuteMoves = (matching: Move[], from?: [number, number], to?: [number, number]) => {
    if (matching.length === 0) return false;
    if (matching.length === 1) {
      dispatchOrConfirmMove(matching[0]);
      return true;
    }
    if (autoQueen) {
      const queenMove = matching.find((m) => m.promotion === 'q') || matching[0];
      dispatchOrConfirmMove(queenMove);
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
    if (!interactive) return;
    if (awaitingDuckPlacement && onDuckPlace) {
      const sq = coordToSq(r, c);
      if (!state.board[r][c] && sq !== duckSquare) {
        onDuckPlace(sq);
      }
      return;
    }
    if (moveMethod === 'drag') return;
    if (pendingConfirm) return;

    // Handle Premove Selection when waiting for opponent
    if (canPremoveNow) {
      const piece = state.board[r][c];
      if (selectedSq) {
        if (selectedSq[0] === r && selectedSq[1] === c) {
          setSelectedSq(null);
          clearPremoves();
          return;
        }
        queuePremove({ from: selectedSq, to: [r, c] });
        setSelectedSq(null);
        return;
      }
      const queuedFromHere = effectivePremoveQueue.some(
        (pq) => pq.to[0] === r && pq.to[1] === c
      );
      if ((piece && piece.color === allowedColor) || queuedFromHere) {
        setSelectedSq([r, c]);
      } else {
        clearPremoves();
      }
      return;
    }

    if (!onMove) return;
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
    if (
      piece &&
      piece.color === state.turn &&
      (!restrictedPieceType || piece.type === restrictedPieceType)
    ) {
      setSelectedSq([r, c]);
      setSelectedDrop(null);
    } else {
      setSelectedSq(null);
    }
  };

  const handleDragStart = (r: number, c: number, e: React.DragEvent) => {
    if (!interactive || awaitingDuckPlacement || moveMethod === 'click' || pendingConfirm) {
      e.preventDefault();
      return;
    }
    const p = state.board[r][c];
    if (canPremoveNow) {
      if (!p || p.color !== allowedColor) {
        e.preventDefault();
        return;
      }
      setSelectedSq([r, c]);
      setSelectedDrop(null);
      e.dataTransfer.setData('text/plain', `${r},${c}`);
      return;
    }
    if (allowedColor !== 'both' && state.turn !== allowedColor) {
      e.preventDefault();
      return;
    }
    if (!p || p.color !== state.turn || (restrictedPieceType && p.type !== restrictedPieceType)) {
      e.preventDefault();
      return;
    }
    setSelectedSq([r, c]);
    setSelectedDrop(null);
    e.dataTransfer.setData('text/plain', `${r},${c}`);
  };

  const handleDropOnSquare = (r: number, c: number, e: React.DragEvent) => {
    e.preventDefault();
    if (!interactive || moveMethod === 'click' || pendingConfirm) return;
    const raw = e.dataTransfer.getData('text/plain');
    if (canPremoveNow) {
      const [fr, fc] = raw.split(',').map((n) => parseInt(n, 10));
      if (!isNaN(fr) && !isNaN(fc) && (fr !== r || fc !== c)) {
        queuePremove({ from: [fr, fc], to: [r, c] });
      }
      setSelectedSq(null);
      return;
    }
    if (!onMove) return;
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
    if (e.button === 2 && canPremoveNow && effectivePremoveQueue.length > 0) {
      clearPremoves();
      setSelectedSq(null);
      return;
    }
    if (!allowAnnotations || e.button !== 2) return;
    rightClickStart.current = coordToSq(r, c);
  };

  const handleMouseUpRight = (r: number, c: number, e: React.MouseEvent) => {
    if (!allowAnnotations || e.button !== 2 || !onUpdateAnnotations) return;
    const endSq = coordToSq(r, c);
    const startSq = rightClickStart.current;
    rightClickStart.current = null;
    if (!startSq) return;

    // Lichess 4-color brushes: Shift=Red, Alt=Blue, Shift+Alt=Yellow, Plain=Green
    const brushArrow =
      e.shiftKey && e.altKey
        ? '#f59e0b'
        : e.shiftKey
        ? '#ef4444'
        : e.altKey
        ? '#3b82f6'
        : '#10b981';
    const brushSquare =
      e.shiftKey && e.altKey
        ? 'rgba(245, 158, 11, 0.52)'
        : e.shiftKey
        ? 'rgba(239, 68, 68, 0.52)'
        : e.altKey
        ? 'rgba(59, 130, 246, 0.52)'
        : 'rgba(16, 185, 129, 0.52)';

    const current = annotations || { arrows: [], squares: [] };
    if (startSq === endSq) {
      const exists = current.squares.some((s) => s.square === endSq);
      const nextSquares = exists
        ? current.squares.filter((s) => s.square !== endSq)
        : [...current.squares, { square: endSq, color: brushSquare }];
      onUpdateAnnotations({ ...current, squares: nextSquares });
    } else {
      const exists = current.arrows.some((a) => a.from === startSq && a.to === endSq);
      const nextArrows = exists
        ? current.arrows.filter((a) => !(a.from === startSq && a.to === endSq))
        : [...current.arrows, { from: startSq, to: endSq, color: brushArrow }];
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
          if (allowAnnotations || canPremoveNow) e.preventDefault();
        }}
      >
        <div className="grid grid-cols-8 grid-rows-8 w-full h-full">
          {displayRows.map((r, vrIdx) =>
            displayCols.map((c, vcIdx) => {
              const isLight = (r + c) % 2 === 0;
              const sq = coordToSq(r, c);
              const piece = state.board[r][c];
              const isSelected = selectedSq && selectedSq[0] === r && selectedSq[1] === c;
              const premoveIdx = effectivePremoveQueue.findIndex(
                (pq) =>
                  (pq.from[0] === r && pq.from[1] === c) ||
                  (pq.to[0] === r && pq.to[1] === c)
              );
              const isPremoveSq = premoveIdx >= 0;
              const isLast =
                showLastMove &&
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
              const isFogHidden = fogVisibleSquares !== null && !fogVisibleSquares.has(sq);
              const isDuckSq = duckSquare === sq;
              const canDropDuckHere = awaitingDuckPlacement && !piece && !isDuckSq;

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
                  {isLast && !isFogHidden && (
                    <div
                      className="absolute inset-0 pointer-events-none"
                      style={{ backgroundColor: theme.lastMove }}
                    />
                  )}

                  {/* Queued Premove tint */}
                  {isPremoveSq && (
                    <div className="absolute inset-0 bg-sky-500/40 pointer-events-none" />
                  )}

                  {/* Selected square tint */}
                  {isSelected && (
                    <div className="absolute inset-0 bg-emerald-500/40 pointer-events-none" />
                  )}

                  {/* Duck Placement Prompt */}
                  {canDropDuckHere && (
                    <div className="absolute inset-1.5 rounded-full border border-dashed border-amber-500/70 bg-amber-400/15 hover:bg-amber-400/35 transition-colors pointer-events-none" />
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
                  {isInCheckSq && !isFogHidden && (
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
                      className="absolute top-0.5 left-1 text-[10px] font-mono font-semibold leading-none pointer-events-none z-20"
                      style={{ color: isLight ? theme.coordLight : theme.coordDark }}
                    >
                      {RANKS[r]}
                    </span>
                  )}
                  {showCoordinates && vrIdx === 7 && (
                    <span
                      className="absolute bottom-0.5 right-1 text-[10px] font-mono font-semibold leading-none pointer-events-none z-20"
                      style={{ color: isLight ? theme.coordLight : theme.coordDark }}
                    >
                      {FILES[c]}
                    </span>
                  )}

                  {/* Piece */}
                  {piece && !blindfold && !isFogHidden && (
                    <div
                      draggable={
                        interactive &&
                        !awaitingDuckPlacement &&
                        moveMethod !== 'click' &&
                        !pendingConfirm &&
                        (!restrictedPieceType || piece.type === restrictedPieceType) &&
                        (allowedColor === 'both' || allowedColor === state.turn || canPremoveNow)
                      }
                      onDragStart={(e) => handleDragStart(r, c, e)}
                      className={`relative z-10 transition-transform duration-100 active:scale-105 ${
                        pieceScale === 'large' ? 'w-[94%] h-[94%]' : 'w-[86%] h-[86%]'
                      }`}
                    >
                      <ChessPiece color={piece.color} type={piece.type} pieceSet={pieceSet} />
                    </div>
                  )}

                  {/* Duck Blocker Piece */}
                  {isDuckSq && !isFogHidden && (
                    <div
                      className="relative z-10 w-[78%] h-[78%] flex items-center justify-center pointer-events-none drop-shadow-sm"
                      title="Duck (blocks movement & captures)"
                    >
                      <svg viewBox="0 0 64 64" className="w-full h-full">
                        <circle cx="34" cy="40" r="16" fill="#fbbf24" stroke="#92400e" strokeWidth="3" />
                        <circle cx="24" cy="22" r="11" fill="#fcd34d" stroke="#92400e" strokeWidth="3" />
                        <path d="M13 21 L5 24 L14 27 Z" fill="#f97316" stroke="#92400e" strokeWidth="2" />
                        <circle cx="21" cy="20" r="2" fill="#1c1917" />
                        <path d="M29 37 Q38 34 45 41 Q38 45 29 41 Z" fill="#f59e0b" />
                      </svg>
                    </div>
                  )}

                  {/* Fog of War Mist */}
                  {isFogHidden && (
                    <div
                      className="absolute inset-0 z-15 bg-zinc-950/88 backdrop-blur-[2px] flex items-center justify-center pointer-events-none border border-zinc-900/40"
                      title="Hidden in Fog of War"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-zinc-700/60" />
                    </div>
                  )}

                  {/* Legal move indicator */}
                  {isTarget && !piece && !isDuckSq && (
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
                <polygon points="0 0, 4 2, 0 4" fill="#f59e0b" />
              </marker>
              <marker
                id="arrowhead-red"
                markerWidth="4"
                markerHeight="4"
                refX="2.5"
                refY="2"
                orient="auto"
              >
                <polygon points="0 0, 4 2, 0 4" fill="#ef4444" />
              </marker>
              <marker
                id="arrowhead-blue"
                markerWidth="4"
                markerHeight="4"
                refX="2.5"
                refY="2"
                orient="auto"
              >
                <polygon points="0 0, 4 2, 0 4" fill="#3b82f6" />
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
              const isAmber = arrow.color.includes('d977') || arrow.color.includes('f59e') || arrow.color.includes('amber');
              const isRed = arrow.color.includes('dc26') || arrow.color.includes('ef44') || arrow.color.includes('red');
              const isBlue = arrow.color.includes('3b82') || arrow.color.includes('blue');
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
                  markerEnd={
                    isRed
                      ? 'url(#arrowhead-red)'
                      : isBlue
                      ? 'url(#arrowhead-blue)'
                      : isAmber
                      ? 'url(#arrowhead-amber)'
                      : 'url(#arrowhead-emerald)'
                  }
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
                      dispatchOrConfirmMove(cand);
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

      {/* Optional Move Confirmation Strip */}
      {pendingConfirm && (
        <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-xs">
          <span className="font-medium text-amber-900 dark:text-amber-200">
            Confirm move <strong className="font-mono">{pendingConfirm.san}</strong>?
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setPendingConfirm(null)}
              className="px-2.5 py-1 rounded border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-stone-700 dark:text-zinc-300 font-medium"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                const mv = pendingConfirm.move;
                setPendingConfirm(null);
                onMove?.(mv);
              }}
              className="px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
            >
              Confirm
            </button>
          </div>
        </div>
      )}

      {renderPocket(flipped ? 'b' : 'w')}
    </div>
  );
};
