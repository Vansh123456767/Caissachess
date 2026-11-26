import React, { useEffect, useMemo, useState } from 'react';
import {
  BoardState,
  ChessVariant,
  DirectMessage,
  ForumPost,
  Friend,
  GameRecord,
  Move,
  RatingCategory,
  Team,
  UserPreferences,
  UserRatings,
} from '../types/chess';
import {
  createInitialState,
  evaluateGameResult,
  makeMove,
  parseFen,
  parsePgn,
  toFen,
  VARIANTS,
} from '../engine/chessEngine';
import { evaluatePosition, findBestMove } from '../engine/aiSearch';
import {
  INITIAL_FORUM_POSTS,
  INITIAL_FRIENDS,
  INITIAL_TEAMS,
} from '../data/puzzlesAndLessons';
import { ChessBoard } from './ChessBoard';
import { EvalBar } from './EvalBar';
import { isBotAccount } from '../utils/botFilter';
import {
  ArrowLeftRight,
  Award,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  Globe,
  GraduationCap,
  MessageSquare,
  Microscope,
  Newspaper,
  Plus,
  Radio,
  Search,
  Send,
  Swords,
  Tv,
  Users,
} from 'lucide-react';

interface CommunityViewProps {
  prefs: UserPreferences;
  games?: GameRecord[];
  userRatings?: UserRatings;
  onChallengeStart: (variant: ChessVariant) => void;
  onSendToAnalysis: (payload: { moves: Move[]; fens: string[]; variant: ChessVariant }) => void;
}

type CommSubTab =
  | 'tv'
  | 'streamers'
  | 'broadcasts'
  | 'players'
  | 'coaches'
  | 'teams'
  | 'forum'
  | 'friends';

interface BroadcastBoard {
  id: string;
  white: string;
  whiteElo: number;
  black: string;
  blackElo: number;
  result: string;
  pgn: string;
}

interface BroadcastEvent {
  id: string;
  name: string;
  location: string;
  roundLabel: string;
  boards: BroadcastBoard[];
}

const BROADCAST_EVENTS: BroadcastEvent[] = [
  {
    id: 'bc-candidates',
    name: '2026 Candidates Tournament',
    location: 'Toronto · Classical 120+30',
    roundLabel: 'Round 9',
    boards: [
      {
        id: 'bc-c-1',
        white: 'GM Nakamura',
        whiteElo: 2802,
        black: 'GM Gukesh',
        blackElo: 2787,
        result: '1-0',
        pgn: '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 Na5 10. Bc2 c5 11. d4 Qc7 12. Nbd2',
      },
      {
        id: 'bc-c-2',
        white: 'GM Caruana',
        whiteElo: 2805,
        black: 'GM Praggnanandhaa',
        blackElo: 2758,
        result: '1/2-1/2',
        pgn: '1. d4 Nf6 2. c4 e6 3. Nf3 d5 4. Nc3 dxc4 5. e4 Bb4 6. Bg5 c5 7. Bxc4 cxd4 8. Nxd4 Bxc3+ 9. bxc3 Qa5',
      },
    ],
  },
  {
    id: 'bc-tata',
    name: 'Tata Steel Masters 2026',
    location: 'Wijk aan Zee · Classical',
    roundLabel: 'Round 11',
    boards: [
      {
        id: 'bc-t-1',
        white: 'GM Abdusattorov',
        whiteElo: 2777,
        black: 'GM Wei Yi',
        blackElo: 2755,
        result: '1-0',
        pgn: '1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 6. Be3 e5 7. Nb3 Be6 8. f3 Be7 9. Qd2 O-O 10. O-O-O',
      },
      {
        id: 'bc-t-2',
        white: 'GM Firouzja',
        whiteElo: 2763,
        black: 'GM Keymer',
        blackElo: 2732,
        result: '1/2-1/2',
        pgn: '1. d4 Nf6 2. c4 g6 3. Nc3 Bg7 4. e4 d6 5. Nf3 O-O 6. Be2 e5 7. O-O Nc6 8. d5 Ne7 9. Ne1 Nd7',
      },
    ],
  },
];

interface CoachListing {
  id: string;
  name: string;
  title: string;
  fide: number;
  languages: string[];
  rate: string;
  specialty: string;
  bio: string;
}

const COACHES: CoachListing[] = [
  {
    id: 'coach-1',
    name: 'Aurelia Vance',
    title: 'GM',
    fide: 2610,
    languages: ['English', 'French'],
    rate: '₹2,500 / hr',
    specialty: 'Endgame Technique & Calculation',
    bio: 'Grandmaster with 12 years coaching 1400–2300 tournament players in classical positional play.',
  },
  {
    id: 'coach-2',
    name: 'Vikramaditya Rao',
    title: 'IM',
    fide: 2475,
    languages: ['English', 'Hindi'],
    rate: '₹1,400 / hr',
    specialty: 'Sicilian Najdorf & Attacking Chess',
    bio: 'Two-time national junior coach focusing on tactical pattern speed and dynamic pawn structures.',
  },
  {
    id: 'coach-3',
    name: 'Elena Lindqvist',
    title: 'WGM',
    fide: 2390,
    languages: ['English', 'German'],
    rate: '₹1,600 / hr',
    specialty: 'Opening Repertoires & Mistake Review',
    bio: 'Builds practical, low-theory club repertoires tailored to rapid and blitz time controls.',
  },
  {
    id: 'coach-4',
    name: 'Mateo Herrera',
    title: 'FM',
    fide: 2335,
    languages: ['Spanish', 'English'],
    rate: '₹950 / hr',
    specialty: 'Beginner Foundations & Tactics',
    bio: 'Patient structured training for players climbing from 800 to 1600 Elo.',
  },
];

interface TvChannel {
  id: string;
  label: string;
  variant: ChessVariant;
  white: string;
  black: string;
}

const TV_CHANNELS: TvChannel[] = [
  { id: 'tv-blitz', label: 'Top Blitz TV', variant: 'standard', white: 'GM_Aurelia (2640)', black: 'GM_Kenji (2615)' },
  { id: 'tv-960', label: 'Chess960 TV', variant: 'chess960', white: 'IM_Soren (2480)', black: 'Marcus_960 (2455)' },
  { id: 'tv-crazy', label: 'Crazyhouse TV', variant: 'crazyhouse', white: 'DropMaster (2390)', black: 'FM_Henrik (2375)' },
  { id: 'tv-atomic', label: 'Atomic TV', variant: 'atomic', white: 'AtomicWizard (2310)', black: 'BlastKing (2285)' },
];

interface StreamerInfo {
  id: string;
  handle: string;
  title: string;
  rating: number;
  viewers: number;
  topic: string;
  variant: ChessVariant;
  opponent: string;
}

