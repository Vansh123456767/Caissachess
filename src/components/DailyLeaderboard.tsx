import React, { useMemo, useState } from 'react';
import { Award, Flame, RotateCcw, User } from 'lucide-react';
import { isBotAccount } from '../utils/botFilter';

export interface DailyLeaderboardEntry {
  id: string;
  name: string;
  isBot?: boolean;
  solvedToday: number;
  totalSolved: number;
  currentStreak: number;
  bestStreak: number;
  lastUpdatedDate: string;
}

export const LEADERBOARD_STORAGE_KEY = 'caissa_daily_leaderboard_v1';

export function buildSeedLeaderboard(_dateKey: string): DailyLeaderboardEntry[] {
  return [];
}

function isHumanLeaderboardEntry(entry: DailyLeaderboardEntry): boolean {
  if (!entry || isBotAccount(entry)) return false;
  if (typeof entry.id === 'string' && entry.id.startsWith('club-')) return false;
  return true;
}

export function loadLeaderboard(
  dateKey: string,
  username: string,
  isCurrentUserBot = false
): DailyLeaderboardEntry[] {
  const userBlockedAsBot = isCurrentUserBot || isBotAccount({ name: username });
  try {
    const raw = localStorage.getItem(LEADERBOARD_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DailyLeaderboardEntry[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        // Reset daily counters for previous day and strictly exclude bot/seeded NPC entries
        const normalized = parsed
          .filter(isHumanLeaderboardEntry)
          .map((entry) =>
            entry.lastUpdatedDate === dateKey
              ? entry
              : { ...entry, solvedToday: 0, lastUpdatedDate: dateKey }
          );
        const hasUser = normalized.some(
          (e) => e.name.toLowerCase() === username.toLowerCase()
        );
        if (!hasUser && !userBlockedAsBot) {
          normalized.push({
            id: `user-${username.toLowerCase()}`,
            name: username,
            solvedToday: 0,
            totalSolved: 0,
            currentStreak: 0,
            bestStreak: 0,
            lastUpdatedDate: dateKey,
          });
        }
        return normalized;
      }
    }
  } catch {
    // ignore storage parse failures
  }

  const seeded: DailyLeaderboardEntry[] = [];
  if (!userBlockedAsBot) {
    seeded.push({
      id: `user-${username.toLowerCase()}`,
      name: username,
      solvedToday: 0,
      totalSolved: 0,
      currentStreak: 0,
      bestStreak: 0,
      lastUpdatedDate: dateKey,
    });
  }
  return seeded;
}

export function saveLeaderboard(entries: DailyLeaderboardEntry[]): void {
  try {
    const clean = entries.filter(isHumanLeaderboardEntry);
    localStorage.setItem(LEADERBOARD_STORAGE_KEY, JSON.stringify(clean));
  } catch {
    // ignore quota errors
  }
}

interface DailyLeaderboardProps {
  entries: DailyLeaderboardEntry[];
  currentUsername: string;
  isCurrentUserBot?: boolean;
  dateKey: string;
  onResetUserStats: () => void;
}

type SortMetric = 'solved' | 'streak';

