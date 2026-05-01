import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Crown,
  Clock,
  CheckCircle,
  AlertTriangle,
  Phone,
  Mail,
  ArrowLeft,
  Zap,
  Shield,
  Star,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

// ─── Plan Definitions ────────────────────────────────────────────────────────

interface Plan {
  slug: string;
  name: string;
  durationMonths: number;
  priceInr: number;
  discountPercent: number;
  badge?: string;
  highlight?: boolean;
  perMonthPrice: number;
}

const PLANS: Plan[] = [
  {
    slug: 'monthly',
    name: 'Monthly',
    durationMonths: 1,
    priceInr: 999,
    discountPercent: 0,
    perMonthPrice: 999,
  },
  {
    slug: '3months',
    name: '3 Months',
    durationMonths: 3,
    priceInr: 2699,
    discountPercent: 10,
    perMonthPrice: Math.round(2699 / 3),
    badge: '10% off',
  },
  {
    slug: '6months',
    name: '6 Months',
    durationMonths: 6,
    priceInr: 4999,
    discountPercent: 17,
    perMonthPrice: Math.round(4999 / 6),
    badge: '17% off',
    highlight: true,
  },
  {
    slug: '12months',
    name: '12 Months',
    durationMonths: 12,
    priceInr: 8999,
    discountPercent: 25,
    perMonthPrice: Math.round(8999 / 12),
    badge: 'Best Value · 25% off',
  },
];

const FEATURES = [
  'Unlimited patient records',
  'Unlimited test orders',
  'AI-powered result analysis',
  'WhatsApp report sharing',
  'PDF report generation',
  'Multi-user access',
  'Priority support',
];

// ─── Component ───────────────────────────────────────────────────────────────

