import React, { useEffect, useState } from 'react';
import {
  BoardState,
  ChessVariant,
  DirectMessage,
  ForumPost,
  Friend,
  Move,
  Team,
  UserPreferences,
} from '../types/chess';
import {
  createInitialState,
  evaluateGameResult,
  makeMove,
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
import {
  MessageSquare,
  Microscope,
  Newspaper,
  Plus,
  Send,
  Swords,
  Tv,
  Users,
} from 'lucide-react';

interface CommunityViewProps {
  prefs: UserPreferences;
  onChallengeStart: (variant: ChessVariant) => void;
  onSendToAnalysis: (payload: { moves: Move[]; fens: string[]; variant: ChessVariant }) => void;
}

type CommSubTab = 'tv' | 'teams' | 'forum' | 'friends';

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

export const CommunityView: React.FC<CommunityViewProps> = ({
  prefs,
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

  // ==================== FRIENDS, MESSAGING & CHALLENGES ====================
  const [friends] = useState<Friend[]>(INITIAL_FRIENDS);
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
                {activeChannel.black}
              </span>
              <span className="text-stone-500 dark:text-zinc-400 font-mono">
                {activeChannel.label} · Move {tvState.fullmoveNumber}
              </span>
            </div>

            <div className="w-full max-w-[560px] flex items-stretch justify-center gap-2.5">
              <EvalBar evalCp={tvEval} />
              <ChessBoard
                state={tvState}
                interactive={false}
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
                {activeChannel.white}
              </span>
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
