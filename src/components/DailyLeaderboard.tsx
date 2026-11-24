import React, { useMemo, useState } from 'react';
import { Award, Flame, RotateCcw } from 'lucide-react';

export interface DailyLeaderboardEntry {
  id: string;
  name: string;
  solvedToday: number;
  totalSolved: number;
  currentStreak: number;
  bestStreak: number;
  lastUpdatedDate: string;
}

export const LEADERBOARD_STORAGE_KEY = 'caissa_daily_leaderboard_v1';

export function buildSeedLeaderboard(dateKey: string): DailyLeaderboardEntry[] {
  return [
    {
      id: 'club-gm-aurelia',
      name: 'GM_Aurelia',
      solvedToday: 14,
      totalSolved: 186,
      currentStreak: 11,
      bestStreak: 19,
      lastUpdatedDate: dateKey,
    },
    {
      id: 'club-marcus-960',
      name: 'Marcus_960',
      solvedToday: 9,
      totalSolved: 124,
      currentStreak: 7,
      bestStreak: 14,
      lastUpdatedDate: dateKey,
    },
    {
      id: 'club-elena-tactics',
      name: 'Elena_Tactics',
      solvedToday: 6,
      totalSolved: 98,
      currentStreak: 5,
      bestStreak: 12,
      lastUpdatedDate: dateKey,
    },
    {
      id: 'club-sora',
      name: 'Sora_Correspondence',
      solvedToday: 4,
      totalSolved: 71,
      currentStreak: 3,
      bestStreak: 9,
      lastUpdatedDate: dateKey,
    },
    {
      id: 'club-aria',
      name: 'Aria_Club',
      solvedToday: 2,
      totalSolved: 43,
      currentStreak: 2,
      bestStreak: 6,
      lastUpdatedDate: dateKey,
    },
  ];
}

export function loadLeaderboard(dateKey: string, username: string): DailyLeaderboardEntry[] {
  try {
    const raw = localStorage.getItem(LEADERBOARD_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DailyLeaderboardEntry[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        // Reset daily counters for entries from a previous calendar day
        const normalized = parsed.map((entry) =>
          entry.lastUpdatedDate === dateKey
            ? entry
            : { ...entry, solvedToday: 0, lastUpdatedDate: dateKey }
        );
        const hasUser = normalized.some(
          (e) => e.name.toLowerCase() === username.toLowerCase()
        );
        if (!hasUser) {
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

  const seeded = buildSeedLeaderboard(dateKey);
  if (!seeded.some((e) => e.name.toLowerCase() === username.toLowerCase())) {
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
    localStorage.setItem(LEADERBOARD_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // ignore quota errors
  }
}

interface DailyLeaderboardProps {
  entries: DailyLeaderboardEntry[];
  currentUsername: string;
  dateKey: string;
  onResetUserStats: () => void;
}

type SortMetric = 'solved' | 'streak';

export const DailyLeaderboard: React.FC<DailyLeaderboardProps> = ({
  entries,
  currentUsername,
  dateKey,
  onResetUserStats,
}) => {
  const [sortBy, setSortBy] = useState<SortMetric>('solved');

  const rankedAll = useMemo(() => {
    const normalized = entries.map((e) =>
      e.lastUpdatedDate === dateKey ? e : { ...e, solvedToday: 0 }
    );
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
  const userRankIdx = rankedAll.findIndex(
    (e) => e.name.toLowerCase() === currentUsername.toLowerCase()
  );
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
            {topFive.map((row, idx) => {
              const isUser = row.name.toLowerCase() === currentUsername.toLowerCase();
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
                  <td className="py-2.5 pr-3 text-stone-900 dark:text-zinc-100 truncate max-w-[150px]">
                    {row.name}
                    {isUser && (
                      <span className="ml-1.5 text-[11px] font-normal text-emerald-700 dark:text-emerald-400">
                        · You
                      </span>
                    )}
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
            })}
          </tbody>
        </table>
      </div>

      {/* Show current user's standing below if outside Top 5 */}
      {userEntry && !userInTopFive && (
        <div className="pt-2 border-t border-stone-100 dark:border-zinc-800 flex items-center justify-between text-xs text-stone-600 dark:text-zinc-400">
          <span>
            Your rank: <strong className="font-mono text-stone-900 dark:text-zinc-100">#{userRankIdx + 1}</strong> · {userEntry.name}
          </span>
          <span className="font-mono">
            {userEntry.solvedToday} solved · {userEntry.currentStreak} ({userEntry.bestStreak}) streak
          </span>
        </div>
      )}

      <div className="flex items-center justify-between pt-1 text-[11px] text-stone-500 dark:text-zinc-400">
        <span>Saved locally for {dateKey}</span>
        <button
          type="button"
          onClick={onResetUserStats}
          className="inline-flex items-center gap-1 hover:text-stone-900 dark:hover:text-zinc-200 transition-colors"
        >
          <RotateCcw className="w-3 h-3" />
          Reset My Stats
        </button>
      </div>
    </div>
  );
};
