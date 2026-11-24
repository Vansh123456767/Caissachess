import React, { useEffect, useMemo, useState } from 'react';
import {
  BoardAnnotation,
  GameRecord,
  Move,
  Study,
  StudyChapter,
  UserPreferences,
} from '../types/chess';
import {
  createInitialState,
  exportPgn,
  makeMove,
  parseFen,
  parsePgn,
  toFen,
} from '../engine/chessEngine';
import { ChessBoard } from './ChessBoard';
import {
  BarChart3,
  BookMarked,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Microscope,
  Plus,
  Share2,
  Trash2,
} from 'lucide-react';

interface StudiesViewProps {
  prefs: UserPreferences;
  games: GameRecord[];
  onOpenGameInAnalysis: (game: GameRecord) => void;
}

function buildSeedStudies(): Study[] {
  const operaPgn = `[Event "Opera Box Game"]\n[White "Paul Morphy"]\n[Black "Duke Karl / Count Isouard"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7 8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7 14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0`;
  const parsed = parsePgn(operaPgn);
  const startFen = toFen(createInitialState('standard'));

  return [
    {
      id: 'study-opera',
      title: "Morphy's Opera Game — Development & Sacrifice",
      author: 'Caissa Library',
      description: 'Classic demonstration of rapid piece development, pinning, and exchange sacrifices.',
      updatedAt: Date.now() - 86400000,
      chapters: [
        {
          id: 'ch-opera-1',
          title: 'Chapter 1: Full Annotated Game',
          initialFen: startFen,
          variant: 'standard',
          moves: parsed.moves,
          fens: parsed.fens,
          comments: {
            19: '10. Nxb5! Morphy sacrifices a knight to open the d-file and accelerate attack on the uncastled king.',
            25: '13. Rxd7! Eliminating a key defender before bringing the second rook into the pin.',
            31: '16. Qb8+! Deflecting the knight away from d8 so Rd8# delivers a picturesque mate.',
          },
          nags: { 19: '!!', 25: '!', 31: '!!' },
          annotations: {
            19: { arrows: [{ from: 'c3', to: 'b5', color: '#10b981' }], squares: [] },
            31: { arrows: [{ from: 'b3', to: 'b8', color: '#10b981' }, { from: 'd1', to: 'd8', color: '#d97706' }], squares: [] },
          },
        },
      ],
    },
  ];
}

