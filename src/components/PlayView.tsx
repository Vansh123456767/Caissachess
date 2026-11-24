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
  UserPreferences,
} from '../types/chess';
import {
  createInitialState,
  evaluateGameResult,
  exportPgn,
  getLegalMoves,
  isInCheck,
  makeMove,
  moveToSan,
  parseFen,
  positionKey,
  sanToMove,
  toFen,
  VARIANTS,
} from '../engine/chessEngine';
import { findBestMove } from '../engine/aiSearch';
import { detectOpeningFromMoves } from '../data/openings';
import { ChessBoard } from './ChessBoard';
import { soundFX } from '../utils/sound';
import {
  ArrowLeftRight,
  Check,
  Clock,
  Copy,
  Download,
  Flag,
  Handshake,
  Layers,
  Microscope,
  Plus,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  Swords,
  Trash2,
} from 'lucide-react';

interface PlayViewProps {
  prefs: UserPreferences;
  initialVariant?: ChessVariant;
  initialFen?: string | null;
  onGameCompleted: (record: GameRecord) => void;
  onSendToAnalysis: (pgnOrFen: { fen?: string; moves?: Move[]; fens?: string[]; variant: ChessVariant }) => void;
}

type PlaySubTab = 'quick' | 'variants' | 'correspondence' | 'simul';

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
  initialVariant = 'standard',
  initialFen = null,
  onGameCompleted,
  onSendToAnalysis,
}) => {
  const [subTab, setSubTab] = useState<PlaySubTab>(initialVariant !== 'standard' ? 'variants' : 'quick');

  // Quick / Variant Game Config
  const [selectedVariant, setSelectedVariant] = useState<ChessVariant>(initialVariant);
  const [timeControl, setTimeControl] = useState<TimeControlOption>(TIME_CONTROLS[3]); // 3+2
  const [opponentMode, setOpponentMode] = useState<'ai' | 'local'>('ai');
  const [skillLevel, setSkillLevel] = useState<number>(4);
  const [userColorChoice, setUserColorChoice] = useState<PieceColor | 'random'>('w');

  // Active Game State
  const [gameActive, setGameActive] = useState<boolean>(!!initialFen);
  const [userColor, setUserColor] = useState<PieceColor>('w');
  const [flipped, setFlipped] = useState<boolean>(false);
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

  const initialFenRef = useRef<string | undefined>(initialFen || undefined);

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
      setUserColor('w');
      setFlipped(false);
      setGameActive(true);
    }
  }, [initialFen, initialVariant]);

  const startNewGame = (variantOverride?: ChessVariant) => {
    const v = variantOverride || selectedVariant;
    const chosenColor: PieceColor =
      userColorChoice === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : userColorChoice;
    const st = createInitialState(v);
    initialFenRef.current = v === 'chess960' ? toFen(st) : undefined;
    setSelectedVariant(v);
    setBoardState(st);
    setFens([toFen(st)]);
    setPosKeys([positionKey(st)]);
    setMoves([]);
    setViewPly(null);
    setGameResult(null);
    setUserColor(chosenColor);
    setFlipped(chosenColor === 'b');
    setClocks({ w: timeControl.baseSeconds, b: timeControl.baseSeconds });
    setSavedNotice(false);
    setGameActive(true);
  };

  const finishAndRecordGame = (res: GameResult, finalMoves: Move[], finalFens: string[]) => {
    setGameResult(res);
    if (res.winner === 'draw') soundFX.move();
    else if (opponentMode === 'ai' && res.winner === userColor) soundFX.victory();
    else if (opponentMode === 'ai' && res.winner !== userColor) soundFX.defeat();
    else soundFX.victory();

    if (finalMoves.length === 0) return;

    const pgnResult = res.winner === 'w' ? '1-0' : res.winner === 'b' ? '0-1' : '1/2-1/2';
    const opening = detectOpeningFromMoves(finalMoves.map((m) => m.san || ''));
    const aiElo = 750 + skillLevel * 200;
    const record: GameRecord = {
      id: `game-${Date.now()}`,
      white: opponentMode === 'local' ? 'White (Local)' : userColor === 'w' ? prefs.username : `Caissa Bot (L${skillLevel})`,
      black: opponentMode === 'local' ? 'Black (Local)' : userColor === 'b' ? prefs.username : `Caissa Bot (L${skillLevel})`,
      whiteElo: userColor === 'w' ? 1620 : aiElo,
      blackElo: userColor === 'b' ? 1620 : aiElo,
      variant: boardState.variant,
      timeControl: timeControl.label,
      result: pgnResult,
      reason: res.reason,
      date: new Date().toISOString().slice(0, 10),
      moves: finalMoves,
      fens: finalFens,
      pgn: exportPgn({
        white: userColor === 'w' ? prefs.username : `Caissa Bot L${skillLevel}`,
        black: userColor === 'b' ? prefs.username : `Caissa Bot L${skillLevel}`,
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

  // Live Clock Tick
  useEffect(() => {
    if (!gameActive || gameResult || timeControl.baseSeconds === 0 || moves.length === 0) return;
    const timer = window.setInterval(() => {
      setClocks((prev) => {
        const turn = boardState.turn;
        const nextVal = Math.max(0, prev[turn] - 1);
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

  const currentVariantInfo = VARIANTS.find((v) => v.id === boardState.variant) || VARIANTS[0];

  return (
    <div className="space-y-6">
      {/* Sub-navigation bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-stone-200 dark:border-zinc-800 pb-3">
        <div className="flex items-center gap-1 p-1 bg-stone-100 dark:bg-zinc-900 rounded-lg">
          {([
            ['quick', 'Quick Match'],
            ['variants', '8 Variants'],
            ['correspondence', 'Correspondence'],
            ['simul', 'Simultaneous Exhibition'],
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
          <span className="mx-1.5" aria-hidden="true">·</span>
          <span>Zero tracking</span>
        </div>
      </div>

      {/* ==================== QUICK MATCH & VARIANTS ==================== */}
      {(subTab === 'quick' || subTab === 'variants') && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left / Center Board Area */}
          <div className="lg:col-span-7 flex flex-col items-center gap-3">
            {/* Top Player Bar */}
            <div className="w-full max-w-[540px] flex items-center justify-between px-3 py-2 rounded-lg bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800">
              <div className="flex items-center gap-2.5">
                <div className={`w-3 h-3 rounded-sm border border-stone-400 ${flipped ? 'bg-stone-100' : 'bg-zinc-800'}`} />
                <span className="text-sm font-semibold text-stone-900 dark:text-zinc-100">
                  {opponentMode === 'local'
                    ? flipped ? 'White (Local)' : 'Black (Local)'
                    : flipped === (userColor === 'w')
                    ? prefs.username
                    : `Caissa Engine (Level ${skillLevel} · ${750 + skillLevel * 200})`}
                </span>
                {aiThinking && (
                  <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                    Thinking...
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                {boardState.variant === 'threeCheck' && (
                  <span className="text-xs font-mono text-amber-600 dark:text-amber-400">
                    Checks: {boardState.checksGiven[flipped ? 'w' : 'b']}/3
                  </span>
                )}
                {timeControl.baseSeconds > 0 && (
                  <span
                    className={`font-mono text-base font-semibold px-2.5 py-1 rounded ${
                      boardState.turn === (flipped ? 'w' : 'b') && gameActive && !gameResult
                        ? 'bg-emerald-600 text-white'
                        : 'bg-stone-100 dark:bg-zinc-800 text-stone-800 dark:text-zinc-200'
                    }`}
                  >
                    {formatClock(clocks[flipped ? 'w' : 'b'])}
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
              lastMove={activeLastMove}
            />

            {/* Bottom Player Bar */}
            <div className="w-full max-w-[540px] flex items-center justify-between px-3 py-2 rounded-lg bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800">
              <div className="flex items-center gap-2.5">
                <div className={`w-3 h-3 rounded-sm border border-stone-400 ${flipped ? 'bg-zinc-800' : 'bg-stone-100'}`} />
                <span className="text-sm font-semibold text-stone-900 dark:text-zinc-100">
                  {opponentMode === 'local'
                    ? flipped ? 'Black (Local)' : 'White (Local)'
                    : flipped === (userColor === 'w')
                    ? `Caissa Engine (Level ${skillLevel} · ${750 + skillLevel * 200})`
                    : prefs.username}
                </span>
              </div>
              <div className="flex items-center gap-3">
                {boardState.variant === 'threeCheck' && (
                  <span className="text-xs font-mono text-amber-600 dark:text-amber-400">
                    Checks: {boardState.checksGiven[flipped ? 'b' : 'w']}/3
                  </span>
                )}
                {timeControl.baseSeconds > 0 && (
                  <span
                    className={`font-mono text-base font-semibold px-2.5 py-1 rounded ${
                      boardState.turn === (flipped ? 'b' : 'w') && gameActive && !gameResult
                        ? 'bg-emerald-600 text-white'
                        : 'bg-stone-100 dark:bg-zinc-800 text-stone-800 dark:text-zinc-200'
                    }`}
                  >
                    {formatClock(clocks[flipped ? 'b' : 'w'])}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Right Panel: Setup or Active Controls + Move List */}
          <div className="lg:col-span-5 space-y-5">
            {subTab === 'variants' && (
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

            {/* Game Setup Controls */}
            <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-stone-900 dark:text-zinc-100">
                  {gameActive ? 'Match Room' : 'Configure Match'}
                </h2>
                <span className="text-xs text-stone-500 dark:text-zinc-400 font-mono">
                  {currentVariantInfo.name}
                </span>
              </div>

              {/* Time control selector */}
              <div>
                <label className="block text-xs font-medium text-stone-600 dark:text-zinc-400 mb-1.5">
                  Time Control
                </label>
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

              {opponentMode === 'ai' && (
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
              )}

              <button
                type="button"
                onClick={() => startNewGame()}
                className="w-full py-2.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2"
              >
                <Swords className="w-4 h-4" />
                {gameActive ? 'Start Fresh Game' : 'Start Game'}
              </button>
            </div>

            {/* Game Result Banner */}
            {gameResult && (
              <div className="bg-stone-100 dark:bg-zinc-900 border border-stone-300 dark:border-zinc-700 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-bold text-stone-900 dark:text-zinc-100">
                      {gameResult.winner === 'draw'
                        ? 'Game Drawn'
                        : `${gameResult.winner === 'w' ? 'White' : 'Black'} Wins`}
                    </div>
                    <div className="text-xs text-stone-600 dark:text-zinc-400">
                      {gameResult.reason}
                      {savedNotice ? ' · Saved to Insights & History' : ''}
                    </div>
                  </div>
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
                    Analyze Game
                  </button>
                </div>
              </div>
            )}

            {/* Move List & Match Controls */}
            <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-stone-600 dark:text-zinc-400">
                  Move List ({moves.length} plies)
                </span>
                <div className="flex items-center gap-1">
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

              {gameActive && !gameResult && (
                <div className="grid grid-cols-3 gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleTakeback}
                    disabled={moves.length === 0}
                    className="py-1.5 px-2 rounded-lg border border-stone-200 dark:border-zinc-800 text-xs font-medium text-stone-700 dark:text-zinc-300 hover:bg-stone-50 dark:hover:bg-zinc-800 disabled:opacity-40 flex items-center justify-center gap-1"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Takeback
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      finishAndRecordGame(
                        { status: 'draw_agreement', winner: 'draw', reason: 'Draw agreed' },
                        moves,
                        fens
                      )
                    }
                    className="py-1.5 px-2 rounded-lg border border-stone-200 dark:border-zinc-800 text-xs font-medium text-stone-700 dark:text-zinc-300 hover:bg-stone-50 dark:hover:bg-zinc-800 flex items-center justify-center gap-1"
                  >
                    <Handshake className="w-3.5 h-3.5" />
                    Draw
                  </button>
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
                    className="py-1.5 px-2 rounded-lg border border-red-200 dark:border-red-900/50 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 flex items-center justify-center gap-1"
                  >
                    <Flag className="w-3.5 h-3.5" />
                    Resign
                  </button>
                </div>
              )}
            </div>
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
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold text-stone-900 dark:text-zinc-100">
                    Simultaneous Exhibition Host
                  </h2>
                  <p className="text-xs text-stone-500 dark:text-zinc-400">
                    Play 4 boards at once as White against rated challengers.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={resetSimul}
                  className="px-3 py-1.5 rounded-lg border border-stone-200 dark:border-zinc-700 text-xs font-medium hover:bg-stone-50 dark:hover:bg-zinc-800"
                >
                  Reset Simul
                </button>
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
