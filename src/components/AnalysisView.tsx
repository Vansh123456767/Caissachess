import React, { useEffect, useMemo, useState } from 'react';
import {
  AnalyzedMove,
  BoardState,
  ChessVariant,
  GameRecord,
  Move,
  Piece,
  PieceColor,
  PieceType,
  Puzzle,
  UserPreferences,
} from '../types/chess';
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
  formatEval,
  probeTablebase,
} from '../engine/aiSearch';
import {
  buildPersonalOpeningStats,
  detectOpeningFromMoves,
  GLOBAL_OPENING_TREE,
} from '../data/openings';
import { TABLEBASE_PRESETS } from '../data/puzzlesAndLessons';
import { ChessBoard, BOARD_THEMES } from './ChessBoard';
import { ChessPiece } from './ChessPiece';
import { EvalBar } from './EvalBar';
import { soundFX } from '../utils/sound';
import {
  ArrowLeftRight,
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
  GraduationCap,
  Play,
  RotateCcw,
  Sliders,
  Upload,
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
}

type AnalysisSubTab = 'board' | 'editor' | 'explorer' | 'tablebase';

export const AnalysisView: React.FC<AnalysisViewProps> = ({
  prefs,
  games,
  incomingPayload,
  onSaveExtractedPuzzles,
  onPlayFromPosition,
  onImportGameRecord,
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
  const [lines, setLines] = useState<EngineLine[]>([]);

  // Full game review & Learn from mistakes
  const [reviewData, setReviewData] = useState<{
    analyzed: AnalyzedMove[];
    accuracy: { w: number; b: number };
    acpl: { w: number; b: number };
  } | null>(null);
  const [mistakeDrillActive, setMistakeDrillActive] = useState(false);
  const [mistakeIndex, setMistakeIndex] = useState(0);
  const [mistakeFeedback, setMistakeFeedback] = useState<string | null>(null);

  // Opening Explorer state
  const [explorerScope, setExplorerScope] = useState<'global' | 'personal' | 'rival'>('global');
  const [personalColor, setPersonalColor] = useState<PieceColor | 'all'>('all');

  // PGN Modal state
  const [showPgnModal, setShowPgnModal] = useState(false);
  const [pgnInput, setPgnInput] = useState('');
  const [copiedFen, setCopiedFen] = useState(false);

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
    setReviewData(null);
    setMistakeDrillActive(false);
    setSubTab('board');
  }, [incomingPayload]);

  const currentFen = fens[ply] || initialFen;
  const currentState = useMemo(() => parseFen(currentFen, variant), [currentFen, variant]);

  // Run Multi-PV analysis on current position
  useEffect(() => {
    if (!engineEnabled) {
      setLines([]);
      return;
    }
    const timer = window.setTimeout(() => {
      const computed = analyzePositionMultiPv(currentState, 3, engineDepth);
      setLines(computed);
    }, 60);
    return () => window.clearTimeout(timer);
  }, [currentState, engineEnabled, engineDepth]);

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
    const slicedMoves = moves.slice(0, ply);
    const slicedFens = fens.slice(0, ply + 1);
    const nextMoves = [...slicedMoves, committed];
    const nextFens = [...slicedFens, toFen(res.next)];

    if (res.san.includes('+')) soundFX.check();
    else if (mv.captured) soundFX.capture();
    else soundFX.move();

    setMoves(nextMoves);
    setFens(nextFens);
    setPly(nextMoves.length);
  };

  const playSanFromExplorer = (san: string) => {
    const mv = sanToMove(currentState, san);
    if (mv) handleBoardMove(mv);
  };

  const runFullGameAnalysis = () => {
    if (moves.length === 0) return;
    const res = analyzeGameMoves(fens, moves, variant);
    setReviewData({ analyzed: res.analyzed, accuracy: res.accuracy, acpl: res.acpl });
    if (res.extractedPuzzles.length > 0) {
      onSaveExtractedPuzzles(res.extractedPuzzles);
    }
  };

  const mistakesList = useMemo(() => {
    if (!reviewData) return [];
    return reviewData.analyzed.filter(
      (m) => m.classification === 'Inaccuracy' || m.classification === 'Mistake' || m.classification === 'Blunder'
    );
  }, [reviewData]);

  const startMistakeDrill = () => {
    if (!reviewData) {
      runFullGameAnalysis();
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
  const currentSans = useMemo(() => moves.slice(0, ply).map((m) => m.san || ''), [moves, ply]);
  const openingDetected = useMemo(() => detectOpeningFromMoves(currentSans), [currentSans]);

  const explorerRows = useMemo(() => {
    if (explorerScope === 'global') {
      const node = GLOBAL_OPENING_TREE[currentSans.join(' ')];
      return node ? node.moves : [];
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
  }, [explorerScope, currentSans, games, personalColor]);

  // Tablebase result
  const tbResult = useMemo(() => probeTablebase(currentState), [currentState]);

  // Best-move arrow for board
  const bestArrow = useMemo(() => {
    if (!engineEnabled || lines.length === 0 || mistakeDrillActive) return [];
    const uci = lines[0].pvUci[0];
    if (!uci || uci.includes('@') || uci.length < 4) return [];
    return [{ from: uci.slice(0, 2), to: uci.slice(2, 4), color: '#059669' }];
  }, [engineEnabled, lines, mistakeDrillActive]);

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

        <div className="flex items-center gap-2">
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
          <div className="lg:col-span-7 flex flex-col items-center gap-3">
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
                suggestedArrows={bestArrow}
                allowAnnotations
                lastMove={ply > 0 && moves[ply - 1] ? { from: moves[ply - 1].from, to: moves[ply - 1].to } : null}
              />
            </div>

            {/* Playback Controls */}
            <div className="w-full max-w-[540px] flex items-center justify-between bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-lg px-3 py-2">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPly(0)}
                  disabled={ply === 0}
                  className="p-1.5 rounded hover:bg-stone-100 dark:hover:bg-zinc-800 disabled:opacity-30"
                  title="Start"
                >
                  <ChevronsLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setPly((p) => Math.max(0, p - 1))}
                  disabled={ply === 0}
                  className="p-1.5 rounded hover:bg-stone-100 dark:hover:bg-zinc-800 disabled:opacity-30"
                  title="Previous Move"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setPly((p) => Math.min(moves.length, p + 1))}
                  disabled={ply >= moves.length}
                  className="p-1.5 rounded hover:bg-stone-100 dark:hover:bg-zinc-800 disabled:opacity-30"
                  title="Next Move"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setPly(moves.length)}
                  disabled={ply >= moves.length}
                  className="p-1.5 rounded hover:bg-stone-100 dark:hover:bg-zinc-800 disabled:opacity-30"
                  title="End"
                >
                  <ChevronsRight className="w-4 h-4" />
                </button>
              </div>

              <div className="text-xs font-mono text-stone-500 dark:text-zinc-400">
                {openingDetected.eco} · {openingDetected.name}
              </div>

              <div className="flex items-center gap-1">
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
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Cpu className="w-4 h-4 text-emerald-600" />
                      <h3 className="text-sm font-semibold text-stone-900 dark:text-zinc-100">
                        Cloud & Local Engine Analysis
                      </h3>
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        value={engineDepth}
                        onChange={(e) => setEngineDepth(Number(e.target.value))}
                        className="px-2 py-1 rounded border border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-xs font-mono"
                      >
                        <option value={2}>Fast (Depth 2)</option>
                        <option value={3}>Deep (Depth 3)</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => setEngineEnabled((v) => !v)}
                        className={`px-2.5 py-1 rounded text-xs font-medium ${
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
                      {lines.length === 0 ? (
                        <div className="text-xs text-stone-500 dark:text-zinc-400 py-2">
                          No legal moves in terminal position.
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
                              className={`font-mono text-xs font-bold w-12 shrink-0 ${
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
                    <h3 className="text-sm font-semibold text-stone-900 dark:text-zinc-100">
                      Deep Game Review & Mistakes Trainer
                    </h3>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={runFullGameAnalysis}
                        disabled={moves.length === 0}
                        className="px-3 py-1.5 rounded-lg bg-stone-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-medium disabled:opacity-40"
                      >
                        Request Engine Analysis
                      </button>
                      {reviewData && mistakesList.length > 0 && (
                        <button
                          type="button"
                          onClick={startMistakeDrill}
                          className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium flex items-center gap-1"
                        >
                          <GraduationCap className="w-3.5 h-3.5" />
                          Learn from mistakes ({mistakesList.length})
                        </button>
                      )}
                    </div>
                  </div>

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
                          <div className="text-base font-mono font-bold text-stone-900 dark:text-zinc-100">
                            {reviewData.accuracy.w}% · {reviewData.acpl.w} ACPL
                          </div>
                        </div>
                        <div className="p-2.5 rounded-lg bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800">
                          <div className="text-stone-500 dark:text-zinc-400">Black Accuracy</div>
                          <div className="text-base font-mono font-bold text-stone-900 dark:text-zinc-100">
                            {reviewData.accuracy.b}% · {reviewData.acpl.b} ACPL
                          </div>
                        </div>
                      </div>

                      {/* Eval Graph SVG */}
                      <div className="h-20 w-full bg-zinc-950 rounded-lg overflow-hidden border border-stone-200 dark:border-zinc-800 relative">
                        <svg viewBox={`0 0 ${Math.max(1, reviewData.analyzed.length) * 10} 100`} className="w-full h-full" preserveAspectRatio="none">
                          <line x1="0" y1="50" x2={Math.max(1, reviewData.analyzed.length) * 10} y2="50" stroke="#3f3f46" strokeWidth="1" />
                          <polyline
                            fill="none"
                            stroke="#10b981"
                            strokeWidth="2"
                            points={reviewData.analyzed
                              .map((m, i) => {
                                const clamped = Math.max(-600, Math.min(600, m.evalAfter));
                                const y = 50 - (clamped / 600) * 45;
                                return `${i * 10 + 5},${y}`;
                              })
                              .join(' ')}
                          />
                        </svg>
                      </div>
                    </div>
                  )}

                  {/* Move List with Classifications */}
                  <div className="max-h-48 overflow-y-auto thin-scroll border border-stone-100 dark:border-zinc-800 rounded-lg p-2 bg-stone-50 dark:bg-zinc-950 font-mono text-xs space-y-0.5">
                    {moves.length === 0 ? (
                      <p className="text-stone-400 dark:text-zinc-500 text-center py-4 font-sans">
                        Play moves on the board, load a FEN, or import a PGN to analyze.
                      </p>
                    ) : (
                      moves.map((m, idx) => {
                        const rev = reviewData?.analyzed[idx];
                        return (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => setPly(idx + 1)}
                            className={`w-full text-left px-2 py-1 rounded flex items-center justify-between ${
                              ply === idx + 1
                                ? 'bg-emerald-600/15 text-emerald-700 dark:text-emerald-400 font-semibold'
                                : 'hover:bg-stone-200/60 dark:hover:bg-zinc-800 text-stone-800 dark:text-zinc-200'
                            }`}
                          >
                            <span>
                              {idx % 2 === 0 ? `${Math.floor(idx / 2) + 1}. ` : '... '}
                              {m.san}
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

                <div className="text-xs font-medium text-stone-700 dark:text-zinc-300">
                  {openingDetected.eco} · {openingDetected.name}
                </div>

                <div className="space-y-2">
                  {explorerRows.length === 0 ? (
                    <div className="text-xs text-stone-500 dark:text-zinc-400 py-6 text-center">
                      No recorded games follow this exact branch yet. Play a move on the board or finish games to populate your personal repertoire.
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
              </div>
            )}

            {/* 3. 7-PIECE TABLEBASE TAB */}
            {subTab === 'tablebase' && (
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
