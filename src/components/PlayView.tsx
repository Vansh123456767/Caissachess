import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BoardState,
  ChessVariant,
  ConditionalPremove,
  CorrespondenceGame,
  GameRecord,
  GameResult,
  Move,
  PieceColor,
  RatingCategory,
  UserPreferences,
  UserRatings,
} from '../types/chess';
import {
  createInitialState,
  evaluateGameResult,
  exportPgn,
  getChess960FenById,
  getLegalMoves,
  makeMove,
  moveToSan,
  parseFen,
  positionKey,
  sanToMove,
  toFen,
  uciToMove,
  VARIANTS,
} from '../engine/chessEngine';
import { findBestMove } from '../engine/aiSearch';
import { detectOpeningFromMoves } from '../data/openings';
import { ChessBoard, QueuedPremove } from './ChessBoard';
import { MaterialStrip } from './MaterialStrip';
import { OtbClockView } from './OtbClockView';
import { announceMove, soundFX } from '../utils/sound';
import {
  ArrowLeftRight,
  Check,
  Clock,
  Copy,
  Download,
  Eye,
  EyeOff,
  Flag,
  Handshake,
  History,
  Layers,
  Link2,
  Maximize2,
  MessageSquare,
  Microscope,
  Minimize2,
  Plus,
  RotateCcw,
  Send,
  Swords,
  Trash2,
} from 'lucide-react';

interface PlayViewProps {
  prefs: UserPreferences;
  games?: GameRecord[];
  userRatings?: UserRatings;
  initialVariant?: ChessVariant;
  initialFen?: string | null;
  onGameCompleted: (record: GameRecord) => void;
  onApplyRatingDelta?: (category: RatingCategory, delta: number) => void;
  onSendToAnalysis: (pgnOrFen: { fen?: string; moves?: Move[]; fens?: string[]; variant: ChessVariant }) => void;
}

type PlaySubTab = 'quick' | 'variants' | 'correspondence' | 'simul' | 'clock';

interface HandicapPreset {
  id: 'none' | 'pawn' | 'knight' | 'rook' | 'queen';
  label: string;
  fen: string;
}

const HANDICAP_PRESETS: HandicapPreset[] = [
  { id: 'none', label: 'Even', fen: '' },
  { id: 'pawn', label: 'Pawn Odds (Opp no f7)', fen: 'rnbqkbnr/ppppp1pp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' },
  { id: 'knight', label: 'Knight Odds (Opp no Nb8)', fen: 'r1bqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' },
  { id: 'rook', label: 'Rook Odds (Opp no Ra8)', fen: '1nbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQk - 0 1' },
  { id: 'queen', label: 'Queen Odds (Opp no Qd8)', fen: 'rnb1kbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' },
];

interface LobbySeek {
  id: string;
  player: string;
  elo: number;
  timeControlId: string;
  variant: ChessVariant;
  rated: boolean;
  skill: number;
  color: PieceColor;
}

const LOBBY_SEEKS: LobbySeek[] = [
  { id: 'seek-1', player: 'Elena_Tactics', elo: 1780, timeControlId: '3+2', variant: 'standard', rated: true, skill: 5, color: 'w' },
  { id: 'seek-2', player: 'Sora_Club', elo: 1540, timeControlId: '5+3', variant: 'standard', rated: true, skill: 4, color: 'b' },
  { id: 'seek-3', player: 'BulletKing99', elo: 1960, timeControlId: '1+0', variant: 'standard', rated: true, skill: 6, color: 'w' },
  { id: 'seek-4', player: 'Marcus_960', elo: 1840, timeControlId: '3+2', variant: 'chess960', rated: true, skill: 5, color: 'b' },
  { id: 'seek-5', player: 'CasualLearner', elo: 1180, timeControlId: '10+0', variant: 'standard', rated: false, skill: 2, color: 'w' },
];

interface TimeControlOption {
  id: string;
  label: string;
  category: string;
  baseSeconds: number;
  increment: number;
}

const TIME_CONTROLS: TimeControlOption[] = [
  { id: '1+0', label: '1+0', category: 'Bullet', baseSeconds: 60, increment: 0 },
  { id: '2+1', label: '2+1', category: 'Bullet', baseSeconds: 120, increment: 1 },
  { id: '3+0', label: '3+0', category: 'Blitz', baseSeconds: 180, increment: 0 },
  { id: '3+2', label: '3+2', category: 'Blitz', baseSeconds: 180, increment: 2 },
  { id: '5+3', label: '5+3', category: 'Blitz', baseSeconds: 300, increment: 3 },
  { id: '10+0', label: '10+0', category: 'Rapid', baseSeconds: 600, increment: 0 },
  { id: '15+10', label: '15+10', category: 'Classical', baseSeconds: 900, increment: 10 },
  { id: 'unlimited', label: '∞', category: 'Casual', baseSeconds: 0, increment: 0 },
];

