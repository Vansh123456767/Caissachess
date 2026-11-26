import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AnalyzedMove,
  BoardAnnotation,
  BoardState,
  ChessVariant,
  DailyQuotaUsage,
  GameRecord,
  Move,
  Piece,
  PieceColor,
  PieceType,
  PlanTier,
  Puzzle,
  UserPreferences,
} from '../types/chess';
import { getPlanLimits, normalizeQuotaUsage, PLAN_CATALOG } from '../data/plans';
import {
  createInitialState,
  exportPgn,
  makeMove,
  parseFen,
  parsePgn,
  sanToMove,
  toFen,
  VARIANTS,
} from '../engine/chessEngine';
import {
  analyzeGameMoves,
  analyzePositionMultiPv,
  EngineLine,
  findThreatLine,
  formatEval,
  probeTablebase,
} from '../engine/aiSearch';
import type { AnalysisWorkerResponse } from '../engine/analysisWorker';
import {
  buildPersonalOpeningStats,
  detectOpeningFromMoves,
  GLOBAL_OPENING_TREE,
  OPENING_CATALOG,
} from '../data/openings';
import { TABLEBASE_PRESETS } from '../data/puzzlesAndLessons';
import { ChessBoard, BOARD_THEMES } from './ChessBoard';
import { ChessPiece } from './ChessPiece';
import { EvalBar } from './EvalBar';
import { MaterialStrip } from './MaterialStrip';
import { computeMaterialSummary } from '../utils/material';
import { announceMove, soundFX } from '../utils/sound';
import {
  ArrowLeftRight,
  ArrowUp,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Copy,
  Cpu,
  Download,
  Eraser,
  GitBranch,
  GraduationCap,
  Pause,
  Play,
  RotateCcw,
  Search,
  Share2,
  ShieldAlert,
  Sliders,
  Swords,
  Trash2,
  Upload,
  X,
} from 'lucide-react';

interface AnalysisViewProps {
  prefs: UserPreferences;
  games: GameRecord[];
  incomingPayload?: {
    fen?: string;
    moves?: Move[];
    fens?: string[];
    variant: ChessVariant;
  } | null;
  onSaveExtractedPuzzles: (puzzles: Puzzle[]) => void;
  onPlayFromPosition: (fen: string, variant: ChessVariant) => void;
  onImportGameRecord: (record: GameRecord) => void;
  planTier: PlanTier;
  dailyUsage: DailyQuotaUsage;
  onConsumeAnalysisQuota: () => Promise<{ allowed: boolean; error?: string }>;
  onOpenPlans: () => void;
}

type AnalysisSubTab = 'board' | 'editor' | 'explorer' | 'tablebase';

