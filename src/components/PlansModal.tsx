import React, { useEffect, useState } from 'react';
import {
  AuthUser,
  DailyQuotaUsage,
  PaymentMethod,
  PaymentOrderInfo,
  PaymentReceipt,
  PlanTier,
} from '../types/chess';
import { PLAN_CATALOG, getPlanLimits, normalizeQuotaUsage } from '../data/plans';
import {
  ArrowLeft,
  Building2,
  Check,
  CheckCircle2,
  CreditCard,
  Crown,
  Infinity as InfinityIcon,
  Layers,
  Lock,
  Receipt,
  ShieldCheck,
  Smartphone,
  Sparkles,
  X,
} from 'lucide-react';

interface RazorpaySuccessResponse {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

interface RazorpayCheckoutOptions {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  prefill?: { name?: string };
  notes?: Record<string, string>;
  theme?: { color?: string };
  handler: (response: RazorpaySuccessResponse) => void;
  modal?: { ondismiss?: () => void };
}

interface RazorpayInstance {
  open: () => void;
  on: (event: string, cb: (resp: { error?: { description?: string } }) => void) => void;
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayCheckoutOptions) => RazorpayInstance;
  }
}

function loadRazorpayCheckoutScript(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  if (window.Razorpay) return Promise.resolve(true);

  return new Promise((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://checkout.razorpay.com/v1/checkout.js"]'
    );
    if (existing) {
      existing.addEventListener('load', () => resolve(Boolean(window.Razorpay)), { once: true });
      existing.addEventListener('error', () => resolve(false), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => resolve(Boolean(window.Razorpay));
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

interface PlansModalProps {
  open: boolean;
  onClose: () => void;
  currentPlan: PlanTier;
  usage: DailyQuotaUsage;
  authUser: AuthUser | null;
  receipts: PaymentReceipt[];
  onDowngradeFree: () => Promise<{ ok: boolean; error?: string }>;
  onCreatePaymentOrder: (
    plan: Exclude<PlanTier, 'free'>
  ) => Promise<{ ok: boolean; order?: PaymentOrderInfo; error?: string }>;
  onVerifyPayment: (payload: {
    order: PaymentOrderInfo;
    method: PaymentMethod;
    upiId?: string;
    bankName?: string;
    otpCode?: string;
    razorpayOrderId?: string;
    razorpayPaymentId?: string;
    razorpaySignature?: string;
  }) => Promise<{ ok: boolean; receipt?: PaymentReceipt; error?: string }>;
  onOpenAuth: (mode?: 'login' | 'register') => void;
}

const ORDERED_PLANS: PlanTier[] = ['free', 'pro', 'max'];
const INDIAN_BANKS = ['HDFC Bank', 'ICICI Bank', 'State Bank of India', 'Axis Bank', 'Kotak Mahindra'];

function DeterministicQrSvg({ seed }: { seed: string }) {
  const size = 11;
  const cells: boolean[] = [];
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const inTopLeft = r < 3 && c < 3;
      const inTopRight = r < 3 && c >= size - 3;
      const inBotLeft = r >= size - 3 && c < 3;
      if (inTopLeft || inTopRight || inBotLeft) {
        const isEdge =
          r === 0 ||
          c === 0 ||
          r === size - 1 ||
          c === size - 1 ||
          r === 2 ||
          c === 2 ||
          r === size - 3 ||
          c === size - 3;
        cells.push(isEdge);
      } else {
        h ^= (r * 31 + c * 17) >>> 0;
        h = Math.imul(h, 16777619);
        cells.push((h & 1) === 1);
      }
    }
  }

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className="w-24 h-24 rounded-lg bg-white p-1.5 border border-stone-200 dark:border-zinc-700 shrink-0"
      aria-label="UPI payment QR code preview"
    >
      {cells.map((filled, idx) => {
        if (!filled) return null;
        const r = Math.floor(idx / size);
        const c = idx % size;
        return <rect key={idx} x={c} y={r} width={1} height={1} fill="#18181b" />;
      })}
    </svg>
  );
}

export const PlansModal: React.FC<PlansModalProps> = ({
  open,
  onClose,
  currentPlan,
  usage,
  authUser,
  receipts,
  onDowngradeFree,
  onCreatePaymentOrder,
  onVerifyPayment,
  onOpenAuth,
}) => {
  const [step, setStep] = useState<'plans' | 'checkout' | 'receipt' | 'history'>('plans');
  const [creatingOrderFor, setCreatingOrderFor] = useState<PlanTier | null>(null);
  const [pendingOrder, setPendingOrder] = useState<PaymentOrderInfo | null>(null);
  const [payMethod, setPayMethod] = useState<PaymentMethod>('upi');
  const [upiId, setUpiId] = useState('');
  const [bankName, setBankName] = useState(INDIAN_BANKS[0]);
  const [otpCode, setOtpCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [latestReceipt, setLatestReceipt] = useState<PaymentReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gatewayMode, setGatewayMode] = useState<'live' | 'test' | 'sandbox'>('sandbox');

  useEffect(() => {
    if (open) {
      setStep('plans');
      setPendingOrder(null);
      setLatestReceipt(null);
      setError(null);
      setOtpCode('');
      setVerifying(false);
      fetch('/api/payments/config')
        .then((r) => (r.ok ? r.json() : null))
        .then((cfg: { mode?: 'live' | 'test' | 'sandbox' } | null) => {
          if (cfg?.mode === 'live' || cfg?.mode === 'test' || cfg?.mode === 'sandbox') {
            setGatewayMode(cfg.mode);
          }
        })
        .catch(() => {
          // Ignore config check errors in static fallback
        });
    }
  }, [open]);

  if (!open) return null;

  const normUsage = normalizeQuotaUsage(usage);
  const activeLimits = getPlanLimits(currentPlan);

  const handleSelectTier = async (tier: PlanTier) => {
    setError(null);
    if (tier === 'free') {
      setCreatingOrderFor('free');
      const res = await onDowngradeFree();
      setCreatingOrderFor(null);
      if (!res.ok) {
        setError(res.error || 'Could not switch to Free plan.');
      }
      return;
    }

    setCreatingOrderFor(tier);
    const res = await onCreatePaymentOrder(tier);
    setCreatingOrderFor(null);
    if (!res.ok || !res.order) {
      setError(res.error || 'Could not create payment order.');
      return;
    }
    setPendingOrder(res.order);
    setOtpCode('');
    setStep('checkout');
  };

  const handleConfirmPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingOrder) return;
    setError(null);
    setVerifying(true);
    const res = await onVerifyPayment({
      order: pendingOrder,
      method: payMethod,
      upiId,
      bankName,
      otpCode,
    });
    setVerifying(false);
    if (!res.ok || !res.receipt) {
      setError(res.error || 'Payment verification failed.');
      return;
    }
    setLatestReceipt(res.receipt);
    setStep('receipt');
  };

  const handleLaunchRazorpay = async () => {
    if (
      !pendingOrder ||
      pendingOrder.provider !== 'razorpay' ||
      !pendingOrder.razorpayKeyId ||
      !pendingOrder.razorpayOrderId
    ) {
      return;
    }
    setError(null);
    setVerifying(true);

    const loaded = await loadRazorpayCheckoutScript();
    if (!loaded || !window.Razorpay) {
      setVerifying(false);
      setError('Could not load Razorpay Checkout. Check your network connection and try again.');
      return;
    }

    const rzp = new window.Razorpay({
      key: pendingOrder.razorpayKeyId,
      amount: pendingOrder.amountInr * 100,
      currency: 'INR',
      name: 'Caissa Chess',
      description: `${PLAN_CATALOG[pendingOrder.plan].name} Plan (₹${pendingOrder.amountInr.toLocaleString()})`,
      order_id: pendingOrder.razorpayOrderId,
      prefill: authUser ? { name: authUser.username } : undefined,
      notes: {
        plan: pendingOrder.plan,
        caissaOrderId: pendingOrder.orderId,
      },
      theme: { color: '#059669' },
      handler: async (response) => {
        const res = await onVerifyPayment({
          order: pendingOrder,
          method: 'razorpay',
          razorpayOrderId: response.razorpay_order_id,
          razorpayPaymentId: response.razorpay_payment_id,
          razorpaySignature: response.razorpay_signature,
        });
        setVerifying(false);
        if (!res.ok || !res.receipt) {
          setError(res.error || 'Razorpay payment verification failed.');
          return;
        }
        setLatestReceipt(res.receipt);
        setStep('receipt');
      },
      modal: {
        ondismiss: () => {
          setVerifying(false);
        },
      },
    });

    rzp.on('payment.failed', (failure) => {
      setVerifying(false);
      setError(
        failure?.error?.description || 'Payment did not complete in Razorpay. Please try again.'
      );
    });

    rzp.open();
  };

  return (
    <div className="fixed inset-0 z-50 bg-zinc-950/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-4xl bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-6 space-y-5 shadow-2xl my-auto">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-stone-200 dark:border-zinc-800 pb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              {step !== 'plans' && (
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setStep('plans');
                  }}
                  className="p-1 rounded-md hover:bg-stone-100 dark:hover:bg-zinc-800 text-stone-600 dark:text-zinc-300"
                  aria-label="Back to plans"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
              )}
              <Crown className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <h2 className="text-lg font-bold text-stone-900 dark:text-zinc-100">
                {step === 'checkout' && pendingOrder
                  ? `Checkout · ${PLAN_CATALOG[pendingOrder.plan].name} (₹${pendingOrder.amountInr.toLocaleString()})`
                  : step === 'receipt'
                  ? 'Payment Confirmed'
                  : step === 'history'
                  ? 'Payment Receipts'
                  : 'Caissa Training Plans'}
              </h2>
            </div>
            <p className="text-xs text-stone-500 dark:text-zinc-400">
              {step === 'checkout'
                ? 'Complete your INR payment below to unlock your upgraded daily limits immediately.'
                : step === 'receipt'
                ? 'Your payment has been verified and your new daily limits are active.'
                : `Daily quotas reset at midnight (${normUsage.date}). Paid plans require checkout in INR (₹).`}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {step === 'plans' && receipts.length > 0 && (
              <button
                type="button"
                onClick={() => setStep('history')}
                className="px-2.5 py-1.5 rounded-lg border border-stone-200 dark:border-zinc-700 text-xs font-medium text-stone-700 dark:text-zinc-300 hover:bg-stone-50 dark:hover:bg-zinc-800 flex items-center gap-1.5"
              >
                <Receipt className="w-3.5 h-3.5" />
                Receipts ({receipts.length})
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-stone-100 dark:hover:bg-zinc-800 text-stone-500"
              aria-label="Close plans modal"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* STEP 1: PLANS GRID */}
        {step === 'plans' && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded-lg bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-stone-600 dark:text-zinc-400">
                    Daily Engine Analysis Used
                  </span>
                  <span className="font-mono font-semibold tabular-nums text-stone-900 dark:text-zinc-100">
                    {normUsage.analysisUsed} /{' '}
                    {activeLimits.analysisPerDay === null ? '∞' : activeLimits.analysisPerDay}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-stone-200 dark:bg-zinc-800 overflow-hidden">
                  <div
                    className="h-full bg-emerald-600 transition-all duration-200"
                    style={{
                      width:
                        activeLimits.analysisPerDay === null
                          ? '100%'
                          : `${Math.min(100, (normUsage.analysisUsed / activeLimits.analysisPerDay) * 100)}%`,
                    }}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-stone-600 dark:text-zinc-400">
                    Daily Puzzles Used
                  </span>
                  <span className="font-mono font-semibold tabular-nums text-stone-900 dark:text-zinc-100">
                    {normUsage.puzzlesUsed} /{' '}
                    {activeLimits.puzzlesPerDay === null ? '∞' : activeLimits.puzzlesPerDay}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-stone-200 dark:bg-zinc-800 overflow-hidden">
                  <div
                    className="h-full bg-emerald-600 transition-all duration-200"
                    style={{
                      width:
                        activeLimits.puzzlesPerDay === null
                          ? '100%'
                          : `${Math.min(100, (normUsage.puzzlesUsed / activeLimits.puzzlesPerDay) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {ORDERED_PLANS.map((tier) => {
                const plan = PLAN_CATALOG[tier];
                const isActive = currentPlan === tier;
                const isPro = tier === 'pro';
                const isMax = tier === 'max';

                return (
                  <div
                    key={tier}
                    className={`rounded-xl border p-5 flex flex-col justify-between gap-5 transition-colors ${
                      isActive
                        ? 'border-emerald-600 bg-emerald-50/40 dark:bg-emerald-950/25'
                        : isPro
                        ? 'border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-900'
                        : 'border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900'
                    }`}
                  >
                    <div className="space-y-4">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          {isMax ? (
                            <InfinityIcon className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                          ) : isPro ? (
                            <Sparkles className="w-4 h-4 text-amber-500" />
                          ) : (
                            <Layers className="w-4 h-4 text-stone-500 dark:text-zinc-400" />
                          )}
                          <h3 className="text-base font-bold text-stone-900 dark:text-zinc-100">
                            {plan.name}
                          </h3>
                        </div>
                        {isActive ? (
                          <span className="px-2 py-0.5 rounded-md bg-emerald-600 text-white text-[11px] font-semibold whitespace-nowrap">
                            Current Plan
                          </span>
                        ) : isPro ? (
                          <span className="px-2 py-0.5 rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 text-[11px] font-semibold whitespace-nowrap">
                            Popular
                          </span>
                        ) : null}
                      </div>

                      <div>
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-3xl font-mono font-bold tabular-nums text-stone-900 dark:text-zinc-100">
                            {plan.priceLabel}
                          </span>
                          <span className="text-xs text-stone-500 dark:text-zinc-400">
                            {plan.billingNote}
                          </span>
                        </div>
                        <p className="text-xs text-stone-500 dark:text-zinc-400 mt-1">
                          {plan.tagline}
                        </p>
                      </div>

                      <div className="grid grid-cols-2 gap-2 p-2.5 rounded-lg bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 text-xs">
                        <div>
                          <div className="text-[11px] text-stone-500 dark:text-zinc-400">
                            Analysis / day
                          </div>
                          <div className="font-mono font-bold tabular-nums text-stone-900 dark:text-zinc-100">
                            {plan.analysisPerDay === null ? 'Infinite' : plan.analysisPerDay}
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px] text-stone-500 dark:text-zinc-400">
                            Puzzles / day
                          </div>
                          <div className="font-mono font-bold tabular-nums text-stone-900 dark:text-zinc-100">
                            {plan.puzzlesPerDay === null
                              ? 'Infinite'
                              : plan.puzzlesPerDay.toLocaleString()}
                          </div>
                        </div>
                      </div>

                      <ul className="space-y-2 text-xs text-stone-600 dark:text-zinc-300">
                        {plan.features.map((feat) => (
                          <li key={feat} className="flex items-start gap-2">
                            <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                            <span>{feat}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <button
                      type="button"
                      disabled={isActive || creatingOrderFor !== null}
                      onClick={() => handleSelectTier(tier)}
                      className={`w-full py-2.5 px-4 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                        isActive
                          ? 'bg-stone-100 dark:bg-zinc-800 text-stone-500 dark:text-zinc-400 cursor-default'
                          : 'bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50'
                      }`}
                    >
                      {creatingOrderFor === tier
                        ? 'Starting Checkout...'
                        : isActive
                        ? 'Active'
                        : tier === 'free'
                        ? 'Switch to Free (₹0)'
                        : tier === 'pro'
                        ? 'Pay ₹100 for Pro'
                        : 'Pay ₹1,000 for Max'}
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* STEP 2: INR CHECKOUT */}
        {step === 'checkout' && pendingOrder && (
          <form onSubmit={handleConfirmPayment} noValidate className="grid grid-cols-1 md:grid-cols-12 gap-5">
            <div className="md:col-span-5 space-y-3">
              <div className="p-4 rounded-xl bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 space-y-3">
                <div className="text-xs font-semibold uppercase tracking-wider text-stone-500 dark:text-zinc-400">
                  Order Summary
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-semibold text-stone-900 dark:text-zinc-100">
                    Caissa {PLAN_CATALOG[pendingOrder.plan].name} Plan
                  </span>
                  <span className="font-mono font-bold tabular-nums text-stone-900 dark:text-zinc-100">
                    ₹{pendingOrder.amountInr.toLocaleString()}.00
                  </span>
                </div>
                <div className="text-xs text-stone-600 dark:text-zinc-400 space-y-1 border-t border-stone-200 dark:border-zinc-800 pt-2.5">
                  <div className="flex justify-between">
                    <span>Engine Analyses / day</span>
                    <span className="font-mono font-semibold text-stone-900 dark:text-zinc-100">
                      {PLAN_CATALOG[pendingOrder.plan].analysisPerDay === null
                        ? 'Infinite'
                        : PLAN_CATALOG[pendingOrder.plan].analysisPerDay}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Puzzles / day</span>
                    <span className="font-mono font-semibold text-stone-900 dark:text-zinc-100">
                      {PLAN_CATALOG[pendingOrder.plan].puzzlesPerDay === null
                        ? 'Infinite'
                        : PLAN_CATALOG[pendingOrder.plan].puzzlesPerDay?.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Order Reference</span>
                    <span className="font-mono text-[11px]">{pendingOrder.orderId}</span>
                  </div>
                </div>
                <div className="flex items-center justify-between border-t border-stone-200 dark:border-zinc-800 pt-2.5 text-sm font-bold text-stone-900 dark:text-zinc-100">
                  <span>Total Payable</span>
                  <span className="font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                    ₹{pendingOrder.amountInr.toLocaleString()}.00 INR
                  </span>
                </div>
              </div>

              <div className="flex items-start gap-2 text-[11px] text-stone-500 dark:text-zinc-400 p-3 rounded-lg border border-stone-200 dark:border-zinc-800">
                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <span>
                  Verified server order & HMAC receipt check. Raw card numbers are never collected or stored by Caissa.
                </span>
              </div>
            </div>

            <div className="md:col-span-7 space-y-4">
              {pendingOrder.provider === 'razorpay' ? (
                <div className="p-5 rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/40 dark:bg-emerald-950/20 space-y-4">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-bold text-stone-900 dark:text-zinc-100">
                        Razorpay INR Checkout
                      </span>
                      <span className="px-2 py-0.5 rounded-md border border-emerald-300 dark:border-emerald-800 bg-white dark:bg-zinc-900 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                        {pendingOrder.razorpayMode === 'live' ? 'Live Merchant' : 'Test Mode'}
                      </span>
                    </div>
                    <p className="text-xs text-stone-600 dark:text-zinc-300 leading-relaxed">
                      Pay ₹{pendingOrder.amountInr.toLocaleString()} directly via UPI (GPay, PhonePe, Paytm, QR), Cards, or NetBanking through Razorpay. Funds settle into your linked Razorpay merchant account.
                    </p>
                  </div>

                  <div className="p-3 rounded-lg bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 text-xs font-mono space-y-1">
                    <div className="flex justify-between">
                      <span className="text-stone-500">Razorpay Order</span>
                      <span className="text-stone-900 dark:text-zinc-100">
                        {pendingOrder.razorpayOrderId}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-stone-500">Amount</span>
                      <span className="text-stone-900 dark:text-zinc-100">
                        ₹{pendingOrder.amountInr.toLocaleString()}.00 INR
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setError(null);
                        setStep('plans');
                      }}
                      className="px-4 py-2.5 rounded-lg border border-stone-200 dark:border-zinc-700 text-xs font-medium text-stone-700 dark:text-zinc-300"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={verifying}
                      onClick={handleLaunchRazorpay}
                      className="px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                    >
                      <Lock className="w-3.5 h-3.5" />
                      {verifying
                        ? 'Processing Razorpay...'
                        : `Pay ₹${pendingOrder.amountInr.toLocaleString()} via Razorpay`}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-stone-700 dark:text-zinc-300">
                      Select Payment Method
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {(
                        [
                          ['upi', 'UPI / QR', Smartphone],
                          ['netbanking', 'NetBanking', Building2],
                          ['card', 'Card (3DS)', CreditCard],
                        ] as const
                      ).map(([id, label, Icon]) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => {
                            setPayMethod(id);
                            setError(null);
                          }}
                          className={`p-2.5 rounded-lg border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                            payMethod === id
                              ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                              : 'border-stone-200 dark:border-zinc-800 text-stone-700 dark:text-zinc-300 hover:bg-stone-50 dark:hover:bg-zinc-800'
                          }`}
                        >
                          <Icon className="w-3.5 h-3.5" />
                          <span>{label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {payMethod === 'upi' && (
                    <div className="p-4 rounded-xl border border-stone-200 dark:border-zinc-800 space-y-3">
                      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                        <DeterministicQrSvg seed={`${pendingOrder.orderId}:${pendingOrder.amountInr}`} />
                        <div className="space-y-1 text-xs">
                          <div className="font-semibold text-stone-900 dark:text-zinc-100">
                            Scan UPI QR or enter UPI ID
                          </div>
                          <p className="text-stone-500 dark:text-zinc-400">
                            Pay ₹{pendingOrder.amountInr.toLocaleString()} using GPay, PhonePe, Paytm, or BHIM.
                          </p>
                          <div className="font-mono text-[11px] text-stone-500 dark:text-zinc-400">
                            Sandbox Mode · ₹{pendingOrder.amountInr}
                          </div>
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-stone-700 dark:text-zinc-300 mb-1">
                          Your UPI ID
                        </label>
                        <input
                          type="text"
                          value={upiId}
                          onChange={(e) => {
                            setUpiId(e.target.value);
                            if (error) setError(null);
                          }}
                          placeholder="e.g. vansh@okicici"
                          className="w-full px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-950 text-sm text-stone-900 dark:text-zinc-100"
                        />
                      </div>
                    </div>
                  )}

                  {payMethod === 'netbanking' && (
                    <div className="p-4 rounded-xl border border-stone-200 dark:border-zinc-800 space-y-3">
                      <div>
                        <label className="block text-xs font-semibold text-stone-700 dark:text-zinc-300 mb-1">
                          Select Bank
                        </label>
                        <select
                          value={bankName}
                          onChange={(e) => setBankName(e.target.value)}
                          className="w-full px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-950 text-sm text-stone-900 dark:text-zinc-100"
                        >
                          {INDIAN_BANKS.map((b) => (
                            <option key={b} value={b}>
                              {b}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-stone-700 dark:text-zinc-300 mb-1">
                          Bank Authorization OTP (4–6 digits)
                        </label>
                        <input
                          type="text"
                          inputMode="numeric"
                          maxLength={6}
                          value={otpCode}
                          onChange={(e) => {
                            setOtpCode(e.target.value.replace(/\D/g, ''));
                            if (error) setError(null);
                          }}
                          placeholder="Enter OTP (e.g. 123456)"
                          className="w-full px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-950 text-sm font-mono text-stone-900 dark:text-zinc-100"
                        />
                      </div>
                    </div>
                  )}

                  {payMethod === 'card' && (
                    <div className="p-4 rounded-xl border border-stone-200 dark:border-zinc-800 space-y-3">
                      <p className="text-xs text-stone-600 dark:text-zinc-400 leading-relaxed">
                        Card checkout uses tokenized 3-D Secure verification. Enter your 4–6 digit 3DS confirmation OTP to authorize ₹{pendingOrder.amountInr.toLocaleString()}.
                      </p>
                      <div>
                        <label className="block text-xs font-semibold text-stone-700 dark:text-zinc-300 mb-1">
                          3-D Secure Confirmation OTP (4–6 digits)
                        </label>
                        <input
                          type="text"
                          inputMode="numeric"
                          maxLength={6}
                          value={otpCode}
                          onChange={(e) => {
                            setOtpCode(e.target.value.replace(/\D/g, ''));
                            if (error) setError(null);
                          }}
                          placeholder="Enter 3DS OTP (e.g. 123456)"
                          className="w-full px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-950 text-sm font-mono text-stone-900 dark:text-zinc-100"
                        />
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setError(null);
                        setStep('plans');
                      }}
                      className="px-4 py-2.5 rounded-lg border border-stone-200 dark:border-zinc-700 text-xs font-medium text-stone-700 dark:text-zinc-300"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={verifying}
                      className="px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                    >
                      <Lock className="w-3.5 h-3.5" />
                      {verifying
                        ? 'Verifying Payment...'
                        : `Pay ₹${pendingOrder.amountInr.toLocaleString()} Now`}
                    </button>
                  </div>
                </>
              )}
            </div>
          </form>
        )}

        {/* STEP 3: VERIFIED RECEIPT */}
        {step === 'receipt' && latestReceipt && (
          <div className="max-w-lg mx-auto p-5 rounded-xl bg-emerald-50/60 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 space-y-4">
            <div className="flex items-center gap-2.5 text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="w-5 h-5 shrink-0" />
              <div>
                <div className="text-sm font-bold">
                  Payment Successful · ₹{latestReceipt.amountInr.toLocaleString()}.00 INR
                </div>
                <div className="text-xs text-emerald-700/80 dark:text-emerald-300/80">
                  {PLAN_CATALOG[latestReceipt.plan].name} Plan is now active on your profile.
                </div>
              </div>
            </div>

            <div className="p-3.5 rounded-lg bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 space-y-1.5 text-xs font-mono tabular-nums">
              <div className="flex justify-between">
                <span className="text-stone-500">Receipt ID</span>
                <span className="text-stone-900 dark:text-zinc-100">{latestReceipt.receiptId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-stone-500">Order ID</span>
                <span className="text-stone-900 dark:text-zinc-100">{latestReceipt.orderId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-stone-500">Method</span>
                <span className="text-stone-900 dark:text-zinc-100">{latestReceipt.methodLabel}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-stone-500">Paid At</span>
                <span className="text-stone-900 dark:text-zinc-100">
                  {new Date(latestReceipt.paidAt).toLocaleString()}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setStep('history')}
                className="px-3.5 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 text-xs font-medium text-stone-700 dark:text-zinc-300"
              >
                View All Receipts
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
              >
                Start Training
              </button>
            </div>
          </div>
        )}

        {/* STEP 4: RECEIPT HISTORY */}
        {step === 'history' && (
          <div className="space-y-3">
            {receipts.length === 0 ? (
              <div className="p-6 text-center text-xs text-stone-500 dark:text-zinc-400">
                No completed payments yet.
              </div>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {receipts.map((r) => (
                  <div
                    key={r.receiptId}
                    className="p-3.5 rounded-lg border border-stone-200 dark:border-zinc-800 bg-stone-50 dark:bg-zinc-950 flex flex-wrap items-center justify-between gap-3 text-xs"
                  >
                    <div>
                      <div className="font-semibold text-stone-900 dark:text-zinc-100">
                        {PLAN_CATALOG[r.plan].name} Plan · {r.methodLabel}
                      </div>
                      <div className="text-[11px] font-mono text-stone-500 dark:text-zinc-400">
                        {r.receiptId} · {new Date(r.paidAt).toLocaleString()}
                      </div>
                    </div>
                    <div className="font-mono font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                      ₹{r.amountInr.toLocaleString()}.00 Paid
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="p-3 rounded-lg border bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900 text-xs font-medium text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-[11px] text-stone-500 dark:text-zinc-400">
          <span>
            {gatewayMode === 'live'
              ? authUser
                ? `Billing synced to "${authUser.username}". Razorpay Live INR merchant settlement is active.`
                : 'Razorpay Live INR merchant settlement is active. Sign in to sync upgraded plans across devices.'
              : gatewayMode === 'test'
              ? 'Razorpay Test Mode active. Switch RAZORPAY_KEY_ID & RAZORPAY_KEY_SECRET to rzp_live_ keys for live rupee payouts.'
              : authUser
              ? `Billing synced to "${authUser.username}". Sandbox mode active until RAZORPAY_KEY_ID & RAZORPAY_KEY_SECRET are configured.`
              : 'Sandbox mode active until RAZORPAY_KEY_ID & RAZORPAY_KEY_SECRET are set in AI Studio Secrets.'}
          </span>
          {!authUser && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenAuth('register');
              }}
              className="text-emerald-600 dark:text-emerald-400 font-semibold hover:underline"
            >
              Sign Up / Log In
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
