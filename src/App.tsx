import React, { useEffect, useState } from 'react';
import {
  AuthUser,
  ChessVariant,
  GameRecord,
  Move,
  Puzzle,
  UserPreferences,
} from './types/chess';
import { parsePgn } from './engine/chessEngine';
import { detectOpeningFromMoves } from './data/openings';
import { LANGUAGES, translate } from './data/i18n';
import { PlayView } from './components/PlayView';
import { AnalysisView } from './components/AnalysisView';
import { StudiesView } from './components/StudiesView';
import { PuzzlesView } from './components/PuzzlesView';
import { TournamentsView } from './components/TournamentsView';
import { CommunityView } from './components/CommunityView';
import { PreferencesModal } from './components/PreferencesModal';
import { AuthModal } from './components/AuthModal';
import { soundFX } from './utils/sound';
import { SlidersHorizontal, User } from 'lucide-react';

type MainTab = 'play' | 'analysis' | 'puzzles' | 'tournaments' | 'community';

const DEFAULT_PREFS: UserPreferences = {
  theme: 'light',
  boardTheme: 'wood',
  pieceSet: 'classic',
  bgTheme: 'clean',
  language: 'en',
  soundEnabled: true,
  showCoordinates: true,
  highlightLegalMoves: true,
  username: 'CaissaPlayer',
};

function buildInitialGames(): GameRecord[] {
  const sample1 = `[Event "Rapid Club Match"]\n[White "CaissaPlayer"]\n[Black "Elena_Tactics"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 Na5 10. Bc2 c5 11. d4 Qc7 1-0`;
  const sample2 = `[Event "Blitz Training"]\n[White "Marcus_960"]\n[Black "CaissaPlayer"]\n[Result "0-1"]\n\n1. d4 Nf6 2. c4 g6 3. Nc3 Bg7 4. e4 d6 5. Nf3 O-O 6. Be2 e5 7. O-O Nc6 8. d5 Ne7 0-1`;

  const p1 = parsePgn(sample1);
  const p2 = parsePgn(sample2);
  const op1 = detectOpeningFromMoves(p1.moves.map((m) => m.san || ''));
  const op2 = detectOpeningFromMoves(p2.moves.map((m) => m.san || ''));

  return [
    {
      id: 'seed-1',
      white: 'CaissaPlayer',
      black: 'Elena_Tactics',
      whiteElo: 1620,
      blackElo: 1780,
      variant: 'standard',
      timeControl: '10+0',
      result: '1-0',
      reason: 'Checkmate',
      date: '2026-11-20',
      moves: p1.moves,
      fens: p1.fens,
      pgn: sample1,
      openingEco: op1.eco,
      openingName: op1.name,
      userColor: 'w',
    },
    {
      id: 'seed-2',
      white: 'Marcus_960',
      black: 'CaissaPlayer',
      whiteElo: 1945,
      blackElo: 1620,
      variant: 'standard',
      timeControl: '3+2',
      result: '0-1',
      reason: 'Resignation',
      date: '2026-11-22',
      moves: p2.moves,
      fens: p2.fens,
      pgn: sample2,
      openingEco: op2.eco,
      openingName: op2.name,
      userColor: 'b',
    },
  ];
}

