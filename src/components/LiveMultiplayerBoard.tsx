import React, { useEffect, useMemo, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import {
  AuthUser,
  ChessVariant,
  GameRecord,
  Move,
  PieceColor,
  UserPreferences,
} from '../types/chess';
import {
  createInitialState,
  exportPgn,
  moveToUci,
  parseFen,
  VARIANTS,
} from '../engine/chessEngine';
import { detectOpeningFromMoves } from '../data/openings';
import { ChessBoard } from './ChessBoard';
import { MaterialStrip } from './MaterialStrip';
import { soundFX } from '../utils/sound';
import {
  ArrowLeftRight,
  Check,
  Copy,
  Eye,
  Flag,
  Handshake,
  Link2,
  MessageSquare,
  RotateCcw,
  Send,
  Swords,
  Trophy,
  User,
  Users,
} from 'lucide-react';

interface LiveRoomChat {
  id: string;
  author: string;
  isGuest: boolean;
  text: string;
  createdAt: string;
}

interface ServerArenaRoom {
  id: string;
  variant: ChessVariant;
  timeControl: string;
  fen: string;
  turn: PieceColor;
  moves: Move[];
  fens: string[];
  whiteName: string;
  blackName: string;
  whiteIsGuest: boolean;
  blackIsGuest: boolean;
  whiteMs: number;
  blackMs: number;
  status: 'waiting' | 'active' | 'finished';
  winner: PieceColor | 'draw' | null;
  resultReason: string | null;
  drawOfferBy: PieceColor | null;
  takebackOfferBy: PieceColor | null;
  rematchVotes: { w: boolean; b: boolean };
  series: { w: number; b: number; draws: number; round: number };
  spectatorCount: number;
  chat: LiveRoomChat[];
}

interface LiveMultiplayerBoardProps {
  prefs: UserPreferences;
  authUser: AuthUser | null;
  authToken: string | null;
  initialChallengeRoomId?: string | null;
  initialSpectateRoomId?: string | null;
  onClearExternalRoom?: () => void;
  onGameCompleted: (rec: GameRecord) => void;
}

const LIVE_TIME_CONTROLS = ['1+0', '3+0', '3+2', '5+0', '5+3', '10+0'];

function formatMs(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export const LiveMultiplayerBoard: React.FC<LiveMultiplayerBoardProps> = ({
  prefs,
  authUser,
  authToken,
  initialChallengeRoomId = null,
  initialSpectateRoomId = null,
  onClearExternalRoom,
  onGameCompleted,
}) => {
  const [variant, setVariant] = useState<ChessVariant>('standard');
  const [timeControl, setTimeControl] = useState<string>('5+0');
  const [room, setRoom] = useState<ServerArenaRoom | null>(null);
  const [myColor, setMyColor] = useState<PieceColor | 'spectator' | null>(null);
  const [queueWaiting, setQueueWaiting] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [localClocks, setLocalClocks] = useState<{ w: number; b: number }>({ w: 300_000, b: 300_000 });

  const wsRef = useRef<WebSocket | null>(null);
  const recordedRoundRef = useRef<string>('');
  const authTokenRef = useRef<string | null>(authToken);
  authTokenRef.current = authToken;

  const ensureSocket = (onReady: (sock: WebSocket) => void) => {
    const existing = wsRef.current;
    if (existing && existing.readyState === WebSocket.OPEN) {
      onReady(existing);
      return;
    }
    if (existing && existing.readyState === WebSocket.CONNECTING) {
      existing.addEventListener('open', () => onReady(existing), { once: true });
      return;
    }

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.host}/ws/arena`);
    wsRef.current = ws;

    ws.addEventListener('open', () => onReady(ws));
    ws.addEventListener('message', (ev) => {
      try {
        const msg = JSON.parse(ev.data) as {
          type?: string;
          roomId?: string;
          myColor?: PieceColor | 'spectator';
          room?: ServerArenaRoom;
          error?: string;
        };
        if (msg.type === 'queue:waiting') {
          setQueueWaiting(true);
          setErrorMsg(null);
        } else if (msg.type === 'room:assigned' && msg.myColor) {
          setMyColor(msg.myColor);
          setQueueWaiting(false);
          setErrorMsg(null);
          if (msg.myColor === 'b') setFlipped(true);
          else if (msg.myColor === 'w') setFlipped(false);
        } else if (msg.type === 'room:state' && msg.room) {
          const nextRoom = msg.room;
          setRoom((prev) => {
            if (prev && nextRoom.moves.length > prev.moves.length) {
              const lastSan = nextRoom.moves[nextRoom.moves.length - 1]?.san || '';
              if (lastSan.includes('+') || lastSan.includes('#')) soundFX.check();
              else if (lastSan.includes('x')) soundFX.capture();
              else soundFX.move();
            }
            return nextRoom;
          });
          setLocalClocks({ w: nextRoom.whiteMs, b: nextRoom.blackMs });
        } else if (msg.type === 'arena:error' && msg.error) {
          setErrorMsg(msg.error);
          setQueueWaiting(false);
        }
      } catch {
        // Ignore malformed server payload
      }
    });
    ws.addEventListener('close', () => {
      if (wsRef.current === ws) wsRef.current = null;
      setQueueWaiting(false);
    });
  };

  useEffect(() => {
    return () => {
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, []);

  // Auto-join challenge link or spectate room from props
  useEffect(() => {
    if (initialChallengeRoomId) {
      ensureSocket((ws) => {
        ws.send(
          JSON.stringify({
            type: 'room:join',
            roomId: initialChallengeRoomId,
            token: authTokenRef.current,
          })
        );
      });
      onClearExternalRoom?.();
    } else if (initialSpectateRoomId) {
      ensureSocket((ws) => {
        ws.send(
          JSON.stringify({
            type: 'room:spectate',
            roomId: initialSpectateRoomId,
            token: authTokenRef.current,
          })
        );
      });
      onClearExternalRoom?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialChallengeRoomId, initialSpectateRoomId]);

  // Smooth client-side clock interpolation for active room
  useEffect(() => {
    if (!room || room.status !== 'active' || room.moves.length === 0) return;
    const timer = window.setInterval(() => {
      setLocalClocks((prev) => ({
        w: room.turn === 'w' ? Math.max(0, prev.w - 1000) : prev.w,
        b: room.turn === 'b' ? Math.max(0, prev.b - 1000) : prev.b,
      }));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [room?.id, room?.status, room?.turn, room?.moves.length]);

  // Record finished match + confetti celebration
  useEffect(() => {
    if (!room || room.status !== 'finished' || !room.winner) return;
    const sig = `${room.id}-r${room.series.round}`;
    if (recordedRoundRef.current === sig) return;
    recordedRoundRef.current = sig;

    if (myColor === 'w' || myColor === 'b') {
      if (room.winner === myColor) {
        soundFX.victory();
        if (room.resultReason?.toLowerCase().includes('checkmate')) {
          confetti({
            particleCount: 70,
            spread: 75,
            origin: { y: 0.55 },
            disableForReducedMotion: true,
          });
        }
      } else if (room.winner !== 'draw') {
        soundFX.defeat();
      }
    }

    if (room.moves.length > 0 && (myColor === 'w' || myColor === 'b')) {
      const pgnRes =
        room.winner === 'w' ? '1-0' : room.winner === 'b' ? '0-1' : '1/2-1/2';
      const opening = detectOpeningFromMoves(room.moves.map((m) => m.san || ''));
      onGameCompleted({
        id: `live-${room.id}-${room.series.round}-${Date.now()}`,
        white: room.whiteName,
        black: room.blackName,
        whiteElo: 1620,
        blackElo: 1620,
        variant: room.variant,
        timeControl: `${room.timeControl} · Live`,
        result: pgnRes,
        reason: room.resultReason || 'Finished',
        date: new Date().toISOString().slice(0, 10),
        moves: room.moves,
        fens: room.fens,
        pgn: exportPgn({
          white: room.whiteName,
          black: room.blackName,
          variant: room.variant,
          result: pgnRes,
          moves: room.moves,
        }),
        openingEco: opening.eco,
        openingName: opening.name,
        userColor: myColor,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.status, room?.winner, room?.series.round]);

  const boardState = useMemo(() => {
    if (!room) return createInitialState(variant);
    try {
      return parseFen(room.fen, room.variant);
    } catch {
      return createInitialState(room.variant);
    }
  }, [room, variant]);

  const lastMove = useMemo(() => {
    if (!room || room.moves.length === 0) return null;
    const mv = room.moves[room.moves.length - 1];
    return { from: mv.from, to: mv.to };
  }, [room]);

  const handleJoinQueue = () => {
    setErrorMsg(null);
    ensureSocket((ws) => {
      ws.send(
        JSON.stringify({
          type: 'queue:join',
          variant,
          timeControl,
          token: authToken,
        })
      );
    });
  };

  const handleCancelQueue = () => {
    wsRef.current?.send(JSON.stringify({ type: 'queue:leave' }));
    setQueueWaiting(false);
  };

  const handleCreateChallenge = () => {
    setErrorMsg(null);
    ensureSocket((ws) => {
      ws.send(
        JSON.stringify({
          type: 'room:create',
          variant,
          timeControl,
          token: authToken,
        })
      );
    });
  };

  const handleJoinCode = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = joinCode.trim();
    if (!cleaned) return;
    ensureSocket((ws) => {
      ws.send(
        JSON.stringify({
          type: 'room:join',
          roomId: cleaned,
          token: authToken,
        })
      );
    });
  };

  const handleMove = (mv: Move) => {
    if (!room || !wsRef.current || room.status !== 'active') return;
    if (myColor !== 'w' && myColor !== 'b') return;
    if (room.turn !== myColor) return;
    wsRef.current.send(
      JSON.stringify({
        type: 'room:move',
        roomId: room.id,
        uci: moveToUci(mv),
        token: authToken,
      })
    );
  };

  const sendRoomAction = (type: string, extra?: Record<string, unknown>) => {
    if (!room || !wsRef.current) return;
    wsRef.current.send(
      JSON.stringify({
        type,
        roomId: room.id,
        token: authToken,
        ...(extra || {}),
      })
    );
  };

  const topSide: PieceColor = flipped ? 'w' : 'b';
  const bottomSide: PieceColor = flipped ? 'b' : 'w';
  const challengeShareUrl = room
    ? `${window.location.origin}${window.location.pathname}?challenge=${room.id}`
    : '';

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
      {/* Board Column */}
      <div className="lg:col-span-7 flex flex-col items-center gap-2.5">
        <div className="w-full max-w-[540px] flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800">
          <div className="min-w-0 flex flex-col gap-0.5">
            <div className="flex items-center gap-1.5 text-sm font-semibold text-stone-900 dark:text-zinc-100">
              <User className="w-3.5 h-3.5 text-stone-400 shrink-0" />
              <span className="truncate">
                {room
                  ? topSide === 'w'
                    ? room.whiteName
                    : room.blackName
                  : 'Waiting for Live Match'}
              </span>
              {room && (topSide === 'w' ? room.whiteIsGuest : room.blackIsGuest) && (
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-stone-100 dark:bg-zinc-800 text-stone-500">
                  Guest
                </span>
              )}
            </div>
            <MaterialStrip state={boardState} side={topSide} pieceSet={prefs.pieceSet} />
          </div>
          <span
            className={`font-mono tabular-nums text-base font-semibold px-2.5 py-1 rounded ${
              room && room.status === 'active' && room.turn === topSide
                ? 'bg-emerald-600 text-white'
                : 'bg-stone-100 dark:bg-zinc-800 text-stone-800 dark:text-zinc-200'
            }`}
          >
            {formatMs(topSide === 'w' ? localClocks.w : localClocks.b)}
          </span>
        </div>

        <ChessBoard
          state={boardState}
          onMove={handleMove}
          flipped={flipped}
          interactive={
            Boolean(room) &&
            room?.status === 'active' &&
            (myColor === 'w' || myColor === 'b') &&
            room?.turn === myColor
          }
          allowedColor={myColor === 'w' || myColor === 'b' ? myColor : 'both'}
          boardTheme={prefs.boardTheme}
          pieceSet={prefs.pieceSet}
          showCoordinates={prefs.showCoordinates}
          highlightLegal={prefs.highlightLegalMoves}
          showLastMove={prefs.showLastMove !== false}
          pieceScale={prefs.pieceScale || 'normal'}
          autoQueen={prefs.autoQueen}
          lastMove={lastMove}
        />

        <div className="w-full max-w-[540px] flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800">
          <div className="min-w-0 flex flex-col gap-0.5">
            <div className="flex items-center gap-1.5 text-sm font-semibold text-stone-900 dark:text-zinc-100">
              <User className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
              <span className="truncate">
                {room
                  ? bottomSide === 'w'
                    ? room.whiteName
                    : room.blackName
                  : authUser
                  ? authUser.username
                  : 'Anonymous'}
              </span>
              {room
                ? (bottomSide === 'w' ? room.whiteIsGuest : room.blackIsGuest) && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-stone-100 dark:bg-zinc-800 text-stone-500">
                      Guest
                    </span>
                  )
                : !authUser && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-stone-100 dark:bg-zinc-800 text-stone-500">
                      Guest
                    </span>
                  )}
            </div>
            <MaterialStrip state={boardState} side={bottomSide} pieceSet={prefs.pieceSet} />
          </div>
          <span
            className={`font-mono tabular-nums text-base font-semibold px-2.5 py-1 rounded ${
              room && room.status === 'active' && room.turn === bottomSide
                ? 'bg-emerald-600 text-white'
                : 'bg-stone-100 dark:bg-zinc-800 text-stone-800 dark:text-zinc-200'
            }`}
          >
            {formatMs(bottomSide === 'w' ? localClocks.w : localClocks.b)}
          </span>
        </div>
      </div>

      {/* Matchmaking / Challenge / Controls Column */}
      <div className="lg:col-span-5 space-y-4">
        {!room && (
          <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-stone-900 dark:text-zinc-100 flex items-center gap-2">
                <Users className="w-4 h-4 text-emerald-600" />
                Live Human Multiplayer
              </h2>
              <span className="text-[11px] font-mono text-stone-500">WebSocket Arena</span>
            </div>

            {errorMsg && (
              <div className="p-2.5 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300">
                {errorMsg}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-stone-600 dark:text-zinc-400 mb-1">
                  Variant
                </label>
                <select
                  value={variant}
                  onChange={(e) => setVariant(e.target.value as ChessVariant)}
                  className="w-full px-2.5 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-950 text-xs"
                >
                  {VARIANTS.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-600 dark:text-zinc-400 mb-1">
                  Time Control
                </label>
                <div className="grid grid-cols-3 gap-1">
                  {LIVE_TIME_CONTROLS.map((tc) => (
                    <button
                      key={tc}
                      type="button"
                      onClick={() => setTimeControl(tc)}
                      className={`py-1.5 rounded border text-xs font-mono font-semibold ${
                        timeControl === tc
                          ? 'border-emerald-600 bg-emerald-600 text-white'
                          : 'border-stone-200 dark:border-zinc-700 text-stone-700 dark:text-zinc-300'
                      }`}
                    >
                      {tc}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {queueWaiting ? (
              <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 flex items-center justify-between gap-2 text-xs">
                <span className="font-medium text-amber-900 dark:text-amber-200">
                  Searching for human opponent ({variant} · {timeControl})...
                </span>
                <button
                  type="button"
                  onClick={handleCancelQueue}
                  className="px-2.5 py-1 rounded bg-white dark:bg-zinc-900 border border-stone-300 dark:border-zinc-700 font-semibold"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={handleJoinQueue}
                  className="py-2.5 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center justify-center gap-1.5"
                >
                  <Swords className="w-4 h-4" />
                  1v1 Quick Pairing
                </button>
                <button
                  type="button"
                  onClick={handleCreateChallenge}
                  className="py-2.5 px-3 rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 hover:bg-stone-50 dark:hover:bg-zinc-700 text-stone-900 dark:text-zinc-100 text-xs font-semibold flex items-center justify-center gap-1.5"
                >
                  <Link2 className="w-4 h-4 text-emerald-600" />
                  Create Challenge Link
                </button>
              </div>
            )}

            <form
              onSubmit={handleJoinCode}
              className="pt-3 border-t border-stone-100 dark:border-zinc-800 flex gap-2"
            >
              <input
                type="text"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                placeholder="Paste Room Code (e.g. rm-xxxx)..."
                className="flex-1 px-2.5 py-1.5 rounded-lg border border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-950 font-mono text-xs"
              />
              <button
                type="submit"
                className="px-3 py-1.5 rounded-lg bg-stone-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-semibold"
              >
                Join Room
              </button>
            </form>
          </div>
        )}

        {room && (
          <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-sm font-bold text-stone-900 dark:text-zinc-100 flex items-center gap-2">
                  <span>Room {room.id}</span>
                  {myColor === 'spectator' && (
                    <span className="text-[11px] font-semibold text-sky-600 dark:text-sky-400 flex items-center gap-1">
                      <Eye className="w-3.5 h-3.5" />
                      Spectating
                    </span>
                  )}
                </div>
                <div className="text-xs text-stone-500 font-mono">
                  {room.variant} · {room.timeControl} · Bo3 Round {room.series.round} (W:{room.series.w} / B:{room.series.b} / D:{room.series.draws})
                </div>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-xs font-mono text-stone-500 flex items-center gap-1 mr-1">
                  <Eye className="w-3.5 h-3.5" />
                  {room.spectatorCount}
                </span>
                <button
                  type="button"
                  onClick={() => setFlipped((f) => !f)}
                  className="p-1.5 rounded hover:bg-stone-100 dark:hover:bg-zinc-800 text-stone-600 dark:text-zinc-400"
                  title="Flip Board"
                >
                  <ArrowLeftRight className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRoom(null);
                    setMyColor(null);
                  }}
                  className="px-2 py-1 rounded border border-stone-200 dark:border-zinc-700 text-xs font-medium"
                >
                  Leave
                </button>
              </div>
            </div>

            {room.status === 'waiting' && (
              <div className="p-3 rounded-lg bg-emerald-50/80 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 space-y-2 text-xs">
                <div className="font-semibold text-emerald-900 dark:text-emerald-200">
                  Share this Challenge Link with a friend:
                </div>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    readOnly
                    value={challengeShareUrl}
                    className="flex-1 px-2 py-1 rounded border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-zinc-950 font-mono text-[11px]"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(challengeShareUrl).catch(() => {});
                      setCopiedLink(true);
                      setTimeout(() => setCopiedLink(false), 1800);
                    }}
                    className="px-2.5 py-1 rounded bg-emerald-600 text-white font-semibold flex items-center gap-1 shrink-0"
                  >
                    {copiedLink ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedLink ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            )}

            {/* Incoming Draw / Takeback Offers */}
            {room.status === 'active' &&
              (myColor === 'w' || myColor === 'b') &&
              room.drawOfferBy &&
              room.drawOfferBy !== myColor && (
                <div className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 flex items-center justify-between text-xs">
                  <span>Opponent offered a draw.</span>
                  <button
                    type="button"
                    onClick={() => sendRoomAction('room:draw_accept')}
                    className="px-2.5 py-1 rounded bg-amber-600 text-white font-semibold"
                  >
                    Accept Draw
                  </button>
                </div>
              )}

            {room.status === 'active' &&
              (myColor === 'w' || myColor === 'b') &&
              room.takebackOfferBy &&
              room.takebackOfferBy !== myColor && (
                <div className="p-2.5 rounded-lg bg-sky-50 dark:bg-sky-950/30 border border-sky-300 dark:border-sky-800 flex items-center justify-between text-xs">
                  <span>Opponent requests a takeback.</span>
                  <button
                    type="button"
                    onClick={() => sendRoomAction('room:takeback_accept')}
                    className="px-2.5 py-1 rounded bg-sky-600 text-white font-semibold"
                  >
                    Allow Takeback
                  </button>
                </div>
              )}

            {/* Finished Banner + Best-of-3 Rematch */}
            {room.status === 'finished' && (
              <div className="p-3 rounded-lg bg-stone-100 dark:bg-zinc-950 border border-stone-300 dark:border-zinc-700 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-bold text-stone-900 dark:text-zinc-100 flex items-center gap-1.5">
                      <Trophy className="w-4 h-4 text-amber-500" />
                      {room.winner === 'draw'
                        ? 'Game Drawn'
                        : `${room.winner === 'w' ? room.whiteName : room.blackName} Wins!`}
                    </div>
                    <div className="text-xs text-stone-500">{room.resultReason}</div>
                  </div>
                  {(myColor === 'w' || myColor === 'b') && (
                    <button
                      type="button"
                      disabled={room.rematchVotes[myColor]}
                      onClick={() => sendRoomAction('room:rematch')}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      {room.rematchVotes[myColor] ? 'Waiting Rematch...' : 'Rematch (Bo3)'}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Live Match Controls */}
            {room.status === 'active' && (myColor === 'w' || myColor === 'b') && (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={room.moves.length === 0 || room.takebackOfferBy === myColor}
                  onClick={() => sendRoomAction('room:takeback_request')}
                  className="flex-1 py-1.5 px-2 rounded-lg border border-stone-200 dark:border-zinc-700 text-xs font-medium disabled:opacity-40 flex items-center justify-center gap-1"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  {room.takebackOfferBy === myColor ? 'Takeback Sent' : 'Takeback'}
                </button>
                <button
                  type="button"
                  disabled={room.drawOfferBy === myColor}
                  onClick={() => sendRoomAction('room:draw_offer')}
                  className="flex-1 py-1.5 px-2 rounded-lg border border-stone-200 dark:border-zinc-700 text-xs font-medium disabled:opacity-40 flex items-center justify-center gap-1"
                >
                  <Handshake className="w-3.5 h-3.5" />
                  {room.drawOfferBy === myColor ? 'Draw Sent' : 'Offer Draw'}
                </button>
                <button
                  type="button"
                  onClick={() => sendRoomAction('room:resign')}
                  className="flex-1 py-1.5 px-2 rounded-lg border border-red-200 dark:border-red-900/50 text-red-600 dark:text-red-400 text-xs font-medium flex items-center justify-center gap-1"
                >
                  <Flag className="w-3.5 h-3.5" />
                  Resign
                </button>
              </div>
            )}

            {/* Room Move List */}
            <div className="max-h-32 overflow-y-auto thin-scroll p-2 rounded-lg bg-stone-50 dark:bg-zinc-950 border border-stone-100 dark:border-zinc-800 font-mono text-xs flex flex-wrap gap-1.5">
              {room.moves.length === 0 ? (
                <span className="text-stone-400 font-sans">No moves played yet.</span>
              ) : (
                room.moves.map((m, idx) => (
                  <span key={idx} className="text-stone-800 dark:text-zinc-200">
                    {idx % 2 === 0 ? `${Math.floor(idx / 2) + 1}.` : ''}
                    {m.san}{' '}
                  </span>
                ))
              )}
            </div>

            {/* Live Room / Kibitz Chat */}
            <div className="pt-2 border-t border-stone-100 dark:border-zinc-800 space-y-2">
              <div className="text-xs font-semibold text-stone-600 dark:text-zinc-400 flex items-center gap-1.5">
                <MessageSquare className="w-3.5 h-3.5 text-emerald-600" />
                Live Room & Kibitz Chat
              </div>
              <div className="max-h-28 overflow-y-auto thin-scroll space-y-1 bg-stone-50 dark:bg-zinc-950 rounded-lg p-2 border border-stone-100 dark:border-zinc-800 text-xs">
                {room.chat.length === 0 ? (
                  <p className="text-stone-400 text-[11px]">Say glhf or chat with spectators.</p>
                ) : (
                  room.chat.map((c) => (
                    <div key={c.id} className="leading-snug">
                      <span className="font-semibold text-stone-800 dark:text-zinc-200">
                        {c.author}
                        {c.isGuest ? ' (Guest)' : ''}:{' '}
                      </span>
                      <span className="text-stone-600 dark:text-zinc-400">{c.text}</span>
                    </div>
                  ))
                )}
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const clean = chatInput.trim();
                  if (!clean) return;
                  sendRoomAction('room:chat', { text: clean });
                  setChatInput('');
                }}
                className="flex gap-1.5"
              >
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Chat in room..."
                  className="flex-1 px-2.5 py-1.5 rounded-lg border border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-950 text-xs"
                />
                <button
                  type="submit"
                  className="px-2.5 py-1.5 rounded-lg bg-stone-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-semibold"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
