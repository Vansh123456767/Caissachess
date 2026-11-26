import React from 'react';
import {
  BgThemeId,
  BoardThemeId,
  LanguageCode,
  MoveMethodId,
  PieceSetId,
  SoundThemeId,
  UserPreferences,
} from '../types/chess';
import { LANGUAGES } from '../data/i18n';
import { BOARD_THEMES } from './ChessBoard';
import { ChessPiece } from './ChessPiece';
import { soundFX } from '../utils/sound';
import { Moon, Sun, Volume2, VolumeX, X } from 'lucide-react';

interface PreferencesModalProps {
  open: boolean;
  onClose: () => void;
  prefs: UserPreferences;
  onChange: (next: UserPreferences) => void;
}

const PIECE_SETS: { id: PieceSetId; label: string }[] = [
  { id: 'classic', label: 'Classic Staunton' },
  { id: 'neo', label: 'Neo Slate' },
  { id: 'alpha', label: 'Warm Alpha' },
  { id: 'minimal', label: 'Minimalist' },
];

const BG_THEMES: { id: BgThemeId; label: string }[] = [
  { id: 'clean', label: 'Clean Studio' },
  { id: 'warm-linen', label: 'Warm Linen' },
  { id: 'obsidian-grid', label: 'Subtle Grid' },
  { id: 'forest-slate', label: 'Forest Slate' },
];