export default function App() {
  const [prefs, setPrefs] = useState<UserPreferences>(() => {
    try {
      const raw = localStorage.getItem('caissa_prefs_v1');
      if (raw) return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
    } catch {
      // ignore
    }
    return DEFAULT_PREFS;
  });

  const [activeTab, setActiveTab] = useState<MainTab>('play');
  const [analysisSection, setAnalysisSection] = useState<'tools' | 'studies'>('tools');
  const [prefsOpen, setPrefsOpen] = useState(false);

  // Server-verified session held strictly in React state (never localStorage)
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<'login' | 'register'>('login');

  const openAuthModal = (mode: 'login' | 'register' = 'login') => {
    setAuthModalMode(mode);
    setAuthModalOpen(true);
  };

  const handleAuthSuccess = (token: string, user: AuthUser) => {
    setAuthToken(token);
    setAuthUser(user);
    setPrefs((prev) => ({ ...prev, username: user.username }));
  };

  const handleLogout = async () => {
    const token = authToken;
    setAuthToken(null);
    setAuthUser(null);
    setPrefs((prev) => ({ ...prev, username: DEFAULT_PREFS.username }));
    if (token) {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        // Ignore network errors on logout
      }
    }
  };

  const [games, setGames] = useState<GameRecord[]>(() => {
    try {
      const raw = localStorage.getItem('caissa_games_v1');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // ignore
    }
    return buildInitialGames();
  });

  const [userGamePuzzles, setUserGamePuzzles] = useState<Puzzle[]>(() => {
    try {
      const raw = localStorage.getItem('caissa_user_puzzles_v1');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  // Cross-tab payloads
  const [playPayload, setPlayPayload] = useState<{
    variant: ChessVariant;
    fen?: string | null;
    key: number;
  }>({ variant: 'standard', fen: null, key: 0 });

  const [analysisPayload, setAnalysisPayload] = useState<{
    fen?: string;
    moves?: Move[];
    fens?: string[];
    variant: ChessVariant;
  } | null>(null);

  // Sync dark mode class on <html> and save preferences
  useEffect(() => {
    const root = document.documentElement;
    if (prefs.theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    const langObj = LANGUAGES.find((l) => l.code === prefs.language);
    root.dir = langObj?.dir || 'ltr';
    soundFX.enabled = prefs.soundEnabled;

    try {
      localStorage.setItem('caissa_prefs_v1', JSON.stringify(prefs));
    } catch {
      // ignore
    }
  }, [prefs]);

  useEffect(() => {
    try {
      localStorage.setItem('caissa_games_v1', JSON.stringify(games));
    } catch {
      // ignore
    }
  }, [games]);

  useEffect(() => {
    try {
      localStorage.setItem('caissa_user_puzzles_v1', JSON.stringify(userGamePuzzles));
    } catch {
      // ignore
    }
  }, [userGamePuzzles]);

  const t = (key: string) => translate(prefs.language, key);

  const bgClasses: Record<UserPreferences['bgTheme'], string> = {
    clean: 'bg-stone-50 dark:bg-zinc-950',
    'warm-linen': 'bg-[#f6f2ea] dark:bg-[#141210]',
    'obsidian-grid':
      'bg-stone-100 dark:bg-zinc-950 bg-[radial-gradient(#d6d3d1_1px,transparent_1px)] dark:bg-[radial-gradient(#27272a_1px,transparent_1px)] [background-size:20px_20px]',
    'forest-slate': 'bg-[#eef2ef] dark:bg-[#0e1512]',
  };

  const handleOpenAnalysis = (payload: {
    fen?: string;
    moves?: Move[];
    fens?: string[];
    variant: ChessVariant;
  }) => {
    setAnalysisPayload(payload);
    setAnalysisSection('tools');
    setActiveTab('analysis');
  };

  const handlePlayFromPosition = (fen: string, variant: ChessVariant) => {
    setPlayPayload({ variant, fen, key: Date.now() });
    setActiveTab('play');
  };

  const handleChallengeVariant = (variant: ChessVariant) => {
    setPlayPayload({ variant, fen: null, key: Date.now() });
    setActiveTab('play');
  };

  return (
    <div className={`min-h-screen flex flex-col transition-colors ${bgClasses[prefs.bgTheme]}`}>
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-40 border-b border-stone-200 dark:border-zinc-800 bg-white/95 dark:bg-zinc-950/95 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-8">
          {/* Zone 1: Single wordmark */}
          <button
            type="button"
            onClick={() => setActiveTab('play')}
            className="font-display text-xl font-bold tracking-tight text-stone-900 dark:text-zinc-100 whitespace-nowrap shrink-0 cursor-pointer"
          >
            Caissa
          </button>

          {/* Zone 2: 5 concise single-line nav links */}
          <nav className="flex items-center gap-5 sm:gap-7 overflow-x-auto thin-scroll">
            {([
              ['play', t('navPlay')],
              ['analysis', t('navAnalysis')],
              ['puzzles', t('navPuzzles')],
              ['tournaments', t('navTournaments')],
              ['community', t('navCommunity')],
            ] as [MainTab, string][]).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={`py-4 text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeTab === id
                    ? 'border-emerald-600 text-stone-900 dark:text-zinc-100'
                    : 'border-transparent text-stone-600 dark:text-zinc-400 hover:text-stone-900 dark:hover:text-zinc-100'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>

          {/* Zone 3: Account + Preferences */}
          <div className="shrink-0 flex items-center gap-2">
            {authUser ? (
              <button
                type="button"
                onClick={() => openAuthModal('login')}
                className="px-3 py-1.5 rounded-lg border border-emerald-600/40 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer"
              >
                <User className="w-3.5 h-3.5" />
                <span>{authUser.username}</span>
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => openAuthModal('login')}
                  className="px-3 py-1.5 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-stone-700 dark:text-zinc-200 hover:bg-stone-100 dark:hover:bg-zinc-800 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Log In
                </button>
                <button
                  type="button"
                  onClick={() => openAuthModal('register')}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Sign Up
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => setPrefsOpen(true)}
              className="px-3 py-1.5 rounded-lg bg-stone-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-stone-800 dark:hover:bg-zinc-200 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer"
              title={t('preferences')}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span className="hidden md:inline">{t('preferences')}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Workspace */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6">
        {activeTab === 'play' && (
          <PlayView
            key={playPayload.key}
            prefs={prefs}
            initialVariant={playPayload.variant}
            initialFen={playPayload.fen}
            onGameCompleted={(rec) => setGames((prev) => [rec, ...prev])}
            onSendToAnalysis={handleOpenAnalysis}
          />
        )}

        {activeTab === 'analysis' && (
          <div className="space-y-4">
            {/* Switch cleanly between Analysis Tools & Studies/Insights */}
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setAnalysisSection('tools')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                    analysisSection === 'tools'
                      ? 'border-emerald-600 bg-emerald-600 text-white'
                      : 'border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-stone-700 dark:text-zinc-300'
                  }`}
                >
                  {t('analysisBoard')} · Editor · Explorer · Tablebase
                </button>
                <button
                  type="button"
                  onClick={() => setAnalysisSection('studies')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                    analysisSection === 'studies'
                      ? 'border-emerald-600 bg-emerald-600 text-white'
                      : 'border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-stone-700 dark:text-zinc-300'
                  }`}
                >
                  {t('studies')} & {t('insights')}
                </button>
              </div>
            </div>

            {analysisSection === 'tools' ? (
              <AnalysisView
                prefs={prefs}
                games={games}
                incomingPayload={analysisPayload}
                onSaveExtractedPuzzles={(extracted) =>
                  setUserGamePuzzles((prev) => [...extracted, ...prev].slice(0, 50))
                }
                onPlayFromPosition={handlePlayFromPosition}
                onImportGameRecord={(rec) => setGames((prev) => [rec, ...prev])}
              />
            ) : (
              <StudiesView
                prefs={prefs}
                games={games}
                onOpenGameInAnalysis={(g) =>
                  handleOpenAnalysis({ moves: g.moves, fens: g.fens, variant: g.variant })
                }
              />
            )}
          </div>
        )}

        {activeTab === 'puzzles' && (
          <PuzzlesView prefs={prefs} userGamePuzzles={userGamePuzzles} />
        )}

        {activeTab === 'tournaments' && (
          <TournamentsView
            prefs={prefs}
            authUser={authUser}
            authToken={authToken}
            onOpenAuth={openAuthModal}
          />
        )}

        {activeTab === 'community' && (
          <CommunityView
            prefs={prefs}
            onChallengeStart={handleChallengeVariant}
            onSendToAnalysis={(payload) => handleOpenAnalysis(payload)}
          />
        )}
      </main>

      {/* Quiet, Honest Footer */}
      <footer className="border-t border-stone-200 dark:border-zinc-800 py-4 px-4 sm:px-6 text-xs text-stone-500 dark:text-zinc-400">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <span>
            Caissa Chess · {t('zeroAds')} · Standard & 8 Variants · Local-first PGN & Studies
          </span>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() =>
                setPrefs((p) => ({ ...p, theme: p.theme === 'light' ? 'dark' : 'light' }))
              }
              className="hover:text-stone-900 dark:hover:text-zinc-200 underline-offset-2 hover:underline"
            >
              Theme: {prefs.theme === 'light' ? 'Light' : 'Dark'}
            </button>
            <button
              type="button"
              onClick={() => setPrefsOpen(true)}
              className="hover:text-stone-900 dark:hover:text-zinc-200 underline-offset-2 hover:underline"
            >
              Language: {LANGUAGES.find((l) => l.code === prefs.language)?.nativeName || 'English'}
            </button>
          </div>
        </div>
      </footer>

      <PreferencesModal
        open={prefsOpen}
        onClose={() => setPrefsOpen(false)}
        prefs={prefs}
        onChange={setPrefs}
      />

      <AuthModal
        open={authModalOpen}
        initialMode={authModalMode}
        onClose={() => setAuthModalOpen(false)}
        authUser={authUser}
        authToken={authToken}
        onAuthSuccess={handleAuthSuccess}
        onLogout={handleLogout}
      />
    </div>
  );
}