const LIVE_STREAMERS: StreamerInfo[] = [
  {
    id: 'str-1',
    handle: 'GM_Aurelia_Live',
    title: 'GM',
    rating: 2640,
    viewers: 1420,
    topic: 'Titled Arena Speedrun · 3+0 Blitz & Post-Game Reviews',
    variant: 'standard',
    opponent: 'IM_Soren (2520)',
  },
  {
    id: 'str-2',
    handle: 'DropMaster960',
    title: 'FM',
    rating: 2390,
    viewers: 685,
    topic: 'Crazyhouse Tactics & Pocket Sacrifice Masterclass',
    variant: 'crazyhouse',
    opponent: 'EightVariants (2290)',
  },
  {
    id: 'str-3',
    handle: 'WGM_Elena_Endgames',
    title: 'WGM',
    rating: 2435,
    viewers: 510,
    topic: 'Viewer Challenges & Rook Endgame Clinic (5+3)',
    variant: 'standard',
    opponent: 'Marcus_960 (2180)',
  },
  {
    id: 'str-4',
    handle: 'AtomicWizard_TV',
    title: 'NM',
    rating: 2310,
    viewers: 340,
    topic: 'Atomic Opening Traps & Variant Arena Prep',
    variant: 'atomic',
    opponent: 'BlastKing (2260)',
  },
];