const Subscription: React.FC = () => {
  const { labName, labStatus, labActiveUpto, trialDaysRemaining } = useAuth();
  const navigate = useNavigate();

  const isTrialActive = labStatus === 'trial';
  const isExpired = labStatus === 'inactive' || labStatus === 'suspended';

  const formatDate = (d: Date | null) => {
    if (!d) return '';
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 p-4 md:p-8">
      <div className="max-w-5xl mx-auto space-y-8">

        {/* ── Back Button ────────────────────────────────────────────────── */}
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-gray-500 hover:text-gray-800 transition-colors text-sm"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="text-center space-y-2">
          <div className="flex justify-center">
            <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg">
              <Crown className="w-8 h-8 text-white" />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-gray-900">
            {isExpired ? 'Renew Your Subscription' : 'Choose a Plan'}
          </h1>
          {labName && (
            <p className="text-gray-500">
              for <span className="font-semibold text-gray-700">{labName}</span>
            </p>
          )}
        </div>

        {/* ── Trial / Status Banner ──────────────────────────────────────── */}
        {isTrialActive && (
          <div
            className={`rounded-2xl p-5 border-2 flex items-start gap-4 ${
              (trialDaysRemaining ?? 5) <= 1
                ? 'bg-red-50 border-red-300'
                : (trialDaysRemaining ?? 5) <= 3
                ? 'bg-amber-50 border-amber-300'
                : 'bg-blue-50 border-blue-300'
            }`}
          >
            <Clock
              className={`w-6 h-6 mt-0.5 flex-shrink-0 ${
                (trialDaysRemaining ?? 5) <= 1
                  ? 'text-red-500'
                  : (trialDaysRemaining ?? 5) <= 3
                  ? 'text-amber-500'
                  : 'text-blue-500'
              }`}
            />
            <div>
              <p className="font-semibold text-gray-800">
                {trialDaysRemaining != null && trialDaysRemaining > 0
                  ? `Free trial ends in ${trialDaysRemaining} day${trialDaysRemaining === 1 ? '' : 's'}`
                  : 'Free trial ends today'}
              </p>
              {labActiveUpto && (
                <p className="text-sm text-gray-500 mt-0.5">
                  Expiry date: {formatDate(labActiveUpto)}
                </p>
              )}
              <p className="text-sm text-gray-600 mt-1">
                Subscribe now to keep uninterrupted access to all features.
              </p>
            </div>
          </div>
        )}

        {isExpired && (
          <div className="rounded-2xl p-5 border-2 bg-red-50 border-red-300 flex items-start gap-4">
            <AlertTriangle className="w-6 h-6 mt-0.5 flex-shrink-0 text-red-500" />
            <div>
              <p className="font-semibold text-red-800">Your subscription has expired</p>
              {labActiveUpto && (
                <p className="text-sm text-red-600 mt-0.5">
                  Expired on {formatDate(labActiveUpto)}
                </p>
              )}
              <p className="text-sm text-red-700 mt-1">
                Choose a plan below to restore full access to {labName || 'your lab'}.
              </p>
            </div>
          </div>
        )}

        {/* ── Plan Cards ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {PLANS.map((plan) => (
            <PlanCard key={plan.slug} plan={plan} />
          ))}
        </div>

        {/* ── What's Included ────────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <Star className="w-5 h-5 text-yellow-500" />
            Everything included in all plans
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {FEATURES.map((feature) => (
              <div key={feature} className="flex items-center gap-2 text-gray-700 text-sm">
                <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                {feature}
              </div>
            ))}
          </div>
        </div>

        {/* ── Contact Support ────────────────────────────────────────────── */}
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-6">
          <div className="flex items-start gap-3">
            <Shield className="w-6 h-6 text-blue-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-semibold text-blue-800 mb-1">Need help choosing a plan?</h3>
              <p className="text-sm text-blue-700 mb-4">
                Our team is happy to assist you. Contact us and we'll activate your subscription immediately.
              </p>
              <div className="flex flex-wrap gap-4">
                <a
                  href="tel:+919876543210"
                  className="flex items-center gap-2 text-blue-700 hover:text-blue-900 font-medium text-sm transition-colors"
                >
                  <Phone className="w-4 h-4" />
                  +91 78630 57036
                </a>
                <a
                  href="mailto:anprohealthtech@gmail.com"
                  className="flex items-center gap-2 text-blue-700 hover:text-blue-900 font-medium text-sm transition-colors"
                >
                  <Mail className="w-4 h-4" />
                  anprohealthtech@gmail.com
                </a>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};

// ─── Plan Card ───────────────────────────────────────────────────────────────

const PlanCard: React.FC<{ plan: Plan }> = ({ plan }) => {
  const fullPrice = plan.durationMonths * 999; // base monthly rate
  const savingsInr = plan.discountPercent > 0 ? Math.round(fullPrice - plan.priceInr) : 0;

  return (
    <div
      className={`relative flex flex-col rounded-2xl border-2 p-5 transition-shadow hover:shadow-md ${
        plan.highlight
          ? 'border-blue-500 bg-gradient-to-b from-blue-50 to-white shadow-md'
          : 'border-gray-200 bg-white'
      }`}
    >
      {/* Badge */}
      {plan.badge && (
        <div
          className={`absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${
            plan.highlight
              ? 'bg-blue-600 text-white'
              : 'bg-gradient-to-r from-purple-500 to-pink-500 text-white'
          }`}
        >
          {plan.badge}
        </div>
      )}

      {/* Plan Name */}
      <p className={`text-sm font-medium mt-1 ${plan.highlight ? 'text-blue-600' : 'text-gray-500'}`}>
        {plan.name}
      </p>

      {/* Price */}
      <div className="mt-2 mb-1">
        <span className="text-3xl font-bold text-gray-900">₹{plan.priceInr.toLocaleString('en-IN')}</span>
      </div>

      {/* Per-month breakdown */}
      <p className="text-xs text-gray-400 mb-1">
        ₹{plan.perMonthPrice}/month
        {plan.durationMonths > 1 && ` · billed as ₹${plan.priceInr.toLocaleString('en-IN')}`}
      </p>

      {/* Savings */}
      {savingsInr > 0 && (
        <p className="text-xs font-medium text-green-600 mb-3">
          Save ₹{savingsInr.toLocaleString('en-IN')}
        </p>
      )}

      {/* Duration pill */}
      <div className="mb-4 mt-auto">
        <span className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 text-gray-600 rounded-lg text-xs">
          <Clock className="w-3 h-3" />
          {plan.durationMonths} {plan.durationMonths === 1 ? 'month' : 'months'}
        </span>
      </div>

      {/* CTA Button — Coming Soon */}
      <button
        disabled
        className={`w-full py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 cursor-not-allowed opacity-70 ${
          plan.highlight
            ? 'bg-blue-600 text-white'
            : 'bg-gray-800 text-white'
        }`}
        title="Online payment coming soon — contact support to subscribe"
      >
        <Zap className="w-4 h-4" />
        Pay with Razorpay
        <span className="ml-1 px-1.5 py-0.5 bg-white/20 rounded text-xs">Soon</span>
      </button>

      <p className="text-xs text-center text-gray-400 mt-2">
        Contact support to activate
      </p>
    </div>
  );
};

export default Subscription;