export const StudiesView: React.FC<StudiesViewProps> = ({
  prefs,
  games,
  onOpenGameInAnalysis,
}) => {
  const [subTab, setSubTab] = useState<'studies' | 'insights'>('studies');

  const [studies, setStudies] = useState<Study[]>(() => {
    try {
      const raw = localStorage.getItem('caissa_studies_v1');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // ignore
    }
    return buildSeedStudies();
  });

  useEffect(() => {
    try {
      localStorage.setItem('caissa_studies_v1', JSON.stringify(studies));
    } catch {
      // ignore
    }
  }, [studies]);

  const [activeStudyId, setActiveStudyId] = useState<string>(studies[0]?.id || '');
  const activeStudy = studies.find((s) => s.id === activeStudyId) || studies[0];
  const [activeChapterId, setActiveChapterId] = useState<string>(activeStudy?.chapters[0]?.id || '');
  const activeChapter =
    activeStudy?.chapters.find((c) => c.id === activeChapterId) || activeStudy?.chapters[0];

  const [ply, setPly] = useState(0);
  const [newStudyTitle, setNewStudyTitle] = useState('');
  const [copiedShare, setCopiedShare] = useState(false);

  useEffect(() => {
    if (activeStudy && !activeStudy.chapters.some((c) => c.id === activeChapterId)) {
      setActiveChapterId(activeStudy.chapters[0]?.id || '');
      setPly(0);
    }
  }, [activeStudy, activeChapterId]);

  const currentFen = activeChapter?.fens[ply] || activeChapter?.initialFen || toFen(createInitialState('standard'));
  const currentState = useMemo(
    () => parseFen(currentFen, activeChapter?.variant || 'standard'),
    [currentFen, activeChapter?.variant]
  );

  const updateActiveChapter = (updater: (ch: StudyChapter) => StudyChapter) => {
    if (!activeStudy || !activeChapter) return;
    setStudies((prev) =>
      prev.map((s) =>
        s.id === activeStudy.id
          ? {
              ...s,
              updatedAt: Date.now(),
              chapters: s.chapters.map((c) => (c.id === activeChapter.id ? updater(c) : c)),
            }
          : s
      )
    );
  };

  const handleStudyMove = (mv: Move) => {
    if (!activeChapter) return;
    const res = makeMove(currentState, mv);
    const committed: Move = { ...mv, san: res.san, uci: res.uci };
    const nextMoves = [...activeChapter.moves.slice(0, ply), committed];
    const nextFens = [...activeChapter.fens.slice(0, ply + 1), toFen(res.next)];
    updateActiveChapter((ch) => ({
      ...ch,
      moves: nextMoves,
      fens: nextFens,
    }));
    setPly(nextMoves.length);
  };

  const createStudy = () => {
    const title = newStudyTitle.trim() || `Study #${studies.length + 1}`;
    const initFen = toFen(createInitialState('standard'));
    const st: Study = {
      id: `study-${Date.now()}`,
      title,
      author: prefs.username,
      description: 'Personal annotated analysis study.',
      updatedAt: Date.now(),
      chapters: [
        {
          id: `ch-${Date.now()}`,
          title: 'Chapter 1',
          initialFen: initFen,
          variant: 'standard',
          moves: [],
          fens: [initFen],
          comments: {},
          nags: {},
          annotations: {},
        },
      ],
    };
    setStudies((prev) => [st, ...prev]);
    setActiveStudyId(st.id);
    setActiveChapterId(st.chapters[0].id);
    setPly(0);
    setNewStudyTitle('');
  };

  const addChapter = () => {
    if (!activeStudy) return;
    const initFen = toFen(createInitialState('standard'));
    const ch: StudyChapter = {
      id: `ch-${Date.now()}`,
      title: `Chapter ${activeStudy.chapters.length + 1}`,
      initialFen: initFen,
      variant: 'standard',
      moves: [],
      fens: [initFen],
      comments: {},
      nags: {},
      annotations: {},
    };
    setStudies((prev) =>
      prev.map((s) =>
        s.id === activeStudy.id ? { ...s, chapters: [...s.chapters, ch], updatedAt: Date.now() } : s
      )
    );
    setActiveChapterId(ch.id);
    setPly(0);
  };

  const handleShareStudy = () => {
    if (!activeStudy) return;
    const payload = JSON.stringify(activeStudy, null, 2);
    navigator.clipboard.writeText(payload).catch(() => {});
    setCopiedShare(true);
    setTimeout(() => setCopiedShare(false), 1800);
  };

  // ==================== CHESS INSIGHTS CALCULATIONS ====================
  const insights = useMemo(() => {
    const total = games.length;
    let wins = 0;
    let losses = 0;
    let draws = 0;
    let whiteGames = 0;
    let whiteWins = 0;
    let blackGames = 0;
    let blackWins = 0;
    const openingMap = new Map<string, { name: string; count: number; wins: number }>();
    const variantMap = new Map<string, number>();

    for (const g of games) {
      const uCol = g.userColor || 'w';
      const isWin = (uCol === 'w' && g.result === '1-0') || (uCol === 'b' && g.result === '0-1');
      const isDraw = g.result === '1/2-1/2';
      if (isWin) wins++;
      else if (isDraw) draws++;
      else losses++;

      if (uCol === 'w') {
        whiteGames++;
        if (isWin) whiteWins++;
      } else {
        blackGames++;
        if (isWin) blackWins++;
      }

      const opKey = g.openingName || 'Standard Opening';
      const opEntry = openingMap.get(opKey) || { name: opKey, count: 0, wins: 0 };
      opEntry.count++;
      if (isWin) opEntry.wins++;
      openingMap.set(opKey, opEntry);

      variantMap.set(g.variant, (variantMap.get(g.variant) || 0) + 1);
    }

    const topOpenings = Array.from(openingMap.values()).sort((a, b) => b.count - a.count).slice(0, 6);
    return {
      total,
      wins,
      losses,
      draws,
      winRate: total > 0 ? Math.round((wins / total) * 100) : 0,
      whiteWinRate: whiteGames > 0 ? Math.round((whiteWins / whiteGames) * 100) : 0,
      blackWinRate: blackGames > 0 ? Math.round((blackWins / blackGames) * 100) : 0,
      topOpenings,
      variants: Array.from(variantMap.entries()),
    };
  }, [games]);

  return (
    <div className="space-y-6">
      {/* Sub-navigation */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-stone-200 dark:border-zinc-800 pb-3">
        <div className="flex items-center gap-1 p-1 bg-stone-100 dark:bg-zinc-900 rounded-lg">
          <button
            type="button"
            onClick={() => setSubTab('studies')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 ${
              subTab === 'studies'
                ? 'bg-white dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 shadow-sm'
                : 'text-stone-600 dark:text-zinc-400 hover:text-stone-900 dark:hover:text-zinc-100'
            }`}
          >
            <BookMarked className="w-3.5 h-3.5" />
            Studies (Persistent & Shareable)
          </button>
          <button
            type="button"
            onClick={() => setSubTab('insights')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 ${
              subTab === 'insights'
                ? 'bg-white dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 shadow-sm'
                : 'text-stone-600 dark:text-zinc-400 hover:text-stone-900 dark:hover:text-zinc-100'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            Chess Insights
          </button>
        </div>

        <span className="text-xs text-stone-500 dark:text-zinc-400">
          Right-click squares or drag arrows on the Study board to annotate
        </span>
      </div>

      {/* ==================== STUDIES WORKSPACE ==================== */}
      {subTab === 'studies' && activeStudy && activeChapter && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left sidebar: Studies & Chapters */}
          <div className="lg:col-span-3 space-y-4">
            <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-4 space-y-3">
              <h2 className="text-sm font-semibold text-stone-900 dark:text-zinc-100">
                Your Studies
              </h2>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={newStudyTitle}
                  onChange={(e) => setNewStudyTitle(e.target.value)}
                  placeholder="New study title..."
                  className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg border border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-950 text-xs"
                />
                <button
                  type="button"
                  onClick={createStudy}
                  className="px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium shrink-0"
                  title="Create Study"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-1.5 max-h-48 overflow-y-auto thin-scroll">
                {studies.map((s) => (
                  <div
                    key={s.id}
                    className={`p-2 rounded-lg border text-xs flex items-center justify-between gap-2 ${
                      s.id === activeStudy.id
                        ? 'border-emerald-600 bg-emerald-50/70 dark:bg-emerald-950/30'
                        : 'border-stone-200 dark:border-zinc-800'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setActiveStudyId(s.id);
                        setActiveChapterId(s.chapters[0]?.id || '');
                        setPly(0);
                      }}
                      className="text-left flex-1 min-w-0"
                    >
                      <div className="font-semibold text-stone-900 dark:text-zinc-100 truncate">
                        {s.title}
                      </div>
                      <div className="text-[11px] text-stone-500 dark:text-zinc-400">
                        {s.chapters.length} chapters
                      </div>
                    </button>
                    {studies.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setStudies((prev) => prev.filter((x) => x.id !== s.id))}
                        className="text-stone-400 hover:text-red-500 shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-stone-900 dark:text-zinc-100">
                  Chapters
                </h3>
                <button
                  type="button"
                  onClick={addChapter}
                  className="text-xs text-emerald-600 font-medium flex items-center gap-0.5"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add
                </button>
              </div>
              <div className="space-y-1">
                {activeStudy.chapters.map((ch) => (
                  <button
                    key={ch.id}
                    type="button"
                    onClick={() => {
                      setActiveChapterId(ch.id);
                      setPly(0);
                    }}
                    className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs ${
                      ch.id === activeChapter.id
                        ? 'bg-stone-900 dark:bg-zinc-100 text-white dark:text-zinc-900 font-medium'
                        : 'hover:bg-stone-100 dark:hover:bg-zinc-800 text-stone-700 dark:text-zinc-300'
                    }`}
                  >
                    {ch.title}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Center Board */}
          <div className="lg:col-span-5 flex flex-col items-center gap-3">
            <ChessBoard
              state={currentState}
              onMove={handleStudyMove}
              interactive
              allowAnnotations
              annotations={activeChapter.annotations[ply]}
              onUpdateAnnotations={(nextAnn: BoardAnnotation) =>
                updateActiveChapter((ch) => ({
                  ...ch,
                  annotations: { ...ch.annotations, [ply]: nextAnn },
                }))
              }
              boardTheme={prefs.boardTheme}
              pieceSet={prefs.pieceSet}
              showCoordinates={prefs.showCoordinates}
              highlightLegal={prefs.highlightLegalMoves}
              lastMove={
                ply > 0 && activeChapter.moves[ply - 1]
                  ? { from: activeChapter.moves[ply - 1].from, to: activeChapter.moves[ply - 1].to }
                  : null
              }
            />

            <div className="w-full max-w-[540px] flex items-center justify-between bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-lg px-3 py-2">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPly((p) => Math.max(0, p - 1))}
                  disabled={ply === 0}
                  className="p-1.5 rounded hover:bg-stone-100 dark:hover:bg-zinc-800 disabled:opacity-30"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="font-mono text-xs px-2">
                  Ply {ply} / {activeChapter.moves.length}
                </span>
                <button
                  type="button"
                  onClick={() => setPly((p) => Math.min(activeChapter.moves.length, p + 1))}
                  disabled={ply >= activeChapter.moves.length}
                  className="p-1.5 rounded hover:bg-stone-100 dark:hover:bg-zinc-800 disabled:opacity-30"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleShareStudy}
                  className="px-2.5 py-1 rounded border border-stone-200 dark:border-zinc-700 text-xs font-medium flex items-center gap-1"
                >
                  {copiedShare ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Share2 className="w-3.5 h-3.5" />}
                  {copiedShare ? 'Copied Study JSON' : 'Share Study'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const pgn = exportPgn({
                      event: activeStudy.title,
                      initialFen: activeChapter.initialFen,
                      moves: activeChapter.moves,
                    });
                    const blob = new Blob([pgn], { type: 'application/x-chess-pgn' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${activeChapter.title.replace(/\s+/g, '_')}.pgn`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="px-2.5 py-1 rounded border border-stone-200 dark:border-zinc-700 text-xs font-medium flex items-center gap-1"
                >
                  <Download className="w-3.5 h-3.5" />
                  PGN
                </button>
              </div>
            </div>
          </div>

          {/* Right Annotations & Move Notation */}
          <div className="lg:col-span-4 space-y-4">
            <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-4 space-y-3">
              <h3 className="text-sm font-semibold text-stone-900 dark:text-zinc-100">
                Moves & Glyphs
              </h3>
              <div className="max-h-56 overflow-y-auto thin-scroll flex flex-wrap gap-1.5 font-mono text-xs bg-stone-50 dark:bg-zinc-950 p-2.5 rounded-lg border border-stone-100 dark:border-zinc-800">
                {activeChapter.moves.length === 0 ? (
                  <span className="text-stone-400 font-sans">Play moves on the board to build this chapter.</span>
                ) : (
                  activeChapter.moves.map((m, idx) => {
                    const mPly = idx + 1;
                    const nag = activeChapter.nags[mPly] || '';
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setPly(mPly)}
                        className={`px-1.5 py-0.5 rounded ${
                          ply === mPly
                            ? 'bg-emerald-600 text-white font-semibold'
                            : 'hover:bg-stone-200 dark:hover:bg-zinc-800 text-stone-800 dark:text-zinc-200'
                        }`}
                      >
                        {idx % 2 === 0 ? `${Math.floor(idx / 2) + 1}.` : ''}
                        {m.san}
                        {nag}
                      </button>
                    );
                  })
                )}
              </div>

              {/* NAG Symbol Selector */}
              <div className="flex items-center justify-between pt-1">
                <span className="text-xs text-stone-500 dark:text-zinc-400">Move Symbol (Ply {ply})</span>
                <div className="flex gap-1">
                  {['!!', '!', '!?', '?!', '?', '??'].map((sym) => (
                    <button
                      key={sym}
                      type="button"
                      disabled={ply === 0}
                      onClick={() =>
                        updateActiveChapter((ch) => ({
                          ...ch,
                          nags: {
                            ...ch.nags,
                            [ply]: ch.nags[ply] === sym ? '' : sym,
                          },
                        }))
                      }
                      className={`px-2 py-0.5 rounded text-xs font-mono border disabled:opacity-40 ${
                        activeChapter.nags[ply] === sym
                          ? 'border-emerald-600 bg-emerald-600 text-white'
                          : 'border-stone-200 dark:border-zinc-700'
                      }`}
                    >
                      {sym}
                    </button>
                  ))}
                </div>
              </div>

              {/* Comment Box */}
              <div>
                <label className="block text-xs font-medium text-stone-600 dark:text-zinc-400 mb-1">
                  Comment at Ply {ply}
                </label>
                <textarea
                  rows={4}
                  value={activeChapter.comments[ply] || ''}
                  onChange={(e) =>
                    updateActiveChapter((ch) => ({
                      ...ch,
                      comments: { ...ch.comments, [ply]: e.target.value },
                    }))
                  }
                  placeholder="Write your strategic notes, variations, or tactical explanations..."
                  className="w-full p-2.5 rounded-lg border border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-950 text-xs"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================== CHESS INSIGHTS ANALYTICS ==================== */}
      {subTab === 'insights' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-4">
              <div className="text-xs text-stone-500 dark:text-zinc-400">Games Recorded</div>
              <div className="text-2xl font-mono font-bold text-stone-900 dark:text-zinc-100 mt-1">
                {insights.total}
              </div>
            </div>
            <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-4">
              <div className="text-xs text-stone-500 dark:text-zinc-400">Overall Win Rate</div>
              <div className="text-2xl font-mono font-bold text-emerald-600 dark:text-emerald-400 mt-1">
                {insights.winRate}%
              </div>
              <div className="text-xs text-stone-500 dark:text-zinc-400 mt-0.5 font-mono">
                {insights.wins}W · {insights.draws}D · {insights.losses}L
              </div>
            </div>
            <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-4">
              <div className="text-xs text-stone-500 dark:text-zinc-400">As White</div>
              <div className="text-2xl font-mono font-bold text-stone-900 dark:text-zinc-100 mt-1">
                {insights.whiteWinRate}%
              </div>
            </div>
            <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-4">
              <div className="text-xs text-stone-500 dark:text-zinc-400">As Black</div>
              <div className="text-2xl font-mono font-bold text-stone-900 dark:text-zinc-100 mt-1">
                {insights.blackWinRate}%
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Openings Repertoire Breakdown */}
            <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-5 space-y-3">
              <h3 className="text-base font-semibold text-stone-900 dark:text-zinc-100">
                Top Openings Played
              </h3>
              {insights.topOpenings.length === 0 ? (
                <p className="text-xs text-stone-500 dark:text-zinc-400 py-4">
                  Play or import games to populate your opening repertoire insights.
                </p>
              ) : (
                <div className="space-y-2.5">
                  {insights.topOpenings.map((op) => {
                    const wr = Math.round((op.wins / op.count) * 100);
                    return (
                      <div key={op.name} className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="font-medium text-stone-800 dark:text-zinc-200 truncate">
                            {op.name}
                          </span>
                          <span className="font-mono text-stone-500 dark:text-zinc-400">
                            {op.count} games · {wr}% win
                          </span>
                        </div>
                        <div className="h-2 bg-stone-100 dark:bg-zinc-800 rounded overflow-hidden">
                          <div className="h-full bg-emerald-600" style={{ width: `${wr}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Game Archive & Quick Analysis */}
            <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-5 space-y-3">
              <h3 className="text-base font-semibold text-stone-900 dark:text-zinc-100">
                Recent Game Archive
              </h3>
              <div className="space-y-2 max-h-64 overflow-y-auto thin-scroll">
                {games.length === 0 ? (
                  <p className="text-xs text-stone-500 dark:text-zinc-400 py-4">
                    No games recorded yet.
                  </p>
                ) : (
                  games.map((g) => (
                    <div
                      key={g.id}
                      className="p-2.5 rounded-lg border border-stone-200 dark:border-zinc-800 flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="font-semibold text-stone-900 dark:text-zinc-100 truncate">
                          {g.white} vs {g.black}
                        </div>
                        <div className="text-stone-500 dark:text-zinc-400 font-mono">
                          {g.result} · {g.variant} · {g.timeControl} · {g.date}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => onOpenGameInAnalysis(g)}
                        className="px-2.5 py-1 rounded bg-emerald-600 text-white font-medium flex items-center gap-1 shrink-0"
                      >
                        <Microscope className="w-3.5 h-3.5" />
                        Analyze
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