export const CommunityView: React.FC<CommunityViewProps> = ({
  prefs,
  games = [],
  userRatings,
  onChallengeStart,
  onSendToAnalysis,
}) => {
  const [subTab, setSubTab] = useState<CommSubTab>('tv');

  // ==================== LIVE TV STATE ====================
  const [channelIdx, setChannelIdx] = useState(0);
  const activeChannel = TV_CHANNELS[channelIdx];
  const [tvState, setTvState] = useState<BoardState>(() => createInitialState(activeChannel.variant));
  const [tvMoves, setTvMoves] = useState<Move[]>([]);
  const [tvFens, setTvFens] = useState<string[]>(() => [toFen(createInitialState(activeChannel.variant))]);
  const [tvEval, setTvEval] = useState(0);
  const [tvFlipped, setTvFlipped] = useState(false);

  // ==================== STREAMERS LIVE PREVIEW STATE ====================
  const [streamerIdx, setStreamerIdx] = useState(0);
  const activeStreamer = LIVE_STREAMERS[streamerIdx];
  const [streamState, setStreamState] = useState<BoardState>(() =>
    createInitialState(activeStreamer.variant)
  );
  const [streamMoves, setStreamMoves] = useState<Move[]>([]);
  const [streamFens, setStreamFens] = useState<string[]>(() => [
    toFen(createInitialState(activeStreamer.variant)),
  ]);
  const [streamEval, setStreamEval] = useState(0);
  const [streamFlipped, setStreamFlipped] = useState(false);

  useEffect(() => {
    const init = createInitialState(activeStreamer.variant);
    setStreamState(init);
    setStreamMoves([]);
    setStreamFens([toFen(init)]);
    setStreamEval(0);
  }, [activeStreamer]);

  useEffect(() => {
    if (subTab !== 'streamers') return;
    const id = window.setInterval(() => {
      setStreamState((prev) => {
        const term = evaluateGameResult(prev);
        if (term) {
          const fresh = createInitialState(activeStreamer.variant);
          setStreamMoves([]);
          setStreamFens([toFen(fresh)]);
          setStreamEval(0);
          return fresh;
        }
        const { move, evalCp } = findBestMove(prev, 4);
        if (!move) return prev;
        const res = makeMove(prev, move);
        setStreamMoves((m) => [...m, { ...move, san: res.san, uci: res.uci }]);
        setStreamFens((f) => [...f, toFen(res.next)]);
        setStreamEval(evalCp || evaluatePosition(res.next));
        return res.next;
      });
    }, 1250);
    return () => window.clearInterval(id);
  }, [subTab, activeStreamer.variant]);

  useEffect(() => {
    const init = createInitialState(activeChannel.variant);
    setTvState(init);
    setTvMoves([]);
    setTvFens([toFen(init)]);
    setTvEval(0);
  }, [activeChannel]);

  useEffect(() => {
    if (subTab !== 'tv') return;
    const id = window.setInterval(() => {
      setTvState((prev) => {
        const term = evaluateGameResult(prev);
        if (term) {
          const fresh = createInitialState(activeChannel.variant);
          setTvMoves([]);
          setTvFens([toFen(fresh)]);
          setTvEval(0);
          return fresh;
        }
        const { move, evalCp } = findBestMove(prev, 5);
        if (!move) return prev;
        const res = makeMove(prev, move);
        setTvMoves((m) => [...m, { ...move, san: res.san, uci: res.uci }]);
        setTvFens((f) => [...f, toFen(res.next)]);
        setTvEval(evalCp || evaluatePosition(res.next));
        return res.next;
      });
    }, 1150);
    return () => window.clearInterval(id);
  }, [subTab, activeChannel.variant]);

  // ==================== TEAMS STATE ====================
  const [teams, setTeams] = useState<Team[]>(() => {
    try {
      const raw = localStorage.getItem('caissa_teams_v1');
      if (raw) return JSON.parse(raw);
    } catch {
      // ignore
    }
    return INITIAL_TEAMS;
  });
  const [newTeamName, setNewTeamName] = useState('');
  const [newTeamDesc, setNewTeamDesc] = useState('');

  useEffect(() => {
    try {
      localStorage.setItem('caissa_teams_v1', JSON.stringify(teams));
    } catch {
      // ignore
    }
  }, [teams]);

  const createTeam = () => {
    if (!newTeamName.trim()) return;
    const t: Team = {
      id: `team-${Date.now()}`,
      name: newTeamName.trim(),
      members: 1,
      location: 'Open Club',
      description: newTeamDesc.trim() || 'Community-organized Caissa chess team.',
      joined: true,
      leader: prefs.username,
    };
    setTeams((prev) => [t, ...prev]);
    setNewTeamName('');
    setNewTeamDesc('');
  };

  // ==================== FORUM & BLOG STATE ====================
  const [posts, setPosts] = useState<ForumPost[]>(() => {
    try {
      const raw = localStorage.getItem('caissa_forum_v1');
      if (raw) return JSON.parse(raw);
    } catch {
      // ignore
    }
    return INITIAL_FORUM_POSTS;
  });
  const [postFilter, setPostFilter] = useState<'all' | 'blog' | 'forum'>('all');
  const [selectedPostId, setSelectedPostId] = useState<string>(INITIAL_FORUM_POSTS[0].id);
  const [replyText, setReplyText] = useState('');
  const [newPostTitle, setNewPostTitle] = useState('');
  const [newPostBody, setNewPostBody] = useState('');
  const [showNewPost, setShowNewPost] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem('caissa_forum_v1', JSON.stringify(posts));
    } catch {
      // ignore
    }
  }, [posts]);

  const filteredPosts = posts.filter((p) => {
    if (postFilter === 'blog') return p.isBlog;
    if (postFilter === 'forum') return !p.isBlog;
    return true;
  });
  const selectedPost = posts.find((p) => p.id === selectedPostId) || filteredPosts[0];

  const submitReply = () => {
    if (!selectedPost || !replyText.trim()) return;
    setPosts((prev) =>
      prev.map((p) =>
        p.id === selectedPost.id
          ? {
              ...p,
              replies: [
                ...p.replies,
                {
                  id: `rep-${Date.now()}`,
                  author: prefs.username,
                  text: replyText.trim(),
                  createdAt: new Date().toISOString().slice(0, 10),
                },
              ],
            }
          : p
      )
    );
    setReplyText('');
  };

  const createPost = () => {
    if (!newPostTitle.trim() || !newPostBody.trim()) return;
    const p: ForumPost = {
      id: `post-${Date.now()}`,
      category: 'General',
      title: newPostTitle.trim(),
      author: prefs.username,
      createdAt: new Date().toISOString().slice(0, 10),
      body: newPostBody.trim(),
      replies: [],
    };
    setPosts((prev) => [p, ...prev]);
    setSelectedPostId(p.id);
    setNewPostTitle('');
    setNewPostBody('');
    setShowNewPost(false);
  };

  // ==================== BROADCASTS, LEADERBOARD & COACHES STATE ====================
  const [broadcastEventIdx, setBroadcastEventIdx] = useState(0);
  const [broadcastBoardIdx, setBroadcastBoardIdx] = useState(0);
  const [broadcastPly, setBroadcastPly] = useState(0);
  const [broadcastFlipped, setBroadcastFlipped] = useState(false);

  const activeBroadcastEvent = BROADCAST_EVENTS[broadcastEventIdx] || BROADCAST_EVENTS[0];
  const activeBroadcastBoard =
    activeBroadcastEvent.boards[broadcastBoardIdx] || activeBroadcastEvent.boards[0];
  const parsedBroadcast = useMemo(
    () => parsePgn(activeBroadcastBoard.pgn),
    [activeBroadcastBoard.pgn]
  );

  useEffect(() => {
    setBroadcastPly(parsedBroadcast.moves.length);
  }, [parsedBroadcast]);

  const broadcastCurrentState = useMemo(() => {
    const fen =
      parsedBroadcast.fens[broadcastPly] ||
      parsedBroadcast.fens[parsedBroadcast.fens.length - 1];
    return parseFen(fen, 'standard');
  }, [parsedBroadcast, broadcastPly]);

  const broadcastEval = useMemo(
    () => evaluatePosition(broadcastCurrentState),
    [broadcastCurrentState]
  );

  const [leaderCategory, setLeaderCategory] = useState<RatingCategory>('blitz');
  const [playerSearch, setPlayerSearch] = useState('');
  const [coachSearch, setCoachSearch] = useState('');
  const [coachLang, setCoachLang] = useState('All');

  const isUserBot = isBotAccount({ name: prefs.username, isBot: prefs.isBot });

  const leaderboardRows = useMemo(() => {
    const userScore = userRatings ? userRatings[leaderCategory] : 1620;
    const baseOffsets: Record<RatingCategory, number> = {
      bullet: 120,
      blitz: 0,
      rapid: -40,
      classical: -80,
      chess960: -140,
    };
    const off = baseOffsets[leaderCategory];
    const entries = [
      { name: 'GM_Aurelia', title: 'GM', rating: 2740 + off, country: 'FR', isBot: false, isUser: false },
      { name: 'GM_Kenji', title: 'GM', rating: 2695 + off, country: 'JP', isBot: false, isUser: false },
      { name: 'IM_Soren', title: 'IM', rating: 2560 + off, country: 'SE', isBot: false, isUser: false },
      { name: 'WGM_Elena', title: 'WGM', rating: 2430 + off, country: 'DE', isBot: false, isUser: false },
      { name: 'Marcus_960', title: 'FM', rating: 2295 + off, country: 'US', isBot: false, isUser: false },
      { name: 'Elena_Tactics', title: '', rating: 1980 + off, country: 'IN', isBot: false, isUser: false },
      {
        name: prefs.username,
        title: isUserBot ? 'BOT' : '',
        rating: userScore,
        country: 'YOU',
        isBot: isUserBot,
        isUser: true,
      },
    ];
    const q = playerSearch.trim().toLowerCase();
    return entries
      .filter((e) => !isBotAccount(e))
      .sort((a, b) => b.rating - a.rating)
      .filter((e) => !q || e.name.toLowerCase().includes(q) || e.country.toLowerCase().includes(q));
  }, [leaderCategory, prefs.username, isUserBot, userRatings, playerSearch]);

  const handleExportAllGamesPgn = () => {
    if (games.length === 0) return;
    const bundle = games.map((g) => g.pgn).join('\n\n');
    const blob = new Blob([bundle], { type: 'application/x-chess-pgn' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${prefs.username}-all-games-${new Date().toISOString().slice(0, 10)}.pgn`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const userWdlStats = useMemo(() => {
    let w = 0;
    let d = 0;
    let l = 0;
    for (const g of games) {
      if (g.result === '1/2-1/2') d += 1;
      else if (g.userColor === 'w') g.result === '1-0' ? w++ : l++;
      else if (g.userColor === 'b') g.result === '0-1' ? w++ : l++;
      else w += 1;
    }
    const total = Math.max(1, w + d + l);
    return { w, d, l, total };
  }, [games]);

  // ==================== FRIENDS, MESSAGING & CHALLENGES ====================
  const [friends, setFriends] = useState<Friend[]>(INITIAL_FRIENDS);
  const [activeFriendId, setActiveFriendId] = useState<string>(INITIAL_FRIENDS[0].id);
  const [messages, setMessages] = useState<DirectMessage[]>(() => [
    {
      id: 'm1',
      friendId: 'fr-1',
      sender: 'them',
      text: 'Up for a 3+2 Blitz or Crazyhouse match later?',
      timestamp: '19:42',
    },
    {
      id: 'm2',
      friendId: 'fr-2',
      sender: 'them',
      text: 'Check out that Chess960 Arena starting soon!',
      timestamp: '20:10',
    },
  ]);
  const [chatInput, setChatInput] = useState('');
  const [challengeVariant, setChallengeVariant] = useState<ChessVariant>('standard');

  const activeFriend = friends.find((f) => f.id === activeFriendId) || friends[0];
  const friendMessages = messages.filter((m) => m.friendId === activeFriend.id);

  const openCoachMessage = (coach: CoachListing) => {
    const existing = friends.find((f) => f.id === coach.id);
    if (!existing) {
      setFriends((prev) => [
        {
          id: coach.id,
          name: coach.name,
          rating: coach.fide,
          title: coach.title,
          online: true,
          bio: `${coach.specialty} · ${coach.rate}`,
        },
        ...prev,
      ]);
      setMessages((prev) => [
        ...prev,
        {
          id: `dm-coach-${Date.now()}`,
          friendId: coach.id,
          sender: 'them',
          text: `Hello ${prefs.username}! Feel free to share a game or ask about ${coach.specialty}.`,
          timestamp: new Date().toTimeString().slice(0, 5),
        },
      ]);
    }
    setActiveFriendId(coach.id);
    setSubTab('friends');
  };

  const sendChatMessage = () => {
    if (!chatInput.trim()) return;
    const msg: DirectMessage = {
      id: `dm-${Date.now()}`,
      friendId: activeFriend.id,
      sender: 'me',
      text: chatInput.trim(),
      timestamp: new Date().toTimeString().slice(0, 5),
    };
    setMessages((prev) => [...prev, msg]);
    setChatInput('');

    window.setTimeout(() => {
      const reply: DirectMessage = {
        id: `dm-r-${Date.now()}`,
        friendId: activeFriend.id,
        sender: 'them',
        text: `Sounds good! Hit "Send Challenge" whenever you're ready to play.`,
        timestamp: new Date().toTimeString().slice(0, 5),
      };
      setMessages((prev) => [...prev, reply]);
    }, 650);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-stone-200 dark:border-zinc-800 pb-3">
        <div className="flex items-center gap-1 p-1 bg-stone-100 dark:bg-zinc-900 rounded-lg overflow-x-auto">
          {([
            ['tv', 'Live TV', Tv],
            ['streamers', 'Streamers', Radio],
            ['broadcasts', 'Broadcasts', Globe],
            ['players', 'Players & Ranks', Award],
            ['coaches', 'Coaches', GraduationCap],
            ['teams', 'Teams', Users],
            ['forum', 'Blog & Forum', Newspaper],
            ['friends', 'Friends & Messaging', MessageSquare],
          ] as const).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => setSubTab(id)}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                subTab === id
                  ? 'bg-white dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 shadow-sm'
                  : 'text-stone-600 dark:text-zinc-400 hover:text-stone-900 dark:hover:text-zinc-100'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ==================== STREAMERS DIRECTORY ==================== */}
      {subTab === 'streamers' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-5 space-y-3">
            <h2 className="text-base font-semibold text-stone-900 dark:text-zinc-100">
              Live Chess Streamers ({LIVE_STREAMERS.length} Online)
            </h2>
            {LIVE_STREAMERS.map((s, idx) => (
              <div
                key={s.id}
                className={`p-4 rounded-xl border transition-colors space-y-2 ${
                  idx === streamerIdx
                    ? 'border-emerald-600 bg-emerald-50/70 dark:bg-emerald-950/30'
                    : 'border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-bold text-stone-900 dark:text-zinc-100">
                    <span className="text-emerald-600 dark:text-emerald-400 mr-1.5">{s.title}</span>
                    {s.handle}
                    <span className="ml-1.5 font-mono text-xs font-normal text-stone-500">
                      ({s.rating})
                    </span>
                  </div>
                  <span className="text-[11px] font-mono tabular-nums text-red-600 dark:text-red-400 font-semibold">
                    LIVE · {s.viewers.toLocaleString()} watching
                  </span>
                </div>
                <p className="text-xs text-stone-600 dark:text-zinc-300 leading-relaxed">
                  {s.topic}
                </p>
                <div className="flex items-center justify-between pt-1">
                  <span className="text-[11px] text-stone-500 dark:text-zinc-400">
                    Playing {VARIANTS.find((v) => v.id === s.variant)?.name} vs {s.opponent}
                  </span>
                  <button
                    type="button"
                    onClick={() => setStreamerIdx(idx)}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 ${
                      idx === streamerIdx
                        ? 'bg-emerald-600 text-white'
                        : 'border border-stone-300 dark:border-zinc-700 text-stone-800 dark:text-zinc-200 hover:bg-stone-100 dark:hover:bg-zinc-800'
                    }`}
                  >
                    {idx === streamerIdx ? 'Watching' : 'Watch Stream'}
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="lg:col-span-7 flex flex-col items-center gap-3">
            <div className="w-full max-w-[540px] flex items-center justify-between px-3 py-2 rounded-lg bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 text-xs">
              <span className="font-semibold text-stone-900 dark:text-zinc-100">
                {streamFlipped ? `${activeStreamer.title} ${activeStreamer.handle}` : activeStreamer.opponent}
              </span>
              <span className="font-mono text-red-600 dark:text-red-400 font-semibold tabular-nums">
                LIVE · {activeStreamer.viewers.toLocaleString()} viewers
              </span>
            </div>

            <div className="w-full max-w-[540px] flex items-stretch justify-center gap-2.5">
              <EvalBar evalCp={streamEval} flipped={streamFlipped} />
              <ChessBoard
                state={streamState}
                interactive={false}
                flipped={streamFlipped}
                boardTheme={prefs.boardTheme}
                pieceSet={prefs.pieceSet}
                showCoordinates={prefs.showCoordinates}
                showLastMove={prefs.showLastMove ?? true}
                pieceScale={prefs.pieceScale || 'normal'}
                lastMove={
                  streamMoves.length > 0
                    ? {
                        from: streamMoves[streamMoves.length - 1].from,
                        to: streamMoves[streamMoves.length - 1].to,
                      }
                    : null
                }
              />
            </div>

            <div className="w-full max-w-[540px] flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-lg bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 text-xs">
              <span className="font-semibold text-stone-900 dark:text-zinc-100">
                {streamFlipped ? activeStreamer.opponent : `${activeStreamer.title} ${activeStreamer.handle} (${activeStreamer.rating})`}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setStreamFlipped((f) => !f)}
                  className="p-1.5 rounded border border-stone-200 dark:border-zinc-700 text-stone-600 dark:text-zinc-300 hover:bg-stone-100 dark:hover:bg-zinc-800"
                  title="Flip Board"
                >
                  <ArrowLeftRight className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onChallengeStart(activeStreamer.variant)}
                  className="px-3 py-1 rounded border border-stone-300 dark:border-zinc-700 text-stone-700 dark:text-zinc-200 font-medium"
                >
                  Play Same Variant
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onSendToAnalysis({
                      moves: streamMoves,
                      fens: streamFens,
                      variant: activeStreamer.variant,
                    })
                  }
                  className="px-3 py-1 rounded bg-emerald-600 text-white font-medium flex items-center gap-1 whitespace-nowrap shrink-0"
                >
                  <Microscope className="w-3.5 h-3.5" />
                  Open in Analysis
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================== TOURNAMENT BROADCASTS ==================== */}
      {subTab === 'broadcasts' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-4 space-y-4">
            <div className="space-y-2">
              <h2 className="text-base font-semibold text-stone-900 dark:text-zinc-100">
                Tournament Broadcasts
              </h2>
              {BROADCAST_EVENTS.map((ev, idx) => (
                <button
                  key={ev.id}
                  type="button"
                  onClick={() => {
                    setBroadcastEventIdx(idx);
                    setBroadcastBoardIdx(0);
                  }}
                  className={`w-full text-left p-3.5 rounded-xl border transition-colors ${
                    idx === broadcastEventIdx
                      ? 'border-emerald-600 bg-emerald-50/70 dark:bg-emerald-950/30'
                      : 'border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-stone-50 dark:hover:bg-zinc-800/50'
                  }`}
                >
                  <div className="text-sm font-semibold text-stone-900 dark:text-zinc-100">
                    {ev.name}
                  </div>
                  <div className="text-xs text-stone-500 dark:text-zinc-400 mt-0.5">
                    {ev.roundLabel} · {ev.location}
                  </div>
                </button>
              ))}
            </div>

            <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-4 space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-stone-500 dark:text-zinc-400">
                Featured Boards ({activeBroadcastEvent.roundLabel})
              </div>
              {activeBroadcastEvent.boards.map((b, idx) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setBroadcastBoardIdx(idx)}
                  className={`w-full text-left p-2.5 rounded-lg border text-xs flex items-center justify-between gap-2 ${
                    idx === broadcastBoardIdx
                      ? 'border-emerald-600 bg-emerald-50/60 dark:bg-emerald-950/30'
                      : 'border-stone-200 dark:border-zinc-800 hover:bg-stone-50 dark:hover:bg-zinc-800/50'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-stone-900 dark:text-zinc-100 truncate">
                      {b.white} ({b.whiteElo})
                    </div>
                    <div className="text-stone-600 dark:text-zinc-400 truncate">
                      {b.black} ({b.blackElo})
                    </div>
                  </div>
                  <span className="font-mono font-bold text-stone-800 dark:text-zinc-200 shrink-0">
                    {b.result}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="lg:col-span-8 flex flex-col items-center gap-3">
            <div className="w-full max-w-[560px] flex items-center justify-between px-3 py-2 rounded-lg bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 text-xs">
              <span className="font-semibold text-stone-900 dark:text-zinc-100">
                {broadcastFlipped
                  ? `${activeBroadcastBoard.white} (${activeBroadcastBoard.whiteElo})`
                  : `${activeBroadcastBoard.black} (${activeBroadcastBoard.blackElo})`}
              </span>
              <span className="font-mono text-stone-500 dark:text-zinc-400">
                {activeBroadcastEvent.name}
              </span>
            </div>

            <div className="w-full max-w-[560px] flex items-stretch justify-center gap-2.5">
              <EvalBar evalCp={broadcastEval} flipped={broadcastFlipped} />
              <ChessBoard
                state={broadcastCurrentState}
                interactive={false}
                flipped={broadcastFlipped}
                boardTheme={prefs.boardTheme}
                pieceSet={prefs.pieceSet}
                showCoordinates={prefs.showCoordinates}
                lastMove={
                  broadcastPly > 0 && parsedBroadcast.moves[broadcastPly - 1]
                    ? {
                        from: parsedBroadcast.moves[broadcastPly - 1].from,
                        to: parsedBroadcast.moves[broadcastPly - 1].to,
                      }
                    : null
                }
              />
            </div>

            <div className="w-full max-w-[560px] flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-lg bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 text-xs">
              <span className="font-semibold text-stone-900 dark:text-zinc-100">
                {broadcastFlipped
                  ? `${activeBroadcastBoard.black} (${activeBroadcastBoard.blackElo})`
                  : `${activeBroadcastBoard.white} (${activeBroadcastBoard.whiteElo})`}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setBroadcastFlipped((f) => !f)}
                  className="p-1.5 rounded border border-stone-200 dark:border-zinc-700 text-stone-600 dark:text-zinc-300"
                  title="Flip Board"
                >
                  <ArrowLeftRight className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setBroadcastPly((p) => Math.max(0, p - 1))}
                  disabled={broadcastPly === 0}
                  className="p-1.5 rounded border border-stone-200 dark:border-zinc-700 disabled:opacity-30"
                  title="Previous move"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <span className="font-mono tabular-nums px-1.5 text-stone-600 dark:text-zinc-300">
                  Ply {broadcastPly}/{parsedBroadcast.moves.length}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setBroadcastPly((p) => Math.min(parsedBroadcast.moves.length, p + 1))
                  }
                  disabled={broadcastPly >= parsedBroadcast.moves.length}
                  className="p-1.5 rounded border border-stone-200 dark:border-zinc-700 disabled:opacity-30"
                  title="Next move"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onSendToAnalysis({
                      moves: parsedBroadcast.moves,
                      fens: parsedBroadcast.fens,
                      variant: 'standard',
                    })
                  }
                  className="ml-1 px-3 py-1 rounded bg-emerald-600 text-white font-medium flex items-center gap-1 whitespace-nowrap shrink-0"
                >
                  <Microscope className="w-3.5 h-3.5" />
                  Open in Analysis
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================== LEADERBOARD & PLAYER PROFILE ==================== */}
      {subTab === 'players' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-6 bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-stone-900 dark:text-zinc-100">
                Top Players Leaderboard
              </h2>
              <div className="flex gap-1 p-1 bg-stone-100 dark:bg-zinc-800 rounded-lg text-xs overflow-x-auto">
                {(['bullet', 'blitz', 'rapid', 'classical', 'chess960'] as RatingCategory[]).map(
                  (cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setLeaderCategory(cat)}
                      className={`px-2.5 py-1 rounded font-medium capitalize whitespace-nowrap shrink-0 ${
                        leaderCategory === cat
                          ? 'bg-white dark:bg-zinc-900 text-stone-900 dark:text-zinc-100 shadow-sm'
                          : 'text-stone-500 dark:text-zinc-400'
                      }`}
                    >
                      {cat}
                    </button>
                  )
                )}
              </div>
            </div>

            <div className="relative">
              <Search className="w-3.5 h-3.5 text-stone-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={playerSearch}
                onChange={(e) => setPlayerSearch(e.target.value)}
                placeholder="Search player handle or country..."
                className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-950 text-xs text-stone-900 dark:text-zinc-100"
              />
            </div>

            <div className="text-[11px] text-stone-500 dark:text-zinc-400 flex items-center justify-between gap-2">
              <span>Human players only · Bots are not allowed in leaderboards</span>
            </div>

            {isUserBot && (
              <div className="px-3 py-2 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50/80 dark:bg-amber-950/30 text-xs text-amber-800 dark:text-amber-200">
                Your account (<span className="font-mono font-semibold">{prefs.username}</span>) is flagged as a BOT and is excluded from all leaderboards.
              </div>
            )}

            <div className="divide-y divide-stone-100 dark:divide-zinc-800">
              {leaderboardRows.map((row, idx) => (
                <div
                  key={`${row.name}-${idx}`}
                  className={`py-2.5 px-2.5 rounded flex items-center justify-between text-xs ${
                    row.isUser
                      ? 'bg-emerald-50/70 dark:bg-emerald-950/30 font-semibold'
                      : ''
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="font-mono tabular-nums text-stone-400 w-5">
                      #{idx + 1}
                    </span>
                    <span className="text-stone-900 dark:text-zinc-100 truncate">
                      {row.title ? `${row.title} ` : ''}
                      {row.name}
                    </span>
                    <span className="text-[11px] font-mono text-stone-400">{row.country}</span>
                  </div>
                  <span className="font-mono font-bold tabular-nums text-stone-900 dark:text-zinc-100">
                    {row.rating}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* User Profile & SVG Rating Progression Graph */}
          <div className="lg:col-span-6 bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold text-stone-900 dark:text-zinc-100 flex items-center gap-2">
                  <span>{prefs.username} · Player Profile</span>
                  {isUserBot && (
                    <span className="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-300 font-mono text-[10px] font-bold">
                      BOT
                    </span>
                  )}
                </h2>
                <p className="text-xs text-stone-500 dark:text-zinc-400">
                  {games.length} total recorded games · {userWdlStats.w}W / {userWdlStats.d}D / {userWdlStats.l}L
                  {isUserBot ? ' · Excluded from leaderboards' : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleExportAllGamesPgn}
                  disabled={games.length === 0}
                  className="px-2.5 py-1 rounded-lg border border-stone-200 dark:border-zinc-700 text-xs font-medium text-stone-700 dark:text-zinc-300 hover:bg-stone-100 dark:hover:bg-zinc-800 disabled:opacity-40 flex items-center gap-1 whitespace-nowrap shrink-0"
                  title="Download all your games as a PGN archive"
                >
                  <Download className="w-3.5 h-3.5" />
                  Export Games
                </button>
                <span className="font-mono text-sm font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                  {userRatings ? userRatings[leaderCategory] : 1620} Elo
                </span>
              </div>
            </div>

            <div className="grid grid-cols-5 gap-2 text-center">
              {(['bullet', 'blitz', 'rapid', 'classical', 'chess960'] as RatingCategory[]).map(
                (cat) => (
                  <div
                    key={cat}
                    className="p-2 rounded-lg bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800"
                  >
                    <div className="text-[10px] uppercase tracking-wider text-stone-500 dark:text-zinc-400">
                      {cat}
                    </div>
                    <div className="text-sm font-mono font-bold tabular-nums text-stone-900 dark:text-zinc-100 mt-0.5">
                      {userRatings ? userRatings[cat] : 1620}
                    </div>
                  </div>
                )
              )}
            </div>

            {/* W / D / L Distribution Bar */}
            <div className="space-y-1">
              <div className="text-xs font-medium text-stone-600 dark:text-zinc-400">
                Win / Draw / Loss Split
              </div>
              <div className="h-3 w-full rounded overflow-hidden flex border border-stone-200 dark:border-zinc-700">
                <div
                  style={{ width: `${(userWdlStats.w / userWdlStats.total) * 100}%` }}
                  className="bg-emerald-600"
                  title={`Wins: ${userWdlStats.w}`}
                />
                <div
                  style={{ width: `${(userWdlStats.d / userWdlStats.total) * 100}%` }}
                  className="bg-stone-400"
                  title={`Draws: ${userWdlStats.d}`}
                />
                <div
                  style={{ width: `${(userWdlStats.l / userWdlStats.total) * 100}%` }}
                  className="bg-red-500"
                  title={`Losses: ${userWdlStats.l}`}
                />
              </div>
            </div>

            {/* Rating Progression SVG Chart */}
            {(() => {
              const pts = (userRatings?.history || []).slice(-12);
              const vals = pts.length > 0 ? pts.map((p) => p.rating) : [1560, 1585, 1605, 1620];
              const minR = Math.min(...vals) - 25;
              const maxR = Math.max(...vals) + 25;
              const span = Math.max(10, maxR - minR);
              return (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-stone-500 dark:text-zinc-400">
                    <span>Rating Progression</span>
                    <span className="font-mono tabular-nums">
                      Range {Math.min(...vals)}–{Math.max(...vals)}
                    </span>
                  </div>
                  <div className="h-28 w-full rounded-lg bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 p-2">
                    <svg viewBox="0 0 240 80" className="w-full h-full" preserveAspectRatio="none">
                      <polyline
                        fill="none"
                        stroke="#059669"
                        strokeWidth="2.5"
                        points={vals
                          .map((r, i) => {
                            const x =
                              vals.length === 1 ? 120 : (i / (vals.length - 1)) * 224 + 8;
                            const y = 72 - ((r - minR) / span) * 62;
                            return `${x},${y}`;
                          })
                          .join(' ')}
                      />
                    </svg>
                  </div>
                </div>
              );
            })()}

            {/* Activity Timeline */}
            <div className="border-t border-stone-200 dark:border-zinc-800 pt-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-500 dark:text-zinc-400 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5" />
                  Recent Activity Timeline
                </h3>
                <span className="text-[11px] font-mono tabular-nums text-stone-400">
                  Latest {Math.min(6, games.length)} games
                </span>
              </div>
              <div className="divide-y divide-stone-100 dark:divide-zinc-800/80 max-h-56 overflow-y-auto thin-scroll">
                {games.length === 0 ? (
                  <p className="text-xs text-stone-400 py-3">
                    Play a rated game or tournament match to populate your activity feed.
                  </p>
                ) : (
                  games.slice(0, 6).map((g) => {
                    const userWon =
                      (g.userColor === 'w' && g.result === '1-0') ||
                      (g.userColor === 'b' && g.result === '0-1');
                    const isDraw = g.result === '1/2-1/2';
                    return (
                      <div
                        key={g.id}
                        className="py-2 flex items-center justify-between gap-3 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="font-medium text-stone-900 dark:text-zinc-100 truncate">
                            {g.white} vs {g.black}
                          </div>
                          <div className="text-[11px] text-stone-500 dark:text-zinc-400">
                            {g.date} · {g.timeControl} ·{' '}
                            <span
                              className={
                                isDraw
                                  ? 'text-stone-500 font-semibold'
                                  : userWon
                                  ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                                  : 'text-red-500 font-semibold'
                              }
                            >
                              {g.result} ({g.reason})
                            </span>
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
                          className="px-2.5 py-1 rounded border border-stone-200 dark:border-zinc-700 text-[11px] font-medium text-stone-700 dark:text-zinc-300 hover:bg-stone-100 dark:hover:bg-zinc-800 whitespace-nowrap shrink-0"
                        >
                          Analyze
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================== COACHES DIRECTORY ==================== */}
      {subTab === 'coaches' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-stone-900 dark:text-zinc-100">
                Titled Chess Coaches
              </h2>
              <p className="text-xs text-stone-500 dark:text-zinc-400">
                Filter FIDE-titled coaches by specialty or language and send a direct message.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={coachSearch}
                onChange={(e) => setCoachSearch(e.target.value)}
                placeholder="Search specialty or name..."
                className="px-3 py-1.5 rounded-lg border border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-950 text-xs"
              />
              <select
                value={coachLang}
                onChange={(e) => setCoachLang(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg border border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-950 text-xs"
              >
                {['All', 'English', 'French', 'German', 'Hindi', 'Spanish'].map((lang) => (
                  <option key={lang} value={lang}>
                    {lang === 'All' ? 'All Languages' : lang}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {COACHES.filter((c) => {
              const langOk = coachLang === 'All' || c.languages.includes(coachLang);
              const q = coachSearch.trim().toLowerCase();
              const qOk =
                !q ||
                c.name.toLowerCase().includes(q) ||
                c.specialty.toLowerCase().includes(q);
              return langOk && qOk;
            }).map((coach) => (
              <div
                key={coach.id}
                className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-5 flex flex-col justify-between gap-4"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-bold text-stone-900 dark:text-zinc-100">
                      <span className="text-emerald-600 dark:text-emerald-400 mr-1.5">
                        {coach.title}
                      </span>
                      {coach.name}
                    </h3>
                    <span className="font-mono text-xs font-semibold text-stone-700 dark:text-zinc-300 tabular-nums">
                      {coach.fide} FIDE · {coach.rate}
                    </span>
                  </div>
                  <div className="text-xs font-medium text-stone-700 dark:text-zinc-300">
                    {coach.specialty} · {coach.languages.join(', ')}
                  </div>
                  <p className="text-xs text-stone-500 dark:text-zinc-400 leading-relaxed">
                    {coach.bio}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => openCoachMessage(coach)}
                  className="self-start px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center gap-1.5"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  Message Coach
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ==================== LIVE TV ==================== */}
      {subTab === 'tv' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-4 space-y-2.5">
            <h2 className="text-base font-semibold text-stone-900 dark:text-zinc-100">
              Live Broadcast Channels
            </h2>
            {TV_CHANNELS.map((ch, idx) => (
              <button
                key={ch.id}
                type="button"
                onClick={() => setChannelIdx(idx)}
                className={`w-full text-left p-3.5 rounded-xl border transition-colors ${
                  idx === channelIdx
                    ? 'border-emerald-600 bg-emerald-50/70 dark:bg-emerald-950/30'
                    : 'border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-stone-50 dark:hover:bg-zinc-800/50'
                }`}
              >
                <div className="text-sm font-semibold text-stone-900 dark:text-zinc-100">
                  {ch.label}
                </div>
                <div className="text-xs text-stone-500 dark:text-zinc-400 mt-1">
                  {ch.white} vs {ch.black}
                </div>
              </button>
            ))}
          </div>

          <div className="lg:col-span-8 flex flex-col items-center gap-3">
            <div className="w-full max-w-[560px] flex items-center justify-between px-3 py-2 rounded-lg bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 text-xs">
              <span className="font-semibold text-stone-900 dark:text-zinc-100">
                {tvFlipped ? activeChannel.white : activeChannel.black}
              </span>
              <span className="text-stone-500 dark:text-zinc-400 font-mono">
                {activeChannel.label} · Move {tvState.fullmoveNumber}
              </span>
            </div>

            <div className="w-full max-w-[560px] flex items-stretch justify-center gap-2.5">
              <EvalBar evalCp={tvEval} flipped={tvFlipped} />
              <ChessBoard
                state={tvState}
                interactive={false}
                flipped={tvFlipped}
                boardTheme={prefs.boardTheme}
                pieceSet={prefs.pieceSet}
                showCoordinates={prefs.showCoordinates}
                lastMove={
                  tvMoves.length > 0
                    ? { from: tvMoves[tvMoves.length - 1].from, to: tvMoves[tvMoves.length - 1].to }
                    : null
                }
              />
            </div>

            <div className="w-full max-w-[560px] flex items-center justify-between px-3 py-2 rounded-lg bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 text-xs">
              <span className="font-semibold text-stone-900 dark:text-zinc-100">
                {tvFlipped ? activeChannel.black : activeChannel.white}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setTvFlipped((f) => !f)}
                  className="p-1.5 rounded border border-stone-200 dark:border-zinc-700 text-stone-600 dark:text-zinc-300"
                  title="Flip Board"
                >
                  <ArrowLeftRight className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onSendToAnalysis({
                      moves: tvMoves,
                      fens: tvFens,
                      variant: activeChannel.variant,
                    })
                  }
                  className="px-3 py-1 rounded bg-emerald-600 text-white font-medium flex items-center gap-1"
                >
                  <Microscope className="w-3.5 h-3.5" />
                  Analyze Live Game
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================== TEAMS ==================== */}
      {subTab === 'teams' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-8 space-y-3">
            {teams.map((team) => (
              <div
                key={team.id}
                className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4"
              >
                <div className="space-y-1 max-w-xl">
                  <div className="text-base font-bold text-stone-900 dark:text-zinc-100">
                    {team.name}
                  </div>
                  <div className="text-xs text-stone-500 dark:text-zinc-400">
                    {team.members.toLocaleString()} members · {team.location} · Leader: {team.leader}
                  </div>
                  <p className="text-xs text-stone-600 dark:text-zinc-300 pt-1">
                    {team.description}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setTeams((prev) =>
                      prev.map((t) =>
                        t.id === team.id
                          ? {
                              ...t,
                              joined: !t.joined,
                              members: t.joined ? t.members - 1 : t.members + 1,
                            }
                          : t
                      )
                    )
                  }
                  className={`px-4 py-2 rounded-lg text-xs font-semibold border ${
                    team.joined
                      ? 'border-stone-300 dark:border-zinc-700 text-stone-700 dark:text-zinc-300'
                      : 'border-emerald-600 bg-emerald-600 text-white'
                  }`}
                >
                  {team.joined ? 'Member (Leave)' : 'Join Team'}
                </button>
              </div>
            ))}
          </div>

          <div className="lg:col-span-4 bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-semibold text-stone-900 dark:text-zinc-100">
              Create New Team
            </h3>
            <input
              type="text"
              value={newTeamName}
              onChange={(e) => setNewTeamName(e.target.value)}
              placeholder="Team name..."
              className="w-full px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-950 text-xs"
            />
            <textarea
              rows={3}
              value={newTeamDesc}
              onChange={(e) => setNewTeamDesc(e.target.value)}
              placeholder="Team focus, weekly arenas, or description..."
              className="w-full px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-950 text-xs"
            />
            <button
              type="button"
              onClick={createTeam}
              className="w-full py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold flex items-center justify-center gap-1"
            >
              <Plus className="w-4 h-4" />
              Create Team
            </button>
          </div>
        </div>
      )}

      {/* ==================== BLOG & FORUM ==================== */}
      {subTab === 'forum' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex gap-1 p-1 bg-stone-100 dark:bg-zinc-900 rounded-lg text-xs">
                {(['all', 'blog', 'forum'] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setPostFilter(f)}
                    className={`px-2.5 py-1 rounded font-medium capitalize ${
                      postFilter === f
                        ? 'bg-white dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 shadow-sm'
                        : 'text-stone-500'
                    }`}
                  >
                    {f === 'all' ? 'All' : f === 'blog' ? 'Blog' : 'Forum'}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setShowNewPost((v) => !v)}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                New Topic
              </button>
            </div>

            {showNewPost && (
              <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-4 space-y-2.5">
                <input
                  type="text"
                  value={newPostTitle}
                  onChange={(e) => setNewPostTitle(e.target.value)}
                  placeholder="Topic title..."
                  className="w-full px-3 py-1.5 rounded-lg border border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-950 text-xs"
                />
                <textarea
                  rows={3}
                  value={newPostBody}
                  onChange={(e) => setNewPostBody(e.target.value)}
                  placeholder="Write your post..."
                  className="w-full px-3 py-1.5 rounded-lg border border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-950 text-xs"
                />
                <button
                  type="button"
                  onClick={createPost}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold"
                >
                  Publish Topic
                </button>
              </div>
            )}

            <div className="space-y-2">
              {filteredPosts.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedPostId(p.id)}
                  className={`w-full text-left p-3.5 rounded-xl border transition-colors ${
                    selectedPost?.id === p.id
                      ? 'border-emerald-600 bg-emerald-50/70 dark:bg-emerald-950/30'
                      : 'border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900'
                  }`}
                >
                  <div className="text-xs text-stone-500 dark:text-zinc-400">
                    {p.category} · {p.createdAt}
                  </div>
                  <div className="text-sm font-semibold text-stone-900 dark:text-zinc-100 mt-0.5">
                    {p.title}
                  </div>
                  <div className="text-xs text-stone-500 dark:text-zinc-400 mt-1">
                    By {p.author} · {p.replies.length} replies
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="lg:col-span-7">
            {selectedPost && (
              <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-6 space-y-5">
                <div>
                  <div className="text-xs text-stone-500 dark:text-zinc-400">
                    {selectedPost.category} · Published {selectedPost.createdAt} · By {selectedPost.author}
                  </div>
                  <h2 className="font-display text-xl font-bold text-stone-900 dark:text-zinc-100 mt-1">
                    {selectedPost.title}
                  </h2>
                </div>
                <p className="text-sm text-stone-700 dark:text-zinc-300 leading-relaxed">
                  {selectedPost.body}
                </p>

                <div className="border-t border-stone-200 dark:border-zinc-800 pt-4 space-y-3">
                  <h3 className="text-xs font-semibold text-stone-600 dark:text-zinc-400">
                    Replies ({selectedPost.replies.length})
                  </h3>
                  {selectedPost.replies.map((rep) => (
                    <div
                      key={rep.id}
                      className="p-3 rounded-lg bg-stone-50 dark:bg-zinc-950 border border-stone-100 dark:border-zinc-800 text-xs space-y-1"
                    >
                      <div className="font-semibold text-stone-900 dark:text-zinc-100">
                        {rep.author}{' '}
                        <span className="font-normal text-stone-400 ml-1">{rep.createdAt}</span>
                      </div>
                      <p className="text-stone-700 dark:text-zinc-300">{rep.text}</p>
                    </div>
                  ))}
                  <div className="flex gap-2 pt-2">
                    <input
                      type="text"
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder="Write a reply..."
                      className="flex-1 px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-950 text-xs"
                    />
                    <button
                      type="button"
                      onClick={submitReply}
                      className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold"
                    >
                      Reply
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================== FRIENDS, MESSAGING & CHALLENGES ==================== */}
      {subTab === 'friends' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-4 space-y-2.5">
            <h2 className="text-base font-semibold text-stone-900 dark:text-zinc-100">
              Friends & Clubmates
            </h2>
            {friends.map((fr) => (
              <button
                key={fr.id}
                type="button"
                onClick={() => setActiveFriendId(fr.id)}
                className={`w-full text-left p-3.5 rounded-xl border transition-colors ${
                  activeFriend.id === fr.id
                    ? 'border-emerald-600 bg-emerald-50/70 dark:bg-emerald-950/30'
                    : 'border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-stone-900 dark:text-zinc-100">
                    {fr.title ? `${fr.title} ` : ''}
                    {fr.name}
                  </span>
                  <span className="font-mono text-xs text-stone-500 dark:text-zinc-400">
                    {fr.rating}
                  </span>
                </div>
                <div className="text-xs text-stone-500 dark:text-zinc-400 mt-0.5">
                  {fr.online ? 'Online' : 'Offline'} · {fr.bio}
                </div>
              </button>
            ))}
          </div>

          <div className="lg:col-span-8 bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 dark:border-zinc-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-stone-900 dark:text-zinc-100">
                  {activeFriend.name} ({activeFriend.rating})
                </h3>
                <p className="text-xs text-stone-500 dark:text-zinc-400">{activeFriend.bio}</p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={challengeVariant}
                  onChange={(e) => setChallengeVariant(e.target.value as ChessVariant)}
                  className="px-2.5 py-1.5 rounded-lg border border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-xs"
                >
                  {VARIANTS.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => onChallengeStart(challengeVariant)}
                  className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center gap-1.5"
                >
                  <Swords className="w-3.5 h-3.5" />
                  Send Challenge
                </button>
              </div>
            </div>

            <div className="h-64 overflow-y-auto thin-scroll space-y-2 p-3 rounded-lg bg-stone-50 dark:bg-zinc-950 border border-stone-100 dark:border-zinc-800">
              {friendMessages.length === 0 ? (
                <p className="text-xs text-stone-400 text-center py-8">
                  Start a conversation or send a match challenge to {activeFriend.name}.
                </p>
              ) : (
                friendMessages.map((m) => (
                  <div
                    key={m.id}
                    className={`flex ${m.sender === 'me' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[75%] px-3 py-2 rounded-xl text-xs ${
                        m.sender === 'me'
                          ? 'bg-emerald-600 text-white'
                          : 'bg-white dark:bg-zinc-800 border border-stone-200 dark:border-zinc-700 text-stone-800 dark:text-zinc-200'
                      }`}
                    >
                      <div>{m.text}</div>
                      <div className="text-[10px] opacity-70 mt-0.5 text-right">{m.timestamp}</div>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') sendChatMessage();
                }}
                placeholder={`Message ${activeFriend.name}...`}
                className="flex-1 px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-950 text-xs"
              />
              <button
                type="button"
                onClick={sendChatMessage}
                className="px-4 py-2 rounded-lg bg-stone-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-semibold flex items-center gap-1.5"
              >
                <Send className="w-3.5 h-3.5" />
                Send
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
