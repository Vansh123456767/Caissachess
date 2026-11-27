import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AuthUser,
  BoardState,
  ChessVariant,
  HallOfFameEntry,
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
import { isBotAccount } from '../utils/botFilter';
import {
  Award,
  ChevronDown,
  ChevronUp,
  Clock,
  Flame,
  Globe,
  LogIn,
  Medal,
  MessageSquare,
  Pause,
  Play,
  Plus,
  Send,
  Share2,
  Shield,
  Swords,
  Table,
  Trash2,
  Trophy,
  User,
  X,
  Zap,
} from 'lucide-react';

interface TournamentsViewProps {
  prefs: UserPreferences;
  authUser: AuthUser | null;
  authToken: string | null;
  onOpenAuth: (mode?: 'login' | 'register') => void;
}

const TIME_CONTROLS = ['1+0', '3+0', '3+2', '5+3', '10+0', '10+5', '15+10'];

const TEAM_BATTLE_CLUBS = [
  'Caissa Vanguard',
  'Tactical Union',
  'Endgame Guild',
  'Chess960 Pioneers',
];

function createSeedTournaments(username: string, isUserBot = false): Tournament[] {
  const swissUser = !isUserBot
    ? [
        {
          id: 'user',
          name: username,
          rating: 1620,
          score: 0,
          streak: 0,
          gamesPlayed: 0,
          buchholz: 0,
          isUser: true,
        },
      ]
    : [];

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
      players: [],
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
      createdBy: 'Caissa Club',
      players: [],
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
      joined: !isUserBot,
      createdBy: 'Caissa Club',
      players: swissUser,
    },
    {
      id: 'battle-world-teams',
      name: 'Caissa World Team Battle',
      format: 'arena',
      isTeamBattle: true,
      variant: 'standard',
      timeControl: '3+2',
      durationMinutes: 60,
      currentRound: 1,
      status: 'active',
      joined: false,
      createdBy: 'Team League',
      players: [],
    },
    {
      id: 'battle-variants-clash',
      name: 'Variants Guild Team Clash',
      format: 'arena',
      isTeamBattle: true,
      variant: 'chess960',
      timeControl: '5+0',
      durationMinutes: 45,
      currentRound: 1,
      status: 'active',
      joined: false,
      createdBy: 'Chess960 Pioneers',
      players: [],
    },
  ];
}

interface LobbyChatMsg {
  id: string;
  author: string;
  text: string;
  time: string;
}

interface GlobalTournamentChatMsg {
  id: string;
  author: string;
  isGuest: boolean;
  tournamentTag?: string;
  text: string;
  createdAt: string;
}

interface KnockoutMatchNode {
  id: string;
  round: 1 | 2 | 3; // 1: QF, 2: SF, 3: Final
  p1: { name: string; rating: number; isUser?: boolean } | null;
  p2: { name: string; rating: number; isUser?: boolean } | null;
  winner: { name: string; rating: number; isUser?: boolean } | null;
}

function createInitialKnockoutBracket(username: string, rating: number): KnockoutMatchNode[] {
  const seeds = [
    { name: username, rating, isUser: true },
    { name: 'Elena_Tactics', rating: 1740 },
    { name: 'Marcus_960', rating: 1680 },
    { name: 'Sora_Endgame', rating: 1810 },
    { name: 'Nadia_Knight', rating: 1640 },
    { name: 'Liam_Gambit', rating: 1715 },
    { name: 'Aria_Check', rating: 1790 },
    { name: 'Kenji_Fork', rating: 1625 },
  ];
  return [
    { id: 'qf-1', round: 1, p1: seeds[0], p2: seeds[7], winner: null },
    { id: 'qf-2', round: 1, p1: seeds[3], p2: seeds[4], winner: null },
    { id: 'qf-3', round: 1, p1: seeds[1], p2: seeds[6], winner: null },
    { id: 'qf-4', round: 1, p1: seeds[2], p2: seeds[5], winner: null },
    { id: 'sf-1', round: 2, p1: null, p2: null, winner: null },
    { id: 'sf-2', round: 2, p1: null, p2: null, winner: null },
    { id: 'fin-1', round: 3, p1: null, p2: null, winner: null },
  ];
}