function formatClock(sec: number): string {
  if (sec <= 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export const PlayView: React.FC<PlayViewProps> = ({
  prefs,
  games = [],
  userRatings,
  initialVariant = 'standard',
  initialFen = null,
  onGameCompleted,
  onApplyRatingDelta,
  onSendToAnalysis,
}) => {
  const [subTab, setSubTab] = useState<PlaySubTab>(initialVariant !== 'standard' ? 'variants' : 'quick');

  // Quick / Variant Game Config
  const [selectedVariant, setSelectedVariant] = useState<ChessVariant>(initialVariant);
  const [timeControl, setTimeControl] = useState<TimeControlOption>(TIME_CONTROLS[3]); // 3+2
  const [opponentMode, setOpponentMode] = useState<'ai' | 'local'>('ai');
  const [skillLevel, setSkillLevel] = useState<number>(4);
  const [userColorChoice, setUserColorChoice] = useState<PieceColor | 'random'>('w');
  const [isRated, setIsRated] = useState<boolean>(true);
  const [handicap, setHandicap] = useState<HandicapPreset['id']>('none');
  const [customTcOpen, setCustomTcOpen] = useState<boolean>(false);
  const [customMinutes, setCustomMinutes] = useState<number>(5);
  const [customIncrement, setCustomIncrement] = useState<number>(3);
  const [ratingRange, setRatingRange] = useState<number>(300);
  const [chess960Sp, setChess960Sp] = useState<'random' | number>('random');
  const [activeChess960Sp, setActiveChess960Sp] = useState<number | null>(null);
  const [lobbyViewMode, setLobbyViewMode] = useState<'list' | 'graph'>('list');
  const [hoveredSeekId, setHoveredSeekId] = useState<string | null>(null);
  const [fromPositionOpen, setFromPositionOpen] = useState<boolean>(false);
  const [customStartFen, setCustomStartFen] = useState<string>('');
  const [challengeCopied, setChallengeCopied] = useState<boolean>(false);
  const [opponentLabel, setOpponentLabel] = useState<string | null>(null);
  const [lastEloDelta, setLastEloDelta] = useState<number | null>(null);

  // Active Game State
  const [gameActive, setGameActive] = useState<boolean>(!!initialFen);
  const [userColor, setUserColor] = useState<PieceColor>('w');
  const [flipped, setFlipped] = useState<boolean>(false);
  const [zenMode, setZenMode] = useState<boolean>(false);
  const [blindfoldMode, setBlindfoldMode] = useState<boolean>(false);
  const [premoveQueue, setPremoveQueue] = useState<QueuedPremove[]>([]);
  const [moveInput, setMoveInput] = useState<string>('');
  const [moveInputError, setMoveInputError] = useState<string | null>(null);
  const [chatDisabled, setChatDisabled] = useState<boolean>(false);
  const [chatInput, setChatInput] = useState<string>('');
  const [chatMessages, setChatMessages] = useState<{ id: string; sender: string; text: string }[]>([]);
  const [boardState, setBoardState] = useState<BoardState>(() =>
    createInitialState(initialVariant, initialFen || undefined)
  );
  const [fens, setFens] = useState<string[]>(() => [
    toFen(createInitialState(initialVariant, initialFen || undefined)),
  ]);
  const [posKeys, setPosKeys] = useState<string[]>(() => [
    positionKey(createInitialState(initialVariant, initialFen || undefined)),
  ]);
  const [moves, setMoves] = useState<Move[]>([]);
  const [viewPly, setViewPly] = useState<number | null>(null);
  const [gameResult, setGameResult] = useState<GameResult | null>(null);
  const [clocks, setClocks] = useState<{ w: number; b: number }>({ w: 180, b: 180 });
  const [aiThinking, setAiThinking] = useState(false);
  const [copiedPgn, setCopiedPgn] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const lowTimeWarnedRef = useRef<{ w: boolean; b: boolean }>({ w: false, b: false });

  const initialFenRef = useRef<string | undefined>(initialFen || undefined);

  const activeRatingCategory: RatingCategory = useMemo(() => {
    if (boardState.variant === 'chess960') return 'chess960';
    if (timeControl.baseSeconds > 0 && timeControl.baseSeconds < 180) return 'bullet';
    if (timeControl.baseSeconds >= 180 && timeControl.baseSeconds <= 480) return 'blitz';
    if (timeControl.baseSeconds > 480 && timeControl.baseSeconds < 900) return 'rapid';
    return 'classical';
  }, [boardState.variant, timeControl.baseSeconds]);

  const currentUserElo = userRatings ? userRatings[activeRatingCategory] : 1620;

  // Sync if launched from Board Editor
  useEffect(() => {
    if (initialFen) {
      const st = createInitialState(initialVariant, initialFen);
      initialFenRef.current = initialFen;
      setSelectedVariant(initialVariant);
      setBoardState(st);
      setFens([toFen(st)]);
      setPosKeys([positionKey(st)]);
      setMoves([]);
      setViewPly(null);
      setGameResult(null);
      setPremoveQueue([]);
      setLastEloDelta(null);
      setOpponentLabel(null);
      setUserColor('w');
      setFlipped(false);
      setGameActive(true);
    }
  }, [initialFen, initialVariant]);

  const applyCustomTimeControl = (mins: number, inc: number) => {
    const baseSec = Math.round(mins * 60);
    const labelMins = mins === 0.25 ? '¼' : mins === 0.5 ? '½' : mins === 0.75 ? '¾' : String(mins);
    const cat =
      baseSec === 0
        ? 'Casual'
        : baseSec < 180
        ? 'Bullet'
        : baseSec <= 480
        ? 'Blitz'
        : baseSec < 900
        ? 'Rapid'
        : 'Classical';
    setTimeControl({
      id: `custom-${mins}+${inc}`,
      label: `${labelMins}+${inc}`,
      category: cat,
      baseSeconds: baseSec,
      increment: inc,
    });
  };

  const startNewGame = (
    variantOverride?: ChessVariant,
    forceColor?: PieceColor,
    customSeek?: { tcId?: string; skill?: number; rated?: boolean; label?: string; fenOverride?: string }
  ) => {
    const v = variantOverride || selectedVariant;
    const tc = customSeek?.tcId
      ? TIME_CONTROLS.find((t) => t.id === customSeek.tcId) || timeControl
      : timeControl;
    if (customSeek?.tcId) setTimeControl(tc);
    if (typeof customSeek?.skill === 'number') setSkillLevel(customSeek.skill);
    if (typeof customSeek?.rated === 'boolean') setIsRated(customSeek.rated);
    setOpponentLabel(customSeek?.label || null);

    const chosenColor: PieceColor =
      forceColor ||
      (userColorChoice === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : userColorChoice);

    const handicapPreset = v === 'standard' ? HANDICAP_PRESETS.find((h) => h.id === handicap) : undefined;
    const cleanCustomFen = customSeek?.fenOverride?.trim() || (fromPositionOpen ? customStartFen.trim() : '');
    let startFenOverride = cleanCustomFen || handicapPreset?.fen || undefined;
    if (v === 'chess960' && !startFenOverride) {
      const spId = chess960Sp === 'random' ? Math.floor(Math.random() * 960) : chess960Sp;
      startFenOverride = getChess960FenById(spId);
      setActiveChess960Sp(spId);
    } else {
      setActiveChess960Sp(null);
    }

    const st = createInitialState(v, startFenOverride);
    initialFenRef.current = v === 'chess960' || startFenOverride ? toFen(st) : undefined;
    setSelectedVariant(v);
    setBoardState(st);
    setFens([toFen(st)]);
    setPosKeys([positionKey(st)]);
    setMoves([]);
    setViewPly(null);
    setGameResult(null);
    setLastEloDelta(null);
    setPremoveQueue([]);
    setMoveInput('');
    setMoveInputError(null);
    setChatMessages([
      {
        id: `sys-${Date.now()}`,
        sender: 'System',
        text: `${customSeek?.label || 'Caissa Engine'} is ready. Good luck!`,
      },
    ]);
    lowTimeWarnedRef.current = { w: false, b: false };
    setUserColor(chosenColor);
    setFlipped(chosenColor === 'b');
    setClocks({ w: tc.baseSeconds, b: tc.baseSeconds });
    setSavedNotice(false);
    setGameActive(true);
  };

  const finishAndRecordGame = (res: GameResult, finalMoves: Move[], finalFens: string[]) => {
    setGameResult(res);
    if (res.status === 'aborted') {
      soundFX.move();
      return;
    }
    if (res.winner === 'draw') soundFX.move();
    else if (opponentMode === 'ai' && res.winner === userColor) soundFX.victory();
    else if (opponentMode === 'ai' && res.winner !== userColor) soundFX.defeat();
    else soundFX.victory();

    if (finalMoves.length === 0) return;

    const aiElo = 750 + skillLevel * 200;
    let delta: number | null = null;
    if (isRated && opponentMode === 'ai' && timeControl.baseSeconds > 0 && handicap === 'none') {
      const score = res.winner === 'draw' ? 0.5 : res.winner === userColor ? 1 : 0;
      const expected = 1 / (1 + Math.pow(10, (aiElo - currentUserElo) / 400));
      delta = Math.round(24 * (score - expected));
      setLastEloDelta(delta);
      onApplyRatingDelta?.(activeRatingCategory, delta);
    }

    const pgnResult = res.winner === 'w' ? '1-0' : res.winner === 'b' ? '0-1' : '1/2-1/2';
    const opening = detectOpeningFromMoves(finalMoves.map((m) => m.san || ''));
    const botTitle = opponentLabel || `Caissa Bot (L${skillLevel})`;
    const record: GameRecord = {
      id: `game-${Date.now()}`,
      white: opponentMode === 'local' ? 'White (Local)' : userColor === 'w' ? prefs.username : botTitle,
      black: opponentMode === 'local' ? 'Black (Local)' : userColor === 'b' ? prefs.username : botTitle,
      whiteElo: userColor === 'w' ? currentUserElo : aiElo,
      blackElo: userColor === 'b' ? currentUserElo : aiElo,
      variant: boardState.variant,
      timeControl: `${timeControl.label}${isRated ? ' · Rated' : ' · Casual'}`,
      result: pgnResult,
      reason: res.reason,
      date: new Date().toISOString().slice(0, 10),
      moves: finalMoves,
      fens: finalFens,
      pgn: exportPgn({
        white: userColor === 'w' ? prefs.username : botTitle,
        black: userColor === 'b' ? prefs.username : botTitle,
        variant: boardState.variant,
        result: pgnResult,
        initialFen: initialFenRef.current,
        moves: finalMoves,
      }),
      openingEco: opening.eco,
      openingName: opening.name,
      userColor: opponentMode === 'ai' ? userColor : undefined,
    };
    onGameCompleted(record);
    setSavedNotice(true);
  };

  const applyPlayerOrAiMove = (mv: Move) => {
    if (gameResult) return;
    const res = makeMove(boardState, mv);
    const committedMove: Move = { ...mv, san: res.san, uci: res.uci };
    const nextMoves = [...moves, committedMove];
    const nextFens = [...fens, toFen(res.next)];
    const nextKeys = [...posKeys, positionKey(res.next)];

    // Add increment to side that just moved
    if (timeControl.baseSeconds > 0) {
      setClocks((prev) => ({
        ...prev,
        [mv.color]: prev[mv.color] + timeControl.increment,
      }));
    }

    if (res.san.includes('+') || res.san.includes('#')) soundFX.check();
    else if (mv.isCastle) soundFX.castle();
    else if (mv.captured) soundFX.capture();
    else soundFX.move();

    announceMove(res.san, prefs.voiceEnabled);

    setBoardState(res.next);
    setMoves(nextMoves);
    setFens(nextFens);
    setPosKeys(nextKeys);
    setViewPly(null);

    const terminal = evaluateGameResult(res.next, nextKeys);
    if (terminal) {
      finishAndRecordGame(terminal, nextMoves, nextFens);
    }
  };

  // AI Turn Effect
  useEffect(() => {
    if (!gameActive || gameResult || opponentMode !== 'ai') return;
    if (boardState.turn === userColor) return;

    setAiThinking(true);
    const timer = window.setTimeout(() => {
      const { move } = findBestMove(boardState, skillLevel);
      setAiThinking(false);
      if (move) {
        applyPlayerOrAiMove(move);
      }
    }, 320);

    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameActive, boardState, gameResult, opponentMode, userColor, skillLevel]);

  // Execute queued multi-premove immediately when it becomes the user's turn
  useEffect(() => {
    if (!gameActive || gameResult || opponentMode !== 'ai') return;
    if (boardState.turn !== userColor || premoveQueue.length === 0) return;

    const [nextPre, ...restQueue] = premoveQueue;
    const legal = getLegalMoves(boardState);
    const matching = legal.filter(
      (m) =>
        !m.isDrop &&
        m.from &&
        m.from[0] === nextPre.from[0] &&
        m.from[1] === nextPre.from[1] &&
        m.to[0] === nextPre.to[0] &&
        m.to[1] === nextPre.to[1]
    );
    if (matching.length > 0) {
      setPremoveQueue(restQueue);
      const picked = matching.find((m) => m.promotion === 'q') || matching[0];
      applyPlayerOrAiMove(picked);
    } else {
      setPremoveQueue([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameActive, gameResult, opponentMode, boardState, userColor, premoveQueue]);

  // Keyboard shortcuts in Quick Play (z for Zen Mode, arrows to browse history)
  useEffect(() => {
    if (subTab !== 'quick' && subTab !== 'variants') return;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')
      ) {
        return;
      }
      if (e.key === 'z' || e.key === 'Z') {
        setZenMode((z) => !z);
      } else if (e.key === 'ArrowLeft') {
        if (moves.length === 0) return;
        e.preventDefault();
        setViewPly((vp) => {
          const cur = vp === null ? moves.length : vp;
          return Math.max(0, cur - 1);
        });
      } else if (e.key === 'ArrowRight') {
        if (viewPly === null) return;
        e.preventDefault();
        setViewPly((vp) => {
          if (vp === null) return null;
          return vp + 1 >= moves.length ? null : vp + 1;
        });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [subTab, moves.length, viewPly]);

  // Live Clock Tick + Lichess low-time audio chime (< 10s)
  useEffect(() => {
    if (!gameActive || gameResult || timeControl.baseSeconds === 0 || moves.length === 0) return;
    const timer = window.setInterval(() => {
      setClocks((prev) => {
        const turn = boardState.turn;
        const nextVal = Math.max(0, prev[turn] - 1);
        if (nextVal <= 10 && nextVal > 0 && !lowTimeWarnedRef.current[turn]) {
          if (opponentMode === 'local' || turn === userColor) {
            soundFX.lowTime();
            lowTimeWarnedRef.current[turn] = true;
          }
        }
        if (nextVal === 0) {
          const winner: PieceColor = turn === 'w' ? 'b' : 'w';
          finishAndRecordGame(
            { status: 'timeout', winner, reason: `${turn === 'w' ? 'White' : 'Black'} ran out of time` },
            moves,
            fens
          );
        }
        return { ...prev, [turn]: nextVal };
      });
    }, 1000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameActive, gameResult, timeControl.baseSeconds, boardState.turn, moves.length]);

  const handleTakeback = () => {
    if (gameResult || moves.length === 0) return;
    setPremoveQueue([]);
    const pliesBack = opponentMode === 'ai' && moves.length >= 2 && boardState.turn === userColor ? 2 : 1;
    const newLen = moves.length - pliesBack;
    if (newLen < 0) return;
    const targetFen = fens[newLen];
    const restored = parseFen(targetFen, boardState.variant);
    setBoardState(restored);
    setMoves(moves.slice(0, newLen));
    setFens(fens.slice(0, newLen + 1));
    setPosKeys(posKeys.slice(0, newLen + 1));
    setViewPly(null);
  };

  const handleGiveMoreTime = () => {
    if (!gameActive || gameResult || timeControl.baseSeconds === 0) return;
    const oppColor: PieceColor =
      opponentMode === 'ai' ? (userColor === 'w' ? 'b' : 'w') : boardState.turn;
    setClocks((prev) => ({ ...prev, [oppColor]: prev[oppColor] + 15 }));
  };

  const handleMoveInputSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!gameActive || gameResult || viewPly !== null) return;
    if (opponentMode === 'ai' && boardState.turn !== userColor) {
      setMoveInputError('Wait for your turn or click a premove on the board.');
      return;
    }
    const raw = moveInput.trim();
    if (!raw) return;
    const mv =
      sanToMove(boardState, raw) ||
      (/^[a-h][1-8][a-h][1-8][qrbnQRBN]?$/.test(raw) ? uciToMove(boardState, raw.toLowerCase()) : null);
    if (!mv) {
      setMoveInputError(`Illegal or unrecognized move: "${raw}"`);
      return;
    }
    setMoveInput('');
    setMoveInputError(null);
    applyPlayerOrAiMove(mv);
  };

  const displayedState = useMemo(() => {
    if (viewPly === null) return boardState;
    return parseFen(fens[viewPly], boardState.variant);
  }, [viewPly, boardState, fens]);

  const activeLastMove = useMemo(() => {
    const idx = viewPly === null ? moves.length - 1 : viewPly - 1;
    if (idx < 0 || !moves[idx]) return null;
    return { from: moves[idx].from, to: moves[idx].to };
  }, [viewPly, moves]);

  const handleCopyPgn = () => {
    const pgn = exportPgn({
      white: userColor === 'w' ? prefs.username : `Caissa Bot L${skillLevel}`,
      black: userColor === 'b' ? prefs.username : `Caissa Bot L${skillLevel}`,
      variant: boardState.variant,
      result: gameResult ? (gameResult.winner === 'w' ? '1-0' : gameResult.winner === 'b' ? '0-1' : '1/2-1/2') : '*',
      initialFen: initialFenRef.current,
      moves,
    });
    navigator.clipboard.writeText(pgn).catch(() => {});
    setCopiedPgn(true);
    setTimeout(() => setCopiedPgn(false), 1800);
  };

  const handleDownloadPgn = () => {
    const pgn = exportPgn({
      white: userColor === 'w' ? prefs.username : `Caissa Bot L${skillLevel}`,
      black: userColor === 'b' ? prefs.username : `Caissa Bot L${skillLevel}`,
      variant: boardState.variant,
      result: gameResult ? (gameResult.winner === 'w' ? '1-0' : gameResult.winner === 'b' ? '0-1' : '1/2-1/2') : '*',
      initialFen: initialFenRef.current,
      moves,
    });
    const blob = new Blob([pgn], { type: 'application/x-chess-pgn' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `caissa-${boardState.variant}-${Date.now()}.pgn`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ==================== CORRESPONDENCE CHESS STATE ====================
  const [corrGames, setCorrGames] = useState<CorrespondenceGame[]>(() => {
    try {
      const raw = localStorage.getItem('caissa_corr_games_v1');
      if (raw) return JSON.parse(raw);
    } catch {
      // ignore
    }
    const init = createInitialState('standard');
    return [
      {
        id: 'corr-1',
        opponent: 'Sora_Correspondence',
        opponentElo: 1620,
        userColor: 'w',
        variant: 'standard',
        daysPerMove: 3,
        lastMoveAt: Date.now(),
        state: init,
        moves: [],
        fens: [toFen(init)],
        conditionals: [],
        status: null,
      },
    ];
  });
  const [activeCorrId, setActiveCorrId] = useState<string>('corr-1');
  const [condOppSan, setCondOppSan] = useState<string>('');
  const [condMySan, setCondMySan] = useState<string>('');

  useEffect(() => {
    try {
      localStorage.setItem('caissa_corr_games_v1', JSON.stringify(corrGames));
    } catch {
      // ignore
    }
  }, [corrGames]);

  const activeCorr = corrGames.find((g) => g.id === activeCorrId) || corrGames[0];

  const corrOppReplies = useMemo(() => {
    if (!activeCorr || activeCorr.status) return [];
    if (activeCorr.state.turn === activeCorr.userColor) return [];
    const legal = getLegalMoves(activeCorr.state);
    return legal.slice(0, 24).map((m) => moveToSan(activeCorr.state, m, legal));
  }, [activeCorr]);

  const corrMyFollowups = useMemo(() => {
    if (!activeCorr || !condOppSan) return [];
    const oppMove = sanToMove(activeCorr.state, condOppSan);
    if (!oppMove) return [];
    const afterOpp = makeMove(activeCorr.state, oppMove).next;
    const legal = getLegalMoves(afterOpp);
    return legal.slice(0, 30).map((m) => moveToSan(afterOpp, m, legal));
  }, [activeCorr, condOppSan]);

  const createNewCorrGame = () => {
    const st = createInitialState('standard');
    const id = `corr-${Date.now()}`;
    const newGame: CorrespondenceGame = {
      id,
      opponent: 'Marcus_960',
      opponentElo: 1945,
      userColor: 'w',
      variant: 'standard',
      daysPerMove: 5,
      lastMoveAt: Date.now(),
      state: st,
      moves: [],
      fens: [toFen(st)],
      conditionals: [],
      status: null,
    };
    setCorrGames((prev) => [newGame, ...prev]);
    setActiveCorrId(id);
  };

  const applyCorrMove = (mv: Move) => {
    if (!activeCorr || activeCorr.status) return;
    const res = makeMove(activeCorr.state, mv);
    const nextMoves = [...activeCorr.moves, { ...mv, san: res.san, uci: res.uci }];
    const nextFens = [...activeCorr.fens, toFen(res.next)];
    const term = evaluateGameResult(res.next);
    soundFX.move();
    setCorrGames((prev) =>
      prev.map((g) =>
        g.id === activeCorr.id
          ? { ...g, state: res.next, moves: nextMoves, fens: nextFens, lastMoveAt: Date.now(), status: term }
          : g
      )
    );
  };

  const triggerCorrOpponentReply = () => {
    if (!activeCorr || activeCorr.status || activeCorr.state.turn === activeCorr.userColor) return;
    const { move } = findBestMove(activeCorr.state, 5);
    if (!move) return;
    const res1 = makeMove(activeCorr.state, move);
    let nextState = res1.next;
    const nextMoves = [...activeCorr.moves, { ...move, san: res1.san, uci: res1.uci }];
    const nextFens = [...activeCorr.fens, toFen(nextState)];
    let term = evaluateGameResult(nextState);
    let remainingConditionals = activeCorr.conditionals;

    // Check conditional premove match!
    if (!term) {
      const matched = activeCorr.conditionals.find(
        (c) => c.ifOpponentSan.replace(/[+#?!]/g, '') === res1.san.replace(/[+#?!]/g, '')
      );
      if (matched) {
        const myPre = sanToMove(nextState, matched.thenMySan);
        if (myPre) {
          const res2 = makeMove(nextState, myPre);
          nextState = res2.next;
          nextMoves.push({ ...myPre, san: res2.san, uci: res2.uci });
          nextFens.push(toFen(nextState));
          term = evaluateGameResult(nextState);
          remainingConditionals = [];
        }
      }
    }

    soundFX.move();
    setCorrGames((prev) =>
      prev.map((g) =>
        g.id === activeCorr.id
          ? {
              ...g,
              state: nextState,
              moves: nextMoves,
              fens: nextFens,
              conditionals: remainingConditionals,
              lastMoveAt: Date.now(),
              status: term,
            }
          : g
      )
    );
  };

  const addConditionalPremove = () => {
    if (!activeCorr || !condOppSan || !condMySan) return;
    const entry: ConditionalPremove = {
      id: `cp-${Date.now()}`,
      ifOpponentSan: condOppSan,
      thenMySan: condMySan,
    };
    setCorrGames((prev) =>
      prev.map((g) =>
        g.id === activeCorr.id ? { ...g, conditionals: [...g.conditionals, entry] } : g
      )
    );
    setCondOppSan('');
    setCondMySan('');
  };

  // ==================== SIMUL EXHIBITION STATE ====================
  interface SimulBoard {
    id: string;
    challenger: string;
    elo: number;
    skill: number;
    state: BoardState;
    moves: Move[];
    result: GameResult | null;
  }

  const [simulBoards, setSimulBoards] = useState<SimulBoard[]>(() => [
    { id: 'sim-1', challenger: 'Board 1 · Aria (1350)', elo: 1350, skill: 2, state: createInitialState('standard'), moves: [], result: null },
    { id: 'sim-2', challenger: 'Board 2 · Viktor (1550)', elo: 1550, skill: 3, state: createInitialState('standard'), moves: [], result: null },
    { id: 'sim-3', challenger: 'Board 3 · Nadia (1720)', elo: 1720, skill: 4, state: createInitialState('standard'), moves: [], result: null },
    { id: 'sim-4', challenger: 'Board 4 · Theo (1890)', elo: 1890, skill: 5, state: createInitialState('standard'), moves: [], result: null },
  ]);
  const [activeSimulIdx, setActiveSimulIdx] = useState(0);

  const handleSimulMove = (idx: number, mv: Move) => {
    const b = simulBoards[idx];
    if (!b || b.result || b.state.turn !== 'w') return;
    const res = makeMove(b.state, mv);
    const nextMoves = [...b.moves, { ...mv, san: res.san, uci: res.uci }];
    const term = evaluateGameResult(res.next);
    soundFX.move();

    setSimulBoards((prev) =>
      prev.map((item, i) => (i === idx ? { ...item, state: res.next, moves: nextMoves, result: term } : item))
    );

    if (!term) {
      window.setTimeout(() => {
        const ai = findBestMove(res.next, b.skill);
        if (ai.move) {
          const res2 = makeMove(res.next, ai.move);
          const term2 = evaluateGameResult(res2.next);
          setSimulBoards((prev) =>
            prev.map((item, i) =>
              i === idx
                ? {
                    ...item,
                    state: res2.next,
                    moves: [...nextMoves, { ...ai.move!, san: res2.san, uci: res2.uci }],
                    result: term2,
                  }
                : item
            )
          );
        }
      }, 450);
    }
  };

  const resetSimul = () => {
    setSimulBoards([
      { id: 'sim-1', challenger: 'Board 1 · Aria (1350)', elo: 1350, skill: 2, state: createInitialState('standard'), moves: [], result: null },
      { id: 'sim-2', challenger: 'Board 2 · Viktor (1550)', elo: 1550, skill: 3, state: createInitialState('standard'), moves: [], result: null },
      { id: 'sim-3', challenger: 'Board 3 · Nadia (1720)', elo: 1720, skill: 4, state: createInitialState('standard'), moves: [], result: null },
      { id: 'sim-4', challenger: 'Board 4 · Theo (1890)', elo: 1890, skill: 5, state: createInitialState('standard'), moves: [], result: null },
    ]);
    setActiveSimulIdx(0);
  };

  const addSimulChallenger = () => {
    if (simulBoards.length >= 6) return;
    const n = simulBoards.length + 1;
    const names = ['Dario', 'Klara', 'Mateo', 'Yuki'];
    const elo = 1400 + n * 95;
    setSimulBoards((prev) => [
      ...prev,
      {
        id: `sim-${Date.now()}`,
        challenger: `Board ${n} · ${names[n % names.length]} (${elo})`,
        elo,
        skill: Math.min(7, Math.max(2, n)),
        state: createInitialState('standard'),
        moves: [],
        result: null,
      },
    ]);
  };

  const currentVariantInfo = VARIANTS.find((v) => v.id === boardState.variant) || VARIANTS[0];
  const topSide: PieceColor = flipped ? 'w' : 'b';
  const bottomSide: PieceColor = flipped ? 'b' : 'w';

  return (
    <div className="space-y-6">
      {/* Sub-navigation bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-stone-200 dark:border-zinc-800 pb-3">
        <div className="flex items-center gap-1 p-1 bg-stone-100 dark:bg-zinc-900 rounded-lg overflow-x-auto">
          {([
            ['quick', 'Quick Match & Lobby'],
            ['variants', '8 Variants'],
            ['correspondence', 'Correspondence'],
            ['simul', 'Simultaneous Exhibition'],
            ['clock', 'OTB Clock'],
          ] as [PlaySubTab, string][]).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setSubTab(id)}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                subTab === id
                  ? 'bg-white dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 shadow-sm'
                  : 'text-stone-600 dark:text-zinc-400 hover:text-stone-900 dark:hover:text-zinc-100'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="text-xs text-stone-500 dark:text-zinc-400">
          <span>{currentVariantInfo.name}</span>
          {prefs.showRatings !== false && (
            <>
              <span className="mx-1.5" aria-hidden="true">·</span>
              <span className="font-mono tabular-nums text-stone-700 dark:text-zinc-300">
                {activeRatingCategory.toUpperCase()} {currentUserElo}
              </span>
            </>
          )}
          <span className="mx-1.5" aria-hidden="true">·</span>
          <span>{isRated && opponentMode === 'ai' ? 'Rated' : 'Casual'}</span>
        </div>
      </div>

      {/* ==================== OTB CHESS CLOCK ==================== */}
      {subTab === 'clock' && <OtbClockView />}

      {/* ==================== QUICK MATCH & VARIANTS ==================== */}
      {(subTab === 'quick' || subTab === 'variants') && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left / Center Board Area */}
          <div className="lg:col-span-7 flex flex-col items-center gap-2.5">
            {/* Top Player Bar */}
            <div className="w-full max-w-[540px] flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800">
              <div className="min-w-0 flex flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <div className={`w-3 h-3 rounded-sm border border-stone-400 shrink-0 ${flipped ? 'bg-stone-100' : 'bg-zinc-800'}`} />
                  <span className="text-sm font-semibold text-stone-900 dark:text-zinc-100 truncate">
                    {opponentMode === 'local'
                      ? flipped ? 'White (Local)' : 'Black (Local)'
                      : flipped === (userColor === 'w')
                      ? `${prefs.username}${prefs.showRatings !== false ? ` (${currentUserElo})` : ''}`
                      : zenMode
                      ? 'Caissa Engine'
                      : `${opponentLabel || `Caissa Engine L${skillLevel}`}${prefs.showRatings !== false ? ` (${750 + skillLevel * 200})` : ''}`}
                  </span>
                  {aiThinking && (
                    <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                      Thinking...
                    </span>
                  )}
                </div>
                <MaterialStrip state={displayedState} side={topSide} pieceSet={prefs.pieceSet} />
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {boardState.variant === 'threeCheck' && (
                  <span className="text-xs font-mono text-amber-600 dark:text-amber-400">
                    Checks: {boardState.checksGiven[topSide]}/3
                  </span>
                )}
                {timeControl.baseSeconds > 0 && (
                  <span
                    className={`font-mono tabular-nums text-base font-semibold px-2.5 py-1 rounded ${
                      boardState.turn === topSide && gameActive && !gameResult
                        ? 'bg-emerald-600 text-white'
                        : 'bg-stone-100 dark:bg-zinc-800 text-stone-800 dark:text-zinc-200'
                    }`}
                  >
                    {formatClock(clocks[topSide])}
                  </span>
                )}
              </div>
            </div>

            <ChessBoard
              state={displayedState}
              onMove={viewPly === null ? applyPlayerOrAiMove : undefined}
              flipped={flipped}
              interactive={gameActive && !gameResult && viewPly === null}
              allowedColor={opponentMode === 'local' ? 'both' : userColor}
              boardTheme={prefs.boardTheme}
              pieceSet={prefs.pieceSet}
              showCoordinates={prefs.showCoordinates}
              highlightLegal={prefs.highlightLegalMoves}
              showLastMove={prefs.showLastMove !== false}
              pieceScale={prefs.pieceScale || 'normal'}
              autoQueen={prefs.autoQueen}
              confirmMove={prefs.confirmMove}
              moveMethod={prefs.moveMethod}
              blindfold={blindfoldMode || !!prefs.blindfoldPieces}
              premoveQueue={opponentMode === 'ai' ? premoveQueue : []}
              onPremoveQueueChange={opponentMode === 'ai' ? setPremoveQueue : undefined}
              lastMove={activeLastMove}
            />

            {premoveQueue.length > 0 && (
              <div className="w-full max-w-[540px] flex items-center justify-between px-3 py-1.5 rounded-lg bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-900 text-xs text-sky-800 dark:text-sky-200">
                <span>
                  {premoveQueue.length} {premoveQueue.length === 1 ? 'premove' : 'premoves'} queued — right-click board or click Cancel to clear
                </span>
                <button
                  type="button"
                  onClick={() => setPremoveQueue([])}
                  className="font-semibold underline"
                >
                  Cancel
                </button>
              </div>
            )}

            {/* Bottom Player Bar */}
            <div className="w-full max-w-[540px] flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800">
              <div className="min-w-0 flex flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <div className={`w-3 h-3 rounded-sm border border-stone-400 shrink-0 ${flipped ? 'bg-zinc-800' : 'bg-stone-100'}`} />
                  <span className="text-sm font-semibold text-stone-900 dark:text-zinc-100 truncate">
                    {opponentMode === 'local'
                      ? flipped ? 'Black (Local)' : 'White (Local)'
                      : flipped === (userColor === 'w')
                      ? zenMode
                        ? 'Caissa Engine'
                        : `${opponentLabel || `Caissa Engine L${skillLevel}`}${prefs.showRatings !== false ? ` (${750 + skillLevel * 200})` : ''}`
                      : `${prefs.username}${prefs.showRatings !== false ? ` (${currentUserElo})` : ''}`}
                  </span>
                </div>
                <MaterialStrip state={displayedState} side={bottomSide} pieceSet={prefs.pieceSet} />
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {boardState.variant === 'threeCheck' && (
                  <span className="text-xs font-mono text-amber-600 dark:text-amber-400">
                    Checks: {boardState.checksGiven[bottomSide]}/3
                  </span>
                )}
                {timeControl.baseSeconds > 0 && (
                  <span
                    className={`font-mono tabular-nums text-base font-semibold px-2.5 py-1 rounded ${
                      boardState.turn === bottomSide && gameActive && !gameResult
                        ? 'bg-emerald-600 text-white'
                        : 'bg-stone-100 dark:bg-zinc-800 text-stone-800 dark:text-zinc-200'
                    }`}
                  >
                    {formatClock(clocks[bottomSide])}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Right Panel: Setup or Active Controls + Move List */}
          <div className="lg:col-span-5 space-y-5">
            {subTab === 'variants' && !zenMode && (
              <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-4 space-y-3">
                <h2 className="text-base font-semibold text-stone-900 dark:text-zinc-100">
                  Standard & 8 Chess Variants
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {VARIANTS.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => startNewGame(v.id)}
                      className={`text-left p-2.5 rounded-lg border transition-colors ${
                        selectedVariant === v.id
                          ? 'border-emerald-600 bg-emerald-50/70 dark:bg-emerald-950/30'
                          : 'border-stone-200 dark:border-zinc-800 hover:bg-stone-50 dark:hover:bg-zinc-800/60'
                      }`}
                    >
                      <div className="text-sm font-semibold text-stone-900 dark:text-zinc-100">
                        {v.name}
                      </div>
                      <div className="text-xs text-stone-500 dark:text-zinc-400 mt-0.5 line-clamp-1">
                        {v.shortDesc}
                      </div>
                    </button>
                  ))}
                </div>
                <p className="text-xs text-stone-600 dark:text-zinc-400 pt-1">
                  {VARIANTS.find((v) => v.id === selectedVariant)?.rules}
                </p>
              </div>
            )}

            {/* Game Setup Controls (hidden cleanly in Zen Mode) */}
            {!zenMode && (
            <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-stone-900 dark:text-zinc-100">
                  {gameActive ? 'Match Room' : 'Configure Match'}
                </h2>
                <span className="text-xs text-stone-500 dark:text-zinc-400 font-mono">
                  {currentVariantInfo.name}
                  {boardState.variant === 'chess960' && activeChess960Sp !== null ? ` · SP #${activeChess960Sp}` : ''}
                </span>
              </div>

              {/* Time control selector + Lichess Custom Sliders */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-stone-600 dark:text-zinc-400">
                    Time Control
                  </label>
                  <button
                    type="button"
                    onClick={() => setCustomTcOpen((v) => !v)}
                    className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 hover:underline"
                  >
                    {customTcOpen ? 'Show Presets' : 'Custom Sliders'}
                  </button>
                </div>

                {!customTcOpen ? (
                  <div className="grid grid-cols-4 gap-1.5">
                    {TIME_CONTROLS.map((tc) => (
                      <button
                        key={tc.id}
                        type="button"
                        onClick={() => setTimeControl(tc)}
                        className={`py-1.5 px-2 rounded-lg border text-center transition-colors ${
                          timeControl.id === tc.id
                            ? 'border-emerald-600 bg-emerald-600 text-white'
                            : 'border-stone-200 dark:border-zinc-800 text-stone-700 dark:text-zinc-300 hover:bg-stone-50 dark:hover:bg-zinc-800'
                        }`}
                      >
                        <div className="font-mono text-xs font-semibold">{tc.label}</div>
                        <div className="text-[10px] opacity-80">{tc.category}</div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="p-3 rounded-lg bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 space-y-2.5">
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-stone-600 dark:text-zinc-400">Minutes per side</span>
                        <span className="font-mono font-semibold text-stone-900 dark:text-zinc-100">
                          {customMinutes} min ({timeControl.category})
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0.25}
                        max={60}
                        step={0.25}
                        value={customMinutes}
                        onChange={(e) => {
                          const m = Number(e.target.value);
                          setCustomMinutes(m);
                          applyCustomTimeControl(m, customIncrement);
                        }}
                        className="w-full accent-emerald-600"
                      />
                    </div>
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-stone-600 dark:text-zinc-400">Increment in seconds</span>
                        <span className="font-mono font-semibold text-stone-900 dark:text-zinc-100">
                          +{customIncrement}s
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={60}
                        step={1}
                        value={customIncrement}
                        onChange={(e) => {
                          const inc = Number(e.target.value);
                          setCustomIncrement(inc);
                          applyCustomTimeControl(customMinutes, inc);
                        }}
                        className="w-full accent-emerald-600"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Opponent & Color */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-stone-600 dark:text-zinc-400 mb-1.5">
                    Opponent
                  </label>
                  <div className="flex gap-1 p-1 bg-stone-100 dark:bg-zinc-800 rounded-lg">
                    <button
                      type="button"
                      onClick={() => setOpponentMode('ai')}
                      className={`flex-1 py-1.5 text-xs font-medium rounded-md ${
                        opponentMode === 'ai'
                          ? 'bg-white dark:bg-zinc-900 text-stone-900 dark:text-zinc-100 shadow-sm'
                          : 'text-stone-600 dark:text-zinc-400'
                      }`}
                    >
                      Engine
                    </button>
                    <button
                      type="button"
                      onClick={() => setOpponentMode('local')}
                      className={`flex-1 py-1.5 text-xs font-medium rounded-md ${
                        opponentMode === 'local'
                          ? 'bg-white dark:bg-zinc-900 text-stone-900 dark:text-zinc-100 shadow-sm'
                          : 'text-stone-600 dark:text-zinc-400'
                      }`}
                    >
                      Over the Board
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-stone-600 dark:text-zinc-400 mb-1.5">
                    Play As
                  </label>
                  <div className="flex gap-1 p-1 bg-stone-100 dark:bg-zinc-800 rounded-lg">
                    {([
                      ['w', 'White'],
                      ['random', 'Random'],
                      ['b', 'Black'],
                    ] as const).map(([c, lbl]) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setUserColorChoice(c)}
                        className={`flex-1 py-1.5 text-xs font-medium rounded-md ${
                          userColorChoice === c
                            ? 'bg-white dark:bg-zinc-900 text-stone-900 dark:text-zinc-100 shadow-sm'
                            : 'text-stone-600 dark:text-zinc-400'
                        }`}
                      >
                        {lbl}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-stone-600 dark:text-zinc-400 mb-1.5">
                    Mode
                  </label>
                  <div className="flex gap-1 p-1 bg-stone-100 dark:bg-zinc-800 rounded-lg">
                    <button
                      type="button"
                      onClick={() => setIsRated(false)}
                      className={`flex-1 py-1.5 text-xs font-medium rounded-md ${
                        !isRated
                          ? 'bg-white dark:bg-zinc-900 text-stone-900 dark:text-zinc-100 shadow-sm'
                          : 'text-stone-600 dark:text-zinc-400'
                      }`}
                    >
                      Casual
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsRated(true)}
                      className={`flex-1 py-1.5 text-xs font-medium rounded-md ${
                        isRated
                          ? 'bg-white dark:bg-zinc-900 text-stone-900 dark:text-zinc-100 shadow-sm'
                          : 'text-stone-600 dark:text-zinc-400'
                      }`}
                    >
                      Rated
                    </button>
                  </div>
                </div>

                {selectedVariant === 'standard' ? (
                  <div>
                    <label className="block text-xs font-medium text-stone-600 dark:text-zinc-400 mb-1.5">
                      Odds / Handicap
                    </label>
                    <select
                      value={handicap}
                      onChange={(e) => setHandicap(e.target.value as HandicapPreset['id'])}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-xs font-medium"
                    >
                      {HANDICAP_PRESETS.map((h) => (
                        <option key={h.id} value={h.id}>
                          {h.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : selectedVariant === 'chess960' ? (
                  <div>
                    <label className="block text-xs font-medium text-stone-600 dark:text-zinc-400 mb-1.5">
                      Scharnagl SP (#0–#959)
                    </label>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setChess960Sp('random')}
                        className={`px-2 py-1.5 rounded-lg border text-[11px] font-medium whitespace-nowrap shrink-0 ${
                          chess960Sp === 'random'
                            ? 'border-emerald-600 bg-emerald-600 text-white'
                            : 'border-stone-200 dark:border-zinc-700 text-stone-600 dark:text-zinc-300'
                        }`}
                      >
                        Random
                      </button>
                      <input
                        type="number"
                        min={0}
                        max={959}
                        value={chess960Sp === 'random' ? '' : chess960Sp}
                        placeholder="#518"
                        onChange={(e) => {
                          const raw = e.target.value;
                          if (raw === '') setChess960Sp('random');
                          else setChess960Sp(Math.max(0, Math.min(959, Number(raw) || 0)));
                        }}
                        className="w-full px-2 py-1.5 rounded-lg border border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-950 font-mono text-xs"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="flex items-end text-[11px] text-stone-500 dark:text-zinc-400 pb-1.5">
                    Standard variant start position
                  </div>
                )}
              </div>

              {opponentMode === 'ai' && (
                <div className="space-y-2.5">
                  <div>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-stone-600 dark:text-zinc-400 font-medium">
                        Engine Strength
                      </span>
                      <span className="font-mono font-semibold text-stone-900 dark:text-zinc-100">
                        Level {skillLevel} ({750 + skillLevel * 200} Elo)
                      </span>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={8}
                      value={skillLevel}
                      onChange={(e) => setSkillLevel(Number(e.target.value))}
                      className="w-full accent-emerald-600"
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-stone-600 dark:text-zinc-400 font-medium">
                        Lobby Rating Range
                      </span>
                      <span className="font-mono text-stone-700 dark:text-zinc-300">
                        {Math.max(800, currentUserElo - ratingRange)}–{currentUserElo + ratingRange}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={100}
                      max={500}
                      step={50}
                      value={ratingRange}
                      onChange={(e) => setRatingRange(Number(e.target.value))}
                      className="w-full accent-emerald-600"
                    />
                  </div>
                </div>
              )}

              {/* Play From Position & Challenge Friend URL */}
              <div className="space-y-2 pt-1 border-t border-stone-100 dark:border-zinc-800">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setFromPositionOpen((v) => !v)}
                    className="font-medium text-stone-600 dark:text-zinc-400 hover:text-stone-900 dark:hover:text-zinc-100 underline-offset-2 hover:underline"
                  >
                    {fromPositionOpen ? 'Hide From Position' : 'From Position (FEN)'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const fenParam = encodeURIComponent(customStartFen.trim() || toFen(boardState));
                      const link = `${window.location.origin}${window.location.pathname}#play=${selectedVariant}&fen=${fenParam}`;
                      navigator.clipboard.writeText(link).catch(() => {});
                      setChallengeCopied(true);
                      setTimeout(() => setChallengeCopied(false), 1800);
                    }}
                    className="font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1 hover:underline"
                  >
                    <Link2 className="w-3.5 h-3.5" />
                    {challengeCopied ? 'Challenge Link Copied!' : 'Challenge a Friend'}
                  </button>
                </div>

                {fromPositionOpen && (
                  <div className="space-y-1.5">
                    <input
                      type="text"
                      value={customStartFen}
                      onChange={(e) => setCustomStartFen(e.target.value)}
                      placeholder="Paste starting FEN (optional)..."
                      className="w-full px-2.5 py-1.5 rounded-lg border border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-950 font-mono text-[11px]"
                    />
                    <div className="flex flex-wrap gap-1">
                      {[
                        ['Najdorf', 'rnbqkb1r/1p2pppp/p2p1n2/8/3NP3/2N5/PPP2PPP/R1BQKB1R w KQkq - 0 6'],
                        ['Lucena', '1K1k4/1P6/8/8/8/8/r7/4R3 w - - 0 1'],
                        ['King Gambit', 'rnbqkbnr/pppp1ppp/8/4p3/4PP2/8/PPPP2PP/RNBQKBNR b KQkq - 0 2'],
                      ].map(([lbl, fen]) => (
                        <button
                          key={lbl}
                          type="button"
                          onClick={() => setCustomStartFen(fen)}
                          className="px-2 py-0.5 rounded border border-stone-200 dark:border-zinc-700 text-[11px] hover:bg-stone-100 dark:hover:bg-zinc-800"
                        >
                          {lbl}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => startNewGame()}
                className="w-full py-2.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2"
              >
                <Swords className="w-4 h-4" />
                {gameActive ? 'Start Fresh Game' : 'Start Game'}
              </button>
            </div>
            )}

            {/* Open Lobby Seeks (List + Lichess 2D Scatter Graph) */}
            {subTab === 'quick' && !zenMode && !gameActive && (
              <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-4 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-500 dark:text-zinc-400">
                    Open Lobby Seeks
                  </h3>
                  <div className="flex items-center gap-1 p-0.5 bg-stone-100 dark:bg-zinc-800 rounded-md text-[11px]">
                    <button
                      type="button"
                      onClick={() => setLobbyViewMode('list')}
                      className={`px-2 py-0.5 rounded font-medium ${
                        lobbyViewMode === 'list'
                          ? 'bg-white dark:bg-zinc-900 text-stone-900 dark:text-zinc-100 shadow-xs'
                          : 'text-stone-500 dark:text-zinc-400'
                      }`}
                    >
                      List
                    </button>
                    <button
                      type="button"
                      onClick={() => setLobbyViewMode('graph')}
                      className={`px-2 py-0.5 rounded font-medium ${
                        lobbyViewMode === 'graph'
                          ? 'bg-white dark:bg-zinc-900 text-stone-900 dark:text-zinc-100 shadow-xs'
                          : 'text-stone-500 dark:text-zinc-400'
                      }`}
                    >
                      Seek Graph
                    </button>
                  </div>
                </div>

                {lobbyViewMode === 'list' ? (
                  <div className="divide-y divide-stone-100 dark:divide-zinc-800">
                    {LOBBY_SEEKS.map((seek) => (
                      <button
                        key={seek.id}
                        type="button"
                        onClick={() =>
                          startNewGame(seek.variant, seek.color, {
                            tcId: seek.timeControlId,
                            skill: seek.skill,
                            rated: seek.rated,
                            label: seek.player,
                          })
                        }
                        className="w-full py-2 px-1 flex items-center justify-between gap-2 text-xs hover:bg-stone-50 dark:hover:bg-zinc-800/60 rounded transition-colors text-left"
                      >
                        <div className="min-w-0">
                          <div className="font-semibold text-stone-900 dark:text-zinc-100 truncate">
                            {seek.player} ({seek.elo})
                          </div>
                          <div className="text-[11px] font-mono text-stone-500 dark:text-zinc-400">
                            {seek.timeControlId} · {seek.variant === 'chess960' ? 'Chess960' : 'Standard'} · {seek.rated ? 'Rated' : 'Casual'}
                          </div>
                        </div>
                        <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 shrink-0">
                          Play
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  (() => {
                    const tcX = (tcId: string) => {
                      const map: Record<string, number> = { '1+0': 45, '3+2': 115, '5+3': 185, '10+0': 250 };
                      return map[tcId] ?? 150;
                    };
                    const eloY = (elo: number) => {
                      const clamped = Math.max(1000, Math.min(2200, elo));
                      return 130 - ((clamped - 1000) / 1200) * 110;
                    };
                    const hovered = LOBBY_SEEKS.find((s) => s.id === hoveredSeekId) || null;
                    return (
                      <div className="space-y-2">
                        <div className="rounded-lg bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 p-2">
                          <svg viewBox="0 0 300 150" className="w-full h-36">
                            {/* Grid lines */}
                            {[1200, 1600, 2000].map((r) => (
                              <g key={r}>
                                <line
                                  x1="28"
                                  y1={eloY(r)}
                                  x2="288"
                                  y2={eloY(r)}
                                  stroke="currentColor"
                                  className="text-stone-200 dark:text-zinc-800"
                                  strokeDasharray="3,3"
                                />
                                <text
                                  x="2"
                                  y={eloY(r) + 3}
                                  className="fill-stone-400 dark:fill-zinc-500 text-[8px] font-mono"
                                >
                                  {r}
                                </text>
                              </g>
                            ))}
                            {/* Speed labels */}
                            {[
                              ['1+0', 45],
                              ['3+2', 115],
                              ['5+3', 185],
                              ['10+0', 250],
                            ].map(([lbl, x]) => (
                              <text
                                key={String(lbl)}
                                x={Number(x)}
                                y="145"
                                textAnchor="middle"
                                className="fill-stone-400 dark:fill-zinc-500 text-[8px] font-mono"
                              >
                                {lbl}
                              </text>
                            ))}
                            {/* Plotted Seeks */}
                            {LOBBY_SEEKS.map((seek) => {
                              const cx = tcX(seek.timeControlId);
                              const cy = eloY(seek.elo);
                              return (
                                <g
                                  key={seek.id}
                                  className="cursor-pointer"
                                  onMouseEnter={() => setHoveredSeekId(seek.id)}
                                  onMouseLeave={() => setHoveredSeekId(null)}
                                  onClick={() =>
                                    startNewGame(seek.variant, seek.color, {
                                      tcId: seek.timeControlId,
                                      skill: seek.skill,
                                      rated: seek.rated,
                                      label: seek.player,
                                    })
                                  }
                                >
                                  <circle
                                    cx={cx}
                                    cy={cy}
                                    r={hoveredSeekId === seek.id ? 8 : 6}
                                    fill={seek.rated ? '#059669' : '#d97706'}
                                    stroke="#ffffff"
                                    strokeWidth="1.5"
                                  />
                                </g>
                              );
                            })}
                          </svg>
                        </div>
                        <div className="text-[11px] font-mono text-stone-500 dark:text-zinc-400 flex items-center justify-between">
                          <span>
                            {hovered
                              ? `${hovered.player} (${hovered.elo}) · ${hovered.timeControlId} · Click to accept`
                              : 'Hover or click any dot to accept seek'}
                          </span>
                          <span>Green = Rated · Amber = Casual</span>
                        </div>
                      </div>
                    );
                  })()
                )}
              </div>
            )}

            {/* Game Result Banner */}
            {gameResult && (
              <div className="bg-stone-100 dark:bg-zinc-900 border border-stone-300 dark:border-zinc-700 rounded-xl p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-bold text-stone-900 dark:text-zinc-100">
                      {gameResult.status === 'aborted'
                        ? 'Game Aborted'
                        : gameResult.winner === 'draw'
                        ? 'Game Drawn'
                        : `${gameResult.winner === 'w' ? 'White' : 'Black'} Wins`}
                      {lastEloDelta !== null && gameResult.status !== 'aborted' && (
                        <span
                          className={`ml-2 font-mono text-xs ${
                            lastEloDelta >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                          }`}
                        >
                          ({lastEloDelta >= 0 ? `+${lastEloDelta}` : lastEloDelta} {activeRatingCategory.toUpperCase()})
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-stone-600 dark:text-zinc-400">
                      {gameResult.reason}
                      {savedNotice ? ' · Saved to History' : ''}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        startNewGame(
                          boardState.variant,
                          opponentMode === 'ai' ? (userColor === 'w' ? 'b' : 'w') : 'w'
                        )
                      }
                      className="px-3 py-1.5 rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 text-xs font-semibold flex items-center gap-1 whitespace-nowrap shrink-0"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Rematch (Swap)
                    </button>
                    <button
                      type="button"
                      onClick={() => startNewGame(boardState.variant, userColor)}
                      className="px-3 py-1.5 rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 text-xs font-semibold whitespace-nowrap shrink-0"
                    >
                      New Game
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onSendToAnalysis({
                          fen: initialFenRef.current,
                          moves,
                          fens,
                          variant: boardState.variant,
                        })
                      }
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0"
                    >
                      <Microscope className="w-3.5 h-3.5" />
                      Analyze
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Move List & Match Controls */}
            <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-stone-600 dark:text-zinc-400">
                  Move List ({moves.length} plies)
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setZenMode((z) => !z)}
                    className={`p-1.5 rounded hover:bg-stone-100 dark:hover:bg-zinc-800 ${
                      zenMode ? 'text-emerald-600 dark:text-emerald-400' : 'text-stone-600 dark:text-zinc-400'
                    }`}
                    title="Zen Mode (shortcut: Z)"
                  >
                    {zenMode ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => setBlindfoldMode((b) => !b)}
                    className={`p-1.5 rounded hover:bg-stone-100 dark:hover:bg-zinc-800 ${
                      blindfoldMode ? 'text-emerald-600 dark:text-emerald-400' : 'text-stone-600 dark:text-zinc-400'
                    }`}
                    title="Blindfold Mode (hide pieces)"
                  >
                    {blindfoldMode ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
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
                    onClick={handleCopyPgn}
                    className="p-1.5 rounded hover:bg-stone-100 dark:hover:bg-zinc-800 text-stone-600 dark:text-zinc-400"
                    title="Copy PGN"
                  >
                    {copiedPgn ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadPgn}
                    className="p-1.5 rounded hover:bg-stone-100 dark:hover:bg-zinc-800 text-stone-600 dark:text-zinc-400"
                    title="Download PGN"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="max-h-48 overflow-y-auto thin-scroll border border-stone-100 dark:border-zinc-800 rounded-lg p-2 bg-stone-50 dark:bg-zinc-950 font-mono text-xs">
                {moves.length === 0 ? (
                  <p className="text-stone-400 dark:text-zinc-500 text-center py-4 font-sans">
                    {gameActive ? 'Make your opening move on the board.' : 'Click Start Game to begin.'}
                  </p>
                ) : (
                  <div className="grid grid-cols-12 gap-y-1">
                    {Array.from({ length: Math.ceil(moves.length / 2) }).map((_, rowIdx) => {
                      const wIdx = rowIdx * 2;
                      const bIdx = wIdx + 1;
                      return (
                        <React.Fragment key={rowIdx}>
                          <div className="col-span-2 text-stone-400 dark:text-zinc-500 py-0.5">
                            {rowIdx + 1}.
                          </div>
                          <button
                            type="button"
                            onClick={() => setViewPly(wIdx + 1 === moves.length ? null : wIdx + 1)}
                            className={`col-span-5 text-left px-1.5 py-0.5 rounded ${
                              (viewPly === wIdx + 1 || (viewPly === null && wIdx + 1 === moves.length))
                                ? 'bg-emerald-600/15 text-emerald-700 dark:text-emerald-400 font-semibold'
                                : 'hover:bg-stone-200/70 dark:hover:bg-zinc-800 text-stone-800 dark:text-zinc-200'
                            }`}
                          >
                            {moves[wIdx]?.san}
                          </button>
                          <button
                            type="button"
                            disabled={!moves[bIdx]}
                            onClick={() => moves[bIdx] && setViewPly(bIdx + 1 === moves.length ? null : bIdx + 1)}
                            className={`col-span-5 text-left px-1.5 py-0.5 rounded ${
                              moves[bIdx] && (viewPly === bIdx + 1 || (viewPly === null && bIdx + 1 === moves.length))
                                ? 'bg-emerald-600/15 text-emerald-700 dark:text-emerald-400 font-semibold'
                                : 'hover:bg-stone-200/70 dark:hover:bg-zinc-800 text-stone-800 dark:text-zinc-200'
                            }`}
                          >
                            {moves[bIdx]?.san || ''}
                          </button>
                        </React.Fragment>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Keyboard Move Input (SAN / UCI — helpful for blindfold & rapid play) */}
              {gameActive && !gameResult && (
                <form onSubmit={handleMoveInputSubmit} className="space-y-1">
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      value={moveInput}
                      onChange={(e) => {
                        setMoveInput(e.target.value);
                        if (moveInputError) setMoveInputError(null);
                      }}
                      placeholder="Type move (e.g. e4, Nf3, O-O)"
                      className="flex-1 px-2.5 py-1.5 rounded-lg border border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-950 font-mono text-xs text-stone-900 dark:text-zinc-100"
                    />
                    <button
                      type="submit"
                      className="px-3 py-1.5 rounded-lg bg-stone-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-semibold whitespace-nowrap shrink-0"
                    >
                      Play
                    </button>
                  </div>
                  {moveInputError && (
                    <div className="text-[11px] text-red-600 dark:text-red-400">{moveInputError}</div>
                  )}
                </form>
              )}

              {gameActive && !gameResult && (
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleTakeback}
                    disabled={moves.length === 0}
                    className="flex-1 py-1.5 px-2 rounded-lg border border-stone-200 dark:border-zinc-800 text-xs font-medium text-stone-700 dark:text-zinc-300 hover:bg-stone-50 dark:hover:bg-zinc-800 disabled:opacity-40 flex items-center justify-center gap-1 whitespace-nowrap shrink-0"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Takeback
                  </button>
                  {timeControl.baseSeconds > 0 && (
                    <button
                      type="button"
                      onClick={handleGiveMoreTime}
                      className="py-1.5 px-2.5 rounded-lg border border-stone-200 dark:border-zinc-800 text-xs font-medium font-mono text-stone-700 dark:text-zinc-300 hover:bg-stone-50 dark:hover:bg-zinc-800 whitespace-nowrap shrink-0"
                      title="Give opponent +15 seconds"
                    >
                      +15s
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      finishAndRecordGame(
                        { status: 'draw_agreement', winner: 'draw', reason: 'Draw agreed' },
                        moves,
                        fens
                      )
                    }
                    className="flex-1 py-1.5 px-2 rounded-lg border border-stone-200 dark:border-zinc-800 text-xs font-medium text-stone-700 dark:text-zinc-300 hover:bg-stone-50 dark:hover:bg-zinc-800 flex items-center justify-center gap-1 whitespace-nowrap shrink-0"
                  >
                    <Handshake className="w-3.5 h-3.5" />
                    Draw
                  </button>
                  {moves.length < 2 ? (
                    <button
                      type="button"
                      onClick={() =>
                        finishAndRecordGame(
                          {
                            status: 'aborted',
                            winner: 'draw',
                            reason: 'Game aborted before move 2 (no rating change)',
                          },
                          moves,
                          fens
                        )
                      }
                      className="flex-1 py-1.5 px-2 rounded-lg border border-stone-300 dark:border-zinc-700 text-xs font-medium text-stone-700 dark:text-zinc-300 hover:bg-stone-100 dark:hover:bg-zinc-800 flex items-center justify-center gap-1 whitespace-nowrap shrink-0"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Abort
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() =>
                        finishAndRecordGame(
                          {
                            status: 'resigned',
                            winner: userColor === 'w' ? 'b' : 'w',
                            reason: `${userColor === 'w' ? 'White' : 'Black'} resigned`,
                          },
                          moves,
                          fens
                        )
                      }
                      className="flex-1 py-1.5 px-2 rounded-lg border border-red-200 dark:border-red-900/50 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 flex items-center justify-center gap-1 whitespace-nowrap shrink-0"
                    >
                      <Flag className="w-3.5 h-3.5" />
                      Resign
                    </button>
                  )}
                </div>
              )}

              {/* Claim 3-Fold Repetition / 50-Move Rule Draw */}
              {gameActive &&
                !gameResult &&
                (boardState.halfmoveClock >= 100 ||
                  posKeys.filter((k) => k === posKeys[posKeys.length - 1]).length >= 3) && (
                  <button
                    type="button"
                    onClick={() =>
                      finishAndRecordGame(
                        {
                          status: boardState.halfmoveClock >= 100 ? 'draw_50move' : 'draw_repetition',
                          winner: 'draw',
                          reason:
                            boardState.halfmoveClock >= 100
                              ? 'Draw claimed by 50-move rule'
                              : 'Draw claimed by threefold repetition',
                        },
                        moves,
                        fens
                      )
                    }
                    className="w-full py-1.5 px-3 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold"
                  >
                    Claim Draw ({boardState.halfmoveClock >= 100 ? '50-Move Rule' : 'Threefold Repetition'})
                  </button>
                )}
            </div>

            {/* In-Game Chat Room (with Disable Chat / Kid Mode toggle) */}
            {!zenMode && (
              <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-4 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-stone-700 dark:text-zinc-300">
                    <MessageSquare className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Match Chat</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setChatDisabled((d) => !d)}
                    className="text-[11px] font-medium text-stone-500 dark:text-zinc-400 hover:text-stone-900 dark:hover:text-zinc-100"
                  >
                    {chatDisabled ? 'Enable Chat' : 'Kid Mode (Hide Chat)'}
                  </button>
                </div>

                {!chatDisabled ? (
                  <>
                    <div className="max-h-24 overflow-y-auto thin-scroll space-y-1 text-xs bg-stone-50 dark:bg-zinc-950 rounded-lg p-2 border border-stone-100 dark:border-zinc-800">
                      {chatMessages.length === 0 ? (
                        <p className="text-stone-400 dark:text-zinc-500 text-[11px]">
                          Say hello or use quick presets below.
                        </p>
                      ) : (
                        chatMessages.map((msg) => (
                          <div key={msg.id} className="leading-snug">
                            <span className="font-semibold text-stone-800 dark:text-zinc-200">
                              {msg.sender}:{' '}
                            </span>
                            <span className="text-stone-600 dark:text-zinc-400">{msg.text}</span>
                          </div>
                        ))
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      {['glhf', 'wp', 'gg', 'ty'].map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => {
                            const oppName = opponentLabel || `Caissa Bot L${skillLevel}`;
                            const replyMap: Record<string, string> = {
                              glhf: 'Good luck, have fun!',
                              wp: 'Thanks — sharp play!',
                              gg: 'Good game!',
                              ty: 'Anytime!',
                            };
                            setChatMessages((prev) => [
                              ...prev.slice(-20),
                              { id: `u-${Date.now()}`, sender: prefs.username, text: preset },
                              ...(opponentMode === 'ai'
                                ? [{ id: `b-${Date.now() + 1}`, sender: oppName, text: replyMap[preset] }]
                                : []),
                            ]);
                          }}
                          className="px-2 py-1 rounded border border-stone-200 dark:border-zinc-700 text-[11px] font-mono text-stone-600 dark:text-zinc-300 hover:bg-stone-100 dark:hover:bg-zinc-800"
                        >
                          {preset}
                        </button>
                      ))}
                    </div>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const clean = chatInput.trim();
                        if (!clean) return;
                        const oppName = opponentLabel || `Caissa Bot L${skillLevel}`;
                        setChatMessages((prev) => [
                          ...prev.slice(-20),
                          { id: `u-${Date.now()}`, sender: prefs.username, text: clean },
                          ...(opponentMode === 'ai'
                            ? [
                                {
                                  id: `b-${Date.now() + 1}`,
                                  sender: oppName,
                                  text: 'Focus on the board — good game!',
                                },
                              ]
                            : []),
                        ]);
                        setChatInput('');
                      }}
                      className="flex gap-1.5"
                    >
                      <input
                        type="text"
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        placeholder="Send chat message..."
                        className="flex-1 px-2.5 py-1.5 rounded-lg border border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-950 text-xs"
                      />
                      <button
                        type="submit"
                        className="px-2.5 py-1.5 rounded-lg bg-stone-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-semibold shrink-0"
                        title="Send chat"
                      >
                        <Send className="w-3.5 h-3.5" />
                      </button>
                    </form>
                  </>
                ) : (
                  <p className="text-[11px] text-stone-400 dark:text-zinc-500">
                    Chat hidden (Kid Mode active).
                  </p>
                )}
              </div>
            )}

            {/* Recent Games Archive */}
            {!zenMode && games.length > 0 && (
              <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-stone-700 dark:text-zinc-300">
                    <History className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Recent Games ({games.length})</span>
                  </div>
                </div>
                <div className="space-y-1.5 max-h-40 overflow-y-auto thin-scroll">
                  {games.slice(0, 6).map((g) => (
                    <div
                      key={g.id}
                      className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg bg-stone-50 dark:bg-zinc-950 border border-stone-100 dark:border-zinc-800 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="font-medium text-stone-900 dark:text-zinc-100 truncate">
                          {g.white} vs {g.black}
                        </div>
                        <div className="text-[11px] font-mono text-stone-500 dark:text-zinc-400 truncate">
                          {g.result} · {g.timeControl} · {g.openingName || g.variant}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          onSendToAnalysis({
                            moves: g.moves,
                            fens: g.fens,
                            variant: g.variant,
                          })
                        }
                        className="px-2.5 py-1 rounded border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 whitespace-nowrap shrink-0"
                      >
                        Analyze
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================== CORRESPONDENCE WITH CONDITIONAL PREMOVES ==================== */}
      {subTab === 'correspondence' && activeCorr && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-7 flex flex-col items-center gap-3">
            <div className="w-full max-w-[540px] flex items-center justify-between px-3 py-2 rounded-lg bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800">
              <div>
                <span className="text-sm font-semibold text-stone-900 dark:text-zinc-100">
                  vs {activeCorr.opponent} ({activeCorr.opponentElo})
                </span>
                <span className="text-xs text-stone-500 dark:text-zinc-400 ml-2">
                  {activeCorr.daysPerMove} days/move
                </span>
              </div>
              <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                {activeCorr.status
                  ? activeCorr.status.reason
                  : activeCorr.state.turn === activeCorr.userColor
                  ? 'Your turn to move'
                  : 'Waiting for opponent'}
              </span>
            </div>

            <ChessBoard
              state={activeCorr.state}
              onMove={applyCorrMove}
              allowedColor={activeCorr.userColor}
              interactive={!activeCorr.status}
              boardTheme={prefs.boardTheme}
              pieceSet={prefs.pieceSet}
              showCoordinates={prefs.showCoordinates}
              highlightLegal={prefs.highlightLegalMoves}
            />
          </div>

          <div className="lg:col-span-5 space-y-5">
            {/* Saved correspondence games list */}
            <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-stone-900 dark:text-zinc-100">
                  Correspondence Games
                </h2>
                <button
                  type="button"
                  onClick={createNewCorrGame}
                  className="px-2.5 py-1 rounded-md bg-emerald-600 text-white text-xs font-medium flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  New Match
                </button>
              </div>
              <div className="space-y-1.5">
                {corrGames.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => setActiveCorrId(g.id)}
                    className={`w-full text-left px-3 py-2 rounded-lg border text-xs flex items-center justify-between ${
                      g.id === activeCorr.id
                        ? 'border-emerald-600 bg-emerald-50/70 dark:bg-emerald-950/30'
                        : 'border-stone-200 dark:border-zinc-800 hover:bg-stone-50 dark:hover:bg-zinc-800/50'
                    }`}
                  >
                    <div>
                      <div className="font-semibold text-stone-900 dark:text-zinc-100">
                        vs {g.opponent}
                      </div>
                      <div className="text-stone-500 dark:text-zinc-400">
                        Move {g.state.fullmoveNumber} · {g.conditionals.length} conditional premoves
                      </div>
                    </div>
                    <span className="font-mono text-stone-600 dark:text-zinc-300">
                      {g.state.turn === g.userColor ? 'Your Turn' : 'Waiting'}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Conditional Premove Builder */}
            <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-stone-900 dark:text-zinc-100">
                  Conditional Premoves
                </h3>
                <Clock className="w-4 h-4 text-stone-400" />
              </div>
              <p className="text-xs text-stone-600 dark:text-zinc-400">
                Program automatic responses when it is your opponent&apos;s turn. If they play the predicted move, your reply fires immediately.
              </p>

              {activeCorr.state.turn !== activeCorr.userColor && !activeCorr.status ? (
                <div className="space-y-2.5">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-medium text-stone-500 dark:text-zinc-400 mb-1">
                        If opponent plays
                      </label>
                      <select
                        value={condOppSan}
                        onChange={(e) => {
                          setCondOppSan(e.target.value);
                          setCondMySan('');
                        }}
                        className="w-full px-2.5 py-1.5 rounded-lg border border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-xs font-mono"
                      >
                        <option value="">Select move...</option>
                        {corrOppReplies.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-stone-500 dark:text-zinc-400 mb-1">
                        Then I play
                      </label>
                      <select
                        value={condMySan}
                        onChange={(e) => setCondMySan(e.target.value)}
                        disabled={!condOppSan}
                        className="w-full px-2.5 py-1.5 rounded-lg border border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-xs font-mono disabled:opacity-50"
                      >
                        <option value="">Select reply...</option>
                        {corrMyFollowups.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={addConditionalPremove}
                      disabled={!condOppSan || !condMySan}
                      className="flex-1 py-1.5 px-3 rounded-lg bg-stone-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-medium disabled:opacity-40"
                    >
                      Add Conditional Rule
                    </button>
                    <button
                      type="button"
                      onClick={triggerCorrOpponentReply}
                      className="py-1.5 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium"
                    >
                      Receive Opponent Move
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-stone-500 dark:text-zinc-400 bg-stone-50 dark:bg-zinc-950 p-3 rounded-lg">
                  Make your move on the board first, then set conditional premoves while waiting for your opponent&apos;s reply.
                </div>
              )}

              {activeCorr.conditionals.length > 0 && (
                <div className="space-y-1.5 pt-2 border-t border-stone-100 dark:border-zinc-800">
                  {activeCorr.conditionals.map((cp) => (
                    <div
                      key={cp.id}
                      className="flex items-center justify-between px-2.5 py-1.5 rounded bg-stone-50 dark:bg-zinc-950 text-xs font-mono"
                    >
                      <span>
                        If <strong className="text-stone-900 dark:text-zinc-100">{cp.ifOpponentSan}</strong> →{' '}
                        <strong className="text-emerald-600 dark:text-emerald-400">{cp.thenMySan}</strong>
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setCorrGames((prev) =>
                            prev.map((g) =>
                              g.id === activeCorr.id
                                ? { ...g, conditionals: g.conditionals.filter((x) => x.id !== cp.id) }
                                : g
                            )
                          )
                        }
                        className="text-stone-400 hover:text-red-500"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ==================== SIMULTANEOUS EXHIBITION ==================== */}
      {subTab === 'simul' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-7 flex flex-col items-center gap-3">
            <div className="w-full max-w-[540px] flex items-center justify-between px-3 py-2 rounded-lg bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800">
              <span className="text-sm font-semibold text-stone-900 dark:text-zinc-100">
                {simulBoards[activeSimulIdx].challenger}
              </span>
              <span className="text-xs font-mono text-emerald-600 dark:text-emerald-400">
                {simulBoards[activeSimulIdx].result
                  ? simulBoards[activeSimulIdx].result!.reason
                  : simulBoards[activeSimulIdx].state.turn === 'w'
                  ? 'Your Turn'
                  : 'Challenger Thinking...'}
              </span>
            </div>

            <ChessBoard
              state={simulBoards[activeSimulIdx].state}
              onMove={(mv) => handleSimulMove(activeSimulIdx, mv)}
              allowedColor="w"
              interactive={!simulBoards[activeSimulIdx].result}
              boardTheme={prefs.boardTheme}
              pieceSet={prefs.pieceSet}
              showCoordinates={prefs.showCoordinates}
              highlightLegal={prefs.highlightLegalMoves}
            />
          </div>

          <div className="lg:col-span-5 space-y-4">
            <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold text-stone-900 dark:text-zinc-100">
                    Simultaneous Exhibition Host
                  </h2>
                  <p className="text-xs text-stone-500 dark:text-zinc-400">
                    Play {simulBoards.length} boards at once as White against rated challengers. Score:{' '}
                    <span className="font-mono font-semibold text-stone-800 dark:text-zinc-200">
                      {simulBoards.reduce(
                        (acc, sb) =>
                          acc +
                          (!sb.result ? 0 : sb.result.winner === 'w' ? 1 : sb.result.winner === 'draw' ? 0.5 : 0),
                        0
                      )}{' '}
                      / {simulBoards.length}
                    </span>
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  {simulBoards.length < 6 && (
                    <button
                      type="button"
                      onClick={addSimulChallenger}
                      className="px-2.5 py-1.5 rounded-lg border border-emerald-600 text-emerald-700 dark:text-emerald-300 text-xs font-medium hover:bg-emerald-50 dark:hover:bg-emerald-950/30 flex items-center gap-1 whitespace-nowrap shrink-0"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Add Board
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={resetSimul}
                    className="px-3 py-1.5 rounded-lg border border-stone-200 dark:border-zinc-700 text-xs font-medium hover:bg-stone-50 dark:hover:bg-zinc-800 whitespace-nowrap shrink-0"
                  >
                    Reset Simul
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2">
                {simulBoards.map((sb, idx) => {
                  const needsMove = !sb.result && sb.state.turn === 'w';
                  return (
                    <button
                      key={sb.id}
                      type="button"
                      onClick={() => setActiveSimulIdx(idx)}
                      className={`p-3 rounded-lg border text-left transition-colors flex items-center justify-between ${
                        idx === activeSimulIdx
                          ? 'border-emerald-600 bg-emerald-50/70 dark:bg-emerald-950/30'
                          : 'border-stone-200 dark:border-zinc-800 hover:bg-stone-50 dark:hover:bg-zinc-800/50'
                      }`}
                    >
                      <div>
                        <div className="text-sm font-semibold text-stone-900 dark:text-zinc-100">
                          {sb.challenger}
                        </div>
                        <div className="text-xs text-stone-500 dark:text-zinc-400 font-mono">
                          Move {sb.state.fullmoveNumber} · {sb.moves.length} plies
                        </div>
                      </div>
                      <span
                        className={`text-xs font-medium ${
                          sb.result
                            ? 'text-stone-500 dark:text-zinc-400'
                            : needsMove
                            ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                            : 'text-amber-600 dark:text-amber-400'
                        }`}
                      >
                        {sb.result ? sb.result.reason : needsMove ? 'Action Needed' : 'Waiting'}
                      </span>
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => {
                  const nextIdx = simulBoards.findIndex(
                    (sb, i) => i !== activeSimulIdx && !sb.result && sb.state.turn === 'w'
                  );
                  if (nextIdx !== -1) setActiveSimulIdx(nextIdx);
                }}
                className="w-full py-2 px-4 rounded-lg bg-stone-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-semibold flex items-center justify-center gap-1.5"
              >
                <Layers className="w-3.5 h-3.5" />
                Jump to Next Board Needing Move
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