export const PreferencesModal: React.FC<PreferencesModalProps> = ({
  open,
  onClose,
  prefs,
  onChange,
}) => {
  if (!open) return null;

  const update = (patch: Partial<UserPreferences>) => {
    onChange({ ...prefs, ...patch });
  };

  return (
    <div className="fixed inset-0 z-50 bg-zinc-950/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto thin-scroll bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-6 space-y-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-stone-200 dark:border-zinc-800 pb-3">
          <div>
            <h2 className="text-lg font-bold text-stone-900 dark:text-zinc-100">
              Appearance, Board & Language
            </h2>
            <p className="text-xs text-stone-500 dark:text-zinc-400">
              All preferences are stored locally in your browser. Zero tracking.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-stone-100 dark:hover:bg-zinc-800 text-stone-500"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Player Name & Theme Mode */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-stone-700 dark:text-zinc-300 mb-1.5">
              Player Name
            </label>
            <input
              type="text"
              value={prefs.username}
              onChange={(e) => update({ username: e.target.value || 'Player' })}
              className="w-full px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-950 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-stone-700 dark:text-zinc-300 mb-1.5">
              Color Theme
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => update({ theme: 'light' })}
                className={`flex-1 py-2 px-3 rounded-lg border text-xs font-semibold flex items-center justify-center gap-1.5 ${
                  prefs.theme === 'light'
                    ? 'border-emerald-600 bg-emerald-600 text-white'
                    : 'border-stone-200 dark:border-zinc-700'
                }`}
              >
                <Sun className="w-4 h-4" />
                Light
              </button>
              <button
                type="button"
                onClick={() => update({ theme: 'dark' })}
                className={`flex-1 py-2 px-3 rounded-lg border text-xs font-semibold flex items-center justify-center gap-1.5 ${
                  prefs.theme === 'dark'
                    ? 'border-emerald-600 bg-emerald-600 text-white'
                    : 'border-stone-200 dark:border-zinc-700'
                }`}
              >
                <Moon className="w-4 h-4" />
                Dark
              </button>
            </div>
          </div>
        </div>

        {/* Custom Board Themes */}
        <div>
          <label className="block text-xs font-semibold text-stone-700 dark:text-zinc-300 mb-2">
            Board Theme
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {(Object.keys(BOARD_THEMES) as BoardThemeId[]).map((id) => {
              const bt = BOARD_THEMES[id];
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => update({ boardTheme: id })}
                  className={`p-2.5 rounded-lg border text-left flex items-center gap-2.5 transition-colors ${
                    prefs.boardTheme === id
                      ? 'border-emerald-600 bg-emerald-50/70 dark:bg-emerald-950/30'
                      : 'border-stone-200 dark:border-zinc-800 hover:bg-stone-50 dark:hover:bg-zinc-800'
                  }`}
                >
                  <div className="w-8 h-8 rounded overflow-hidden grid grid-cols-2 grid-rows-2 border border-stone-300 shrink-0">
                    <div style={{ backgroundColor: bt.light }} />
                    <div style={{ backgroundColor: bt.dark }} />
                    <div style={{ backgroundColor: bt.dark }} />
                    <div style={{ backgroundColor: bt.light }} />
                  </div>
                  <span className="text-xs font-medium text-stone-800 dark:text-zinc-200">
                    {bt.name}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Custom Piece Sets */}
        <div>
          <label className="block text-xs font-semibold text-stone-700 dark:text-zinc-300 mb-2">
            Piece Set
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {PIECE_SETS.map((ps) => (
              <button
                key={ps.id}
                type="button"
                onClick={() => update({ pieceSet: ps.id })}
                className={`p-3 rounded-lg border flex flex-col items-center gap-1.5 transition-colors ${
                  prefs.pieceSet === ps.id
                    ? 'border-emerald-600 bg-emerald-50/70 dark:bg-emerald-950/30'
                    : 'border-stone-200 dark:border-zinc-800 hover:bg-stone-50 dark:hover:bg-zinc-800'
                }`}
              >
                <div className="flex items-center gap-1">
                  <ChessPiece color="w" type="n" pieceSet={ps.id} className="w-7 h-7" />
                  <ChessPiece color="b" type="q" pieceSet={ps.id} className="w-7 h-7" />
                </div>
                <span className="text-xs font-medium text-stone-800 dark:text-zinc-200">
                  {ps.label}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Workspace Background & Language */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-stone-700 dark:text-zinc-300 mb-1.5">
              Workspace Background
            </label>
            <div className="grid grid-cols-2 gap-2">
              {BG_THEMES.map((bg) => (
                <button
                  key={bg.id}
                  type="button"
                  onClick={() => update({ bgTheme: bg.id })}
                  className={`py-2 px-3 rounded-lg border text-xs font-medium ${
                    prefs.bgTheme === bg.id
                      ? 'border-emerald-600 bg-emerald-50/70 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300'
                      : 'border-stone-200 dark:border-zinc-800'
                  }`}
                >
                  {bg.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-stone-700 dark:text-zinc-300 mb-1.5">
              Interface Language (20 Languages)
            </label>
            <select
              value={prefs.language}
              onChange={(e) => update({ language: e.target.value as LanguageCode })}
              className="w-full px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-950 text-sm"
            >
              {LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.nativeName} ({lang.name})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Audio & Gameplay Input Behavior */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-stone-100 dark:border-zinc-800">
          <div>
            <label className="block text-xs font-semibold text-stone-700 dark:text-zinc-300 mb-1.5">
              Sound Theme
            </label>
            <div className="flex gap-1.5">
              {([
                ['standard', 'Standard'],
                ['wood', 'Wood Board'],
                ['futuristic', 'Synth'],
              ] as [SoundThemeId, string][]).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    update({ soundTheme: id });
                    soundFX.theme = id;
                    soundFX.move();
                  }}
                  className={`flex-1 py-1.5 px-2 rounded-lg border text-xs font-medium ${
                    (prefs.soundTheme || 'standard') === id
                      ? 'border-emerald-600 bg-emerald-50/70 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300'
                      : 'border-stone-200 dark:border-zinc-800'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-stone-700 dark:text-zinc-300 mb-1.5">
              Piece Movement
            </label>
            <div className="flex gap-1.5">
              {([
                ['both', 'Click & Drag'],
                ['click', 'Click Only'],
                ['drag', 'Drag Only'],
              ] as [MoveMethodId, string][]).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => update({ moveMethod: id })}
                  className={`flex-1 py-1.5 px-2 rounded-lg border text-xs font-medium ${
                    (prefs.moveMethod || 'both') === id
                      ? 'border-emerald-600 bg-emerald-50/70 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300'
                      : 'border-stone-200 dark:border-zinc-800'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-stone-700 dark:text-zinc-300 mb-1.5">
              Piece Size
            </label>
            <div className="flex gap-1.5">
              {([
                ['normal', 'Standard'],
                ['large', 'Large'],
              ] as ['normal' | 'large', string][]).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => update({ pieceScale: id })}
                  className={`flex-1 py-1.5 px-2 rounded-lg border text-xs font-medium ${
                    (prefs.pieceScale || 'normal') === id
                      ? 'border-emerald-600 bg-emerald-50/70 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300'
                      : 'border-stone-200 dark:border-zinc-800'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Toggles */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 pt-2 border-t border-stone-100 dark:border-zinc-800">
          <button
            type="button"
            onClick={() => update({ soundEnabled: !prefs.soundEnabled })}
            className="flex items-center gap-2 text-xs font-medium text-stone-700 dark:text-zinc-300"
          >
            {prefs.soundEnabled ? <Volume2 className="w-4 h-4 text-emerald-600" /> : <VolumeX className="w-4 h-4 text-stone-400" />}
            Sound Effects: {prefs.soundEnabled ? 'On' : 'Muted'}
          </button>

          <label className="flex items-center gap-2 text-xs font-medium text-stone-700 dark:text-zinc-300 cursor-pointer">
            <input
              type="checkbox"
              checked={!!prefs.voiceEnabled}
              onChange={(e) => update({ voiceEnabled: e.target.checked })}
              className="accent-emerald-600"
            />
            Voice Move Announcer
          </label>

          <label className="flex items-center gap-2 text-xs font-medium text-stone-700 dark:text-zinc-300 cursor-pointer">
            <input
              type="checkbox"
              checked={prefs.showCoordinates}
              onChange={(e) => update({ showCoordinates: e.target.checked })}
              className="accent-emerald-600"
            />
            Board Coordinates
          </label>

          <label className="flex items-center gap-2 text-xs font-medium text-stone-700 dark:text-zinc-300 cursor-pointer">
            <input
              type="checkbox"
              checked={prefs.highlightLegalMoves}
              onChange={(e) => update({ highlightLegalMoves: e.target.checked })}
              className="accent-emerald-600"
            />
            Show Legal Moves
          </label>

          <label className="flex items-center gap-2 text-xs font-medium text-stone-700 dark:text-zinc-300 cursor-pointer">
            <input
              type="checkbox"
              checked={prefs.showLastMove !== false}
              onChange={(e) => update({ showLastMove: e.target.checked })}
              className="accent-emerald-600"
            />
            Highlight Last Move
          </label>

          <label className="flex items-center gap-2 text-xs font-medium text-stone-700 dark:text-zinc-300 cursor-pointer">
            <input
              type="checkbox"
              checked={!!prefs.blindfoldPieces}
              onChange={(e) => update({ blindfoldPieces: e.target.checked })}
              className="accent-emerald-600"
            />
            Blindfold Pieces
          </label>

          <label className="flex items-center gap-2 text-xs font-medium text-stone-700 dark:text-zinc-300 cursor-pointer">
            <input
              type="checkbox"
              checked={!!prefs.autoQueen}
              onChange={(e) => update({ autoQueen: e.target.checked })}
              className="accent-emerald-600"
            />
            Always Promote to Queen
          </label>

          <label className="flex items-center gap-2 text-xs font-medium text-stone-700 dark:text-zinc-300 cursor-pointer">
            <input
              type="checkbox"
              checked={!!prefs.confirmMove}
              onChange={(e) => update({ confirmMove: e.target.checked })}
              className="accent-emerald-600"
            />
            Move Confirmation
          </label>

          <label className="flex items-center gap-2 text-xs font-medium text-stone-700 dark:text-zinc-300 cursor-pointer">
            <input
              type="checkbox"
              checked={prefs.showRatings !== false}
              onChange={(e) => update({ showRatings: e.target.checked })}
              className="accent-emerald-600"
            />
            Show Player Ratings
          </label>

          <label
            className="flex items-center gap-2 text-xs font-medium text-stone-700 dark:text-zinc-300 cursor-pointer"
            title="BOT accounts are excluded from all leaderboards"
          >
            <input
              type="checkbox"
              checked={!!prefs.isBot}
              onChange={(e) => update({ isBot: e.target.checked })}
              className="accent-emerald-600"
            />
            BOT Account (No Leaderboards)
          </label>
        </div>

        <div className="pt-2 border-t border-stone-100 dark:border-zinc-800 text-[11px] text-stone-500 dark:text-zinc-400">
          Tip: Press <kbd className="px-1.5 py-0.5 rounded bg-stone-100 dark:bg-zinc-800 font-mono">?</kbd> anytime for keyboard shortcuts, or hold <kbd className="px-1 py-0.5 rounded bg-stone-100 dark:bg-zinc-800 font-mono">Shift</kbd> / <kbd className="px-1 py-0.5 rounded bg-stone-100 dark:bg-zinc-800 font-mono">Alt</kbd> + Right-Click to draw red, blue, or yellow arrows.
        </div>
      </div>
    </div>
  );
};
