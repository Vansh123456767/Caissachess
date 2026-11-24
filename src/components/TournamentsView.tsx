import React, { useEffect, useMemo, useState } from 'react';
import {
  AuthUser,
  BoardState,
  ChessVariant,
  Move,
  PieceColor,
  Tournament,
  TournamentPlayer,
  UserPreferences,
} from '../types/chess';
import {
  createInitialState,
  evaluateGameResult,
  makeMove,
  VARIANTS,
} from '../engine/chessEngine';
import { findBestMove } from '../engine/aiSearch';
import { ChessBoard } from './ChessBoard';
import { soundFX } from '../utils/sound';
import { Flame, LogIn, Plus, Swords, Trash2, Trophy, X, Zap } from 'lucide-react';

interface TournamentsViewProps {
  prefs: UserPreferences;
  authUser: AuthUser | null;
  authToken: string | null;
  onOpenAuth: (mode?: 'login' | 'register') => void;
}

const TIME_CONTROLS = ['1+0', '3+0', '3+2', '5+3', '10+0', '10+5', '15+10'];

function createSeedTournaments(username: string): Tournament[] {
  return [
    {
      id: 'arena-blitz',
      name: 'Hourly Blitz Arena',
      format: 'arena',
      variant: 'standard',
      timeControl: '3+0',
      durationMinutes: 45,
      currentRound: 1,
      status: 'active',
      joined: false,
      createdBy: 'Caissa Club',
      players: [
        { id: 'p1', name: 'GM_Aurelia', rating: 2480, score: 14, streak: 3, gamesPlayed: 5 },
        { id: 'p2', name: 'Marcus_960', rating: 1945, score: 10, streak: 2, gamesPlayed: 5 },
        { id: 'p3', name: 'Elena_Tactics', rating: 1780, score: 8, streak: 0, gamesPlayed: 4 },
        { id: 'p4', name: 'Viktor_Rapid', rating: 1620, score: 5, streak: 1, gamesPlayed: 4 },
        { id: 'p5', name: 'Aria_Club', rating: 1440, score: 3, streak: 0, gamesPlayed: 4 },
      ],
    },
    {
      id: 'arena-crazyhouse',
      name: 'Crazyhouse Variant Arena',
      format: 'arena',
      variant: 'crazyhouse',
      timeControl: '3+2',
      durationMinutes: 60,
      currentRound: 1,
      status: 'active',
      joined: false,
      createdBy: 'EightVariants',
      players: [
        { id: 'c1', name: 'DropMaster', rating: 2110, score: 12, streak: 2, gamesPlayed: 4 },
        { id: 'c2', name: 'EightVariants', rating: 1890, score: 9, streak: 1, gamesPlayed: 4 },
        { id: 'c3', name: 'PocketRook', rating: 1650, score: 4, streak: 0, gamesPlayed: 3 },
      ],
    },
    {
      id: 'swiss-open',
      name: 'Caissa Open Swiss Championship',
      format: 'swiss',
      variant: 'standard',
      timeControl: '5+3',
      totalRounds: 5,
      currentRound: 1,
      status: 'active',
      joined: true,
      createdBy: 'Caissa Club',
      players: [
        { id: 'user', name: username, rating: 1620, score: 0, streak: 0, gamesPlayed: 0, buchholz: 0, isUser: true },
        { id: 's1', name: 'IM_Soren', rating: 2350, score: 0, streak: 0, gamesPlayed: 0, buchholz: 0 },
        { id: 's2', name: 'Nadia_K', rating: 1740, score: 0, streak: 0, gamesPlayed: 0, buchholz: 0 },
        { id: 's3', name: 'Theo_Endgame', rating: 1860, score: 0, streak: 0, gamesPlayed: 0, buchholz: 0 },
        { id: 's4', name: 'ClaraV', rating: 1580, score: 0, streak: 0, gamesPlayed: 0, buchholz: 0 },
        { id: 's5', name: 'Henrik_FM', rating: 2190, score: 0, streak: 0, gamesPlayed: 0, buchholz: 0 },
      ],
    },
  ];
}