export const TournamentsView: React.FC<TournamentsViewProps> = ({
  prefs,
  authUser,
  authToken,
  onOpenAuth,
}) => {
  const [formatFilter, setFormatFilter] = useState<'arena' | 'swiss' | 'team_battle' | 'knockout'>('arena');
  const [lobbyTab, setLobbyTab] = useState<'standings' | 'pairings' | 'crosstable' | 'chat'>('standings');
  const [selectedTeam, setSelectedTeam] = useState<string>(TEAM_BATTLE_CLUBS[0]);
  const [pausedMap, setPausedMap] = useState<Record<string, boolean>>({});
  const [chatByTournament, setChatByTournament] = useState<Record<string, LobbyChatMsg[]>>({});
  const [chatInput, setChatInput] = useState('');
  const [globalChatMessages, setGlobalChatMessages] = useState<GlobalTournamentChatMsg[]>([]);
  const [globalChatInput, setGlobalChatInput] = useState('');
  const [globalChatOpen, setGlobalChatOpen] = useState<boolean>(true);
  const [tagCurrentTournament, setTagCurrentTournament] = useState<boolean>(true);
  const [globalChatError, setGlobalChatError] = useState<string | null>(null);
  const globalChatWsRef = useRef<WebSocket | null>(null);
  const globalChatScrollRef = useRef<HTMLDivElement | null>(null);
  const [roundResults, setRoundResults] = useState<Record<string, Record<string, (string | null)[]>>>({});
  const effectiveUsername = authUser ? authUser.username : 'Anonymous';
  const isUserBot = isBotAccount({
    name: authUser ? authUser.username : '',
    isBot: Boolean(prefs.isBot || authUser?.isBot),
  });

  const [tournaments, setTournaments] = useState<Tournament[]>(() =>
    createSeedTournaments(effectiveUsername, isUserBot)
  );
  const [activeId, setActiveId] = useState<string>('arena-blitz');
  const [createOpen, setCreateOpen] = useState<boolean>(false);

  // Hourly Arena Countdown & Hall of Fame
  const [hourlyCountdownSec, setHourlyCountdownSec] = useState<number>(() => {
    const now = new Date();
    return 3600 - (now.getMinutes() * 60 + now.getSeconds());
  });
  const [hallOfFame, setHallOfFame] = useState<HallOfFameEntry[]>([]);
  const [knockoutCupTitle, setKnockoutCupTitle] = useState('Caissa 8-Player Knockout Cup');
  const [knockoutNodes, setKnockoutNodes] = useState<KnockoutMatchNode[]>(() =>
    createInitialKnockoutBracket(effectiveUsername, authUser?.rating || 1620)
  );
  const [activeKnockoutMatchId, setActiveKnockoutMatchId] = useState<string | null>(null);

  // Create Tournament form state
  const [newName, setNewName] = useState('');
  const [newFormat, setNewFormat] = useState<'arena' | 'swiss' | 'team_battle'>('arena');
  const [newVariant, setNewVariant] = useState<ChessVariant>('standard');
  const [newTimeControl, setNewTimeControl] = useState<string>('3+2');
  const [newDuration, setNewDuration] = useState<number>(30);
  const [newRounds, setNewRounds] = useState<number>(5);
  const [createBusy, setCreateBusy] = useState<boolean>(false);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  // Active Tournament Game
  const [playingMatch, setPlayingMatch] = useState<{
    tournamentId: string;
    knockoutNodeId?: string;
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
          const seedBattles = createSeedTournaments(effectiveUsername, isUserBot).filter(
            (t) => t.isTeamBattle
          );
          const serverList: Tournament[] = data.tournaments;
          const hasBattles = serverList.some((t) => t.isTeamBattle);
          setTournaments(hasBattles ? serverList : [...serverList, ...seedBattles]);
        }
      } catch {
        // Offline / fallback to local seed list
      }
    };
    loadFromServer();
    return () => {
      cancelled = true;
    };
  }, [authToken, prefs.username, isUserBot]);

  // Hourly arena countdown + Hall of Fame load
  useEffect(() => {
    const id = window.setInterval(() => {
      const now = new Date();
      setHourlyCountdownSec(3600 - (now.getMinutes() * 60 + now.getSeconds()));
    }, 1000);
    fetch('/api/tournaments/hall-of-fame')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (Array.isArray(data?.entries)) {
          setHallOfFame(data.entries);
        }
      })
      .catch(() => {});
    return () => window.clearInterval(id);
  }, []);

  const archiveToHallOfFame = async (
    tournamentId: string,
    tournamentName: string,
    format: 'arena' | 'swiss' | 'knockout',
    podium: { name: string; isGuest?: boolean; score: number }[]
  ) => {
    if (podium.length === 0) return;
    try {
      const resp = await fetch('/api/tournaments/hall-of-fame', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tournamentId,
          tournamentName,
          format,
          podium: podium.slice(0, 3),
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data?.entry) {
        setHallOfFame((prev) =>
          prev.some((e) => e.tournamentId === data.entry.tournamentId)
            ? prev
            : [data.entry as HallOfFameEntry, ...prev]
        );
      }
    } catch {
      // ignore offline
    }
  };

  // Persistent Global Tournament Chat (WebSocket + HTTP sync + auto-reconnect)
  useEffect(() => {
    let disposed = false;
    let reconnectTimer: number | null = null;
    let backoffMs = 1000;

    const mergeChatMessages = (incoming: GlobalTournamentChatMsg[]) => {
      setGlobalChatMessages((prev) => {
        const seen = new Set<string>();
        const merged: GlobalTournamentChatMsg[] = [];
        for (const msg of [...prev, ...incoming]) {
          if (!msg || typeof msg.id !== 'string' || seen.has(msg.id)) continue;
          seen.add(msg.id);
          merged.push(msg);
        }
        return merged.slice(-250);
      });
    };

    const hydrateFromRest = async () => {
      try {
        const resp = await fetch('/api/tournaments/chat');
        if (!resp.ok) return;
        const data = await resp.json();
        if (!disposed && Array.isArray(data?.messages)) {
          mergeChatMessages(data.messages as GlobalTournamentChatMsg[]);
        }
      } catch {
        // Ignore offline/static errors
      }
    };

    const connectWs = () => {
      if (disposed || typeof WebSocket === 'undefined') return;
      try {
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(`${proto}//${window.location.host}/ws/tournaments-chat`);
        globalChatWsRef.current = ws;

        ws.onopen = () => {
          backoffMs = 1000;
        };

        ws.onmessage = (event) => {
          try {
            const payload = JSON.parse(String(event.data)) as {
              type?: string;
              messages?: GlobalTournamentChatMsg[];
              message?: GlobalTournamentChatMsg;
              error?: string;
            };
            if (payload.type === 'chat:init' && Array.isArray(payload.messages)) {
              mergeChatMessages(payload.messages);
            } else if (payload.type === 'chat:message' && payload.message) {
              mergeChatMessages([payload.message]);
            } else if (payload.type === 'chat:error' && payload.error) {
              setGlobalChatError(payload.error);
            }
          } catch {
            // Ignore malformed socket payloads
          }
        };

        ws.onclose = () => {
          if (globalChatWsRef.current === ws) {
            globalChatWsRef.current = null;
          }
          if (!disposed) {
            reconnectTimer = window.setTimeout(() => {
              backoffMs = Math.min(8000, backoffMs * 2);
              connectWs();
            }, backoffMs);
          }
        };

        ws.onerror = () => {
          ws.close();
        };
      } catch {
        // Fallback already handled via REST
      }
    };

    void hydrateFromRest();
    connectWs();

    return () => {
      disposed = true;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      if (globalChatWsRef.current) {
        globalChatWsRef.current.close();
        globalChatWsRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const el = globalChatScrollRef.current;
    if (el && globalChatOpen) {
      el.scrollTop = el.scrollHeight;
    }
  }, [globalChatMessages, globalChatOpen]);

  const visibleTournaments = tournaments.filter((t) =>
    formatFilter === 'team_battle'
      ? Boolean(t.isTeamBattle)
      : formatFilter === 'knockout'
      ? false
      : t.format === formatFilter && !t.isTeamBattle
  );
  const activeTournament =
    tournaments.find((t) => t.id === activeId) || visibleTournaments[0] || tournaments[0];

  useEffect(() => {
    if (formatFilter === 'knockout') return;
    const matchesCurrentFilter =
      activeTournament &&
      (formatFilter === 'team_battle'
        ? Boolean(activeTournament.isTeamBattle)
        : activeTournament.format === formatFilter && !activeTournament.isTeamBattle);
    if (!matchesCurrentFilter) {
      const firstMatch = tournaments.find((t) =>
        formatFilter === 'team_battle'
          ? Boolean(t.isTeamBattle)
          : t.format === formatFilter && !t.isTeamBattle
      );
      if (firstMatch) setActiveId(firstMatch.id);
    }
  }, [formatFilter, activeTournament, tournaments]);

  const sortedStandings = useMemo(() => {
    if (!activeTournament) return [];
    return activeTournament.players
      .filter((p) => !isBotAccount(p) && !(p.isUser && isUserBot))
      .sort(
        (a, b) => b.score - a.score || (b.buchholz || 0) - (a.buchholz || 0) || b.rating - a.rating
      );
  }, [activeTournament, isUserBot]);

  const roundPairings = useMemo(() => {
    const pairs: { board: number; white: TournamentPlayer; black: TournamentPlayer | null }[] = [];
    for (let i = 0; i < sortedStandings.length; i += 2) {
      const a = sortedStandings[i];
      const b = sortedStandings[i + 1] || null;
      const swap = ((activeTournament?.currentRound || 1) + i) % 2 === 1 && b !== null;
      pairs.push({
        board: Math.floor(i / 2) + 1,
        white: swap && b ? b : a,
        black: swap && b ? a : b,
      });
    }
    return pairs;
  }, [sortedStandings, activeTournament?.currentRound]);

  const teamStandings = useMemo(() => {
    if (!activeTournament?.isTeamBattle) return [];
    const grouped = new Map<string, TournamentPlayer[]>();
    for (const p of activeTournament.players) {
      if (isBotAccount(p) || (p.isUser && isUserBot)) continue;
      const teamName = p.team || 'Independent';
      const list = grouped.get(teamName) || [];
      list.push(p);
      grouped.set(teamName, list);
    }
    return Array.from(grouped.entries())
      .map(([teamName, members]) => {
        const sortedMembers = [...members].sort((a, b) => b.score - a.score || b.rating - a.rating);
        const top3 = sortedMembers.slice(0, 3);
        const totalScore = top3.reduce((acc, m) => acc + m.score, 0);
        return {
          teamName,
          memberCount: members.length,
          topContributors: top3,
          totalScore,
        };
      })
      .sort((a, b) => b.totalScore - a.totalScore || b.memberCount - a.memberCount);
  }, [activeTournament, isUserBot]);

  const toggleJoin = async (t: Tournament) => {
    if (!t.joined && isUserBot) {
      setStatusNotice('Bots are not allowed in tournament leaderboards.');
      return;
    }
    if (authToken && !t.isTeamBattle) {
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
          setPausedMap((pm) => ({ ...pm, [t.id]: false }));
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
              name: effectiveUsername,
              rating: authUser?.rating || 1620,
              score: 0,
              streak: 0,
              gamesPlayed: 0,
              buchholz: 0,
              team: item.isTeamBattle ? selectedTeam : undefined,
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
    const isTeamBattle = newFormat === 'team_battle';
    const apiFormat: 'arena' | 'swiss' = newFormat === 'swiss' ? 'swiss' : 'arena';
    const finalName =
      newName.trim() ||
      `${variantLabel} ${isTeamBattle ? 'Team Battle' : apiFormat === 'arena' ? 'Arena' : 'Swiss'}`;

    if (authToken && !isTeamBattle) {
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
            format: apiFormat,
            variant: newVariant,
            timeControl: newTimeControl,
            durationMinutes: apiFormat === 'arena' ? newDuration : undefined,
            totalRounds: apiFormat === 'swiss' ? newRounds : undefined,
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

    // Local session creation (also used for Team Battles)
    const created: Tournament = {
      id: `tour-${Date.now()}`,
      name: finalName,
      format: apiFormat,
      isTeamBattle,
      variant: newVariant,
      timeControl: newTimeControl,
      durationMinutes: apiFormat === 'arena' ? newDuration : undefined,
      totalRounds: apiFormat === 'swiss' ? newRounds : undefined,
      currentRound: 1,
      status: 'active',
      joined: !isUserBot,
      createdBy: effectiveUsername,
      players: isUserBot
        ? []
        : [
            {
              id: 'user',
              name: effectiveUsername,
              rating: authUser?.rating || 1620,
              score: 0,
              streak: 0,
              gamesPlayed: 0,
              buchholz: 0,
              team: isTeamBattle ? selectedTeam : undefined,
              isUser: true,
            },
          ],
    };
    setTournaments((prev) => [created, ...prev]);
    setFormatFilter(isTeamBattle ? 'team_battle' : created.format);
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
    if (isUserBot) {
      setStatusNotice('Bots are not allowed in tournament leaderboards.');
      return;
    }
    if (pausedMap[activeTournament.id]) {
      setPausedMap((pm) => ({ ...pm, [activeTournament.id]: false }));
    }
    if (!activeTournament.joined) void toggleJoin(activeTournament);
    const pool = activeTournament.players.filter(
      (p) => !p.isUser && !isBotAccount(p) && (!activeTournament.isTeamBattle || p.team !== selectedTeam)
    );
    const fallbackPool = activeTournament.players.filter((p) => !p.isUser && !isBotAccount(p));
    const candidates = pool.length > 0 ? pool : fallbackPool;
    const opp = candidates[Math.floor(Math.random() * candidates.length)] || {
      id: 'practice-engine',
      name: 'Practice Opponent',
      rating: 1650,
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

  const startKnockoutMatch = (node: KnockoutMatchNode) => {
    if (!node.p1 || !node.p2 || node.winner) return;
    const userSide = node.p1.isUser ? node.p1 : node.p2.isUser ? node.p2 : null;
    if (!userSide) return;
    const oppSide = node.p1.isUser ? node.p2 : node.p1;
    setActiveKnockoutMatchId(node.id);
    setPlayingMatch({
      tournamentId: 'knockout-cup',
      knockoutNodeId: node.id,
      opponent: {
        id: `ko-${oppSide.name}`,
        name: oppSide.name,
        rating: oppSide.rating,
        score: 0,
        streak: 0,
        gamesPlayed: 0,
      },
      userColor: Math.random() < 0.5 ? 'w' : 'b',
      berserk: false,
      state: createInitialState('standard'),
      clockSec: 180,
      oppClockSec: 180,
      resultText: null,
    });
  };

  const resolveKnockoutBracket = (nodeId: string, userWon: boolean) => {
    setKnockoutNodes((prev) => {
      const next = prev.map((n) => ({ ...n }));
      const target = next.find((n) => n.id === nodeId);
      if (!target || !target.p1 || !target.p2) return prev;
      const userEnt = target.p1.isUser ? target.p1 : target.p2;
      const oppEnt = target.p1.isUser ? target.p2 : target.p1;
      target.winner = userWon ? userEnt : oppEnt;

      // Also simulate peer matches in the same round so the bracket fills organically
      for (const peer of next.filter((n) => n.round === target.round && n.id !== nodeId && !n.winner && n.p1 && n.p2)) {
        const p1Chance = 1 / (1 + Math.pow(10, (peer.p2!.rating - peer.p1!.rating) / 400));
        peer.winner = Math.random() < p1Chance ? peer.p1 : peer.p2;
      }

      const qf = next.filter((n) => n.round === 1);
      const sf1 = next.find((n) => n.id === 'sf-1');
      const sf2 = next.find((n) => n.id === 'sf-2');
      if (sf1 && qf[0].winner && qf[1].winner) {
        sf1.p1 = qf[0].winner;
        sf1.p2 = qf[1].winner;
      }
      if (sf2 && qf[2].winner && qf[3].winner) {
        sf2.p1 = qf[2].winner;
        sf2.p2 = qf[3].winner;
      }
      const fin = next.find((n) => n.id === 'fin-1');
      if (fin && sf1?.winner && sf2?.winner) {
        fin.p1 = sf1.winner;
        fin.p2 = sf2.winner;
      }

      if (target.round === 3 && fin?.winner) {
        const runnerUp = fin.winner.name === fin.p1?.name ? fin.p2 : fin.p1;
        const semiLosers = [sf1, sf2]
          .map((sf) => (sf && sf.winner ? (sf.winner.name === sf.p1?.name ? sf.p2 : sf.p1) : null))
          .filter(Boolean);
        const podium = [
          { name: fin.winner.name, isGuest: Boolean(fin.winner.isUser && !authUser), score: 3 },
          runnerUp
            ? { name: runnerUp.name, isGuest: Boolean(runnerUp.isUser && !authUser), score: 2 }
            : null,
          semiLosers[0]
            ? { name: semiLosers[0]!.name, isGuest: Boolean(semiLosers[0]!.isUser && !authUser), score: 1 }
            : null,
        ].filter(Boolean) as { name: string; isGuest?: boolean; score: number }[];
        void archiveToHallOfFame(`ko-${Date.now()}`, knockoutCupTitle, 'knockout', podium);
      }
      return next;
    });
    setActiveKnockoutMatchId(null);
  };

  const recordTournamentOutcome = async (outcome: 'win' | 'draw' | 'loss', reason: string) => {
    if (!playingMatch) return;
    if (playingMatch.knockoutNodeId) {
      setPlayingMatch((pm) => (pm ? { ...pm, resultText: reason } : null));
      resolveKnockoutBracket(playingMatch.knockoutNodeId, outcome === 'win');
      return;
    }
    const matchId = playingMatch.tournamentId;
    const wasBerserk = playingMatch.berserk;
    const oppId = playingMatch.opponent.id;
    const userTag = outcome === 'win' ? (wasBerserk ? '2⚡' : '1') : outcome === 'draw' ? '½' : '0';
    setRoundResults((prev) => {
      const tourMap = { ...(prev[matchId] || {}) };
      const userArr = [...(tourMap.user || []), userTag];
      const oppArr = [...(tourMap[oppId] || []), outcome === 'win' ? '0' : outcome === 'draw' ? '½' : '1'];
      tourMap.user = userArr;
      tourMap[oppId] = oppArr;
      return { ...prev, [matchId]: tourMap };
    });
    setPlayingMatch((pm) => (pm ? { ...pm, resultText: reason } : null));

    const currentTour = tournaments.find((t) => t.id === matchId);
    if (authToken && !currentTour?.isTeamBattle) {
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
          return p;
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

  const formatMatchClock = (sec: number) => {
    const s = Math.max(0, Math.floor(sec));
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
  };

  // Live clock tick inside active tournament match (Berserk disables increment)
  useEffect(() => {
    if (!playingMatch || playingMatch.resultText) return;
    const interval = window.setInterval(() => {
      setPlayingMatch((pm) => {
        if (!pm || pm.resultText) return pm;
        const userTurn = pm.state.turn === pm.userColor;
        const nextUserSec = userTurn ? Math.max(0, pm.clockSec - 1) : pm.clockSec;
        const nextOppSec = !userTurn ? Math.max(0, pm.oppClockSec - 1) : pm.oppClockSec;
        if (nextUserSec === 0) {
          void recordTournamentOutcome('loss', 'Flagged on time');
        } else if (nextOppSec === 0) {
          void recordTournamentOutcome('win', 'Opponent ran out of time');
        }
        return { ...pm, clockSec: nextUserSec, oppClockSec: nextOppSec };
      });
    }, 1000);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(playingMatch), playingMatch?.resultText]);

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
      const inc = parseInt(activeTournament?.timeControl.split('+')[1] || '0', 10) || 0;
      setPlayingMatch((pm) =>
        pm ? { ...pm, state: res.next, oppClockSec: pm.oppClockSec + inc } : null
      );

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
    const inc = playingMatch.berserk
      ? 0
      : parseInt(activeTournament?.timeControl.split('+')[1] || '0', 10) || 0;
    setPlayingMatch((pm) =>
      pm ? { ...pm, state: res.next, clockSec: pm.clockSec + inc } : null
    );
    if (term) {
      const outcome =
        term.winner === 'draw' ? 'draw' : term.winner === playingMatch.userColor ? 'win' : 'loss';
      void recordTournamentOutcome(outcome, term.reason);
    }
  };

  const sendGlobalChat = async (preset?: string) => {
    const text = (preset ?? globalChatInput).trim();
    if (!text) return;
    setGlobalChatError(null);
    const clientMsgId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? `tgc-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`
        : `tgc-${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    const tournamentTag =
      tagCurrentTournament && activeTournament ? activeTournament.name : undefined;

    if (!preset) setGlobalChatInput('');

    const ws = globalChatWsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: 'chat:send',
          clientMsgId,
          token: authToken,
          text,
          tournamentTag,
        })
      );
      return;
    }

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authToken) {
        headers.Authorization = `Bearer ${authToken}`;
      }
      const resp = await fetch('/api/tournaments/chat', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          id: clientMsgId,
          text,
          tournamentTag,
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data?.message) {
        setGlobalChatMessages((prev) => {
          if (prev.some((m) => m.id === data.message.id)) return prev;
          return [...prev, data.message as GlobalTournamentChatMsg].slice(-250);
        });
      } else if (!resp.ok) {
        setGlobalChatError(data?.error || 'Could not send chat message.');
      }
    } catch {
      setGlobalChatError('Unable to reach chat server.');
    }
  };

  const sendLobbyChat = (preset?: string) => {
    if (!activeTournament) return;
    const text = (preset ?? chatInput).trim();
    if (!text) return;
    const tId = activeTournament.id;
    const msg: LobbyChatMsg = {
      id: `tc-${Date.now()}`,
      author: effectiveUsername,
      text,
      time: new Date().toTimeString().slice(0, 5),
    };
    setChatByTournament((prev) => ({
      ...prev,
      [tId]: [...(prev[tId] || []), msg],
    }));
    if (!preset) setChatInput('');
  };

  const activeLobbyMessages = useMemo(() => {
    if (!activeTournament) return [];
    const custom = chatByTournament[activeTournament.id] || [];
    const seeded: LobbyChatMsg[] = [
      {
        id: `seed-1-${activeTournament.id}`,
        author: activeTournament.createdBy || 'Tournament Director',
        text: `Welcome to ${activeTournament.name}! Fair play rules active; enjoy the pairings.`,
        time: '19:00',
      },
      {
        id: `seed-2-${activeTournament.id}`,
        author: activeTournament.players[0]?.name || 'GM_Aurelia',
        text: 'glhf everyone, sharp games ahead!',
        time: '19:04',
      },
    ];
    return [...seeded, ...custom];
  }, [activeTournament, chatByTournament]);

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-stone-200 dark:border-zinc-800 pb-3">
        <div className="flex items-center gap-1 p-1 bg-stone-100 dark:bg-zinc-900 rounded-lg overflow-x-auto">
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
            Arena
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
            Swiss
          </button>
          <button
            type="button"
            onClick={() => setFormatFilter('team_battle')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
              formatFilter === 'team_battle'
                ? 'bg-white dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 shadow-sm'
                : 'text-stone-600 dark:text-zinc-400'
            }`}
          >
            <Shield className="w-3.5 h-3.5 text-indigo-500" />
            Team Battles
          </button>
          <button
            type="button"
            onClick={() => setFormatFilter('knockout')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
              formatFilter === 'knockout'
                ? 'bg-white dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 shadow-sm'
                : 'text-stone-600 dark:text-zinc-400'
            }`}
          >
            <Award className="w-3.5 h-3.5 text-rose-500" />
            Knockout Cup
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
              setNewFormat(formatFilter === 'knockout' ? 'arena' : formatFilter);
              setCreateOpen(true);
            }}
            className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            Make Tournament
          </button>
        </div>
      </div>

      {/* Automated Hourly Arena Countdown Banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-xl bg-gradient-to-r from-emerald-50 to-amber-50/60 dark:from-emerald-950/40 dark:to-zinc-900 border border-emerald-200 dark:border-emerald-900/60">
        <div className="flex items-center gap-2.5">
          <Clock className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <div className="text-xs">
            <span className="font-semibold text-stone-900 dark:text-zinc-100">
              Next Hourly Blitz Arena starts in{' '}
            </span>
            <span className="font-mono font-bold tabular-nums text-emerald-700 dark:text-emerald-300">
              {Math.floor(hourlyCountdownSec / 60)}:
              {(hourlyCountdownSec % 60).toString().padStart(2, '0')}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            setFormatFilter('arena');
            const target = tournaments.find((t) => t.id === 'arena-blitz') || tournaments[0];
            if (target) {
              setActiveId(target.id);
              if (!target.joined) void toggleJoin(target);
            }
          }}
          className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold whitespace-nowrap shrink-0"
        >
          Join Active Hourly Arena
        </button>
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
        {/* Left Sidebar: Tournament Directory + Persistent Global Chat Window */}
        <div className="lg:col-span-4 space-y-5">
          <div className="space-y-3">
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

          {/* Persistent Global Tournament Chat Window (always accessible during tournament browsing & live games) */}
          <section
            aria-label="Global Tournament Chat"
            className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl overflow-hidden shadow-xs"
          >
            <div className="px-4 py-3 border-b border-stone-200 dark:border-zinc-800 flex items-center justify-between gap-2 bg-stone-50/80 dark:bg-zinc-950/60">
              <div className="flex items-center gap-2 min-w-0">
                <Globe className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <div className="min-w-0">
                  <h3 className="text-xs font-semibold text-stone-900 dark:text-zinc-100 truncate">
                    Global Tournament Chat
                  </h3>
                  <p className="text-[11px] text-stone-500 dark:text-zinc-400 truncate">
                    Discuss ongoing games · Posting as {effectiveUsername}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setGlobalChatOpen((o) => !o)}
                className="p-1.5 rounded-md text-stone-500 hover:text-stone-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-stone-200/60 dark:hover:bg-zinc-800 shrink-0"
                title={globalChatOpen ? 'Minimize global chat' : 'Expand global chat'}
                aria-expanded={globalChatOpen}
              >
                {globalChatOpen ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </button>
            </div>

            {globalChatOpen && (
              <div className="p-3.5 space-y-3">
                <div
                  ref={globalChatScrollRef}
                  className="h-64 overflow-y-auto thin-scroll space-y-2.5 p-2.5 rounded-lg bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800"
                >
                  {globalChatMessages.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-center px-3 text-xs text-stone-500 dark:text-zinc-400">
                      No messages yet. Start a conversation about ongoing tournament games!
                    </div>
                  ) : (
                    globalChatMessages.map((msg) => {
                      const timeLabel = msg.createdAt
                        ? new Date(msg.createdAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : '';
                      return (
                        <div key={msg.id} className="text-xs leading-relaxed break-words">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {timeLabel && (
                              <span className="font-mono text-[10px] text-stone-400">
                                [{timeLabel}]
                              </span>
                            )}
                            {msg.isGuest && (
                              <User
                                className="w-3 h-3 text-stone-400 dark:text-zinc-500 shrink-0"
                                aria-hidden="true"
                              />
                            )}
                            <span
                              className={`font-semibold ${
                                msg.isGuest
                                  ? 'text-stone-700 dark:text-zinc-300 italic'
                                  : 'text-stone-900 dark:text-zinc-100'
                              }`}
                            >
                              {msg.author}
                            </span>
                            {msg.isGuest && (
                              <span className="px-1 py-0.2 rounded border border-stone-200 dark:border-zinc-700 bg-stone-100 dark:bg-zinc-800 text-stone-600 dark:text-zinc-300 text-[9px] font-medium">
                                Guest
                              </span>
                            )}
                            {msg.tournamentTag && (
                              <span className="text-[10px] font-mono text-emerald-700 dark:text-emerald-400 truncate max-w-[160px]">
                                · {msg.tournamentTag}
                              </span>
                            )}
                          </div>
                          <div className="text-stone-700 dark:text-zinc-300 pl-0.5 mt-0.5">
                            {msg.text}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {globalChatError && (
                  <div className="text-[11px] text-red-600 dark:text-red-400">
                    {globalChatError}
                  </div>
                )}

                {activeTournament && (
                  <label className="flex items-center gap-1.5 text-[11px] text-stone-600 dark:text-zinc-400 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={tagCurrentTournament}
                      onChange={(e) => setTagCurrentTournament(e.target.checked)}
                      className="w-3.5 h-3.5 rounded accent-emerald-600 cursor-pointer"
                    />
                    <span className="truncate">
                      Tag <strong className="font-medium text-stone-800 dark:text-zinc-200">{activeTournament.name}</strong>
                    </span>
                  </label>
                )}

                <div className="flex flex-wrap items-center gap-1.5">
                  {['🔥', '👏', '⚡', '♟️'].map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => void sendGlobalChat(emoji)}
                      className="px-2 py-1 rounded border border-stone-200 dark:border-zinc-700 text-xs hover:bg-stone-100 dark:hover:bg-zinc-800"
                      title={`Send ${emoji} reaction`}
                    >
                      {emoji}
                    </button>
                  ))}
                  {['glhf!', 'Sharp game!', 'Great endgame!'].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => void sendGlobalChat(preset)}
                      className="px-2 py-1 rounded border border-stone-200 dark:border-zinc-700 text-[11px] font-medium text-stone-600 dark:text-zinc-300 hover:bg-stone-100 dark:hover:bg-zinc-800"
                    >
                      {preset}
                    </button>
                  ))}
                  {activeTournament && (
                    <button
                      type="button"
                      onClick={() =>
                        void sendGlobalChat(
                          `Come join ${activeTournament.name} (${activeTournament.timeControl}, ${activeTournament.players.length} players)!`
                        )
                      }
                      className="px-2 py-1 rounded border border-emerald-200 dark:border-emerald-800 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 flex items-center gap-1"
                    >
                      <Share2 className="w-3 h-3" />
                      Share Event
                    </button>
                  )}
                </div>

                <div className="flex gap-2">
                  <input
                    type="text"
                    value={globalChatInput}
                    onChange={(e) => setGlobalChatInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void sendGlobalChat();
                      }
                    }}
                    maxLength={300}
                    placeholder="Discuss ongoing games..."
                    className="flex-1 min-w-0 px-3 py-1.5 rounded-lg border border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-950 text-xs text-stone-900 dark:text-zinc-100"
                  />
                  <button
                    type="button"
                    onClick={() => void sendGlobalChat()}
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center gap-1 whitespace-nowrap shrink-0"
                  >
                    <Send className="w-3.5 h-3.5" />
                    Send
                  </button>
                </div>
              </div>
            )}
          </section>
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

              <div className="flex flex-col items-center gap-2">
                <div className="w-full max-w-[460px] flex items-center justify-between px-3 py-1.5 rounded-lg bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 text-xs">
                  <span className="font-semibold text-stone-800 dark:text-zinc-200">
                    {playingMatch.opponent.name} ({playingMatch.opponent.rating})
                  </span>
                  <span
                    className={`font-mono tabular-nums text-sm font-bold px-2 py-0.5 rounded ${
                      playingMatch.state.turn !== playingMatch.userColor && !playingMatch.resultText
                        ? 'bg-emerald-600 text-white'
                        : 'text-stone-700 dark:text-zinc-300'
                    }`}
                  >
                    {formatMatchClock(playingMatch.oppClockSec)}
                  </span>
                </div>

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
                  showLastMove={prefs.showLastMove ?? true}
                  pieceScale={prefs.pieceScale || 'normal'}
                  autoQueen={prefs.autoQueen}
                  maxWidthClass="max-w-[460px]"
                />

                <div className="w-full max-w-[460px] flex items-center justify-between px-3 py-1.5 rounded-lg bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 text-xs">
                  <span className="font-semibold text-stone-800 dark:text-zinc-200">
                    {prefs.username} {playingMatch.berserk ? '· Berserk' : ''}
                  </span>
                  <span
                    className={`font-mono tabular-nums text-sm font-bold px-2 py-0.5 rounded ${
                      playingMatch.state.turn === playingMatch.userColor && !playingMatch.resultText
                        ? 'bg-emerald-600 text-white'
                        : 'text-stone-700 dark:text-zinc-300'
                    }`}
                  >
                    {formatMatchClock(playingMatch.clockSec)}
                  </span>
                </div>
              </div>
            </div>
          ) : formatFilter === 'knockout' ? (
            <div className="space-y-5">
              <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-5 space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-bold text-stone-900 dark:text-zinc-100 flex items-center gap-2">
                      <Award className="w-5 h-5 text-rose-500" />
                      {knockoutCupTitle}
                    </h2>
                    <p className="text-xs text-stone-500 dark:text-zinc-400">
                      8-Player Single-Elimination Knockout · 3+0 Blitz · Win 3 rounds to lift the trophy!
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setKnockoutCupTitle(`Caissa Knockout Cup #${Math.floor(10 + Math.random() * 89)}`);
                      setKnockoutNodes(createInitialKnockoutBracket(effectiveUsername, authUser?.rating || 1620));
                    }}
                    className="px-3 py-1.5 rounded-lg border border-stone-200 dark:border-zinc-700 text-xs font-semibold hover:bg-stone-50 dark:hover:bg-zinc-800"
                  >
                    New 8-Player Cup
                  </button>
                </div>

                {knockoutNodes.find((n) => n.id === 'fin-1')?.winner && (
                  <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 flex items-center gap-3">
                    <Trophy className="w-6 h-6 text-amber-500 shrink-0" />
                    <div className="text-xs">
                      <div className="font-bold text-amber-900 dark:text-amber-200 text-sm">
                        Champion Crowned: {knockoutNodes.find((n) => n.id === 'fin-1')?.winner?.name}
                      </div>
                      <div className="text-amber-800 dark:text-amber-300">
                        Result archived to the Tournament Hall of Fame Podium!
                      </div>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {([
                    [1, 'Quarterfinals'],
                    [2, 'Semifinals'],
                    [3, 'Grand Final'],
                  ] as const).map(([roundNum, label]) => (
                    <div key={roundNum} className="space-y-3">
                      <div className="text-xs font-semibold uppercase tracking-wider text-stone-500 dark:text-zinc-400">
                        {label}
                      </div>
                      {knockoutNodes
                        .filter((n) => n.round === roundNum)
                        .map((node) => {
                          const canPlay =
                            !node.winner &&
                            Boolean(node.p1 && node.p2) &&
                            Boolean(node.p1?.isUser || node.p2?.isUser);
                          return (
                            <div
                              key={node.id}
                              className="p-3 rounded-lg border border-stone-200 dark:border-zinc-800 bg-stone-50/70 dark:bg-zinc-950 space-y-2 text-xs"
                            >
                              {[node.p1, node.p2].map((pl, idx) => (
                                <div
                                  key={idx}
                                  className={`flex items-center justify-between px-2 py-1 rounded ${
                                    node.winner && pl && node.winner.name === pl.name
                                      ? 'bg-emerald-100 dark:bg-emerald-950/50 font-bold text-emerald-900 dark:text-emerald-200'
                                      : pl?.isUser
                                      ? 'font-semibold text-stone-900 dark:text-zinc-100'
                                      : 'text-stone-600 dark:text-zinc-400'
                                  }`}
                                >
                                  <span className="truncate">{pl ? pl.name : 'TBD'}</span>
                                  {pl && <span className="font-mono text-[11px]">{pl.rating}</span>}
                                </div>
                              ))}
                              {canPlay && (
                                <button
                                  type="button"
                                  onClick={() => startKnockoutMatch(node)}
                                  className="w-full py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold"
                                >
                                  Play {roundNum === 3 ? 'Final' : roundNum === 2 ? 'Semifinal' : 'Quarterfinal'}
                                </button>
                              )}
                            </div>
                          );
                        })}
                    </div>
                  ))}
                </div>
              </div>

              {/* Hall of Fame Podium */}
              <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-stone-900 dark:text-zinc-100 flex items-center gap-2">
                    <Medal className="w-4 h-4 text-amber-500" />
                    Tournament Hall of Fame Podium
                  </h3>
                  <span className="text-[11px] font-mono text-stone-400">
                    {hallOfFame.length} archived
                  </span>
                </div>
                {hallOfFame.length === 0 ? (
                  <p className="text-xs text-stone-500 dark:text-zinc-400">
                    Complete a Swiss Championship or Knockout Cup to immortalize top 3 finishers here.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {hallOfFame.slice(0, 6).map((entry) => (
                      <div
                        key={entry.id}
                        className="p-3 rounded-lg border border-stone-200 dark:border-zinc-800 bg-stone-50 dark:bg-zinc-950 space-y-2 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-stone-900 dark:text-zinc-100 truncate">
                            {entry.tournamentName}
                          </span>
                          <span className="text-[10px] font-mono uppercase text-emerald-600 dark:text-emerald-400">
                            {entry.format}
                          </span>
                        </div>
                        <div className="space-y-1">
                          {entry.podium.map((p) => (
                            <div key={p.rank} className="flex items-center justify-between">
                              <span className="text-stone-700 dark:text-zinc-300">
                                {p.rank === 1 ? '🥇' : p.rank === 2 ? '🥈' : '🥉'} {p.name}
                              </span>
                              <span className="font-mono text-[11px] text-stone-500">
                                {p.score} pts
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
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

                  <div className="flex flex-wrap items-center gap-2">
                    {activeTournament.isTeamBattle && !activeTournament.joined && (
                      <select
                        value={selectedTeam}
                        onChange={(e) => setSelectedTeam(e.target.value)}
                        className="px-2.5 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-950 text-xs text-stone-800 dark:text-zinc-200"
                        title="Choose team to represent"
                      >
                        {TEAM_BATTLE_CLUBS.map((club) => (
                          <option key={club} value={club}>
                            {club}
                          </option>
                        ))}
                      </select>
                    )}
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
                    {activeTournament.joined && activeTournament.format === 'arena' && (
                      <button
                        type="button"
                        onClick={() =>
                          setPausedMap((pm) => ({
                            ...pm,
                            [activeTournament.id]: !pm[activeTournament.id],
                          }))
                        }
                        className={`px-3 py-2 rounded-lg border text-xs font-semibold flex items-center gap-1 whitespace-nowrap shrink-0 ${
                          pausedMap[activeTournament.id]
                            ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300'
                            : 'border-stone-300 dark:border-zinc-700 text-stone-700 dark:text-zinc-300'
                        }`}
                        title="Pause pairings without withdrawing"
                      >
                        {pausedMap[activeTournament.id] ? (
                          <>
                            <Play className="w-3.5 h-3.5" />
                            Resume
                          </>
                        ) : (
                          <>
                            <Pause className="w-3.5 h-3.5" />
                            Pause
                          </>
                        )}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => launchPairing(false)}
                      className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0"
                    >
                      <Swords className="w-3.5 h-3.5" />
                      {activeTournament.format === 'arena'
                        ? pausedMap[activeTournament.id]
                          ? 'Resume & Pair'
                          : 'Play Next Pairing'
                        : `Play Round ${activeTournament.currentRound}`}
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
                    {sortedStandings.length > 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          void archiveToHallOfFame(
                            `${activeTournament.id}-${Date.now()}`,
                            activeTournament.name,
                            activeTournament.format,
                            sortedStandings.slice(0, 3).map((p) => ({
                              name: p.name,
                              isGuest: p.isUser && !authUser,
                              score: p.score,
                            }))
                          )
                        }
                        className="px-3 py-2 rounded-lg border border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-300 text-xs font-semibold flex items-center gap-1 whitespace-nowrap shrink-0 hover:bg-amber-50 dark:hover:bg-amber-950/30"
                        title="Archive current podium snapshot to the Hall of Fame"
                      >
                        <Medal className="w-3.5 h-3.5" />
                        Archive Podium
                      </button>
                    )}
                  </div>
                </div>

                {activeTournament.joined && pausedMap[activeTournament.id] && (
                  <div className="px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-xs text-amber-800 dark:text-amber-200">
                    You are currently paused in this arena. Click Resume or Play Next Pairing when ready.
                  </div>
                )}

                {/* Team Battle Standings Table */}
                {activeTournament.isTeamBattle && teamStandings.length > 0 && (
                  <div className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-stone-50/70 dark:bg-zinc-950 p-4 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-600 dark:text-zinc-400 flex items-center gap-1.5">
                        <Shield className="w-3.5 h-3.5 text-indigo-500" />
                        Team Battle Leaderboard (Top 3 Scorers Count)
                      </h3>
                      <span className="text-[11px] font-mono text-stone-500 dark:text-zinc-400">
                        {teamStandings.length} teams
                      </span>
                    </div>
                    <div className="divide-y divide-stone-200/70 dark:divide-zinc-800 text-xs">
                      {teamStandings.map((team, idx) => (
                        <div
                          key={team.teamName}
                          className="py-2 flex flex-wrap items-center justify-between gap-2"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span className="font-mono tabular-nums text-stone-400 w-5">
                              #{idx + 1}
                            </span>
                            <span className="font-semibold text-stone-900 dark:text-zinc-100">
                              {team.teamName}
                            </span>
                            <span className="text-[11px] text-stone-500 dark:text-zinc-400 truncate">
                              ({team.topContributors.map((c) => `${c.name} ${c.score}`).join(', ')})
                            </span>
                          </div>
                          <span className="font-mono font-bold tabular-nums text-indigo-600 dark:text-indigo-400">
                            {team.totalScore} pts
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Lobby View Switcher: Standings / Pairings / Crosstable / Lobby Chat */}
                <div className="flex items-center gap-1 p-1 bg-stone-100 dark:bg-zinc-950 rounded-lg w-fit overflow-x-auto">
                  <button
                    type="button"
                    onClick={() => setLobbyTab('standings')}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                      lobbyTab === 'standings'
                        ? 'bg-white dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 shadow-xs'
                        : 'text-stone-500 dark:text-zinc-400'
                    }`}
                  >
                    <Trophy className="w-3.5 h-3.5" />
                    Standings
                  </button>
                  <button
                    type="button"
                    onClick={() => setLobbyTab('pairings')}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                      lobbyTab === 'pairings'
                        ? 'bg-white dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 shadow-xs'
                        : 'text-stone-500 dark:text-zinc-400'
                    }`}
                  >
                    <Swords className="w-3.5 h-3.5" />
                    Pairings
                  </button>
                  <button
                    type="button"
                    onClick={() => setLobbyTab('crosstable')}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                      lobbyTab === 'crosstable'
                        ? 'bg-white dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 shadow-xs'
                        : 'text-stone-500 dark:text-zinc-400'
                    }`}
                  >
                    <Table className="w-3.5 h-3.5" />
                    Crosstable
                  </button>
                  <button
                    type="button"
                    onClick={() => setLobbyTab('chat')}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                      lobbyTab === 'chat'
                        ? 'bg-white dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 shadow-xs'
                        : 'text-stone-500 dark:text-zinc-400'
                    }`}
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    Lobby Chat
                  </button>
                </div>

                {/* Live Standings Table */}
                {lobbyTab === 'standings' && (
                  <div className="space-y-2">
                    <div className="text-[11px] text-stone-500 dark:text-zinc-400">
                      Human players only · Bots are not allowed in leaderboards
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs text-left">
                      <thead>
                        <tr className="border-b border-stone-200 dark:border-zinc-800 text-stone-500 dark:text-zinc-400">
                          <th className="py-2 pr-3 font-medium">#</th>
                          <th className="py-2 pr-3 font-medium">Player</th>
                          {activeTournament.isTeamBattle && (
                            <th className="py-2 pr-3 font-medium">Team</th>
                          )}
                          <th className="py-2 pr-3 font-medium">Rating</th>
                          <th className="py-2 pr-3 font-medium">Games</th>
                          {activeTournament.format === 'swiss' && (
                            <th className="py-2 pr-3 font-medium">Buchholz</th>
                          )}
                          <th className="py-2 text-right font-medium">Score</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-100 dark:divide-zinc-800/70">
                        {sortedStandings.length === 0 ? (
                          <tr>
                            <td
                              colSpan={activeTournament.isTeamBattle ? 7 : 6}
                              className="py-5 text-center text-xs text-stone-500 dark:text-zinc-400"
                            >
                              No human players in this tournament standings yet. Join above to compete.
                            </td>
                          </tr>
                        ) : (
                          sortedStandings.map((pl, idx) => (
                            <tr
                              key={pl.id}
                              className={
                                pl.isUser ? 'bg-emerald-50/70 dark:bg-emerald-950/25 font-semibold' : ''
                              }
                            >
                              <td className="py-2.5 pr-3 font-mono tabular-nums text-stone-500 dark:text-zinc-400">
                                {idx + 1}
                              </td>
                              <td className="py-2.5 pr-3 text-stone-900 dark:text-zinc-100">
                                {pl.name}
                                {pl.streak >= 2 && activeTournament.format === 'arena' && (
                                  <span className="ml-2 text-amber-500 font-mono">
                                    ({pl.streak} streak)
                                  </span>
                                )}
                              </td>
                              {activeTournament.isTeamBattle && (
                                <td className="py-2.5 pr-3 text-stone-600 dark:text-zinc-400">
                                  {pl.team || 'Open'}
                                </td>
                              )}
                              <td className="py-2.5 pr-3 font-mono tabular-nums text-stone-600 dark:text-zinc-400">
                                {pl.rating}
                              </td>
                              <td className="py-2.5 pr-3 font-mono tabular-nums text-stone-600 dark:text-zinc-400">
                                {pl.gamesPlayed}
                              </td>
                              {activeTournament.format === 'swiss' && (
                                <td className="py-2.5 pr-3 font-mono tabular-nums text-stone-600 dark:text-zinc-400">
                                  {(pl.buchholz || 0).toFixed(1)}
                                </td>
                              )}
                              <td className="py-2.5 text-right font-mono tabular-nums font-bold text-stone-900 dark:text-zinc-100">
                                {pl.score}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                    </div>
                  </div>
                )}

                {/* Round Pairings Table */}
                {lobbyTab === 'pairings' && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-xs text-stone-500 dark:text-zinc-400">
                      <span>
                        {activeTournament.format === 'swiss'
                          ? `Round ${activeTournament.currentRound} of ${activeTournament.totalRounds} Pairings`
                          : 'Active Arena Matchups'}
                      </span>
                      <span className="font-mono tabular-nums">{roundPairings.length} boards</span>
                    </div>
                    <div className="divide-y divide-stone-100 dark:divide-zinc-800 border border-stone-200 dark:border-zinc-800 rounded-lg overflow-hidden">
                      {roundPairings.map((pair) => {
                        const involvesUser = pair.white.isUser || pair.black?.isUser;
                        return (
                          <div
                            key={pair.board}
                            className={`px-3 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs ${
                              involvesUser ? 'bg-emerald-50/70 dark:bg-emerald-950/25' : ''
                            }`}
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <span className="font-mono text-stone-400 w-7 shrink-0">
                                Bd {pair.board}
                              </span>
                              <div className="min-w-0">
                                <span className="font-semibold text-stone-900 dark:text-zinc-100">
                                  {pair.white.name} ({pair.white.rating})
                                </span>
                                <span className="mx-2 text-stone-400">vs</span>
                                <span className="font-semibold text-stone-900 dark:text-zinc-100">
                                  {pair.black ? `${pair.black.name} (${pair.black.rating})` : 'BYE (1 pt)'}
                                </span>
                              </div>
                            </div>
                            {involvesUser && pair.black && (
                              <button
                                type="button"
                                onClick={() => launchPairing(false)}
                                className="px-2.5 py-1 rounded bg-emerald-600 text-white text-[11px] font-semibold whitespace-nowrap shrink-0"
                              >
                                Play Board
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Crosstable Matrix */}
                {lobbyTab === 'crosstable' && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left border-collapse">
                      <thead>
                        <tr className="border-b border-stone-200 dark:border-zinc-800 text-stone-500 dark:text-zinc-400">
                          <th className="py-2 pr-3 font-medium">Player</th>
                          {sortedStandings.map((_, colIdx) => (
                            <th key={colIdx} className="py-2 px-2 text-center font-mono">
                              #{colIdx + 1}
                            </th>
                          ))}
                          <th className="py-2 pl-3 text-right font-medium">Pts</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-100 dark:divide-zinc-800/70">
                        {sortedStandings.map((rowPl, rIdx) => {
                          const recorded = roundResults[activeTournament.id]?.[rowPl.id] || [];
                          return (
                            <tr
                              key={rowPl.id}
                              className={rowPl.isUser ? 'bg-emerald-50/50 dark:bg-emerald-950/20 font-semibold' : ''}
                            >
                              <td className="py-2 pr-3 text-stone-900 dark:text-zinc-100 whitespace-nowrap">
                                <span className="font-mono text-stone-400 mr-1.5">{rIdx + 1}.</span>
                                {rowPl.name}
                              </td>
                              {sortedStandings.map((colPl, cIdx) => {
                                if (rowPl.id === colPl.id) {
                                  return (
                                    <td
                                      key={colPl.id}
                                      className="py-2 px-2 text-center font-mono bg-stone-100 dark:bg-zinc-800/60 text-stone-400"
                                    >
                                      ×
                                    </td>
                                  );
                                }
                                let cell = '·';
                                const recordedVal = recorded[cIdx];
                                if (recordedVal) {
                                  cell = recordedVal;
                                } else if (rowPl.gamesPlayed > 0 && colPl.gamesPlayed > 0) {
                                  cell =
                                    rowPl.score > colPl.score
                                      ? '1'
                                      : rowPl.score === colPl.score
                                      ? '½'
                                      : '0';
                                }
                                return (
                                  <td
                                    key={colPl.id}
                                    className={`py-2 px-2 text-center font-mono tabular-nums ${
                                      cell.startsWith('1') || cell.startsWith('2')
                                        ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                                        : cell === '0'
                                        ? 'text-red-500'
                                        : 'text-stone-500 dark:text-zinc-400'
                                    }`}
                                  >
                                    {cell}
                                  </td>
                                );
                              })}
                              <td className="py-2 pl-3 text-right font-mono font-bold tabular-nums text-stone-900 dark:text-zinc-100">
                                {rowPl.score}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Tournament Lobby Chat */}
                {lobbyTab === 'chat' && (
                  <div className="space-y-3">
                    <div className="h-52 overflow-y-auto thin-scroll space-y-2 p-3 rounded-lg bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800">
                      {activeLobbyMessages.map((m) => (
                        <div key={m.id} className="text-xs leading-relaxed">
                          <span className="font-mono text-[10px] text-stone-400 mr-1.5">
                            [{m.time}]
                          </span>
                          <span className="font-semibold text-stone-900 dark:text-zinc-100 mr-1.5">
                            {m.author}:
                          </span>
                          <span className="text-stone-700 dark:text-zinc-300">{m.text}</span>
                        </div>
                      ))}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {['glhf!', 'Great round!', 'Berserk time!'].map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => sendLobbyChat(preset)}
                          className="px-2.5 py-1 rounded border border-stone-200 dark:border-zinc-700 text-[11px] font-medium text-stone-600 dark:text-zinc-300 hover:bg-stone-100 dark:hover:bg-zinc-800"
                        >
                          {preset}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') sendLobbyChat();
                        }}
                        placeholder="Message tournament lobby..."
                        className="flex-1 px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-950 text-xs text-stone-900 dark:text-zinc-100"
                      />
                      <button
                        type="button"
                        onClick={() => sendLobbyChat()}
                        className="px-3.5 py-2 rounded-lg bg-stone-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0"
                      >
                        <Send className="w-3.5 h-3.5" />
                        Send
                      </button>
                    </div>
                  </div>
                )}
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
                  <div className="grid grid-cols-3 gap-1 p-1 bg-stone-100 dark:bg-zinc-950 rounded-lg">
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
                    <button
                      type="button"
                      onClick={() => setNewFormat('team_battle')}
                      className={`py-1.5 rounded-md text-xs font-semibold ${
                        newFormat === 'team_battle'
                          ? 'bg-white dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 shadow-xs'
                          : 'text-stone-500'
                      }`}
                    >
                      Battle
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
