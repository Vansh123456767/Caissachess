import React, { useEffect, useRef, useState } from 'react';
import { AuthUser, PlanTier } from '../types/chess';
import { PLAN_CATALOG } from '../data/plans';
import {
  Check,
  Crown,
  Eye,
  EyeOff,
  KeyRound,
  LogIn,
  LogOut,
  ShieldCheck,
  Sparkles,
  UserPlus,
  X,
} from 'lucide-react';

interface AuthModalProps {
  open: boolean;
  initialMode?: 'login' | 'register';
  onClose: () => void;
  authUser: AuthUser | null;
  authToken?: string | null;
  onAuthSuccess: (token: string, user: AuthUser) => void;
  onLogout: () => Promise<void> | void;
  planTier?: PlanTier;
  onOpenPlans?: () => void;
  visitorId?: string;
  guestStatsSummary?: {
    gamesCount: number;
    puzzlesSolved: number;
    blitzRating: number;
  };
}

function generateSuggestedPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  const buf = new Uint32Array(12);
  window.crypto.getRandomValues(buf);
  let out = '';
  for (let i = 0; i < buf.length; i++) {
    out += chars[buf[i] % chars.length];
  }
  return out;
}

function getPasswordStrength(pw: string): {
  label: string;
  color: string;
  bars: number;
} {
  if (!pw) return { label: '', color: 'text-stone-400', bars: 0 };
  let score = 0;
  if (pw.length >= 6) score++;
  if (pw.length >= 10) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw) || /[^a-zA-Z0-9]/.test(pw)) score++;

  if (pw.length < 6) return { label: 'Too short', color: 'text-red-600 dark:text-red-400', bars: 1 };
  if (score <= 2) return { label: 'Fair', color: 'text-amber-600 dark:text-amber-400', bars: 2 };
  if (score === 3) return { label: 'Good', color: 'text-emerald-600 dark:text-emerald-400', bars: 3 };
  return { label: 'Strong', color: 'text-emerald-600 dark:text-emerald-400', bars: 4 };
}