export const TournamentsView: React.FC<TournamentsViewProps> = ({
  prefs,
  authUser,
  authToken,
  onOpenAuth,
}) => {
  const [formatFilter, setFormatFilter] = useState<'arena' | 'swiss'>('arena');
  const [tournaments, setTournaments] = useState<Tournament[]>(() =>
    createSeedTournaments(prefs.username)
  );
  const [activeId, setActiveId] = useState<string>('arena-blitz');
  const [createOpen, setCreateOpen] = useState<boolean>(false);

  // Create Tournament form state
  const [newName, setNewName] = useState('');
  const [newFormat, setNewFormat] = useState<'arena' | 'swiss'>('arena');
  const [newVariant, setNewVariant] = useState<ChessVariant>('standard');
  const [newTimeControl, setNewTimeControl] = useState<string>('3+2');
  const [newDuration, setNewDuration] = useState<number>(30);
  const [newRounds, setNewRounds] = useState<number>(5);
  const [createBusy, setCreateBusy] = useState<boolean>(false);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  // Active Tournament Game
  const [playingMatch, setPlayingMatch] = useState<{
    tournamentId: string;
    opponent: TournamentPlayer;
    userColor: PieceColor;
    berserk: boolean;
    state: BoardState;
    clockSec: number;
    oppClockSec: number;
    resultText: string | null;
  } | null>(null);

  // Fetch tournaments from backend on mount / auth change
  useEffect(() => {
    let cancelled = false;
    const loadFromServer = async () => {
      try {
        const headers: Record<string, string> = {};
        if (authToken) headers.Authorization = `Bearer ${authToken}`;
        const resp = await fetch('/api/tournaments', { headers });
        if (!resp.ok) return;
        const data = await resp.json();
        if (!cancelled && Array.isArray(data?.tournaments) && data.tournaments.length > 0) {
          setTournaments(data.tournaments);
        }
      } catch {
        // Offline / fallback to local seed list
      }
    };
    loadFromServer();
    return () => {
      cancelled = true;
    };
  }, [authToken]);

  const visibleTournaments = tournaments.filter((t) => t.format === formatFilter);
  const activeTournament =
    tournaments.find((t) => t.id === activeId) || visibleTournaments[0] || tournaments[0];

  useEffect(() => {
    if (activeTournament && activeTournament.format !== formatFilter) {
      const firstMatch = tournaments.find((t) => t.format === formatFilter);
      if (firstMatch) setActiveId(firstMatch.id);
    }
  }, [formatFilter, activeTournament, tournaments]);

  const sortedStandings = useMemo(() => {
    if (!activeTournament) return [];
    return [...activeTournament.players].sort(
      (a, b) => b.score - a.score || (b.buchholz || 0) - (a.buchholz || 0) || b.rating - a.rating
    );
  }, [activeTournament]);

  const toggleJoin = async (t: Tournament) => {
    if (authToken) {
      try {
        const resp = await fetch(`/api/tournaments/${encodeURIComponent(t.id)}/join`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${authToken}` },
        });
        if (resp.ok) {
          const data = await resp.json();
          if (data?.tournament) {
            setTournaments((prev) =>
              prev.map((item) => (item.id === t.id ? data.tournament : item))
            );
            return;
          }
        }
      } catch {
        // Fallback to local state toggle
      }
    }

    setTournaments((prev) =>
      prev.map((item) => {
        if (item.id !== t.id) return item;
        if (item.joined) {
          return {
            ...item,
            joined: false,
            players: item.players.filter((p) => !p.isUser),
          };
        }
        return {
          ...item,
          joined: true,
          players: [
            ...item.players,
            {
              id: 'user',
              name: prefs.username,
              rating: authUser?.rating || 1620,
              score: 0,
              streak: 0,
              gamesPlayed: 0,
              buchholz: 0,
              isUser: true,
            },
          ],
        };
      })
    );
  };

  const handleCreateTournament = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusNotice(null);
    const variantLabel = VARIANTS.find((v) => v.id === newVariant)?.name || 'Open';
    const finalName =
      newName.trim() || `${variantLabel} ${newFormat === 'arena' ? 'Arena' : 'Swiss'}`;

    if (authToken) {
      setCreateBusy(true);
      try {
        const resp = await fetch('/api/tournaments', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({
            name: finalName,
            format: newFormat,
            variant: newVariant,
            timeControl: newTimeControl,
            durationMinutes: newFormat === 'arena' ? newDuration : undefined,
            totalRounds: newFormat === 'swiss' ? newRounds : undefined,
          }),
        });
        const data = await resp.json().catch(() => ({}));
        if (resp.ok && data?.tournament) {
          setTournaments((prev) => [data.tournament, ...prev]);
          setFormatFilter(data.tournament.format);
          setActiveId(data.tournament.id);
          setNewName('');
          setCreateOpen(false);
          setStatusNotice(`Created "${data.tournament.name}" and saved to your account.`);
          return;
        }
      } catch {
        // Fall back to local creation below
      } finally {
        setCreateBusy(false);
      }
    }

    // Local session fallback when not logged in
    const created: Tournament = {
      id: `tour-${Date.now()}`,
      name: finalName,
      format: newFormat,
      variant: newVariant,
      timeControl: newTimeControl,
      durationMinutes: newFormat === 'arena' ? newDuration : undefined,
      totalRounds: newFormat === 'swiss' ? newRounds : undefined,
      currentRound: 1,
      status: 'active',
      joined: true,
      createdBy: prefs.username,
      players: [
        {
          id: 'user',
          name: prefs.username,
          rating: 1620,
          score: 0,
          streak: 0,
          gamesPlayed: 0,
          buchholz: 0,
          isUser: true,
        },
        { id: `b1-${Date.now()}`, name: 'Elena_Tactics', rating: 1780, score: 0, streak: 0, gamesPlayed: 0, buchholz: 0 },
        { id: `b2-${Date.now()}`, name: 'Marcus_960', rating: 1945, score: 0, streak: 0, gamesPlayed: 0, buchholz: 0 },
        { id: `b3-${Date.now()}`, name: 'Aria_Club', rating: 1440, score: 0, streak: 0, gamesPlayed: 0, buchholz: 0 },
      ],
    };
    setTournaments((prev) => [created, ...prev]);
    setFormatFilter(created.format);
    setActiveId(created.id);
    setNewName('');
    setCreateOpen(false);
    setStatusNotice(`Created "${created.name}" for this session.`);
  };

  const handleDeleteTournament = async (t: Tournament) => {
    if (!authToken || t.ownerId !== authUser?.id) return;
    try {
      const resp = await fetch(`/api/tournaments/${encodeURIComponent(t.id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (resp.ok) {
        setTournaments((prev) => prev.filter((item) => item.id !== t.id));
        setStatusNotice(`Removed "${t.name}".`);
      }
    } catch {
      // ignore
    }
  };

  const launchPairing = (berserk = false) => {
    if (!activeTournament) return;
    if (!activeTournament.joined) void toggleJoin(activeTournament);
    const pool = activeTournament.players.filter((p) => !p.isUser);
    const opp = pool[Math.floor(Math.random() * pool.length)] || {
      id: 'opp',
      name: 'ClubChallenger',
      rating: 1600,
      score: 0,
      streak: 0,
      gamesPlayed: 0,
    };
    const [mins] = activeTournament.timeControl.split('+').map((n) => parseInt(n, 10) || 3);
    const baseSec = mins * 60;
    setPlayingMatch({
      tournamentId: activeTournament.id,
      opponent: opp,
      userColor: Math.random() < 0.5 ? 'w' : 'b',
      berserk,
      state: createInitialState(activeTournament.variant),
      clockSec: berserk ? Math.floor(baseSec / 2) : baseSec,
      oppClockSec: baseSec,
      resultText: null,
    });
  };

  const recordTournamentOutcome = async (outcome: 'win' | 'draw' | 'loss', reason: string) => {
    if (!playingMatch) return;
    const matchId = playingMatch.tournamentId;
    const wasBerserk = playingMatch.berserk;
    setPlayingMatch((pm) => (pm ? { ...pm, resultText: reason } : null));

    if (authToken) {
      try {
        const resp = await fetch(`/api/tournaments/${encodeURIComponent(matchId)}/result`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({ outcome, berserk: wasBerserk }),
        });
        if (resp.ok) {
          const data = await resp.json();
          if (data?.tournament) {
            setTournaments((prev) =>
              prev.map((t) => (t.id === matchId ? data.tournament : t))
            );
            return;
          }
        }
      } catch {
        // Fall back to local update
      }
    }

    setTournaments((prev) =>
      prev.map((t) => {
        if (t.id !== matchId) return t;
        const isSwiss = t.format === 'swiss';
        const nextRound = isSwiss ? Math.min(t.totalRounds || 5, t.currentRound + 1) : t.currentRound;
        const nextPlayers = t.players.map((p) => {
          if (p.isUser) {
            if (outcome === 'win') {
              const streakBonus = !isSwiss && p.streak >= 2 ? 2 : 0;
              const berserkBonus = !isSwiss && wasBerserk ? 1 : 0;
              const pts = isSwiss ? 1 : 2 + streakBonus + berserkBonus;
              return {
                ...p,
                score: p.score + pts,
                streak: p.streak + 1,
                gamesPlayed: p.gamesPlayed + 1,
                buchholz: (p.buchholz || 0) + 1.5,
              };
            }
            if (outcome === 'draw') {
              return {
                ...p,
                score: p.score + (isSwiss ? 0.5 : 1),
                streak: 0,
                gamesPlayed: p.gamesPlayed + 1,
                buchholz: (p.buchholz || 0) + 1,
              };
            }
            return { ...p, streak: 0, gamesPlayed: p.gamesPlayed + 1 };
          }
          const botGain = isSwiss
            ? [0, 0.5, 1][Math.floor(Math.random() * 3)]
            : [0, 1, 2][Math.floor(Math.random() * 3)];
          return {
            ...p,
            score: p.score + botGain,
            gamesPlayed: p.gamesPlayed + 1,
            buchholz: (p.buchholz || 0) + (botGain > 0 ? 1 : 0.5),
          };
        });
        return {
          ...t,
          currentRound: nextRound,
          status: isSwiss && t.currentRound >= (t.totalRounds || 5) ? 'finished' : t.status,
          players: nextPlayers,
        };
      })
    );
  };

  // AI response inside active tournament game
  useEffect(() => {
    if (!playingMatch || playingMatch.resultText) return;
    if (playingMatch.state.turn === playingMatch.userColor) return;

    const timer = window.setTimeout(() => {
      const skill = Math.max(1, Math.min(7, Math.round((playingMatch.opponent.rating - 800) / 220)));
      const { move } = findBestMove(playingMatch.state, skill);
      if (!move) return;
      const res = makeMove(playingMatch.state, move);
      const term = evaluateGameResult(res.next);
      soundFX.move();
      setPlayingMatch((pm) => (pm ? { ...pm, state: res.next } : null));

      if (term) {
        const outcome =
          term.winner === 'draw' ? 'draw' : term.winner === playingMatch.userColor ? 'win' : 'loss';
        void recordTournamentOutcome(outcome, term.reason);
      }
    }, 340);

    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playingMatch?.state, playingMatch?.resultText]);

  const handleTournamentMove = (mv: Move) => {
    if (!playingMatch || playingMatch.resultText) return;
    const res = makeMove(playingMatch.state, mv);
    const term = evaluateGameResult(res.next);
    soundFX.move();
    setPlayingMatch((pm) => (pm ? { ...pm, state: res.next } : null));
    if (term) {
      const outcome =
        term.winner === 'draw' ? 'draw' : term.winner === playingMatch.userColor ? 'win' : 'loss';
      void recordTournamentOutcome(outcome, term.reason);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-stone-200 dark:border-zinc-800 pb-3">
        <div className="flex items-center gap-1 p-1 bg-stone-100 dark:bg-zinc-900 rounded-lg">
          <button
            type="button"
            onClick={() => setFormatFilter('arena')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
              formatFilter === 'arena'
                ? 'bg-white dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 shadow-sm'
                : 'text-stone-600 dark:text-zinc-400'
            }`}
          >
            <Flame className="w-3.5 h-3.5 text-amber-500" />
            Arena Tournaments
          </button>
          <button
            type="button"
            onClick={() => setFormatFilter('swiss')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
              formatFilter === 'swiss'
                ? 'bg-white dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 shadow-sm'
                : 'text-stone-600 dark:text-zinc-400'
            }`}
          >
            <Trophy className="w-3.5 h-3.5 text-emerald-600" />
            Swiss Tournaments
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!authUser && (
            <button
              type="button"
              onClick={() => onOpenAuth('login')}
              className="px-3 py-1.5 rounded-lg border border-stone-200 dark:border-zinc-700 text-xs font-medium text-stone-700 dark:text-zinc-300 hover:bg-stone-100 dark:hover:bg-zinc-800 flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <LogIn className="w-3.5 h-3.5" />
              Sign In to Persist
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setNewFormat(formatFilter);
              setCreateOpen(true);
            }}
            className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            Make Tournament
          </button>
        </div>
      </div>

      {statusNotice && (
        <div className="px-3.5 py-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 text-xs text-emerald-800 dark:text-emerald-200 flex items-center justify-between gap-2">
          <span>{statusNotice}</span>
          <button
            type="button"
            onClick={() => setStatusNotice(null)}
            className="text-emerald-600 dark:text-emerald-400 hover:underline font-medium"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Tournament Directory */}
        <div className="lg:col-span-4 space-y-3">
          {visibleTournaments.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveId(t.id)}
              className={`w-full text-left p-4 rounded-xl border transition-colors space-y-1.5 ${
                activeTournament?.id === t.id
                  ? 'border-emerald-600 bg-emerald-50/70 dark:bg-emerald-950/30'
                  : 'border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-stone-50 dark:hover:bg-zinc-800/60'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-stone-900 dark:text-zinc-100 truncate">
                  {t.name}
                </span>
                <span className="font-mono text-xs text-emerald-600 dark:text-emerald-400 shrink-0">
                  {t.timeControl}
                </span>
              </div>
              <div className="text-xs text-stone-500 dark:text-zinc-400">
                {VARIANTS.find((v) => v.id === t.variant)?.name} · {t.players.length} players ·{' '}
                {t.format === 'arena'
                  ? `${t.durationMinutes}m Arena`
                  : `Round ${t.currentRound}/${t.totalRounds}`}
              </div>
              {t.createdBy && (
                <div className="text-[11px] font-mono text-stone-400 dark:text-zinc-500">
                  Host: {t.createdBy}
                </div>
              )}
            </button>
          ))}
        </div>

        {/* Active Tournament Lobby or Live Match */}
        <div className="lg:col-span-8 space-y-5">
          {playingMatch ? (
            <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-bold text-stone-900 dark:text-zinc-100">
                    Tournament Game vs {playingMatch.opponent.name} ({playingMatch.opponent.rating})
                  </div>
                  <div className="text-xs text-stone-500 dark:text-zinc-400">
                    {playingMatch.berserk ? 'Berserk Active (+1 Bonus Point on Win)' : 'Standard Tournament Clock'}
                  </div>
                </div>
                <div className="flex gap-2">
                  {!playingMatch.resultText ? (
                    <button
                      type="button"
                      onClick={() => void recordTournamentOutcome('loss', 'Resigned tournament game')}
                      className="px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-900 text-xs font-medium text-red-600 dark:text-red-400"
                    >
                      Resign
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setPlayingMatch(null)}
                      className="px-3.5 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold"
                    >
                      Return to Standings
                    </button>
                  )}
                </div>
              </div>

              {playingMatch.resultText && (
                <div className="p-3 rounded-lg bg-stone-100 dark:bg-zinc-800 text-xs font-semibold text-stone-900 dark:text-zinc-100">
                  Match Complete: {playingMatch.resultText} — Standings updated!
                </div>
              )}

              <div className="flex justify-center">
                <ChessBoard
                  state={playingMatch.state}
                  onMove={handleTournamentMove}
                  flipped={playingMatch.userColor === 'b'}
                  allowedColor={playingMatch.userColor}
                  interactive={!playingMatch.resultText}
                  boardTheme={prefs.boardTheme}
                  pieceSet={prefs.pieceSet}
                  showCoordinates={prefs.showCoordinates}
                  highlightLegal={prefs.highlightLegalMoves}
                  maxWidthClass="max-w-[460px]"
                />
              </div>
            </div>
          ) : (
            activeTournament && (
              <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-5 space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-bold text-stone-900 dark:text-zinc-100">
                        {activeTournament.name}
                      </h2>
                      {authUser && activeTournament.ownerId === authUser.id && (
                        <button
                          type="button"
                          onClick={() => void handleDeleteTournament(activeTournament)}
                          className="p-1.5 rounded-md text-stone-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                          title="Delete tournament"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-stone-500 dark:text-zinc-400 mt-0.5">
                      {activeTournament.format === 'arena'
                        ? `Time Control ${activeTournament.timeControl} · Win = 2 pts (4 pts on streak) · Draw = 1 pt · Berserk = +1 pt`
                        : `${activeTournament.totalRounds}-Round Swiss (${activeTournament.timeControl}) · Win = 1 pt · Draw = 0.5 pt · Round ${activeTournament.currentRound}/${activeTournament.totalRounds}`}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void toggleJoin(activeTournament)}
                      className={`px-3.5 py-2 rounded-lg border text-xs font-semibold whitespace-nowrap shrink-0 ${
                        activeTournament.joined
                          ? 'border-stone-300 dark:border-zinc-700 text-stone-700 dark:text-zinc-300'
                          : 'border-emerald-600 text-emerald-700 dark:text-emerald-400'
                      }`}
                    >
                      {activeTournament.joined ? 'Withdraw' : 'Join Tournament'}
                    </button>
                    <button
                      type="button"
                      onClick={() => launchPairing(false)}
                      className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0"
                    >
                      <Swords className="w-3.5 h-3.5" />
                      {activeTournament.format === 'arena' ? 'Play Next Pairing' : `Play Round ${activeTournament.currentRound}`}
                    </button>
                    {activeTournament.format === 'arena' && (
                      <button
                        type="button"
                        onClick={() => launchPairing(true)}
                        className="px-3 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold flex items-center gap-1 whitespace-nowrap shrink-0"
                        title="Halve clock for +1 point on win"
                      >
                        <Zap className="w-3.5 h-3.5" />
                        Berserk
                      </button>
                    )}
                  </div>
                </div>

                {/* Live Standings Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead>
                      <tr className="border-b border-stone-200 dark:border-zinc-800 text-stone-500 dark:text-zinc-400">
                        <th className="py-2 pr-3 font-medium">#</th>
                        <th className="py-2 pr-3 font-medium">Player</th>
                        <th className="py-2 pr-3 font-medium">Rating</th>
                        <th className="py-2 pr-3 font-medium">Games</th>
                        {activeTournament.format === 'swiss' && (
                          <th className="py-2 pr-3 font-medium">Buchholz</th>
                        )}
                        <th className="py-2 text-right font-medium">Score</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100 dark:divide-zinc-800/70">
                      {sortedStandings.map((pl, idx) => (
                        <tr
                          key={pl.id}
                          className={
                            pl.isUser ? 'bg-emerald-50/70 dark:bg-emerald-950/25 font-semibold' : ''
                          }
                        >
                          <td className="py-2.5 pr-3 font-mono text-stone-500 dark:text-zinc-400">
                            {idx + 1}
                          </td>
                          <td className="py-2.5 pr-3 text-stone-900 dark:text-zinc-100">
                            {pl.name}
                            {pl.streak >= 2 && activeTournament.format === 'arena' && (
                              <span className="ml-2 text-amber-500 font-mono">({pl.streak} streak)</span>
                            )}
                          </td>
                          <td className="py-2.5 pr-3 font-mono text-stone-600 dark:text-zinc-400">
                            {pl.rating}
                          </td>
                          <td className="py-2.5 pr-3 font-mono text-stone-600 dark:text-zinc-400">
                            {pl.gamesPlayed}
                          </td>
                          {activeTournament.format === 'swiss' && (
                            <td className="py-2.5 pr-3 font-mono text-stone-600 dark:text-zinc-400">
                              {(pl.buchholz || 0).toFixed(1)}
                            </td>
                          )}
                          <td className="py-2.5 text-right font-mono font-bold text-stone-900 dark:text-zinc-100">
                            {pl.score}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          )}
        </div>
      </div>

      {/* Make Tournament Modal */}
      {createOpen && (
        <div className="fixed inset-0 z-50 bg-zinc-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-stone-200 dark:border-zinc-800 pb-3">
              <div>
                <h2 className="text-base font-bold text-stone-900 dark:text-zinc-100">
                  Create New Tournament
                </h2>
                <p className="text-xs text-stone-500 dark:text-zinc-400">
                  {authUser
                    ? `Publishing as ${authUser.username} (saved to server).`
                    : 'Configure Arena or Swiss rules. Sign in to save tournaments across sessions.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="p-1.5 rounded-lg hover:bg-stone-100 dark:hover:bg-zinc-800 text-stone-500"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateTournament} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-stone-700 dark:text-zinc-300 mb-1">
                  Tournament Name
                </label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  maxLength={80}
                  placeholder="e.g. Friday Night Blitz Grand Prix"
                  className="w-full px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-950 text-sm text-stone-900 dark:text-zinc-100"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-stone-700 dark:text-zinc-300 mb-1">
                    Format
                  </label>
                  <div className="grid grid-cols-2 gap-1 p-1 bg-stone-100 dark:bg-zinc-950 rounded-lg">
                    <button
                      type="button"
                      onClick={() => setNewFormat('arena')}
                      className={`py-1.5 rounded-md text-xs font-semibold ${
                        newFormat === 'arena'
                          ? 'bg-white dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 shadow-xs'
                          : 'text-stone-500'
                      }`}
                    >
                      Arena
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewFormat('swiss')}
                      className={`py-1.5 rounded-md text-xs font-semibold ${
                        newFormat === 'swiss'
                          ? 'bg-white dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 shadow-xs'
                          : 'text-stone-500'
                      }`}
                    >
                      Swiss
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-stone-700 dark:text-zinc-300 mb-1">
                    Time Control
                  </label>
                  <select
                    value={newTimeControl}
                    onChange={(e) => setNewTimeControl(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-950 text-xs font-mono text-stone-900 dark:text-zinc-100"
                  >
                    {TIME_CONTROLS.map((tc) => (
                      <option key={tc} value={tc}>
                        {tc}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-stone-700 dark:text-zinc-300 mb-1">
                    Chess Variant
                  </label>
                  <select
                    value={newVariant}
                    onChange={(e) => setNewVariant(e.target.value as ChessVariant)}
                    className="w-full px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-950 text-xs text-stone-900 dark:text-zinc-100"
                  >
                    {VARIANTS.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </div>

                {newFormat === 'arena' ? (
                  <div>
                    <label className="block text-xs font-semibold text-stone-700 dark:text-zinc-300 mb-1">
                      Duration (Minutes)
                    </label>
                    <select
                      value={newDuration}
                      onChange={(e) => setNewDuration(Number(e.target.value))}
                      className="w-full px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-950 text-xs font-mono text-stone-900 dark:text-zinc-100"
                    >
                      {[15, 30, 45, 60, 90].map((m) => (
                        <option key={m} value={m}>
                          {m} minutes
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs font-semibold text-stone-700 dark:text-zinc-300 mb-1">
                      Swiss Rounds
                    </label>
                    <select
                      value={newRounds}
                      onChange={(e) => setNewRounds(Number(e.target.value))}
                      className="w-full px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-950 text-xs font-mono text-stone-900 dark:text-zinc-100"
                    >
                      {[3, 5, 7, 9].map((r) => (
                        <option key={r} value={r}>
                          {r} rounds
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-stone-100 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="px-3.5 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 text-xs font-medium text-stone-700 dark:text-zinc-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createBusy}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {createBusy ? 'Creating...' : 'Create Tournament'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