export const AnalysisView: React.FC<AnalysisViewProps> = ({
  prefs,
  games,
  incomingPayload,
  onSaveExtractedPuzzles,
  onPlayFromPosition,
  onImportGameRecord,
  planTier,
  dailyUsage,
  onConsumeAnalysisQuota,
  onOpenPlans,
}) => {
  const [subTab, setSubTab] = useState<AnalysisSubTab>('board');
  const [variant, setVariant] = useState<ChessVariant>(incomingPayload?.variant || 'standard');
  const [initialFen, setInitialFen] = useState<string>(() =>
    incomingPayload?.fen || toFen(createInitialState(incomingPayload?.variant || 'standard'))
  );
  const [moves, setMoves] = useState<Move[]>(incomingPayload?.moves || []);
  const [fens, setFens] = useState<string[]>(
    incomingPayload?.fens || [toFen(createInitialState('standard'))]
  );
  const [ply, setPly] = useState<number>(incomingPayload?.moves ? incomingPayload.moves.length : 0);
  const [flipped, setFlipped] = useState(false);

  // Engine state
  const [engineEnabled, setEngineEnabled] = useState(true);
  const [engineDepth, setEngineDepth] = useState(3);
  const [multiPvCount, setMultiPvCount] = useState(3);
  const [showBestArrow, setShowBestArrow] = useState(true);
  const [showThreat, setShowThreat] = useState(false);
  const [lines, setLines] = useState<EngineLine[]>([]);
  const [threatLine, setThreatLine] = useState<EngineLine | null>(null);
  const [engineComputing, setEngineComputing] = useState(false);
  const [boardAnnotations, setBoardAnnotations] = useState<BoardAnnotation>({ arrows: [], squares: [] });

  // Full game review & Learn from mistakes
  const [reviewData, setReviewData] = useState<{
    analyzed: AnalyzedMove[];
    accuracy: { w: number; b: number };
    acpl: { w: number; b: number };
  } | null>(null);
  const [chartMode, setChartMode] = useState<'eval' | 'material'>('eval');
  const [reviewProgress, setReviewProgress] = useState<{ done: number; total: number } | null>(null);
  const [mistakeDrillActive, setMistakeDrillActive] = useState(false);
  const [mistakeIndex, setMistakeIndex] = useState(0);
  const [mistakeFeedback, setMistakeFeedback] = useState<string | null>(null);
  const [analysisQuotaError, setAnalysisQuotaError] = useState<string | null>(null);

  const liveWorkerRef = useRef<Worker | null>(null);
  const reviewWorkerRef = useRef<Worker | null>(null);
  const liveReqIdRef = useRef(0);
  const reviewReqIdRef = useRef(0);
  const liveCacheRef = useRef<Map<string, { lines: EngineLine[]; threat: EngineLine | null }>>(
    new Map()
  );

  const normUsage = useMemo(() => normalizeQuotaUsage(dailyUsage), [dailyUsage]);
  const planLimits = useMemo(() => getPlanLimits(planTier), [planTier]);

  // Auto-replay & branching sub-variations
  const [autoReplay, setAutoReplay] = useState(false);
  const [autoReplayMs, setAutoReplayMs] = useState(1100);
  const [subVariations, setSubVariations] = useState<
    Record<number, { id: string; moves: Move[]; fens: string[] }[]>
  >({});
  const [activeVariation, setActiveVariation] = useState<{
    basePly: number;
    id: string;
    step: number;
  } | null>(null);

  // Opening Explorer & Repertoire Drill state
  const [explorerScope, setExplorerScope] = useState<'global' | 'personal' | 'rival'>('global');
  const [personalColor, setPersonalColor] = useState<PieceColor | 'all'>('all');
  const [explorerRating, setExplorerRating] = useState<'1600' | '2000' | '2200' | '2500'>('2200');
  const [explorerSpeed, setExplorerSpeed] = useState<'all' | 'bullet' | 'blitz' | 'rapid' | 'classical'>('all');
  const [openingSearch, setOpeningSearch] = useState('');
  const [repertoireDrill, setRepertoireDrill] = useState(false);
  const [drillSide, setDrillSide] = useState<PieceColor>('w');
  const [drillStatus, setDrillStatus] = useState<string | null>(null);

  // PGN & Archive Modal state
  const [showPgnModal, setShowPgnModal] = useState(false);
  const [showArchiveDrawer, setShowArchiveDrawer] = useState(false);
  const [archiveSearch, setArchiveSearch] = useState('');
  const [shareCopied, setShareCopied] = useState(false);
  const [pgnInput, setPgnInput] = useState('');
  const [copiedFen, setCopiedFen] = useState(false);

  // Lifecycle cleanup for background workers
  useEffect(() => {
    return () => {
      liveWorkerRef.current?.terminate();
      liveWorkerRef.current = null;
      reviewWorkerRef.current?.terminate();
      reviewWorkerRef.current = null;
    };
  }, []);

  // Sync incoming game from Play or TV
  useEffect(() => {
    if (!incomingPayload) return;
    const v = incomingPayload.variant || 'standard';
    setVariant(v);
    const startFen = incomingPayload.fen || toFen(createInitialState(v));
    setInitialFen(startFen);
    setMoves(incomingPayload.moves || []);
    setFens(incomingPayload.fens || [startFen]);
    setPly(incomingPayload.moves ? incomingPayload.moves.length : 0);
    setSubVariations({});
    setActiveVariation(null);
    setAutoReplay(false);
    setReviewData(null);
    setReviewProgress(null);
    setMistakeDrillActive(false);
    setSubTab('board');
  }, [incomingPayload]);

  const activeVarBranch = useMemo(() => {
    if (!activeVariation) return null;
    const branches = subVariations[activeVariation.basePly] || [];
    return branches.find((b) => b.id === activeVariation.id) || null;
  }, [activeVariation, subVariations]);

  const currentFen = useMemo(() => {
    if (activeVariation && activeVarBranch) {
      return activeVarBranch.fens[activeVariation.step] || fens[activeVariation.basePly] || initialFen;
    }
    return fens[ply] || initialFen;
  }, [activeVariation, activeVarBranch, fens, ply, initialFen]);

  const currentState = useMemo(() => parseFen(currentFen, variant), [currentFen, variant]);

  // Auto-replay timer
  useEffect(() => {
    if (!autoReplay) return;
    if (ply >= moves.length) {
      setAutoReplay(false);
      return;
    }
    const id = window.setInterval(() => {
      setActiveVariation(null);
      setPly((p) => {
        if (p + 1 >= moves.length) {
          setAutoReplay(false);
          return moves.length;
        }
        return p + 1;
      });
    }, autoReplayMs);
    return () => window.clearInterval(id);
  }, [autoReplay, autoReplayMs, ply, moves.length]);

  // Keyboard shortcuts for fast Lichess-style navigation (arrows, f to flip, x for threat, space for top engine move)
  useEffect(() => {
    if (subTab === 'editor' || showPgnModal) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')
      ) {
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setAutoReplay(false);
        if (activeVariation) {
          if (activeVariation.step > 1) {
            setActiveVariation({ ...activeVariation, step: activeVariation.step - 1 });
          } else {
            const base = activeVariation.basePly;
            setActiveVariation(null);
            setPly(base);
          }
        } else {
          setPly((p) => Math.max(0, p - 1));
        }
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setAutoReplay(false);
        if (activeVariation && activeVarBranch) {
          if (activeVariation.step < activeVarBranch.moves.length) {
            setActiveVariation({ ...activeVariation, step: activeVariation.step + 1 });
          }
        } else {
          setPly((p) => Math.min(moves.length, p + 1));
        }
      } else if (e.key === 'ArrowUp' || e.key === 'Home') {
        e.preventDefault();
        setAutoReplay(false);
        setActiveVariation(null);
        setPly(0);
      } else if (e.key === 'ArrowDown' || e.key === 'End') {
        e.preventDefault();
        setAutoReplay(false);
        setActiveVariation(null);
        setPly(moves.length);
      } else if (e.key === 'f' || e.key === 'F') {
        setFlipped((f) => !f);
      } else if (e.key === 'x' || e.key === 'X') {
        setShowThreat((t) => !t);
      } else if (e.key === ' ') {
        e.preventDefault();
        if (engineEnabled && lines.length > 0 && lines[0].pvSan[0]) {
          playSanFromExplorer(lines[0].pvSan[0]);
        } else if (moves.length > 0) {
          setAutoReplay((r) => !r);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moves.length, subTab, showPgnModal, activeVariation, activeVarBranch, engineEnabled, lines]);

  // Run Multi-PV + Threat analysis off the main UI thread via Web Worker with LRU caching
  useEffect(() => {
    if (!engineEnabled) {
      setLines([]);
      setThreatLine(null);
      setEngineComputing(false);
      return;
    }

    const cacheKey = `${currentFen}|${variant}|${engineDepth}|${multiPvCount}|${showThreat ? 1 : 0}`;
    const cached = liveCacheRef.current.get(cacheKey);
    if (cached) {
      setLines(cached.lines);
      setThreatLine(cached.threat);
      setEngineComputing(false);
      return;
    }

    const reqId = ++liveReqIdRef.current;
    setEngineComputing(true);

    const runFallback = () => {
      const stateSnapshot = parseFen(currentFen, variant);
      const computed = analyzePositionMultiPv(stateSnapshot, multiPvCount, engineDepth);
      const threat = showThreat ? findThreatLine(stateSnapshot, engineDepth) : null;
      if (liveReqIdRef.current !== reqId) return;
      if (liveCacheRef.current.size > 250) {
        const firstKey = liveCacheRef.current.keys().next().value;
        if (firstKey) liveCacheRef.current.delete(firstKey);
      }
      liveCacheRef.current.set(cacheKey, { lines: computed, threat });
      setLines(computed);
      setThreatLine(threat);
      setEngineComputing(false);
    };

    const timer = window.setTimeout(() => {
      if (typeof Worker === 'undefined') {
        runFallback();
        return;
      }
      try {
        if (!liveWorkerRef.current) {
          liveWorkerRef.current = new Worker(
            new URL('../engine/analysisWorker.ts', import.meta.url),
            { type: 'module' }
          );
        }
        const worker = liveWorkerRef.current;
        worker.onmessage = (ev: MessageEvent<AnalysisWorkerResponse>) => {
          const msg = ev.data;
          if (msg.type === 'multiPvResult' && msg.id === liveReqIdRef.current) {
            if (liveCacheRef.current.size > 250) {
              const firstKey = liveCacheRef.current.keys().next().value;
              if (firstKey) liveCacheRef.current.delete(firstKey);
            }
            liveCacheRef.current.set(cacheKey, {
              lines: msg.lines,
              threat: msg.threat,
            });
            setLines(msg.lines);
            setThreatLine(msg.threat);
            setEngineComputing(false);
          }
        };
        worker.onerror = () => {
          liveWorkerRef.current?.terminate();
          liveWorkerRef.current = null;
          runFallback();
        };
        worker.postMessage({
          id: reqId,
          type: 'multiPv',
          fen: currentFen,
          variant,
          depth: engineDepth,
          numLines: multiPvCount,
          includeThreat: showThreat,
        });
      } catch {
        runFallback();
      }
    }, 35);

    return () => window.clearTimeout(timer);
  }, [currentFen, variant, engineEnabled, engineDepth, multiPvCount, showThreat]);

  const handleBoardMove = (mv: Move) => {
    // Mistake drill mode verification
    if (mistakeDrillActive && mistakesList[mistakeIndex]) {
      const target = mistakesList[mistakeIndex];
      const uci = mv.from
        ? `${String.fromCharCode(97 + mv.from[1])}${8 - mv.from[0]}${String.fromCharCode(97 + mv.to[1])}${8 - mv.to[0]}${mv.promotion || ''}`
        : '';
      if (uci === target.bestMoveUci) {
        soundFX.victory();
        setMistakeFeedback(`Correct! ${target.bestMoveSan} is the best continuation.`);
      } else {
        soundFX.error();
        setMistakeFeedback(`Not quite — try finding a stronger move than ${mv.san || uci}.`);
      }
      return;
    }

    const res = makeMove(currentState, mv);
    const committed: Move = { ...mv, san: res.san, uci: res.uci };

    if (res.san.includes('+')) soundFX.check();
    else if (mv.captured) soundFX.capture();
    else soundFX.move();
    announceMove(res.san, prefs.voiceEnabled);

    // If browsing inside an existing variation branch, extend/fork it
    if (activeVariation && activeVarBranch && !(subTab === 'explorer' && repertoireDrill)) {
      const prefixMoves = activeVarBranch.moves.slice(0, activeVariation.step);
      const prefixFens = activeVarBranch.fens.slice(0, activeVariation.step + 1);
      const updatedMoves = [...prefixMoves, committed];
      const updatedFens = [...prefixFens, toFen(res.next)];
      setSubVariations((prev) => ({
        ...prev,
        [activeVariation.basePly]: (prev[activeVariation.basePly] || []).map((b) =>
          b.id === activeVariation.id ? { ...b, moves: updatedMoves, fens: updatedFens } : b
        ),
      }));
      setActiveVariation({ ...activeVariation, step: updatedMoves.length });
      return;
    }

    // If playing a different move mid-game on the mainline, preserve mainline & create a sideline branch
    if (ply < moves.length && !(subTab === 'explorer' && repertoireDrill)) {
      if (moves[ply]?.san === res.san) {
        setPly(ply + 1);
        return;
      }
      const existingAtPly = subVariations[ply] || [];
      const matchingExisting = existingAtPly.find((b) => b.moves[0]?.san === res.san);
      if (matchingExisting) {
        setActiveVariation({ basePly: ply, id: matchingExisting.id, step: 1 });
        return;
      }
      const newId = `var-${ply}-${Date.now().toString(36)}`;
      const baseFen = fens[ply] || initialFen;
      const newBranch = {
        id: newId,
        moves: [committed],
        fens: [baseFen, toFen(res.next)],
      };
      setSubVariations((prev) => ({
        ...prev,
        [ply]: [...(prev[ply] || []), newBranch],
      }));
      setActiveVariation({ basePly: ply, id: newId, step: 1 });
      return;
    }

    const slicedMoves = moves.slice(0, ply);
    const slicedFens = fens.slice(0, ply + 1);
    let nextMoves = [...slicedMoves, committed];
    let nextFens = [...slicedFens, toFen(res.next)];

    // Repertoire Drill feedback & automatic book reply
    if (subTab === 'explorer' && repertoireDrill && currentState.turn === drillSide) {
      const prefixSans = slicedMoves.map((m) => m.san || '');
      const bookNode = GLOBAL_OPENING_TREE[prefixSans.join(' ')];
      if (bookNode && bookNode.moves.length > 0) {
        const isBookMove = bookNode.moves.some((bm) => bm.san === res.san);
        setDrillStatus(
          isBookMove
            ? `In book! ${res.san} is a main line.`
            : `Sideline (${res.san}) — main theory prefers ${bookNode.moves[0].san}.`
        );
      } else {
        setDrillStatus(`Played ${res.san}. Reached end of book branch.`);
      }

      const nextPrefix = nextMoves.map((m) => m.san || '').join(' ');
      const oppNode = GLOBAL_OPENING_TREE[nextPrefix];
      if (oppNode && oppNode.moves.length > 0) {
        const oppSan = oppNode.moves[0].san;
        const oppMv = sanToMove(res.next, oppSan);
        if (oppMv) {
          const oppRes = makeMove(res.next, oppMv);
          nextMoves = [...nextMoves, { ...oppMv, san: oppRes.san, uci: oppRes.uci }];
          nextFens = [...nextFens, toFen(oppRes.next)];
        }
      }
    }

    setMoves(nextMoves);
    setFens(nextFens);
    setPly(nextMoves.length);
  };

  const promoteVariation = (basePly: number, branchId: string) => {
    const branches = subVariations[basePly] || [];
    const target = branches.find((b) => b.id === branchId);
    if (!target) return;

    const oldTailMoves = moves.slice(basePly);
    const oldTailFens = fens.slice(basePly);
    const nextMainMoves = [...moves.slice(0, basePly), ...target.moves];
    const nextMainFens = [...fens.slice(0, basePly), ...target.fens];

    const remainingBranches = branches.filter((b) => b.id !== branchId);
    if (oldTailMoves.length > 0) {
      remainingBranches.push({
        id: `var-old-${basePly}-${Date.now().toString(36)}`,
        moves: oldTailMoves,
        fens: oldTailFens,
      });
    }
    setSubVariations((prev) => ({ ...prev, [basePly]: remainingBranches }));
    setMoves(nextMainMoves);
    setFens(nextMainFens);
    setActiveVariation(null);
    setPly(basePly + target.moves.length);
    setReviewData(null);
  };

  const deleteVariation = (basePly: number, branchId: string) => {
    setSubVariations((prev) => ({
      ...prev,
      [basePly]: (prev[basePly] || []).filter((b) => b.id !== branchId),
    }));
    if (activeVariation && activeVariation.id === branchId) {
      setActiveVariation(null);
      setPly(basePly);
    }
  };

  const loadOpeningLine = (sans: string[]) => {
    const startSt = createInitialState('standard');
    let st = startSt;
    const lineMoves: Move[] = [];
    const lineFens: string[] = [toFen(startSt)];
    for (const san of sans) {
      const mv = sanToMove(st, san);
      if (!mv) break;
      const res = makeMove(st, mv);
      lineMoves.push({ ...mv, san: res.san, uci: res.uci });
      lineFens.push(toFen(res.next));
      st = res.next;
    }
    setVariant('standard');
    setInitialFen(lineFens[0]);
    setMoves(lineMoves);
    setFens(lineFens);
    setPly(lineMoves.length);
    setReviewData(null);
    setDrillStatus(null);
  };

  const playSanFromExplorer = (san: string) => {
    const mv = sanToMove(currentState, san);
    if (mv) handleBoardMove(mv);
  };

  const cancelFullGameAnalysis = () => {
    reviewReqIdRef.current++;
    reviewWorkerRef.current?.terminate();
    reviewWorkerRef.current = null;
    setReviewProgress(null);
  };

  const runFullGameAnalysis = async () => {
    if (moves.length === 0 || reviewProgress) return;
    setAnalysisQuotaError(null);
    const gate = await onConsumeAnalysisQuota();
    if (!gate.allowed) {
      setAnalysisQuotaError(
        gate.error || 'Daily analysis limit reached. Upgrade to Pro or Max to continue.'
      );
      return;
    }

    const reqId = ++reviewReqIdRef.current;
    const total = Math.min(moves.length, Math.max(0, fens.length - 1));
    setReviewProgress({ done: 0, total });

    const runSyncFallback = () => {
      window.setTimeout(() => {
        if (reviewReqIdRef.current !== reqId) return;
        const res = analyzeGameMoves(fens, moves, variant);
        setReviewData({ analyzed: res.analyzed, accuracy: res.accuracy, acpl: res.acpl });
        setReviewProgress(null);
        if (res.extractedPuzzles.length > 0) {
          onSaveExtractedPuzzles(res.extractedPuzzles);
        }
      }, 20);
    };

    if (typeof Worker === 'undefined') {
      runSyncFallback();
      return;
    }

    try {
      reviewWorkerRef.current?.terminate();
      const worker = new Worker(
        new URL('../engine/analysisWorker.ts', import.meta.url),
        { type: 'module' }
      );
      reviewWorkerRef.current = worker;
      worker.onmessage = (ev: MessageEvent<AnalysisWorkerResponse>) => {
        const msg = ev.data;
        if (msg.id !== reviewReqIdRef.current) return;
        if (msg.type === 'reviewProgress') {
          setReviewProgress({ done: msg.done, total: msg.total });
        } else if (msg.type === 'reviewResult') {
          setReviewData({
            analyzed: msg.analyzed,
            accuracy: msg.accuracy,
            acpl: msg.acpl,
          });
          setReviewProgress(null);
          if (msg.extractedPuzzles.length > 0) {
            onSaveExtractedPuzzles(msg.extractedPuzzles);
          }
        }
      };
      worker.onerror = () => {
        worker.terminate();
        reviewWorkerRef.current = null;
        runSyncFallback();
      };
      worker.postMessage({
        id: reqId,
        type: 'gameReview',
        fens,
        moves,
        variant,
      });
    } catch {
      runSyncFallback();
    }
  };

  const mistakesList = useMemo(() => {
    if (!reviewData) return [];
    return reviewData.analyzed.filter(
      (m) => m.classification === 'Inaccuracy' || m.classification === 'Mistake' || m.classification === 'Blunder'
    );
  }, [reviewData]);

  const startMistakeDrill = async () => {
    if (!reviewData) {
      await runFullGameAnalysis();
    }
    setMistakeDrillActive(true);
    setMistakeIndex(0);
    setMistakeFeedback(null);
  };

  useEffect(() => {
    if (mistakeDrillActive && mistakesList[mistakeIndex]) {
      setPly(mistakesList[mistakeIndex].ply - 1);
      setMistakeFeedback(null);
    }
  }, [mistakeDrillActive, mistakeIndex, mistakesList]);

  // Opening Explorer lookup
  const currentSans = useMemo(() => {
    const base = moves.slice(0, activeVariation ? activeVariation.basePly : ply).map((m) => m.san || '');
    if (activeVariation && activeVarBranch) {
      return [...base, ...activeVarBranch.moves.slice(0, activeVariation.step).map((m) => m.san || '')];
    }
    return base;
  }, [moves, ply, activeVariation, activeVarBranch]);
  const openingDetected = useMemo(() => detectOpeningFromMoves(currentSans), [currentSans]);

  const explorerRows = useMemo(() => {
    if (explorerScope === 'global') {
      const node = GLOBAL_OPENING_TREE[currentSans.join(' ')];
      if (!node) return [];
      const ratingFactor =
        explorerRating === '1600' ? 1.45 : explorerRating === '2000' ? 1.15 : explorerRating === '2200' ? 1 : 0.42;
      const ratingOffset =
        explorerRating === '1600' ? -420 : explorerRating === '2000' ? -180 : explorerRating === '2200' ? 0 : 190;
      const speedFactor =
        explorerSpeed === 'all'
          ? 1
          : explorerSpeed === 'blitz'
          ? 0.46
          : explorerSpeed === 'rapid'
          ? 0.28
          : explorerSpeed === 'bullet'
          ? 0.18
          : 0.08;
      return node.moves.map((m) => ({
        ...m,
        games: Math.max(12, Math.round(m.games * ratingFactor * speedFactor)),
        whiteWins: Math.max(4, Math.round(m.whiteWins * ratingFactor * speedFactor)),
        draws: Math.max(2, Math.round(m.draws * ratingFactor * speedFactor)),
        blackWins: Math.max(4, Math.round(m.blackWins * ratingFactor * speedFactor)),
        avgRating: Math.max(1500, Math.min(2780, m.avgRating + ratingOffset)),
      }));
    }
    if (explorerScope === 'personal') {
      return buildPersonalOpeningStats(
        games,
        currentSans,
        personalColor === 'all' ? undefined : personalColor
      );
    }
    // Sample Rival Repertoire (Master-style preset)
    const rivalKey = currentSans.join(' ');
    const base = GLOBAL_OPENING_TREE[rivalKey]?.moves || [];
    return base.slice(0, 3).map((m, idx) => ({
      ...m,
      games: Math.max(4, Math.round(m.games / (1200 + idx * 400))),
      whiteWins: Math.max(1, Math.round(m.whiteWins / (1200 + idx * 400))),
      draws: Math.max(1, Math.round(m.draws / (1200 + idx * 400))),
      blackWins: Math.max(1, Math.round(m.blackWins / (1200 + idx * 400))),
    }));
  }, [explorerScope, currentSans, games, personalColor, explorerRating, explorerSpeed]);

  // Tablebase result — only probe when the 7-Piece Tablebase sub-tab is active so regular analysis never lags
  const tbResult = useMemo(
    () => (subTab === 'tablebase' ? probeTablebase(currentState) : null),
    [currentState, subTab]
  );

  // Best-move arrow + optional opponent threat arrow
  const bestArrow = useMemo(() => {
    if (!engineEnabled || mistakeDrillActive) return [];
    const arrows: { from: string; to: string; color: string }[] = [];
    if (showBestArrow && lines.length > 0) {
      const uci = lines[0].pvUci[0];
      if (uci && !uci.includes('@') && uci.length >= 4) {
        arrows.push({ from: uci.slice(0, 2), to: uci.slice(2, 4), color: '#059669' });
      }
    }
    if (showThreat && threatLine) {
      const tuci = threatLine.pvUci[0];
      if (tuci && !tuci.includes('@') && tuci.length >= 4) {
        arrows.push({ from: tuci.slice(0, 2), to: tuci.slice(2, 4), color: '#dc2626' });
      }
    }
    return arrows;
  }, [engineEnabled, showBestArrow, lines, mistakeDrillActive, showThreat, threatLine]);

  const phaseBreakdown = useMemo(() => {
    if (!reviewData) return null;
    const total = reviewData.analyzed.length;
    if (total === 0) return null;
    const openEnd = Math.min(total, 16);
    const endStart = Math.max(openEnd, Math.floor(total * 0.68));
    const avgCp = (slice: AnalyzedMove[]) =>
      slice.length > 0 ? Math.round(slice.reduce((acc, m) => acc + m.cpLoss, 0) / slice.length) : 0;
    return {
      opening: avgCp(reviewData.analyzed.slice(0, openEnd)),
      middlegame: avgCp(reviewData.analyzed.slice(openEnd, endStart)),
      endgame: avgCp(reviewData.analyzed.slice(endStart)),
    };
  }, [reviewData]);

  const materialSeries = useMemo(() => {
    if (!reviewData || chartMode !== 'material') return [];
    return reviewData.analyzed.map((m) =>
      computeMaterialSummary(parseFen(m.fenAfter, variant)).advantage
    );
  }, [reviewData, chartMode, variant]);

  const filteredArchiveGames = useMemo(() => {
    const q = archiveSearch.trim().toLowerCase();
    if (!q) return games;
    return games.filter(
      (g) =>
        g.white.toLowerCase().includes(q) ||
        g.black.toLowerCase().includes(q) ||
        (g.openingName || '').toLowerCase().includes(q) ||
        g.variant.toLowerCase().includes(q)
    );
  }, [games, archiveSearch]);

  // ==================== BOARD EDITOR STATE ====================
  const [editorBoard, setEditorBoard] = useState<(Piece | null)[][]>(() =>
    parseFen(currentFen, 'standard').board
  );
  const [editorTurn, setEditorTurn] = useState<PieceColor>('w');
  const [editorCastling, setEditorCastling] = useState({ wK: true, wQ: true, bK: true, bQ: true });
  const [selectedBrush, setSelectedBrush] = useState<Piece | 'erase'>({ color: 'w', type: 'q' });
  const [fenInputText, setFenInputText] = useState('');

  const editorState: BoardState = useMemo(
    () => ({
      ...createInitialState('standard'),
      board: editorBoard,
      turn: editorTurn,
      castling: editorCastling,
    }),
    [editorBoard, editorTurn, editorCastling]
  );

  const editorFen = useMemo(() => toFen(editorState), [editorState]);

  const handleEditorSquareClick = (r: number, c: number) => {
    setEditorBoard((prev) => {
      const next = prev.map((row) => [...row]);
      if (selectedBrush === 'erase') {
        next[r][c] = null;
      } else {
        next[r][c] = { ...selectedBrush };
      }
      return next;
    });
  };

  const loadFenIntoAnalysis = (fenStr: string, targetVariant: ChessVariant = 'standard') => {
    try {
      const st = parseFen(fenStr, targetVariant);
      const norm = toFen(st);
      setVariant(targetVariant);
      setInitialFen(norm);
      setFens([norm]);
      setMoves([]);
      setPly(0);
      setReviewData(null);
      setSubTab('board');
    } catch {
      // ignore invalid fen
    }
  };

  const handleImportPgnSubmit = () => {
    if (!pgnInput.trim()) return;
    const parsed = parsePgn(pgnInput);
    const startFen = parsed.initialFen || toFen(createInitialState(parsed.variant));
    setVariant(parsed.variant);
    setInitialFen(startFen);
    setMoves(parsed.moves);
    setFens(parsed.fens);
    setPly(parsed.moves.length);
    setReviewData(null);
    setShowPgnModal(false);

    if (parsed.moves.length > 0) {
      const op = detectOpeningFromMoves(parsed.moves.map((m) => m.san || ''));
      onImportGameRecord({
        id: `pgn-${Date.now()}`,
        white: parsed.headers['White'] || 'White',
        black: parsed.headers['Black'] || 'Black',
        whiteElo: parseInt(parsed.headers['WhiteElo'] || '1800', 10) || 1800,
        blackElo: parseInt(parsed.headers['BlackElo'] || '1800', 10) || 1800,
        variant: parsed.variant,
        timeControl: parsed.headers['TimeControl'] || 'Imported',
        result: (['1-0', '0-1', '1/2-1/2'].includes(parsed.result) ? parsed.result : '1/2-1/2') as GameRecord['result'],
        reason: 'Imported PGN',
        date: parsed.headers['Date'] || new Date().toISOString().slice(0, 10),
        moves: parsed.moves,
        fens: parsed.fens,
        pgn: pgnInput,
        openingEco: op.eco,
        openingName: op.name,
      });
    }
  };

  const handleUploadPgnFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setPgnInput(reader.result);
      }
    };
    reader.readAsText(file);
  };

  const topLine = lines[0];
  const boardThemePalette = BOARD_THEMES[prefs.boardTheme] || BOARD_THEMES.wood;

  return (
    <div className="space-y-6">
      {/* Sub-tabs */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-stone-200 dark:border-zinc-800 pb-3">
        <div className="flex items-center gap-1 p-1 bg-stone-100 dark:bg-zinc-900 rounded-lg">
          {([
            ['board', 'Analysis Board'],
            ['editor', 'Board Editor'],
            ['explorer', 'Opening Explorer'],
            ['tablebase', '7-Piece Tablebase'],
          ] as [AnalysisSubTab, string][]).map(([id, label]) => (
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

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowArchiveDrawer((v) => !v)}
            className={`px-3 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 ${
              showArchiveDrawer
                ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300'
                : 'border-stone-200 dark:border-zinc-700 text-stone-700 dark:text-zinc-300 hover:bg-stone-100 dark:hover:bg-zinc-800'
            }`}
          >
            <Search className="w-3.5 h-3.5" />
            Search Archive ({games.length})
          </button>
          <button
            type="button"
            onClick={() => {
              const url = `${window.location.origin}${window.location.pathname}#analysis=${variant}&fen=${encodeURIComponent(currentFen)}`;
              navigator.clipboard.writeText(url).catch(() => {});
              setShareCopied(true);
              setTimeout(() => setShareCopied(false), 1800);
            }}
            className="px-3 py-1.5 rounded-lg border border-stone-200 dark:border-zinc-700 text-xs font-medium text-stone-700 dark:text-zinc-300 hover:bg-stone-100 dark:hover:bg-zinc-800 flex items-center gap-1.5"
          >
            {shareCopied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Share2 className="w-3.5 h-3.5" />}
            {shareCopied ? 'Link Copied' : 'Share Position'}
          </button>
          <button
            type="button"
            onClick={() => setShowPgnModal(true)}
            className="px-3 py-1.5 rounded-lg border border-stone-200 dark:border-zinc-700 text-xs font-medium text-stone-700 dark:text-zinc-300 hover:bg-stone-100 dark:hover:bg-zinc-800 flex items-center gap-1.5"
          >
            <Upload className="w-3.5 h-3.5" />
            Import PGN
          </button>
          <button
            type="button"
            onClick={() => {
              const pgn = exportPgn({ variant, initialFen, moves });
              const blob = new Blob([pgn], { type: 'application/x-chess-pgn' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `caissa-analysis-${Date.now()}.pgn`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            className="px-3 py-1.5 rounded-lg border border-stone-200 dark:border-zinc-700 text-xs font-medium text-stone-700 dark:text-zinc-300 hover:bg-stone-100 dark:hover:bg-zinc-800 flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" />
            Download PGN
          </button>
        </div>
      </div>

      {showArchiveDrawer && (
        <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-stone-900 dark:text-zinc-100">
              Search Games Archive
            </h3>
            <input
              type="text"
              value={archiveSearch}
              onChange={(e) => setArchiveSearch(e.target.value)}
              placeholder="Filter by player, opening, variant..."
              className="px-3 py-1.5 rounded-lg border border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-950 text-xs w-full sm:w-64"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 max-h-48 overflow-y-auto thin-scroll">
            {filteredArchiveGames.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => {
                  setVariant(g.variant);
                  setInitialFen(g.fens[0] || toFen(createInitialState(g.variant)));
                  setMoves(g.moves);
                  setFens(g.fens);
                  setPly(g.moves.length);
                  setReviewData(null);
                  setShowArchiveDrawer(false);
                  setSubTab('board');
                }}
                className="p-2.5 rounded-lg border border-stone-200 dark:border-zinc-800 hover:border-emerald-600 text-left text-xs transition-colors"
              >
                <div className="font-semibold text-stone-900 dark:text-zinc-100 truncate">
                  {g.white} vs {g.black}
                </div>
                <div className="text-[11px] font-mono text-stone-500 dark:text-zinc-400 truncate mt-0.5">
                  {g.result} · {g.openingName || g.variant} · {g.date}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ==================== BOARD EDITOR ==================== */}
      {subTab === 'editor' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-6 flex flex-col items-center">
            <div className="w-full max-w-[500px] aspect-square rounded-lg overflow-hidden shadow-md border border-stone-300 dark:border-zinc-700 grid grid-cols-8 grid-rows-8">
              {editorBoard.map((row, r) =>
                row.map((p, c) => {
                  const isLight = (r + c) % 2 === 0;
                  return (
                    <button
                      key={`${r}-${c}`}
                      type="button"
                      onClick={() => handleEditorSquareClick(r, c)}
                      style={{ backgroundColor: isLight ? boardThemePalette.light : boardThemePalette.dark }}
                      className="flex items-center justify-center hover:brightness-95 transition"
                    >
                      {p && <ChessPiece color={p.color} type={p.type} pieceSet={prefs.pieceSet} className="w-[85%] h-[85%]" />}
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div className="lg:col-span-6 space-y-5 bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-stone-900 dark:text-zinc-100">
                Position Setup & Board Editor
              </h2>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setEditorBoard(createInitialState('standard').board)}
                  className="px-2.5 py-1 rounded border border-stone-200 dark:border-zinc-700 text-xs font-medium"
                >
                  Starting Position
                </button>
                <button
                  type="button"
                  onClick={() => setEditorBoard(Array.from({ length: 8 }, () => Array(8).fill(null)))}
                  className="px-2.5 py-1 rounded border border-stone-200 dark:border-zinc-700 text-xs font-medium"
                >
                  Clear Board
                </button>
              </div>
            </div>

            {/* Piece Palette */}
            <div className="space-y-2">
              {(['w', 'b'] as PieceColor[]).map((col) => (
                <div key={col} className="flex items-center gap-1.5">
                  <span className="w-12 text-xs font-medium text-stone-500 dark:text-zinc-400">
                    {col === 'w' ? 'White' : 'Black'}
                  </span>
                  {(['k', 'q', 'r', 'b', 'n', 'p'] as PieceType[]).map((pt) => {
                    const active =
                      selectedBrush !== 'erase' && selectedBrush.color === col && selectedBrush.type === pt;
                    return (
                      <button
                        key={pt}
                        type="button"
                        onClick={() => setSelectedBrush({ color: col, type: pt })}
                        className={`w-10 h-10 rounded-lg border flex items-center justify-center ${
                          active
                            ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/40'
                            : 'border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800'
                        }`}
                      >
                        <ChessPiece color={col} type={pt} pieceSet={prefs.pieceSet} className="w-8 h-8" />
                      </button>
                    );
                  })}
                </div>
              ))}
              <button
                type="button"
                onClick={() => setSelectedBrush('erase')}
                className={`mt-1 px-3 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 ${
                  selectedBrush === 'erase'
                    ? 'border-red-500 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300'
                    : 'border-stone-200 dark:border-zinc-700 text-stone-700 dark:text-zinc-300'
                }`}
              >
                <Eraser className="w-3.5 h-3.5" />
                Erase Square Tool
              </button>
            </div>

            {/* Side & Castling */}
            <div className="grid grid-cols-2 gap-4 pt-2 border-t border-stone-100 dark:border-zinc-800">
              <div>
                <label className="block text-xs font-medium text-stone-600 dark:text-zinc-400 mb-1.5">
                  Side to Move
                </label>
                <div className="flex gap-2">
                  {(['w', 'b'] as PieceColor[]).map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setEditorTurn(c)}
                      className={`flex-1 py-1.5 rounded-lg border text-xs font-medium ${
                        editorTurn === c
                          ? 'border-emerald-600 bg-emerald-600 text-white'
                          : 'border-stone-200 dark:border-zinc-700'
                      }`}
                    >
                      {c === 'w' ? 'White' : 'Black'}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-600 dark:text-zinc-400 mb-1.5">
                  Castling Rights
                </label>
                <div className="grid grid-cols-2 gap-1.5 text-xs">
                  {([
                    ['wK', 'White O-O'],
                    ['wQ', 'White O-O-O'],
                    ['bK', 'Black O-O'],
                    ['bQ', 'Black O-O-O'],
                  ] as const).map(([key, lbl]) => (
                    <label key={key} className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editorCastling[key]}
                        onChange={(e) =>
                          setEditorCastling((prev) => ({ ...prev, [key]: e.target.checked }))
                        }
                        className="accent-emerald-600"
                      />
                      <span>{lbl}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {/* FEN Box */}
            <div className="space-y-2 pt-2 border-t border-stone-100 dark:border-zinc-800">
              <label className="block text-xs font-medium text-stone-600 dark:text-zinc-400">
                Current FEN
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={editorFen}
                  className="flex-1 px-2.5 py-1.5 rounded-lg bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 font-mono text-xs"
                />
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(editorFen).catch(() => {});
                    setCopiedFen(true);
                    setTimeout(() => setCopiedFen(false), 1500);
                  }}
                  className="px-3 py-1.5 rounded-lg border border-stone-200 dark:border-zinc-700 text-xs font-medium flex items-center gap-1"
                >
                  {copiedFen ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  Copy
                </button>
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Paste custom FEN to load..."
                  value={fenInputText}
                  onChange={(e) => setFenInputText(e.target.value)}
                  className="flex-1 px-2.5 py-1.5 rounded-lg bg-white dark:bg-zinc-950 border border-stone-200 dark:border-zinc-700 font-mono text-xs"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (!fenInputText.trim()) return;
                    const parsed = parseFen(fenInputText, 'standard');
                    setEditorBoard(parsed.board);
                    setEditorTurn(parsed.turn);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-stone-200 dark:bg-zinc-800 text-xs font-medium"
                >
                  Load FEN
                </button>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => loadFenIntoAnalysis(editorFen, 'standard')}
                className="flex-1 py-2 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center justify-center gap-1.5"
              >
                <Cpu className="w-4 h-4" />
                Analyze Position
              </button>
              <button
                type="button"
                onClick={() => onPlayFromPosition(editorFen, 'standard')}
                className="flex-1 py-2 px-4 rounded-lg bg-stone-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-semibold flex items-center justify-center gap-1.5"
              >
                <Play className="w-4 h-4" />
                Play from Position
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* ==================== ANALYSIS BOARD / EXPLORER / TABLEBASE ==================== */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left: Eval Bar + Board + Navigation */}
          <div className="lg:col-span-7 flex flex-col items-center gap-2.5">
            <div className="w-full max-w-[540px] flex items-center justify-between px-3 py-1.5 rounded-lg bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 text-xs">
              <span className="font-semibold text-stone-700 dark:text-zinc-300">
                {flipped ? 'White' : 'Black'}
              </span>
              <MaterialStrip
                state={currentState}
                side={flipped ? 'w' : 'b'}
                pieceSet={prefs.pieceSet}
              />
            </div>

            <div className="w-full max-w-[580px] flex items-stretch justify-center gap-2.5">
              <EvalBar
                evalCp={topLine ? topLine.evalCp : 0}
                mateIn={topLine?.mateIn}
                flipped={flipped}
              />
              <ChessBoard
                state={currentState}
                onMove={handleBoardMove}
                flipped={flipped}
                interactive
                boardTheme={prefs.boardTheme}
                pieceSet={prefs.pieceSet}
                showCoordinates={prefs.showCoordinates}
                highlightLegal={prefs.highlightLegalMoves}
                showLastMove={prefs.showLastMove !== false}
                pieceScale={prefs.pieceScale || 'normal'}
                autoQueen={prefs.autoQueen}
                moveMethod={prefs.moveMethod}
                suggestedArrows={bestArrow}
                annotations={boardAnnotations}
                onUpdateAnnotations={setBoardAnnotations}
                allowAnnotations
                lastMove={
                  activeVariation && activeVarBranch && activeVariation.step > 0
                    ? {
                        from: activeVarBranch.moves[activeVariation.step - 1].from,
                        to: activeVarBranch.moves[activeVariation.step - 1].to,
                      }
                    : ply > 0 && moves[ply - 1]
                    ? { from: moves[ply - 1].from, to: moves[ply - 1].to }
                    : null
                }
              />
            </div>

            <div className="w-full max-w-[540px] flex items-center justify-between px-3 py-1.5 rounded-lg bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 text-xs">
              <span className="font-semibold text-stone-700 dark:text-zinc-300">
                {flipped ? 'Black' : 'White'}
              </span>
              <MaterialStrip
                state={currentState}
                side={flipped ? 'b' : 'w'}
                pieceSet={prefs.pieceSet}
              />
            </div>

            {/* Playback Controls */}
            <div className="w-full max-w-[540px] flex flex-wrap items-center justify-between gap-2 bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-lg px-3 py-2">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setAutoReplay(false);
                    setActiveVariation(null);
                    setPly(0);
                  }}
                  disabled={ply === 0 && !activeVariation}
                  className="p-1.5 rounded hover:bg-stone-100 dark:hover:bg-zinc-800 disabled:opacity-30"
                  title="Start"
                >
                  <ChevronsLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAutoReplay(false);
                    if (activeVariation) {
                      if (activeVariation.step > 1) {
                        setActiveVariation({ ...activeVariation, step: activeVariation.step - 1 });
                      } else {
                        const base = activeVariation.basePly;
                        setActiveVariation(null);
                        setPly(base);
                      }
                    } else {
                      setPly((p) => Math.max(0, p - 1));
                    }
                  }}
                  disabled={ply === 0 && !activeVariation}
                  className="p-1.5 rounded hover:bg-stone-100 dark:hover:bg-zinc-800 disabled:opacity-30"
                  title="Previous Move"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveVariation(null);
                    setAutoReplay((r) => !r);
                  }}
                  disabled={moves.length === 0}
                  className={`p-1.5 rounded disabled:opacity-30 ${
                    autoReplay
                      ? 'bg-emerald-600 text-white'
                      : 'hover:bg-stone-100 dark:hover:bg-zinc-800 text-stone-700 dark:text-zinc-300'
                  }`}
                  title={autoReplay ? 'Pause Auto-Replay' : 'Auto-Replay Game'}
                >
                  {autoReplay ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAutoReplay(false);
                    if (activeVariation && activeVarBranch) {
                      if (activeVariation.step < activeVarBranch.moves.length) {
                        setActiveVariation({ ...activeVariation, step: activeVariation.step + 1 });
                      }
                    } else {
                      setPly((p) => Math.min(moves.length, p + 1));
                    }
                  }}
                  disabled={
                    activeVariation && activeVarBranch
                      ? activeVariation.step >= activeVarBranch.moves.length
                      : ply >= moves.length
                  }
                  className="p-1.5 rounded hover:bg-stone-100 dark:hover:bg-zinc-800 disabled:opacity-30"
                  title="Next Move"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAutoReplay(false);
                    setActiveVariation(null);
                    setPly(moves.length);
                  }}
                  disabled={ply >= moves.length && !activeVariation}
                  className="p-1.5 rounded hover:bg-stone-100 dark:hover:bg-zinc-800 disabled:opacity-30"
                  title="End"
                >
                  <ChevronsRight className="w-4 h-4" />
                </button>
              </div>

              <div className="text-xs font-mono text-stone-500 dark:text-zinc-400 truncate max-w-[200px]">
                {openingDetected.eco} · {openingDetected.name}
              </div>

              <div className="flex items-center gap-1">
                <select
                  value={autoReplayMs}
                  onChange={(e) => setAutoReplayMs(Number(e.target.value))}
                  className="px-1.5 py-1 rounded border border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-[11px] font-mono"
                  title="Auto-replay speed"
                >
                  <option value={600}>0.6s</option>
                  <option value={1100}>1.1s</option>
                  <option value={2000}>2.0s</option>
                </select>
                <button
                  type="button"
                  onClick={() => setFlipped((f) => !f)}
                  className="p-1.5 rounded hover:bg-stone-100 dark:hover:bg-zinc-800"
                  title="Flip Board"
                >
                  <ArrowLeftRight className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const st = createInitialState(variant);
                    setInitialFen(toFen(st));
                    setFens([toFen(st)]);
                    setMoves([]);
                    setSubVariations({});
                    setActiveVariation(null);
                    setAutoReplay(false);
                    setPly(0);
                    setReviewData(null);
                  }}
                  className="p-1.5 rounded hover:bg-stone-100 dark:hover:bg-zinc-800"
                  title="Reset Board"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Right Column: Contextual Tools */}
          <div className="lg:col-span-5 space-y-4">
            {/* 1. ANALYSIS BOARD TAB */}
            {subTab === 'board' && (
              <>
                {/* Cloud / Local Engine Multi-PV Panel */}
                <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Cpu className="w-4 h-4 text-emerald-600" />
                      <h3 className="text-sm font-semibold text-stone-900 dark:text-zinc-100">
                        Engine Analysis
                      </h3>
                      {engineComputing && (
                        <span className="text-[11px] font-mono text-stone-400 dark:text-zinc-500">
                          Evaluating...
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setShowBestArrow((v) => !v)}
                        disabled={!engineEnabled}
                        title="Toggle #1 best move arrow on board"
                        className={`px-2 py-1 rounded border text-xs font-medium whitespace-nowrap shrink-0 disabled:opacity-40 ${
                          showBestArrow && engineEnabled
                            ? 'border-emerald-600/60 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                            : 'border-stone-200 dark:border-zinc-700 text-stone-600 dark:text-zinc-400'
                        }`}
                      >
                        Arrow
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowThreat((v) => !v)}
                        disabled={!engineEnabled}
                        title="Show opponent threat arrow (shortcut: X)"
                        className={`px-2 py-1 rounded border text-xs font-medium flex items-center gap-1 whitespace-nowrap shrink-0 disabled:opacity-40 ${
                          showThreat && engineEnabled
                            ? 'border-red-500/60 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300'
                            : 'border-stone-200 dark:border-zinc-700 text-stone-600 dark:text-zinc-400 hover:bg-stone-50 dark:hover:bg-zinc-800'
                        }`}
                      >
                        <ShieldAlert className="w-3.5 h-3.5" />
                        Threat
                      </button>
                      {(boardAnnotations.arrows.length > 0 || boardAnnotations.squares.length > 0) && (
                        <button
                          type="button"
                          onClick={() => setBoardAnnotations({ arrows: [], squares: [] })}
                          className="px-2 py-1 rounded border border-stone-200 dark:border-zinc-700 text-xs font-medium text-stone-600 dark:text-zinc-400 hover:bg-stone-50 dark:hover:bg-zinc-800 whitespace-nowrap shrink-0"
                        >
                          Clear Marks
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onPlayFromPosition(currentFen, variant)}
                        title="Practice this exact position against the engine"
                        className="px-2 py-1 rounded border border-stone-200 dark:border-zinc-700 text-xs font-medium text-stone-700 dark:text-zinc-300 hover:bg-stone-50 dark:hover:bg-zinc-800 flex items-center gap-1 whitespace-nowrap shrink-0"
                      >
                        <Swords className="w-3.5 h-3.5" />
                        Play
                      </button>
                      <select
                        value={multiPvCount}
                        onChange={(e) => setMultiPvCount(Number(e.target.value))}
                        className="px-2 py-1 rounded border border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-xs font-mono"
                        title="Multi-PV lines"
                      >
                        {[1, 2, 3, 4, 5].map((n) => (
                          <option key={n} value={n}>
                            {n} {n === 1 ? 'Line' : 'Lines'}
                          </option>
                        ))}
                      </select>
                      <select
                        value={engineDepth}
                        onChange={(e) => setEngineDepth(Number(e.target.value))}
                        className="px-2 py-1 rounded border border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-xs font-mono"
                      >
                        <option value={2}>Depth 2</option>
                        <option value={3}>Depth 3</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => setEngineEnabled((v) => !v)}
                        className={`px-2.5 py-1 rounded text-xs font-medium whitespace-nowrap shrink-0 ${
                          engineEnabled
                            ? 'bg-emerald-600 text-white'
                            : 'bg-stone-200 dark:bg-zinc-800 text-stone-600 dark:text-zinc-400'
                        }`}
                      >
                        {engineEnabled ? 'ON' : 'OFF'}
                      </button>
                    </div>
                  </div>

                  {engineEnabled ? (
                    <div className="space-y-1.5">
                      {showThreat && threatLine && (
                        <div className="px-2.5 py-1.5 rounded-lg bg-red-50/70 dark:bg-red-950/30 border border-red-200 dark:border-red-900/60 flex items-center justify-between gap-2 text-xs">
                          <span className="font-semibold text-red-700 dark:text-red-300 shrink-0">
                            Threat:
                          </span>
                          <span className="font-mono text-red-900 dark:text-red-200 truncate">
                            {threatLine.pvSan.join(' ')}
                          </span>
                        </div>
                      )}

                      {lines.length === 0 ? (
                        <div className="text-xs text-stone-500 dark:text-zinc-400 py-2">
                          {engineComputing ? 'Computing Multi-PV lines...' : 'No legal moves in terminal position.'}
                        </div>
                      ) : (
                        lines.map((line) => (
                          <button
                            key={line.rank}
                            type="button"
                            onClick={() => playSanFromExplorer(line.pvSan[0])}
                            className="w-full text-left px-2.5 py-1.5 rounded-lg bg-stone-50 dark:bg-zinc-950 hover:bg-stone-100 dark:hover:bg-zinc-800 flex items-center gap-3 transition-colors"
                          >
                            <span
                              className={`font-mono text-xs font-bold tabular-nums w-12 shrink-0 ${
                                line.evalCp >= 0
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : 'text-red-600 dark:text-red-400'
                              }`}
                            >
                              {formatEval(line.evalCp, line.mateIn)}
                            </span>
                            <span className="font-mono text-xs text-stone-800 dark:text-zinc-200 truncate">
                              {line.pvSan.join(' ')}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-stone-500 dark:text-zinc-400">
                      Engine paused. Toggle ON to compute Multi-PV candidate lines.
                    </p>
                  )}
                </div>

                {/* Full Game Analysis & Learn From Mistakes */}
                <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold text-stone-900 dark:text-zinc-100">
                        Deep Game Review & Mistakes Trainer
                      </h3>
                      <div className="text-[11px] text-stone-500 dark:text-zinc-400 font-mono tabular-nums mt-0.5">
                        {PLAN_CATALOG[planTier].name} Plan · {normUsage.analysisUsed} /{' '}
                        {planLimits.analysisPerDay === null ? '∞' : planLimits.analysisPerDay} analyses today ·{' '}
                        <button
                          type="button"
                          onClick={onOpenPlans}
                          className="text-emerald-600 dark:text-emerald-400 font-sans font-semibold hover:underline"
                        >
                          {planTier === 'max' ? 'Manage Plan' : 'Upgrade'}
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {reviewProgress ? (
                        <button
                          type="button"
                          onClick={cancelFullGameAnalysis}
                          className="px-3 py-1.5 rounded-lg border border-stone-300 dark:border-zinc-700 text-xs font-medium text-stone-700 dark:text-zinc-200 flex items-center gap-1 whitespace-nowrap shrink-0"
                        >
                          <X className="w-3.5 h-3.5" />
                          Cancel ({reviewProgress.done}/{reviewProgress.total})
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={runFullGameAnalysis}
                          disabled={moves.length === 0}
                          className="px-3 py-1.5 rounded-lg bg-stone-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-medium disabled:opacity-40 whitespace-nowrap shrink-0"
                        >
                          Request Engine Analysis
                        </button>
                      )}
                      {reviewData && mistakesList.length > 0 && (
                        <button
                          type="button"
                          onClick={startMistakeDrill}
                          className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium flex items-center gap-1 whitespace-nowrap shrink-0"
                        >
                          <GraduationCap className="w-3.5 h-3.5" />
                          Learn from mistakes ({mistakesList.length})
                        </button>
                      )}
                    </div>
                  </div>

                  {reviewProgress && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px] font-mono tabular-nums text-stone-500 dark:text-zinc-400">
                        <span>Running background engine review...</span>
                        <span>
                          {reviewProgress.done} / {reviewProgress.total} plies
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-stone-100 dark:bg-zinc-800 overflow-hidden">
                        <div
                          className="h-full bg-emerald-600 transition-all duration-150"
                          style={{
                            width: `${
                              reviewProgress.total > 0
                                ? Math.round((reviewProgress.done / reviewProgress.total) * 100)
                                : 0
                            }%`,
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {analysisQuotaError && (
                    <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-800 dark:text-amber-200">
                      <span>{analysisQuotaError}</span>
                      <button
                        type="button"
                        onClick={onOpenPlans}
                        className="px-3 py-1 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white font-semibold whitespace-nowrap shrink-0"
                      >
                        View Free / Pro / Max
                      </button>
                    </div>
                  )}

                  {/* Mistake Drill Interactive Banner */}
                  {mistakeDrillActive && mistakesList[mistakeIndex] && (
                    <div className="p-3 rounded-lg bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 space-y-2">
                      <div className="flex items-center justify-between text-xs font-semibold text-emerald-900 dark:text-emerald-200">
                        <span>
                          Mistake {mistakeIndex + 1} of {mistakesList.length} · Move{' '}
                          {Math.ceil(mistakesList[mistakeIndex].ply / 2)} ({mistakesList[mistakeIndex].classification})
                        </span>
                        <button
                          type="button"
                          onClick={() => setMistakeDrillActive(false)}
                          className="underline"
                        >
                          Exit Drill
                        </button>
                      </div>
                      <p className="text-xs text-stone-700 dark:text-zinc-300">
                        You played <strong className="font-mono">{mistakesList[mistakeIndex].san}</strong> (lost{' '}
                        {mistakesList[mistakeIndex].cpLoss} cp). Find the stronger move on the board!
                      </p>
                      {mistakeFeedback && (
                        <div className="text-xs font-medium text-stone-900 dark:text-zinc-100">
                          {mistakeFeedback}
                        </div>
                      )}
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() =>
                            setMistakeFeedback(`Engine top choice: ${mistakesList[mistakeIndex].bestMoveSan}`)
                          }
                          className="px-2.5 py-1 rounded border border-stone-300 dark:border-zinc-700 text-xs"
                        >
                          View Solution
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (mistakeIndex + 1 < mistakesList.length) {
                              setMistakeIndex((i) => i + 1);
                            } else {
                              setMistakeDrillActive(false);
                            }
                          }}
                          className="px-2.5 py-1 rounded bg-emerald-600 text-white text-xs font-medium"
                        >
                          {mistakeIndex + 1 < mistakesList.length ? 'Next Mistake' : 'Finish Drill'}
                        </button>
                      </div>
                    </div>
                  )}

                  {reviewData && (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div className="p-2.5 rounded-lg bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800">
                          <div className="text-stone-500 dark:text-zinc-400">White Accuracy</div>
                          <div className="text-base font-mono font-bold tabular-nums text-stone-900 dark:text-zinc-100">
                            {reviewData.accuracy.w}% · {reviewData.acpl.w} ACPL
                          </div>
                        </div>
                        <div className="p-2.5 rounded-lg bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800">
                          <div className="text-stone-500 dark:text-zinc-400">Black Accuracy</div>
                          <div className="text-base font-mono font-bold tabular-nums text-stone-900 dark:text-zinc-100">
                            {reviewData.accuracy.b}% · {reviewData.acpl.b} ACPL
                          </div>
                        </div>
                      </div>

                      {/* Game Phase ACPL Breakdown */}
                      {phaseBreakdown && (
                        <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
                          <div className="p-2 rounded-lg bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800">
                            <div className="text-stone-500 dark:text-zinc-400">Opening ACPL</div>
                            <div className="font-mono font-bold tabular-nums text-stone-900 dark:text-zinc-100">
                              {phaseBreakdown.opening}
                            </div>
                          </div>
                          <div className="p-2 rounded-lg bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800">
                            <div className="text-stone-500 dark:text-zinc-400">Middlegame ACPL</div>
                            <div className="font-mono font-bold tabular-nums text-stone-900 dark:text-zinc-100">
                              {phaseBreakdown.middlegame}
                            </div>
                          </div>
                          <div className="p-2 rounded-lg bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800">
                            <div className="text-stone-500 dark:text-zinc-400">Endgame ACPL</div>
                            <div className="font-mono font-bold tabular-nums text-stone-900 dark:text-zinc-100">
                              {phaseBreakdown.endgame}
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-stone-500 dark:text-zinc-400 font-medium">
                          {chartMode === 'eval' ? 'Evaluation Advantage' : 'Material Balance'}
                        </span>
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => setChartMode('eval')}
                            className={`px-2 py-0.5 rounded font-medium ${
                              chartMode === 'eval'
                                ? 'bg-emerald-600 text-white'
                                : 'bg-stone-100 dark:bg-zinc-800 text-stone-600 dark:text-zinc-400'
                            }`}
                          >
                            Advantage
                          </button>
                          <button
                            type="button"
                            onClick={() => setChartMode('material')}
                            className={`px-2 py-0.5 rounded font-medium ${
                              chartMode === 'material'
                                ? 'bg-emerald-600 text-white'
                                : 'bg-stone-100 dark:bg-zinc-800 text-stone-600 dark:text-zinc-400'
                            }`}
                          >
                            Material
                          </button>
                        </div>
                      </div>

                      {/* Interactive Clickable Eval / Material Graph SVG */}
                      <div
                        className="h-20 w-full bg-zinc-950 rounded-lg overflow-hidden border border-stone-200 dark:border-zinc-800 relative cursor-pointer"
                        title="Click anywhere on graph to jump to move"
                        onClick={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                          const idx = Math.min(
                            reviewData.analyzed.length,
                            Math.max(1, Math.round(ratio * reviewData.analyzed.length))
                          );
                          setPly(idx);
                        }}
                      >
                        <svg viewBox={`0 0 ${Math.max(1, reviewData.analyzed.length) * 10} 100`} className="w-full h-full" preserveAspectRatio="none">
                          <line x1="0" y1="50" x2={Math.max(1, reviewData.analyzed.length) * 10} y2="50" stroke="#3f3f46" strokeWidth="1" />
                          {ply > 0 && ply <= reviewData.analyzed.length && (
                            <line
                              x1={(ply - 1) * 10 + 5}
                              y1="0"
                              x2={(ply - 1) * 10 + 5}
                              y2="100"
                              stroke="#fbbf24"
                              strokeWidth="1.5"
                              strokeDasharray="3,2"
                            />
                          )}
                          <polyline
                            fill="none"
                            stroke={chartMode === 'eval' ? '#10b981' : '#38bdf8'}
                            strokeWidth="2"
                            points={
                              chartMode === 'eval'
                                ? reviewData.analyzed
                                    .map((m, i) => {
                                      const clamped = Math.max(-600, Math.min(600, m.evalAfter));
                                      const y = 50 - (clamped / 600) * 45;
                                      return `${i * 10 + 5},${y}`;
                                    })
                                    .join(' ')
                                : materialSeries
                                    .map((adv, i) => {
                                      const clamped = Math.max(-12, Math.min(12, adv));
                                      const y = 50 - (clamped / 12) * 45;
                                      return `${i * 10 + 5},${y}`;
                                    })
                                    .join(' ')
                            }
                          />
                        </svg>
                      </div>
                    </div>
                  )}

                  {/* Move List with Classifications & Branching Variations */}
                  <div className="max-h-56 overflow-y-auto thin-scroll border border-stone-100 dark:border-zinc-800 rounded-lg p-2 bg-stone-50 dark:bg-zinc-950 font-mono text-xs space-y-1">
                    {moves.length === 0 ? (
                      <p className="text-stone-400 dark:text-zinc-500 text-center py-4 font-sans">
                        Play moves on the board, load a FEN, or import a PGN to analyze.
                      </p>
                    ) : (
                      moves.map((m, idx) => {
                        const rev = reviewData?.analyzed[idx];
                        const branchesAtPly = subVariations[idx] || [];
                        const glyph =
                          rev?.classification === 'Best'
                            ? '!!'
                            : rev?.classification === 'Great'
                            ? '!'
                            : rev?.classification === 'Inaccuracy'
                            ? '?!'
                            : rev?.classification === 'Mistake'
                            ? '?'
                            : rev?.classification === 'Blunder'
                            ? '??'
                            : '';
                        return (
                          <div key={idx} className="space-y-1">
                            {branchesAtPly.map((branch) => (
                              <div
                                key={branch.id}
                                className="ml-3 pl-2 border-l-2 border-emerald-500/60 bg-white dark:bg-zinc-900/80 rounded-r p-1.5 space-y-1"
                              >
                                <div className="flex items-center justify-between gap-2 text-[10px] font-sans text-stone-500 dark:text-zinc-400">
                                  <span className="flex items-center gap-1 font-semibold text-emerald-700 dark:text-emerald-400">
                                    <GitBranch className="w-3 h-3" />
                                    Sideline
                                  </span>
                                  <div className="flex items-center gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => promoteVariation(idx, branch.id)}
                                      className="hover:text-emerald-600 dark:hover:text-emerald-400 flex items-center gap-0.5 font-medium"
                                      title="Promote variation to mainline"
                                    >
                                      <ArrowUp className="w-3 h-3" />
                                      Promote
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => deleteVariation(idx, branch.id)}
                                      className="hover:text-red-600 flex items-center"
                                      title="Delete variation"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  </div>
                                </div>
                                <div className="flex flex-wrap gap-1">
                                  {branch.moves.map((bm, bIdx) => {
                                    const isActiveVarMove =
                                      activeVariation?.id === branch.id &&
                                      activeVariation.step === bIdx + 1;
                                    const absPly = idx + bIdx;
                                    return (
                                      <button
                                        key={bIdx}
                                        type="button"
                                        onClick={() =>
                                          setActiveVariation({
                                            basePly: idx,
                                            id: branch.id,
                                            step: bIdx + 1,
                                          })
                                        }
                                        className={`px-1.5 py-0.5 rounded text-[11px] ${
                                          isActiveVarMove
                                            ? 'bg-emerald-600 text-white font-semibold'
                                            : 'hover:bg-stone-100 dark:hover:bg-zinc-800 text-stone-700 dark:text-zinc-300'
                                        }`}
                                      >
                                        {absPly % 2 === 0 ? `${Math.floor(absPly / 2) + 1}. ` : ''}
                                        {bm.san}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            ))}

                            <button
                              type="button"
                              onClick={() => {
                                setActiveVariation(null);
                                setPly(idx + 1);
                              }}
                              className={`w-full text-left px-2 py-1 rounded flex items-center justify-between ${
                                !activeVariation && ply === idx + 1
                                  ? 'bg-emerald-600/15 text-emerald-700 dark:text-emerald-400 font-semibold'
                                  : 'hover:bg-stone-200/60 dark:hover:bg-zinc-800 text-stone-800 dark:text-zinc-200'
                              }`}
                            >
                              <span>
                                {idx % 2 === 0 ? `${Math.floor(idx / 2) + 1}. ` : '... '}
                                {m.san}
                                {glyph}
                              </span>
                              {rev && (
                                <span
                                  className={`text-[11px] font-sans ${
                                    rev.classification === 'Blunder'
                                      ? 'text-red-600 dark:text-red-400 font-semibold'
                                      : rev.classification === 'Mistake'
                                      ? 'text-amber-600 dark:text-amber-400 font-semibold'
                                      : rev.classification === 'Inaccuracy'
                                      ? 'text-sky-600 dark:text-sky-400'
                                      : 'text-stone-400 dark:text-zinc-500'
                                  }`}
                                >
                                  {rev.classification}
                                </span>
                              )}
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </>
            )}

            {/* 2. OPENING EXPLORER TAB */}
            {subTab === 'explorer' && (
              <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-4 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-emerald-600" />
                    <h3 className="text-sm font-semibold text-stone-900 dark:text-zinc-100">
                      Opening Explorer
                    </h3>
                  </div>
                  <div className="flex items-center gap-1 p-1 bg-stone-100 dark:bg-zinc-800 rounded-lg text-xs">
                    {([
                      ['global', 'Global Masters'],
                      ['personal', 'Personal'],
                      ['rival', 'Club / Rival'],
                    ] as const).map(([id, lbl]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setExplorerScope(id)}
                        className={`px-2.5 py-1 rounded font-medium ${
                          explorerScope === id
                            ? 'bg-white dark:bg-zinc-900 text-stone-900 dark:text-zinc-100 shadow-sm'
                            : 'text-stone-600 dark:text-zinc-400'
                        }`}
                      >
                        {lbl}
                      </button>
                    ))}
                  </div>
                </div>

                {explorerScope === 'global' && (
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs bg-stone-50 dark:bg-zinc-950 p-2.5 rounded-lg border border-stone-200 dark:border-zinc-800">
                    <div className="flex items-center gap-1">
                      <span className="text-stone-500 dark:text-zinc-400 mr-1">Rating:</span>
                      {(['1600', '2000', '2200', '2500'] as const).map((r) => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => setExplorerRating(r)}
                          className={`px-2 py-0.5 rounded font-mono text-[11px] border ${
                            explorerRating === r
                              ? 'border-emerald-600 bg-emerald-600 text-white'
                              : 'border-stone-200 dark:border-zinc-700 text-stone-600 dark:text-zinc-300'
                          }`}
                        >
                          {r}+
                        </button>
                      ))}
                    </div>
                    <select
                      value={explorerSpeed}
                      onChange={(e) =>
                        setExplorerSpeed(
                          e.target.value as 'all' | 'bullet' | 'blitz' | 'rapid' | 'classical'
                        )
                      }
                      className="px-2 py-1 rounded border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs"
                    >
                      <option value="all">All Speeds</option>
                      <option value="bullet">Bullet</option>
                      <option value="blitz">Blitz</option>
                      <option value="rapid">Rapid</option>
                      <option value="classical">Classical</option>
                    </select>
                  </div>
                )}

                {explorerScope === 'personal' && (
                  <div className="flex items-center justify-between text-xs bg-stone-50 dark:bg-zinc-950 p-2.5 rounded-lg">
                    <span className="text-stone-600 dark:text-zinc-400">
                      Aggregated from your {games.length} played/imported games
                    </span>
                    <div className="flex gap-1">
                      {(['all', 'w', 'b'] as const).map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setPersonalColor(c)}
                          className={`px-2 py-0.5 rounded border ${
                            personalColor === c
                              ? 'border-emerald-600 bg-emerald-600 text-white'
                              : 'border-stone-200 dark:border-zinc-700'
                          }`}
                        >
                          {c === 'all' ? 'All' : c === 'w' ? 'White' : 'Black'}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-medium text-stone-700 dark:text-zinc-300">
                  <span>{openingDetected.eco} · {openingDetected.name}</span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        const next = !repertoireDrill;
                        setRepertoireDrill(next);
                        setDrillStatus(
                          next
                            ? `Repertoire Drill active (${drillSide === 'w' ? 'White' : 'Black'}). Play book moves on the board.`
                            : null
                        );
                        if (next) {
                          const st = createInitialState('standard');
                          setVariant('standard');
                          setInitialFen(toFen(st));
                          setFens([toFen(st)]);
                          setMoves([]);
                          setPly(0);
                          setFlipped(drillSide === 'b');
                          if (drillSide === 'b') {
                            const firstSan = GLOBAL_OPENING_TREE['']?.moves[0]?.san || 'e4';
                            const mv = sanToMove(st, firstSan);
                            if (mv) {
                              const r = makeMove(st, mv);
                              setMoves([{ ...mv, san: r.san, uci: r.uci }]);
                              setFens([toFen(st), toFen(r.next)]);
                              setPly(1);
                            }
                          }
                        }
                      }}
                      className={`px-2.5 py-1 rounded border text-xs font-semibold transition-colors ${
                        repertoireDrill
                          ? 'border-emerald-600 bg-emerald-600 text-white'
                          : 'border-stone-200 dark:border-zinc-700 hover:bg-stone-50 dark:hover:bg-zinc-800'
                      }`}
                    >
                      {repertoireDrill ? 'Drilling Book' : 'Drill Repertoire'}
                    </button>
                    <select
                      value={drillSide}
                      onChange={(e) => setDrillSide(e.target.value as PieceColor)}
                      className="px-2 py-1 rounded border border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-xs"
                    >
                      <option value="w">As White</option>
                      <option value="b">As Black</option>
                    </select>
                  </div>
                </div>

                {drillStatus && (
                  <div className="px-3 py-2 rounded-lg bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 text-xs text-emerald-800 dark:text-emerald-200">
                    {drillStatus}
                  </div>
                )}

                <div className="space-y-2">
                  {explorerRows.length === 0 ? (
                    <div className="text-xs text-stone-500 dark:text-zinc-400 py-4 text-center">
                      No recorded games follow this exact branch yet. Play a move on the board or pick an opening below.
                    </div>
                  ) : (
                    explorerRows.map((row) => {
                      const wPct = Math.round((row.whiteWins / row.games) * 100);
                      const dPct = Math.round((row.draws / row.games) * 100);
                      const bPct = Math.max(0, 100 - wPct - dPct);
                      return (
                        <button
                          key={row.san}
                          type="button"
                          onClick={() => playSanFromExplorer(row.san)}
                          className="w-full text-left p-2 rounded-lg hover:bg-stone-50 dark:hover:bg-zinc-800/70 border border-stone-100 dark:border-zinc-800 space-y-1.5 transition-colors"
                        >
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-mono font-bold text-stone-900 dark:text-zinc-100">
                              {row.san}
                            </span>
                            <span className="font-mono text-stone-500 dark:text-zinc-400">
                              {row.games.toLocaleString()} games · Avg {row.avgRating}
                            </span>
                          </div>
                          <div className="h-2.5 w-full rounded overflow-hidden flex border border-stone-200 dark:border-zinc-700 text-[9px]">
                            <div style={{ width: `${wPct}%` }} className="bg-stone-100" title={`White ${wPct}%`} />
                            <div style={{ width: `${dPct}%` }} className="bg-stone-400" title={`Draw ${dPct}%`} />
                            <div style={{ width: `${bPct}%` }} className="bg-zinc-800" title={`Black ${bPct}%`} />
                          </div>
                          <div className="flex justify-between text-[11px] font-mono text-stone-500 dark:text-zinc-400">
                            <span>White {wPct}%</span>
                            <span>Draw {dPct}%</span>
                            <span>Black {bPct}%</span>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>

                {/* ECO Opening Catalog Search */}
                <div className="pt-3 border-t border-stone-100 dark:border-zinc-800 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-stone-700 dark:text-zinc-300">
                      ECO Opening Directory
                    </span>
                    <input
                      type="text"
                      value={openingSearch}
                      onChange={(e) => setOpeningSearch(e.target.value)}
                      placeholder="Search ECO or opening..."
                      className="w-44 px-2.5 py-1 rounded-md border border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-950 text-xs"
                    />
                  </div>
                  <div className="max-h-40 overflow-y-auto thin-scroll space-y-1">
                    {OPENING_CATALOG.filter((op) => {
                      const q = openingSearch.trim().toLowerCase();
                      if (!q) return true;
                      return (
                        op.name.toLowerCase().includes(q) ||
                        op.eco.toLowerCase().includes(q)
                      );
                    }).map((op) => (
                      <button
                        key={`${op.eco}-${op.name}`}
                        type="button"
                        onClick={() => loadOpeningLine(op.moves)}
                        className="w-full text-left px-2.5 py-1.5 rounded-lg border border-stone-100 dark:border-zinc-800 hover:bg-stone-50 dark:hover:bg-zinc-800/60 flex items-center justify-between gap-2 text-xs"
                      >
                        <span className="font-medium text-stone-800 dark:text-zinc-200 truncate">
                          <span className="font-mono text-emerald-600 dark:text-emerald-400 mr-1.5">
                            {op.eco}
                          </span>
                          {op.name}
                        </span>
                        <span className="font-mono text-[11px] text-stone-400 shrink-0 truncate max-w-[140px]">
                          {op.moves.join(' ')}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* 3. 7-PIECE TABLEBASE TAB */}
            {subTab === 'tablebase' && tbResult && (
              <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sliders className="w-4 h-4 text-emerald-600" />
                    <h3 className="text-sm font-semibold text-stone-900 dark:text-zinc-100">
                      7-Piece Endgame Tablebase
                    </h3>
                  </div>
                  <span className="text-xs font-mono text-stone-500 dark:text-zinc-400">
                    {tbResult.pieceCount} pieces
                  </span>
                </div>

                <div className="p-3.5 rounded-lg bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-stone-500 dark:text-zinc-400">
                      Tablebase Verdict ({currentState.turn === 'w' ? 'White' : 'Black'} to move)
                    </span>
                    <span
                      className={`text-xs font-bold ${
                        tbResult.wdl === 'Win'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : tbResult.wdl === 'Loss'
                          ? 'text-red-600 dark:text-red-400'
                          : 'text-stone-700 dark:text-zinc-300'
                      }`}
                    >
                      {tbResult.wdl} · {tbResult.dtzText}
                    </span>
                  </div>
                  <p className="text-xs text-stone-600 dark:text-zinc-400">{tbResult.explanation}</p>
                </div>

                {tbResult.bestMoves.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-xs font-semibold text-stone-700 dark:text-zinc-300">
                      Optimal Endgame Moves
                    </div>
                    {tbResult.bestMoves.map((bm) => (
                      <button
                        key={bm.uci}
                        type="button"
                        onClick={() => playSanFromExplorer(bm.san)}
                        className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg bg-stone-50 dark:bg-zinc-950 hover:bg-stone-100 dark:hover:bg-zinc-800 text-xs"
                      >
                        <span className="font-mono font-bold text-stone-900 dark:text-zinc-100">{bm.san}</span>
                        <span className="font-mono text-emerald-600 dark:text-emerald-400">{bm.outcome}</span>
                      </button>
                    ))}
                  </div>
                )}

                <div className="pt-2 border-t border-stone-100 dark:border-zinc-800 space-y-2">
                  <div className="text-xs font-semibold text-stone-700 dark:text-zinc-300">
                    Load Classic Tablebase Endgames
                  </div>
                  <div className="grid grid-cols-1 gap-1.5">
                    {TABLEBASE_PRESETS.map((preset) => (
                      <button
                        key={preset.name}
                        type="button"
                        onClick={() => {
                          const st = parseFen(preset.fen, 'standard');
                          setVariant('standard');
                          setInitialFen(preset.fen);
                          setFens([preset.fen]);
                          setMoves([]);
                          setPly(0);
                        }}
                        className="text-left p-2.5 rounded-lg border border-stone-200 dark:border-zinc-800 hover:bg-stone-50 dark:hover:bg-zinc-800/60"
                      >
                        <div className="text-xs font-semibold text-stone-900 dark:text-zinc-100">
                          {preset.name}
                        </div>
                        <div className="text-[11px] text-stone-500 dark:text-zinc-400">{preset.note}</div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Variant switcher quick bar */}
            <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-3 flex items-center justify-between">
              <span className="text-xs font-medium text-stone-600 dark:text-zinc-400">
                Analysis Variant Rules
              </span>
              <select
                value={variant}
                onChange={(e) => {
                  const v = e.target.value as ChessVariant;
                  const st = createInitialState(v);
                  setVariant(v);
                  setInitialFen(toFen(st));
                  setFens([toFen(st)]);
                  setMoves([]);
                  setPly(0);
                  setReviewData(null);
                }}
                className="px-2.5 py-1 rounded-lg border border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-xs font-medium"
              >
                {VARIANTS.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {/* PGN Import Modal */}
      {showPgnModal && (
        <div className="fixed inset-0 z-50 bg-zinc-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-5 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-stone-900 dark:text-zinc-100">
                Upload or Paste PGN
              </h3>
              <button
                type="button"
                onClick={() => setShowPgnModal(false)}
                className="text-xs text-stone-500 hover:text-stone-800 dark:hover:text-zinc-200"
              >
                Close
              </button>
            </div>

            <div className="flex items-center gap-3">
              <label className="px-3 py-1.5 rounded-lg border border-stone-200 dark:border-zinc-700 text-xs font-medium cursor-pointer hover:bg-stone-50 dark:hover:bg-zinc-800">
                Choose .pgn File
                <input type="file" accept=".pgn,.txt" onChange={handleUploadPgnFile} className="hidden" />
              </label>
              <button
                type="button"
                onClick={() =>
                  setPgnInput(
                    `[Event "Immortal Sample"]\n[White "Morphy"]\n[Black "Duke Karl"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7 8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7 14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0`
                  )
                }
                className="text-xs text-emerald-600 hover:underline"
              >
                Load Opera Game Sample
              </button>
            </div>

            <textarea
              rows={8}
              value={pgnInput}
              onChange={(e) => setPgnInput(e.target.value)}
              placeholder="Paste PGN notation here..."
              className="w-full p-3 rounded-lg border border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-950 font-mono text-xs"
            />

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowPgnModal(false)}
                className="px-3.5 py-1.5 rounded-lg border border-stone-200 dark:border-zinc-700 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleImportPgnSubmit}
                className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
              >
                Import into Analysis
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