function normalizeUsername(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

function validateUsername(raw: string): string | null {
  const clean = normalizeUsername(raw);
  if (clean.length < 3) {
    return `Username must be at least 3 characters (${clean.length}/3 entered).`;
  }
  if (clean.length > 48) {
    return `Username must be 48 characters or fewer (${clean.length}/48).`;
  }
  const badMatch = clean.match(/[^\p{L}\p{N}_. @+-]/u);
  if (badMatch) {
    return `Unsupported character "${badMatch[0]}". Use letters, numbers, spaces, _, ., -, @, or +.`;
  }
  return null;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  open,
  initialMode = 'login',
  onClose,
  authUser,
  onAuthSuccess,
  onLogout,
  planTier = 'free',
  onOpenPlans,
  visitorId,
  guestStatsSummary,
}) => {
  const [mode, setMode] = useState<'login' | 'register'>(initialMode);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [claimGuestProgress, setClaimGuestProgress] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setMode(initialMode);
      setError(null);
    }
  }, [open, initialMode]);

  if (!open) return null;

  const switchMode = (nextMode: 'login' | 'register') => {
    setMode(nextMode);
    setError(null);
    setPassword('');
    setConfirmPassword('');
  };

  const strength = getPasswordStrength(password);
  const passwordValidLen = password.length >= 6;
  const passwordsMatch =
    confirmPassword.length > 0 && password === confirmPassword;
  const cleanUsername = normalizeUsername(username);
  const usernameIssue = cleanUsername.length > 0 ? validateUsername(username) : null;

  const handleSuggestPassword = () => {
    const suggested = generateSuggestedPassword();
    setPassword(suggested);
    setConfirmPassword(suggested);
    setShowPassword(true);
    setShowConfirm(true);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const rawUserInput = usernameRef.current?.value ?? username;
    const rawPassInput = passwordRef.current?.value ?? password;
    const rawConfirmInput = confirmRef.current?.value ?? confirmPassword;

    const trimmedUser = normalizeUsername(rawUserInput);
    if (rawUserInput !== username) {
      setUsername(rawUserInput);
    }
    const userErr = validateUsername(rawUserInput);
    if (userErr) {
      setError(userErr);
      return;
    }
    if (mode === 'register' && rawPassInput.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (mode === 'login' && rawPassInput.length === 0) {
      setError('Please enter your password.');
      return;
    }
    if (mode === 'register' && rawPassInput !== rawConfirmInput) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      const endpoint = mode === 'register' ? '/api/auth/register' : '/api/auth/login';
      const payload: Record<string, unknown> = {
        username: trimmedUser,
        password: rawPassInput,
      };
      if (mode === 'register' && claimGuestProgress) {
        if (visitorId) payload.visitorId = visitorId;
        if (guestStatsSummary) {
          payload.claimRatings = { blitz: guestStatsSummary.blitzRating };
        }
      }
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data?.token || !data?.user) {
        setError(data?.error || 'Authentication failed. Please try again.');
        return;
      }

      setPassword('');
      setConfirmPassword('');
      onAuthSuccess(data.token, data.user);
      onClose();
    } catch {
      setError('Unable to reach server. Please check your connection.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-zinc-950/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-6 space-y-5 shadow-2xl">
        <div className="flex items-center justify-between border-b border-stone-200 dark:border-zinc-800 pb-3">
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <h2 className="text-base font-bold text-stone-900 dark:text-zinc-100">
              {authUser
                ? 'Player Account'
                : mode === 'login'
                ? 'Log In to Caissa'
                : 'Create Player Account'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-stone-100 dark:hover:bg-zinc-800 text-stone-500"
            aria-label="Close account modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {authUser ? (
          <div className="space-y-4">
            <div className="p-4 rounded-lg bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-stone-900 dark:text-zinc-100">
                  {authUser.username}
                </span>
                <span className="font-mono text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                  Rating {authUser.rating}
                </span>
              </div>
              <div className="text-xs text-stone-500 dark:text-zinc-400 font-mono">
                Member since {new Date(authUser.createdAt).toLocaleDateString()}
              </div>
            </div>

            <div className="flex items-start gap-2 text-xs text-stone-600 dark:text-zinc-400">
              <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <span>
                Signed in with a verified server session. Custom tournaments you create are saved under your username.
              </span>
            </div>

            {onOpenPlans && (
              <div className="flex items-center justify-between gap-2 p-3 rounded-lg bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 text-xs">
                <div className="flex items-center gap-2">
                  <Crown className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span className="text-stone-700 dark:text-zinc-300">
                    Active Plan: <strong>{PLAN_CATALOG[planTier].name}</strong> ({PLAN_CATALOG[planTier].priceLabel})
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenPlans();
                  }}
                  className="text-emerald-600 dark:text-emerald-400 font-semibold hover:underline shrink-0"
                >
                  Change Plan
                </button>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 text-xs font-medium text-stone-700 dark:text-zinc-300"
              >
                Close
              </button>
              <button
                type="button"
                onClick={async () => {
                  await onLogout();
                  onClose();
                }}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <LogOut className="w-3.5 h-3.5" />
                Log Out
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Mode Switcher */}
            <div className="grid grid-cols-2 gap-1 p-1 bg-stone-100 dark:bg-zinc-950 rounded-lg">
              <button
                type="button"
                onClick={() => switchMode('login')}
                className={`py-2 px-3 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                  mode === 'login'
                    ? 'bg-white dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 shadow-sm'
                    : 'text-stone-600 dark:text-zinc-400'
                }`}
              >
                <LogIn className="w-3.5 h-3.5" />
                Log In
              </button>
              <button
                type="button"
                onClick={() => switchMode('register')}
                className={`py-2 px-3 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                  mode === 'register'
                    ? 'bg-white dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 shadow-sm'
                    : 'text-stone-600 dark:text-zinc-400'
                }`}
              >
                <UserPlus className="w-3.5 h-3.5" />
                Create Account
              </button>
            </div>

            {mode === 'register' && guestStatsSummary && (
              <label className="flex items-start gap-2.5 p-3 rounded-lg border border-emerald-200 dark:border-emerald-800/70 bg-emerald-50/70 dark:bg-emerald-950/30 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={claimGuestProgress}
                  onChange={(e) => setClaimGuestProgress(e.target.checked)}
                  className="accent-emerald-600 mt-0.5"
                />
                <div className="space-y-0.5">
                  <div className="font-semibold text-emerald-900 dark:text-emerald-200">
                    Claim my Anonymous guest ratings & progress
                  </div>
                  <div className="text-[11px] text-emerald-800/80 dark:text-emerald-300/80">
                    Carry over {guestStatsSummary.blitzRating} Blitz Elo, {guestStatsSummary.gamesCount} local games & {guestStatsSummary.puzzlesSolved} puzzles solved.
                  </div>
                </div>
              </label>
            )}

            <form onSubmit={handleSubmit} noValidate className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-stone-700 dark:text-zinc-300 mb-1">
                  Username
                </label>
                <input
                  ref={usernameRef}
                  type="text"
                  name="username"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={username}
                  onChange={(e) => {
                    setUsername(e.target.value);
                    if (error) setError(null);
                  }}
                  placeholder="e.g. Grandmaster_K or your email"
                  className="w-full px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-950 text-sm text-stone-900 dark:text-zinc-100"
                />
                {usernameIssue ? (
                  <p className="text-[11px] text-red-600 dark:text-red-400 mt-1">
                    {usernameIssue}
                  </p>
                ) : cleanUsername.length >= 3 ? (
                  <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1 flex items-center gap-1">
                    <Check className="w-3 h-3 shrink-0" />
                    <span>Username ready ({cleanUsername.length} chars)</span>
                  </p>
                ) : (
                  <p className="text-[11px] text-stone-500 dark:text-zinc-400 mt-1">
                    3–48 characters (letters, numbers, spaces, _, ., -, or @).
                  </p>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-stone-700 dark:text-zinc-300">
                    Password
                  </label>
                  {mode === 'register' && (
                    <button
                      type="button"
                      onClick={handleSuggestPassword}
                      className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1"
                    >
                      <Sparkles className="w-3 h-3" />
                      Suggest Password
                    </button>
                  )}
                </div>
                <div className="relative">
                  <input
                    ref={passwordRef}
                    type={showPassword ? 'text' : 'password'}
                    name="password"
                    autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (error) setError(null);
                    }}
                    placeholder={mode === 'register' ? 'At least 6 characters' : 'Enter your password'}
                    className="w-full px-3 py-2 pr-10 rounded-lg border border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-950 text-sm text-stone-900 dark:text-zinc-100"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 dark:hover:text-zinc-300"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                {mode === 'register' && (
                  <div className="mt-2 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex-1 grid grid-cols-4 gap-1">
                        {[1, 2, 3, 4].map((idx) => (
                          <div
                            key={idx}
                            className={`h-1 rounded-full transition-colors ${
                              strength.bars >= idx
                                ? strength.bars === 1
                                  ? 'bg-red-500'
                                  : strength.bars === 2
                                  ? 'bg-amber-500'
                                  : 'bg-emerald-500'
                                : 'bg-stone-200 dark:bg-zinc-800'
                            }`}
                          />
                        ))}
                      </div>
                      <span className={`text-[11px] font-mono font-medium ${strength.color}`}>
                        {strength.label || `${password.length}/6+ chars`}
                      </span>
                    </div>
                    <div
                      className={`text-[11px] flex items-center gap-1 ${
                        passwordValidLen
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-stone-500 dark:text-zinc-400'
                      }`}
                    >
                      <Check className="w-3 h-3 shrink-0" />
                      <span>Minimum 6 characters ({password.length} entered)</span>
                    </div>
                  </div>
                )}
              </div>

              {mode === 'register' && (
                <div>
                  <label className="block text-xs font-semibold text-stone-700 dark:text-zinc-300 mb-1">
                    Confirm Password
                  </label>
                  <div className="relative">
                    <input
                      ref={confirmRef}
                      type={showConfirm ? 'text' : 'password'}
                      name="confirmPassword"
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(e) => {
                        setConfirmPassword(e.target.value);
                        if (error) setError(null);
                      }}
                      placeholder="Re-enter password"
                      className="w-full px-3 py-2 pr-10 rounded-lg border border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-950 text-sm text-stone-900 dark:text-zinc-100"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirm((s) => !s)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 dark:hover:text-zinc-300"
                      aria-label={showConfirm ? 'Hide confirm password' : 'Show confirm password'}
                    >
                      {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {confirmPassword.length > 0 && (
                    <p
                      className={`text-[11px] mt-1 ${
                        passwordsMatch
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-red-600 dark:text-red-400'
                      }`}
                    >
                      {passwordsMatch ? 'Passwords match' : 'Passwords do not match'}
                    </p>
                  )}
                </div>
              )}

              {error && (
                <div className="p-2.5 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold transition-colors cursor-pointer"
              >
                {submitting
                  ? mode === 'login'
                    ? 'Signing in...'
                    : 'Creating account...'
                  : mode === 'login'
                  ? 'Log In'
                  : 'Create Account'}
              </button>

              <div className="text-center text-xs text-stone-500 dark:text-zinc-400 pt-1">
                {mode === 'login' ? (
                  <>
                    Need an account?{' '}
                    <button
                      type="button"
                      onClick={() => switchMode('register')}
                      className="text-emerald-600 dark:text-emerald-400 font-semibold hover:underline"
                    >
                      Create one here
                    </button>
                  </>
                ) : (
                  <>
                    Already have an account?{' '}
                    <button
                      type="button"
                      onClick={() => switchMode('login')}
                      className="text-emerald-600 dark:text-emerald-400 font-semibold hover:underline"
                    >
                      Log in
                    </button>
                  </>
                )}
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
};