export const DailyLeaderboard: React.FC<DailyLeaderboardProps> = ({
  entries,
  currentUsername,
  isCurrentUserBot = false,
  dateKey,
  onResetUserStats,
}) => {
  const [sortBy, setSortBy] = useState<SortMetric>('solved');

  const rankedAll = useMemo(() => {
    const normalized = entries
      .filter(isHumanLeaderboardEntry)
      .map((e) => (e.lastUpdatedDate === dateKey ? e : { ...e, solvedToday: 0 }));
    return normalized.sort((a, b) => {
      if (sortBy === 'streak') {
        return (
          b.bestStreak - a.bestStreak ||
          b.currentStreak - a.currentStreak ||
          b.solvedToday - a.solvedToday
        );
      }
      return (
        b.solvedToday - a.solvedToday ||
        b.currentStreak - a.currentStreak ||
        b.totalSolved - a.totalSolved
      );
    });
  }, [entries, dateKey, sortBy]);

  const topFive = rankedAll.slice(0, 5);
  const userRankIdx = isCurrentUserBot
    ? -1
    : rankedAll.findIndex((e) => e.name.toLowerCase() === currentUsername.toLowerCase());
  const userEntry = userRankIdx >= 0 ? rankedAll[userRankIdx] : null;
  const userInTopFive = userRankIdx >= 0 && userRankIdx < 5;

  return (
    <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Award className="w-4 h-4 text-emerald-600" />
          <h3 className="text-sm font-semibold text-stone-900 dark:text-zinc-100">
            Daily Leaderboard · Top 5
          </h3>
        </div>

        <div className="flex items-center gap-1 p-1 bg-stone-100 dark:bg-zinc-800 rounded-lg text-xs">
          <button
            type="button"
            onClick={() => setSortBy('solved')}
            className={`px-2.5 py-1 rounded font-medium transition-colors ${
              sortBy === 'solved'
                ? 'bg-white dark:bg-zinc-900 text-stone-900 dark:text-zinc-100 shadow-sm'
                : 'text-stone-600 dark:text-zinc-400 hover:text-stone-900 dark:hover:text-zinc-100'
            }`}
          >
            Solved
          </button>
          <button
            type="button"
            onClick={() => setSortBy('streak')}
            className={`px-2.5 py-1 rounded font-medium transition-colors ${
              sortBy === 'streak'
                ? 'bg-white dark:bg-zinc-900 text-stone-900 dark:text-zinc-100 shadow-sm'
                : 'text-stone-600 dark:text-zinc-400 hover:text-stone-900 dark:hover:text-zinc-100'
            }`}
          >
            Streaks
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs text-left">
          <thead>
            <tr className="border-b border-stone-200 dark:border-zinc-800 text-stone-500 dark:text-zinc-400">
              <th className="py-2 pr-2 font-medium w-8">#</th>
              <th className="py-2 pr-3 font-medium">Player</th>
              <th className="py-2 pr-3 font-medium text-right">Today</th>
              <th className="py-2 font-medium text-right">Streak (Best)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100 dark:divide-zinc-800/70">
            {topFive.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-4 text-center text-xs text-stone-500 dark:text-zinc-400">
                  No human players on the daily leaderboard yet.
                </td>
              </tr>
            ) : (
              topFive.map((row, idx) => {
                const isUser = row.name.toLowerCase() === currentUsername.toLowerCase();
                const isGuest = row.name.trim().toLowerCase() === 'anonymous';
                return (
                  <tr
                    key={row.id}
                    className={
                      isUser
                        ? 'bg-emerald-50/70 dark:bg-emerald-950/25 font-semibold'
                        : ''
                    }
                  >
                    <td className="py-2.5 pr-2 font-mono text-stone-500 dark:text-zinc-400">
                      {idx + 1}
                    </td>
                    <td className="py-2.5 pr-3 text-stone-900 dark:text-zinc-100 max-w-[180px]">
                      <div className="flex items-center gap-1.5 min-w-0">
                        {isGuest && (
                          <User
                            className="w-3.5 h-3.5 text-stone-400 dark:text-zinc-500 shrink-0"
                            aria-label="Unregistered guest player"
                          />
                        )}
                        <span
                          className={`truncate ${
                            isGuest ? 'text-stone-700 dark:text-zinc-300 italic' : ''
                          }`}
                        >
                          {row.name}
                        </span>
                        {isGuest && (
                          <span
                            className="px-1.5 py-0.5 rounded border border-stone-200 dark:border-zinc-700 bg-stone-100 dark:bg-zinc-800 text-stone-600 dark:text-zinc-300 text-[10px] font-medium shrink-0"
                            title="Unregistered player without an account"
                          >
                            Guest
                          </span>
                        )}
                        {isUser && (
                          <span className="text-[11px] font-normal text-emerald-700 dark:text-emerald-400 shrink-0">
                            · You
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 pr-3 text-right font-mono text-stone-800 dark:text-zinc-200">
                      {row.solvedToday}
                    </td>
                    <td className="py-2.5 text-right font-mono text-stone-700 dark:text-zinc-300">
                      <span className="inline-flex items-center justify-end gap-1">
                        <Flame className="w-3 h-3 text-amber-500" />
                        {row.currentStreak} ({row.bestStreak})
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Show current user's standing below if outside Top 5 */}
      {userEntry && !userInTopFive && (
        <div className="pt-2 border-t border-stone-100 dark:border-zinc-800 flex items-center justify-between text-xs text-stone-600 dark:text-zinc-400">
          <span className="inline-flex items-center gap-1.5">
            Your rank: <strong className="font-mono text-stone-900 dark:text-zinc-100">#{userRankIdx + 1}</strong> ·{' '}
            {userEntry.name.trim().toLowerCase() === 'anonymous' && (
              <User className="w-3.5 h-3.5 text-stone-400 dark:text-zinc-500" aria-hidden="true" />
            )}
            <span>{userEntry.name}</span>
            {userEntry.name.trim().toLowerCase() === 'anonymous' && (
              <span className="px-1.5 py-0.5 rounded border border-stone-200 dark:border-zinc-700 bg-stone-100 dark:bg-zinc-800 text-stone-600 dark:text-zinc-300 text-[10px] font-medium">
                Guest
              </span>
            )}
          </span>
          <span className="font-mono">
            {userEntry.solvedToday} solved · {userEntry.currentStreak} ({userEntry.bestStreak}) streak
          </span>
        </div>
      )}

      {isCurrentUserBot && (
        <div className="px-3 py-2 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50/80 dark:bg-amber-950/30 text-[11px] text-amber-800 dark:text-amber-200">
          BOT accounts are excluded from Daily Leaderboards.
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] text-stone-500 dark:text-zinc-400">
        <span>Human players only · Bots excluded · {dateKey}</span>
        {!isCurrentUserBot && (
          <button
            type="button"
            onClick={onResetUserStats}
            className="inline-flex items-center gap-1 hover:text-stone-900 dark:hover:text-zinc-200 transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            Reset My Stats
          </button>
        )}
      </div>
    </div>
  );
};
