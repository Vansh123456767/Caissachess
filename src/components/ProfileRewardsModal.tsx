import React from 'react';
import {
  getLevelFromXp,
  ProgressionState,
  saveProgressionState,
  TROPHY_CATALOG,
} from '../data/progression';
import {
  Award,
  Brain,
  Check,
  Compass,
  Crown,
  Flame,
  Shield,
  Sparkles,
  Swords,
  Trophy,
  X,
} from 'lucide-react';

interface ProfileRewardsModalProps {
  open: boolean;
  onClose: () => void;
  progression: ProgressionState;
  onUpdateProgression: (next: ProgressionState) => void;
  dailyStreak: number;
  username: string;
}

export const ProfileRewardsModal: React.FC<ProfileRewardsModalProps> = ({
  open,
  onClose,
  progression,
  onUpdateProgression,
  dailyStreak,
  username,
}) => {
  if (!open) return null;

  const { level, intoLevel, needed } = getLevelFromXp(progression.xp);
  const xpPct = Math.min(100, Math.round((intoLevel / needed) * 100));

  const renderTrophyIcon = (icon: string, unlocked: boolean) => {
    const cls = `w-5 h-5 ${unlocked ? 'text-amber-500' : 'text-stone-400 dark:text-zinc-600'}`;
    switch (icon) {
      case 'swords':
        return <Swords className={cls} />;
      case 'brain':
        return <Brain className={cls} />;
      case 'compass':
        return <Compass className={cls} />;
      case 'crown':
        return <Crown className={cls} />;
      case 'flame':
        return <Flame className={cls} />;
      case 'shield':
        return <Shield className={cls} />;
      default:
        return <Trophy className={cls} />;
    }
  };

  const handleEquipTitle = (title: string) => {
    const next: ProgressionState = {
      ...progression,
      equippedTitle: progression.equippedTitle === title ? '' : title,
    };
    saveProgressionState(next);
    onUpdateProgression(next);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-zinc-950/60 backdrop-blur-xs flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto thin-scroll bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-6 space-y-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-stone-200 dark:border-zinc-800 pb-3">
          <div className="flex items-center gap-2.5">
            <Award className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            <div>
              <h2 className="text-lg font-bold text-stone-900 dark:text-zinc-100">
                Player Progression, Quests & Trophy Case
              </h2>
              <p className="text-xs text-stone-500 dark:text-zinc-400">
                {username} {progression.equippedTitle ? `· "${progression.equippedTitle}"` : ''}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-stone-100 dark:hover:bg-zinc-800 text-stone-500"
            aria-label="Close rewards modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* XP Level + Streak Shields Summary */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2 p-4 rounded-xl bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-stone-900 dark:text-zinc-100">
                Level {level} Strategist
              </span>
              <span className="font-mono text-stone-500 dark:text-zinc-400">
                {progression.xp} XP total ({intoLevel}/{needed} to Lv.{level + 1})
              </span>
            </div>
            <div className="h-2.5 rounded-full bg-stone-200 dark:bg-zinc-800 overflow-hidden">
              <div
                className="h-full bg-emerald-600 transition-all duration-300"
                style={{ width: `${xpPct}%` }}
              />
            </div>
            <div className="flex flex-wrap gap-3 text-[11px] text-stone-500 dark:text-zinc-400 pt-1">
              <span>Games: {progression.gamesPlayed}</span>
              <span>Wins: {progression.gamesWon}</span>
              <span>Puzzles: {progression.puzzlesSolved}</span>
              <span>Bosses Slain: {progression.defeatedBossIds.length}/4</span>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/70 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-amber-900 dark:text-amber-200 flex items-center gap-1.5">
                <Shield className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                Streak Shields
              </span>
              <span className="font-mono text-lg font-bold text-amber-700 dark:text-amber-300">
                {progression.streakShields}
              </span>
            </div>
            <p className="text-[11px] text-amber-800/80 dark:text-amber-300/80 leading-snug mt-1">
              Automatically protects your {dailyStreak}-day login streak if you miss a day. Earn more from Daily Quests!
            </p>
          </div>
        </div>

        {/* Daily Quests */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-stone-500 dark:text-zinc-400 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
              Daily Quests
            </h3>
            <span className="text-[11px] text-stone-500 dark:text-zinc-400">
              Resets daily ({progression.questsDate})
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {progression.quests.map((q) => {
              const pct = Math.min(100, Math.round((q.progress / q.target) * 100));
              return (
                <div
                  key={q.id}
                  className={`p-3 rounded-lg border text-xs space-y-1.5 ${
                    q.claimed
                      ? 'border-emerald-500/60 bg-emerald-50/60 dark:bg-emerald-950/25'
                      : 'border-stone-200 dark:border-zinc-800 bg-stone-50 dark:bg-zinc-950'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-stone-800 dark:text-zinc-200">
                      {q.title}
                    </span>
                    <span className="font-mono text-[11px] text-emerald-600 dark:text-emerald-400 shrink-0">
                      {q.claimed ? 'Completed' : `+${q.xpReward} XP`}
                      {!q.claimed && q.shieldReward > 0 ? ` +${q.shieldReward} Shield` : ''}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 rounded-full bg-stone-200 dark:bg-zinc-800 overflow-hidden">
                      <div
                        className="h-full bg-emerald-600 transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="font-mono text-[11px] text-stone-500">
                      {q.progress}/{q.target}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Unlockable Titles */}
        <div className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-stone-500 dark:text-zinc-400">
            Unlockable Player Titles
          </h3>
          {progression.unlockedTitles.length === 0 ? (
            <p className="text-xs text-stone-500 dark:text-zinc-400">
              Unlock trophies below to earn custom player titles.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {progression.unlockedTitles.map((title) => {
                const active = progression.equippedTitle === title;
                return (
                  <button
                    key={title}
                    type="button"
                    onClick={() => handleEquipTitle(title)}
                    className={`px-3 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                      active
                        ? 'border-emerald-600 bg-emerald-600 text-white'
                        : 'border-stone-200 dark:border-zinc-800 bg-stone-50 dark:bg-zinc-950 text-stone-700 dark:text-zinc-300 hover:border-emerald-500'
                    }`}
                  >
                    {active && <Check className="w-3.5 h-3.5" />}
                    {title}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Trophy Case */}
        <div className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-stone-500 dark:text-zinc-400">
            Trophy Case ({progression.unlockedTrophies.length}/{TROPHY_CATALOG.length})
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {TROPHY_CATALOG.map((trophy) => {
              const unlocked = progression.unlockedTrophies.includes(trophy.id);
              return (
                <div
                  key={trophy.id}
                  className={`p-3 rounded-lg border flex items-start gap-3 ${
                    unlocked
                      ? 'border-amber-300 dark:border-amber-700/70 bg-amber-50/40 dark:bg-amber-950/20'
                      : 'border-stone-200 dark:border-zinc-800 bg-stone-50/60 dark:bg-zinc-950/60 opacity-70'
                  }`}
                >
                  <div className="p-2 rounded-lg bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 shrink-0">
                    {renderTrophyIcon(trophy.icon, unlocked)}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-stone-900 dark:text-zinc-100">
                        {trophy.title}
                      </span>
                      {unlocked && (
                        <span className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
                          Unlocked
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-stone-600 dark:text-zinc-400 mt-0.5">
                      {trophy.description}
                    </p>
                    <p className="text-[10px] text-amber-700 dark:text-amber-400 font-medium mt-1">
                      Title: {trophy.unlockTitle}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
