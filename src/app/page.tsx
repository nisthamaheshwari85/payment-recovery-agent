'use client';

import React, { useState, useEffect, useTransition } from 'react';
import {
  ShieldAlert,
  Zap,
  TrendingUp,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  Clock,
  UserX,
  MessageSquare,
  Search,
  ChevronRight,
  ExternalLink,
  Sliders,
  Sparkles,
  ArrowUpRight,
  Send,
  UserCheck,
  RefreshCw,
  X,
  Lock,
  Repeat,
  AlertOctagon,
  MousePointerClick,
} from 'lucide-react';
import { Transaction, AnalyticsSummary, FailureBucket, Customer, RecoveryAttempt, RecurringFailurePattern } from '@/lib/types';
import { maskPhoneNumber } from '@/lib/masking';
import { computeExplainableScoreBreakdown } from '@/lib/scoringBreakdown';
import { generateTransactionAuditTrail } from '@/lib/auditTrail';
import { BUCKET_COOLDOWN_POLICIES } from '@/lib/guardrails';

export default function DashboardPage() {
  const [analytics, setAnalytics] = useState<AnalyticsSummary | null>(null);
  const [recurringPatterns, setRecurringPatterns] = useState<RecurringFailurePattern[]>([]);
  const [circuitBreakers, setCircuitBreakers] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [selectedBucket, setSelectedBucket] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [isSeeding, setIsSeeding] = useState<boolean>(false);

  // Selected Transaction for Modal / Drawer
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [runningTxId, setRunningTxId] = useState<string | null>(null);
  const [revealedPhoneTxId, setRevealedPhoneTxId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [systemStatus, setSystemStatus] = useState<any>(null);

  // Active view tab: 'feed' or 'escalations'
  const [activeTab, setActiveTab] = useState<'feed' | 'escalations'>('feed');

  // Load Data
  const fetchData = async () => {
    try {
      setLoading(true);
      const [analyticsRes, txRes, statusRes] = await Promise.all([
        fetch('/api/analytics'),
        fetch('/api/transactions'),
        fetch('/api/razorpay/status').catch(() => null),
      ]);
      const analyticsData = await analyticsRes.json();
      const txData = await txRes.json();
      if (statusRes) {
        const statusData = await statusRes.json().catch(() => null);
        if (statusData) setSystemStatus(statusData);
      }

      if (analyticsData.analytics) setAnalytics(analyticsData.analytics);
      if (analyticsData.recurring_patterns) setRecurringPatterns(analyticsData.recurring_patterns);
      if (analyticsData.circuit_breakers) setCircuitBreakers(analyticsData.circuit_breakers);
      if (txData.transactions) setTransactions(txData.transactions);
    } catch (err) {
      console.error('Failed to load dashboard data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Handle Seed
  const handleSeed = async () => {
    try {
      setIsSeeding(true);
      const res = await fetch('/api/seed', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setActionMessage({
          type: 'success',
          text: `Seeded ${data.counts.transactionsCount} realistic failed transactions & drop-offs!`,
        });
        await fetchData();
      }
    } catch (err) {
      setActionMessage({ type: 'error', text: 'Failed to seed synthetic dataset.' });
    } finally {
      setIsSeeding(false);
    }
  };

  // Trigger Recovery
  const handleTriggerRecovery = async (txId: string) => {
    try {
      setActionLoading(true);
      setRunningTxId(txId);
      setActionMessage(null);

      // Open drawer immediately so user sees live synthesis
      const currentTx = transactions.find((t) => t.id === txId);
      if (currentTx) {
        setSelectedTx(currentTx);
        setModalOpen(true);
      }

      const res = await fetch('/api/recovery/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction_id: txId }),
      });
      const data = await res.json();

      if (data.success) {
        setActionMessage({
          type: 'success',
          text: `Recovery attempt #${data.attempt?.attempt_number} dispatched successfully via Hinglish Agent!`,
        });
        // Update local state
        await fetchData();
        const updated = await (await fetch(`/api/transactions`)).json();
        const found = updated.transactions.find((t: Transaction) => t.id === txId);
        if (found) {
          setSelectedTx(found);
          setModalOpen(true);
        }
      } else {
        setActionMessage({
          type: 'error',
          text: `Guardrail Rejection (${data.guardrail?.code}): ${data.guardrail?.message}`,
        });
      }
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err?.message || 'Error executing recovery.' });
    } finally {
      setActionLoading(false);
      setRunningTxId(null);
    }
  };

  // Simulate Customer Action (Opt Out / Pay / Cooldown)
  const handleSimulateAction = async (txId: string, action: string) => {
    try {
      setActionLoading(true);
      const res = await fetch('/api/recovery/simulate-customer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction_id: txId, action }),
      });
      const data = await res.json();

      if (data.success) {
        setActionMessage({
          type: 'info',
          text: data.message,
        });
        await fetchData();
        const updated = await (await fetch(`/api/transactions`)).json();
        const found = updated.transactions.find((t: Transaction) => t.id === txId);
        if (found) setSelectedTx(found);
      } else {
        setActionMessage({ type: 'error', text: data.error });
      }
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err?.message || 'Simulation failed.' });
    } finally {
      setActionLoading(false);
    }
  };

  // Filter transactions
  const filteredTransactions = transactions.filter((tx) => {
    const matchesStatus =
      selectedStatus === 'all'
        ? true
        : selectedStatus === 'ready'
        ? (tx.recovery_attempts?.length || 0) === 0 && tx.status === 'failed'
        : tx.status === selectedStatus;

    const matchesBucket =
      selectedBucket === 'all' ? true : tx.failure_bucket === selectedBucket;

    const query = searchQuery.toLowerCase();
    const matchesSearch =
      !query ||
      tx.customer?.name.toLowerCase().includes(query) ||
      tx.customer?.phone.includes(query) ||
      tx.razorpay_payment_id.toLowerCase().includes(query) ||
      tx.failure_reason_raw.toLowerCase().includes(query);

    return matchesStatus && matchesBucket && matchesSearch;
  });

  const getBucketBadgeClass = (bucket: FailureBucket) => {
    switch (bucket) {
      case 'upi_timeout': return 'badge-upi';
      case 'card_decline': return 'badge-card';
      case 'network_error': return 'badge-network';
      case 'cart_abandon': return 'badge-cart';
      case 'insufficient_funds': return 'badge-funds';
      default: return 'badge-other';
    }
  };

  const formatStatus = (status: string) => {
    if (status === 'auto_resolved_late_capture') return 'Auto-Resolved (Late Capture)';
    if (status === 'not_economically_viable') return 'ROI Skipped';
    if (status === 'escalated_human_review') return 'Human Review';
    return status.replace(/_/g, ' ');
  };

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'recovered': return 'status-recovered';
      case 'auto_resolved_late_capture': return 'status-recovered';
      case 'in_recovery': return 'status-recovering';
      case 'escalated_human_review': return 'status-escalated';
      case 'not_economically_viable': return 'status-unviable';
      case 'opted_out': return 'status-opted_out';
      default: return 'status-failed';
    }
  };

  return (
    <main style={{ minHeight: '100vh', padding: '24px 32px' }}>
      {/* 1. TOP NAVBAR */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '28px',
          paddingBottom: '20px',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div
            style={{
              width: '46px',
              height: '46px',
              borderRadius: '12px',
              background: 'linear-gradient(135deg, #2563eb, #7c3aed)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 20px rgba(37, 99, 235, 0.4)',
            }}
          >
            <Zap size={26} color="#ffffff" />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <h1 style={{ fontSize: '1.4rem', fontWeight: 700, letterSpacing: '-0.02em' }}>
                Razorpay Revenue Recovery Agent
              </h1>
              <span
                style={{
                  background: 'rgba(59, 130, 246, 0.15)',
                  color: '#60a5fa',
                  border: '1px solid rgba(59, 130, 246, 0.3)',
                  padding: '2px 8px',
                  borderRadius: '6px',
                  fontSize: '0.72rem',
                  fontWeight: 600,
                }}
              >
                Buildathon 2026
              </span>
            </div>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              AI Revenue Recovery Track • Hinglish Autonomous Recovery Engine • Defensive Hard Guardrails
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          {/* LLM Status Indicator */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '5px 12px',
              background: 'rgba(59, 130, 246, 0.08)',
              border: '1px solid rgba(59, 130, 246, 0.25)',
              borderRadius: '9999px',
              fontSize: '0.78rem',
              color: '#93c5fd',
            }}
            title="Live LLM inference engine via Groq"
          >
            <Sparkles size={13} color="#60a5fa" />
            <span>LLM: {systemStatus?.llm?.primary_model || 'Groq qwen3.8-27b'}</span>
          </div>

          {/* Razorpay Status Indicator */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '5px 12px',
              background: systemStatus?.razorpay?.is_configured
                ? 'rgba(16, 185, 129, 0.08)'
                : 'rgba(245, 158, 11, 0.08)',
              border: systemStatus?.razorpay?.is_configured
                ? '1px solid rgba(16, 185, 129, 0.25)'
                : '1px solid rgba(245, 158, 11, 0.25)',
              borderRadius: '9999px',
              fontSize: '0.78rem',
              color: systemStatus?.razorpay?.is_configured ? '#34d399' : '#fcd34d',
            }}
            title={
              systemStatus?.razorpay?.is_configured
                ? `Razorpay Test Mode connected (${systemStatus.razorpay.key_id_preview})`
                : 'Razorpay API credentials pending in .env.local (simulated links active)'
            }
          >
            <Zap size={13} color={systemStatus?.razorpay?.is_configured ? '#34d399' : '#f59e0b'} />
            <span>
              Razorpay: {systemStatus?.razorpay?.is_configured ? 'Test Mode API Live' : 'Test Mode (Demo)'}
            </span>
          </div>

          {/* Agent Status Indicator */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '5px 12px',
              background: 'rgba(16, 185, 129, 0.08)',
              border: '1px solid rgba(16, 185, 129, 0.25)',
              borderRadius: '9999px',
              fontSize: '0.78rem',
              color: '#34d399',
            }}
          >
            <span className="live-pulse" />
            <span>Guardrails Active</span>
          </div>

          <button
            id="btn-refresh"
            onClick={fetchData}
            className="btn-secondary"
            disabled={loading}
            title="Refresh analytics and telemetry"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </button>

          <button
            id="btn-reseed"
            onClick={handleSeed}
            className="btn-primary"
            disabled={isSeeding}
            style={{ background: 'linear-gradient(135deg, #4f46e5, #7c3aed)' }}
          >
            <Sparkles size={16} />
            <span>{isSeeding ? 'Seeding...' : 'Seed 50+ Test Cases'}</span>
          </button>
        </div>
      </header>

      {/* ACTION BANNER / TOAST */}
      {actionMessage && (
        <div
          style={{
            marginBottom: '20px',
            padding: '12px 18px',
            borderRadius: '10px',
            background:
              actionMessage.type === 'error'
                ? 'rgba(239, 68, 68, 0.15)'
                : actionMessage.type === 'success'
                ? 'rgba(16, 185, 129, 0.15)'
                : 'rgba(59, 130, 246, 0.15)',
            border: `1px solid ${
              actionMessage.type === 'error'
                ? 'rgba(239, 68, 68, 0.4)'
                : actionMessage.type === 'success'
                ? 'rgba(16, 185, 129, 0.4)'
                : 'rgba(59, 130, 246, 0.4)'
            }`,
            color:
              actionMessage.type === 'error'
                ? '#fca5a5'
                : actionMessage.type === 'success'
                ? '#6ee7b7'
                : '#93c5fd',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '0.875rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {actionMessage.type === 'error' ? (
              <AlertTriangle size={18} />
            ) : actionMessage.type === 'success' ? (
              <CheckCircle2 size={18} />
            ) : (
              <Lock size={18} />
            )}
            <span>{actionMessage.text}</span>
          </div>
          <button
            onClick={() => setActionMessage(null)}
            style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer' }}
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* 2. TOP METRIC CARDS */}
      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
          gap: '16px',
          marginBottom: '28px',
        }}
      >
        {/* Card 1: Revenue at Risk */}
        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Total Revenue At Risk
            </span>
            <span style={{ color: '#f87171', background: 'rgba(239, 68, 68, 0.12)', padding: '4px', borderRadius: '6px' }}>
              <AlertTriangle size={18} />
            </span>
          </div>
          <div style={{ fontSize: '1.85rem', fontWeight: 700, margin: '8px 0 4px', color: '#ffffff' }}>
            ₹{analytics?.total_revenue_at_risk.toLocaleString('en-IN') || '0'}
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Across {analytics?.total_transactions || 0} dropped / failed checkouts
          </div>
        </div>

        {/* Card 2: Revenue Recovered */}
        <div className="glass-panel" style={{ padding: '20px', borderLeft: '3px solid #10b981' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Total Recovered
            </span>
            <span style={{ color: '#34d399', background: 'rgba(16, 185, 129, 0.12)', padding: '4px', borderRadius: '6px' }}>
              <TrendingUp size={18} />
            </span>
          </div>
          <div style={{ fontSize: '1.85rem', fontWeight: 700, margin: '8px 0 4px', color: '#34d399' }}>
            ₹{analytics?.total_recovered_revenue.toLocaleString('en-IN') || '0'}
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            {analytics?.recovered_count || 0} successfully salvaged orders
          </div>
        </div>

        {/* Card 3: Recovery Rate */}
        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Blended Recovery Rate
            </span>
            <span style={{ color: '#60a5fa', background: 'rgba(59, 130, 246, 0.12)', padding: '4px', borderRadius: '6px' }}>
              <Zap size={18} />
            </span>
          </div>
          <div style={{ fontSize: '1.85rem', fontWeight: 700, margin: '8px 0 4px', color: '#ffffff' }}>
            {analytics?.blended_recovery_rate || 0}%
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Target: 15-20% benchmark
          </div>
        </div>

        {/* Card 4: Active In Recovery */}
        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Active In-Flight
            </span>
            <span style={{ color: '#fbbf24', background: 'rgba(245, 158, 11, 0.12)', padding: '4px', borderRadius: '6px' }}>
              <Clock size={18} />
            </span>
          </div>
          <div style={{ fontSize: '1.85rem', fontWeight: 700, margin: '8px 0 4px', color: '#fbbf24' }}>
            {analytics?.active_in_recovery || 0}
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Respecting 6-hr cooldown window
          </div>
        </div>

        {/* Card 5: Escalated to Human Review */}
        <div className="glass-panel" style={{ padding: '20px', borderLeft: '3px solid #ef4444' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Needs Human Review
            </span>
            <span style={{ color: '#f87171', background: 'rgba(239, 68, 68, 0.12)', padding: '4px', borderRadius: '6px' }}>
              <ShieldAlert size={18} />
            </span>
          </div>
          <div style={{ fontSize: '1.85rem', fontWeight: 700, margin: '8px 0 4px', color: '#f87171' }}>
            {analytics?.escalated_count || 0}
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Hit 3 attempts without spamming
          </div>
        </div>
      </section>

      {/* 3. VISUALIZERS: FAILURE BUCKETS & RECOVERY FUNNEL */}
      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))',
          gap: '20px',
          marginBottom: '28px',
        }}
      >
        {/* Left: Recovery by Failure Bucket */}
        <div className="glass-panel" style={{ padding: '22px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h2 style={{ fontSize: '1.05rem', fontWeight: 600 }}>Recovery Performance by Failure Bucket</h2>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>6 Root Cause Categories</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {analytics &&
              Object.entries(analytics.bucket_metrics).map(([bucket, metric]) => {
                const b = bucket as FailureBucket;
                return (
                  <div key={b}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.825rem', marginBottom: '4px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span className={`badge ${getBucketBadgeClass(b)}`} style={{ fontSize: '0.68rem', padding: '2px 8px' }}>
                          {b.replace('_', ' ')}
                        </span>
                        <span style={{ color: 'var(--text-secondary)' }}>({metric.count} events)</span>
                      </div>
                      <div style={{ display: 'flex', gap: '12px' }}>
                        <span style={{ color: 'var(--text-muted)' }}>
                          ₹{metric.revenue_recovered.toLocaleString('en-IN')} / ₹{metric.revenue_at_risk.toLocaleString('en-IN')}
                        </span>
                        <span style={{ fontWeight: 600, color: metric.recovery_rate > 20 ? '#34d399' : metric.recovery_rate > 10 ? '#60a5fa' : '#9ca3af' }}>
                          {metric.recovery_rate}%
                        </span>
                      </div>
                    </div>
                    {/* Progress Track */}
                    <div
                      style={{
                        height: '6px',
                        background: 'rgba(255, 255, 255, 0.06)',
                        borderRadius: '3px',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          height: '100%',
                          width: `${Math.min(100, Math.max(4, metric.recovery_rate))}%`,
                          background:
                            b === 'upi_timeout'
                              ? 'linear-gradient(90deg, #8b5cf6, #c084fc)'
                              : b === 'network_error'
                              ? 'linear-gradient(90deg, #f59e0b, #fbbf24)'
                              : b === 'cart_abandon'
                              ? 'linear-gradient(90deg, #06b6d4, #38bdf8)'
                              : b === 'card_decline'
                              ? 'linear-gradient(90deg, #3b82f6, #60a5fa)'
                              : 'linear-gradient(90deg, #ef4444, #f87171)',
                          borderRadius: '3px',
                        }}
                      />
                    </div>
                  </div>
                );
              })}
          </div>
        </div>

        {/* Right: Funnel & Hard Constraints Enforced */}
        <div className="glass-panel" style={{ padding: '22px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h2 style={{ fontSize: '1.05rem', fontWeight: 600 }}>Attempts-to-Conversion Funnel</h2>
            <span style={{ fontSize: '0.75rem', color: '#10b981', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Lock size={12} /> Bounded Policy
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '20px' }}>
            {analytics && (
              <>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.825rem', marginBottom: '4px' }}>
                    <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                      Attempt #1 (Initial Hinglish Outreach)
                    </span>
                    <span style={{ color: '#34d399', fontWeight: 600 }}>
                      {analytics.attempts_funnel.attempt_1.converted} recovered ({analytics.attempts_funnel.attempt_1.rate}%)
                    </span>
                  </div>
                  <div style={{ height: '7px', background: 'rgba(255,255,255,0.06)', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: '100%', background: '#3b82f6' }} />
                  </div>
                </div>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.825rem', marginBottom: '4px' }}>
                    <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                      Attempt #2 (After &gt;6h Cooldown Gap)
                    </span>
                    <span style={{ color: '#60a5fa', fontWeight: 600 }}>
                      {analytics.attempts_funnel.attempt_2.converted} recovered ({analytics.attempts_funnel.attempt_2.rate}%)
                    </span>
                  </div>
                  <div style={{ height: '7px', background: 'rgba(255,255,255,0.06)', borderRadius: '4px', overflow: 'hidden' }}>
                    <div
                      style={{
                        height: '100%',
                        width: `${Math.round((analytics.attempts_funnel.attempt_2.sent / (analytics.attempts_funnel.attempt_1.sent || 1)) * 100)}%`,
                        background: '#6366f1',
                      }}
                    />
                  </div>
                </div>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.825rem', marginBottom: '4px' }}>
                    <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                      Attempt #3 (Final Gentle Nudge)
                    </span>
                    <span style={{ color: '#fbbf24', fontWeight: 600 }}>
                      {analytics.attempts_funnel.attempt_3.converted} recovered ({analytics.attempts_funnel.attempt_3.rate}%)
                    </span>
                  </div>
                  <div style={{ height: '7px', background: 'rgba(255,255,255,0.06)', borderRadius: '4px', overflow: 'hidden' }}>
                    <div
                      style={{
                        height: '100%',
                        width: `${Math.round((analytics.attempts_funnel.attempt_3.sent / (analytics.attempts_funnel.attempt_1.sent || 1)) * 100)}%`,
                        background: '#f59e0b',
                      }}
                    />
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Hard Guardrails Checklist */}
          <div
            style={{
              padding: '12px 14px',
              borderRadius: '10px',
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid var(--border-subtle)',
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '8px',
              fontSize: '0.75rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#34d399' }}>
              <CheckCircle2 size={13} />
              <span>MAX 3 attempts strictly capped</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#34d399' }}>
              <CheckCircle2 size={13} />
              <span>6-hour mandatory cooldown</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#34d399' }}>
              <CheckCircle2 size={13} />
              <span>Opt-out &quot;STOP&quot; killswitch</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#34d399' }}>
              <CheckCircle2 size={13} />
              <span>Zero pressure &amp; dark patterns</span>
            </div>
          </div>
        </div>
      </section>

      {/* 3.4 ATTRIBUTION FUNNEL: MESSAGED -> CLICKED -> RETRIED -> RECOVERED */}
      <section
        id="attribution-funnel-panel"
        className="glass-panel"
        style={{
          padding: '22px',
          marginBottom: '28px',
          borderLeft: '4px solid #10b981',
          background: 'rgba(16, 185, 129, 0.03)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h2 style={{ fontSize: '1.05rem', fontWeight: 600 }}>End-to-End Recovery Attribution Funnel</h2>
              <span className="badge badge-success" style={{ fontSize: '0.68rem', padding: '2px 8px' }}>
                Traceable Attribution
              </span>
            </div>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
              Tracks customer lifecycle events across outreach: Messaged → Link Clicked → Payment Retried → Payment Successful.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Attributed Recovered</div>
              <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#34d399' }}>
                ₹{analytics?.attribution_funnel?.recovered_revenue?.toLocaleString('en-IN') || 0}
              </div>
            </div>
          </div>
        </div>

        {/* 4-Step Visual Flow Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
          {/* Step 1: Messaged */}
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-subtle)', borderRadius: '10px', padding: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 500 }}>STEP 1: OUTREACH</span>
              <span style={{ color: '#3b82f6', background: 'rgba(59,130,246,0.1)', padding: '4px', borderRadius: '6px' }}>
                <Send size={14} />
              </span>
            </div>
            <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#60a5fa' }}>
              {analytics?.attribution_funnel?.messaged_count || 0}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
              Dispatched via WhatsApp / SMS
            </div>
          </div>

          {/* Step 2: Link Clicked */}
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-subtle)', borderRadius: '10px', padding: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 500 }}>STEP 2: LINK CLICKED</span>
              <span style={{ color: '#8b5cf6', background: 'rgba(139,92,246,0.1)', padding: '4px', borderRadius: '6px' }}>
                <ExternalLink size={14} />
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
              <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#a78bfa' }}>
                {analytics?.attribution_funnel?.link_clicked_count || 0}
              </div>
              <div style={{ fontSize: '0.8rem', color: '#c084fc', fontWeight: 600 }}>
                ({analytics?.attribution_funnel?.click_rate || 0}% CTR)
              </div>
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
              Payment link opened by customer
            </div>
          </div>

          {/* Step 3: Payment Retried */}
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-subtle)', borderRadius: '10px', padding: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 500 }}>STEP 3: RETRIED</span>
              <span style={{ color: '#f59e0b', background: 'rgba(245,158,11,0.1)', padding: '4px', borderRadius: '6px' }}>
                <RefreshCw size={14} />
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
              <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#fbbf24' }}>
                {analytics?.attribution_funnel?.payment_retried_count || 0}
              </div>
              <div style={{ fontSize: '0.8rem', color: '#fcd34d', fontWeight: 600 }}>
                ({analytics?.attribution_funnel?.retry_rate || 0}% of clicks)
              </div>
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
              Checkout re-initiated
            </div>
          </div>

          {/* Step 4: Attributed as Recovered */}
          <div style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: '10px', padding: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontSize: '0.75rem', color: '#34d399', fontWeight: 600 }}>STEP 4: RECOVERED</span>
              <span style={{ color: '#10b981', background: 'rgba(16,185,129,0.2)', padding: '4px', borderRadius: '6px' }}>
                <CheckCircle2 size={14} />
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
              <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#34d399' }}>
                {analytics?.attribution_funnel?.payment_successful_count || 0}
              </div>
              <div style={{ fontSize: '0.8rem', color: '#6ee7b7', fontWeight: 600 }}>
                ({analytics?.attribution_funnel?.conversion_rate || 0}% conv)
              </div>
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
              Full payment captured &amp; attributed
            </div>
          </div>
        </div>
      </section>

      {/* 3.5 EXPLAINABLE SIGNALS: RECURRING FAILURE PATTERNS */}
      <section
        id="recurring-patterns-panel"
        className="glass-panel"
        style={{
          padding: '22px',
          marginBottom: '28px',
          borderLeft: '4px solid #a855f7',
          background: 'rgba(168, 85, 247, 0.03)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: '16px',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span
                style={{
                  background: 'rgba(168, 85, 247, 0.15)',
                  color: '#c084fc',
                  padding: '4px',
                  borderRadius: '6px',
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                <Repeat size={18} />
              </span>
              <h2 style={{ fontSize: '1.05rem', fontWeight: 600, color: '#ffffff', margin: 0 }}>
                Customers with Recurring Failure Patterns
              </h2>
              <span
                style={{
                  fontSize: '0.725rem',
                  padding: '2px 8px',
                  borderRadius: '12px',
                  background: 'rgba(168, 85, 247, 0.2)',
                  color: '#d8b4fe',
                  fontWeight: 600,
                  border: '1px solid rgba(168, 85, 247, 0.4)',
                }}
              >
                {recurringPatterns.length} Flagged
              </span>
            </div>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '4px 0 0' }}>
              Explainable historical telemetry — identifies repeat root causes across customer checkouts (≥2 in same bucket) to guide preventive remediation.
            </p>
          </div>
          <div
            style={{
              fontSize: '0.72rem',
              color: 'var(--text-muted)',
              background: 'rgba(255, 255, 255, 0.04)',
              padding: '6px 12px',
              borderRadius: '6px',
              border: '1px solid var(--border-subtle)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span>Telemetry: Rule-based count history (NOT opaque ML)</span>
          </div>
        </div>

        {recurringPatterns.length === 0 ? (
          <div
            style={{
              padding: '20px',
              textAlign: 'center',
              color: 'var(--text-muted)',
              fontSize: '0.825rem',
              background: 'rgba(0,0,0,0.2)',
              borderRadius: '8px',
            }}
          >
            No customers currently meet the recurring failure threshold (≥2 past transactions with the same failure bucket).
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
              gap: '14px',
            }}
          >
            {recurringPatterns.map((pat) => (
              <div
                key={`${pat.customer_id}-${pat.repeated_bucket}`}
                style={{
                  background: 'rgba(0, 0, 0, 0.28)',
                  border: '1px solid rgba(168, 85, 247, 0.25)',
                  borderRadius: '10px',
                  padding: '14px 16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                  transition: 'border-color 0.15s ease',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.875rem', color: '#ffffff' }}>
                      {pat.customer_name}
                    </div>
                    <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                      {maskPhoneNumber(pat.customer_phone)}
                    </div>
                  </div>
                  <span className={`badge ${getBucketBadgeClass(pat.repeated_bucket)}`} style={{ fontSize: '0.7rem' }}>
                    {pat.repeated_bucket.replace('_', ' ')}
                  </span>
                </div>

                <div
                  style={{
                    background: 'rgba(168, 85, 247, 0.1)',
                    borderRadius: '6px',
                    padding: '8px 10px',
                    fontSize: '0.76rem',
                    color: '#e9d5ff',
                    border: '1px solid rgba(168, 85, 247, 0.2)',
                  }}
                >
                  <strong style={{ color: '#d8b4fe' }}>Pattern: </strong>
                  {pat.plain_language_reason}
                </div>

                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                  <span style={{ color: '#c084fc', fontWeight: 600 }}>Suggested Prevention: </span>
                  {pat.suggested_prevention_action}
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'auto', paddingTop: '4px' }}>
                  <button
                    onClick={() => {
                      setSearchQuery(pat.customer_name);
                      const el = document.getElementById('search-input');
                      if (el) el.focus();
                    }}
                    style={{
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      color: 'var(--text-secondary)',
                      padding: '4px 10px',
                      borderRadius: '6px',
                      fontSize: '0.72rem',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = '#ffffff')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
                  >
                    <span>Filter feed for customer</span>
                    <ArrowUpRight size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* MASS-FAILURE CIRCUIT BREAKER SYSTEMIC ALERT BANNER */}
      {circuitBreakers && circuitBreakers.length > 0 && (
        <section
          id="circuit-breaker-alert-banner"
          style={{
            marginBottom: '24px',
            padding: '18px 24px',
            borderRadius: '12px',
            background: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            boxShadow: '0 4px 24px rgba(239, 68, 68, 0.18)',
          }}
        >
          <div
            style={{
              width: '42px',
              height: '42px',
              borderRadius: '10px',
              background: 'rgba(239, 68, 68, 0.25)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ef4444',
              flexShrink: 0,
            }}
          >
            <AlertOctagon size={24} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
              <span style={{ fontSize: '13px', fontWeight: 700, color: '#ef4444', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Systemic Mass-Failure Circuit Breaker Tripped
              </span>
              <span className="badge" style={{ background: 'rgba(239, 68, 68, 0.25)', color: '#fca5a5', fontSize: '10px', fontWeight: 600 }}>
                Automated Recovery Gated
              </span>
            </div>
            {circuitBreakers.map((cb, idx) => (
              <div key={idx} style={{ fontSize: '13px', color: '#fca5a5', lineHeight: 1.5, marginTop: idx > 0 ? '4px' : '0' }}>
                ⚠️ <strong>{cb.message}</strong>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 4. MAIN WORKBENCH / TRANSACTION FEED */}
      <section className="glass-panel" style={{ padding: '24px' }}>
        {/* Controls Bar */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '16px',
            marginBottom: '20px',
          }}
        >
          {/* Status Tabs */}
          <div style={{ display: 'flex', gap: '6px', background: 'rgba(255,255,255,0.04)', padding: '4px', borderRadius: '10px' }}>
            {[
              { id: 'all', label: 'All Events', count: transactions.length },
              { id: 'ready', label: 'Fresh / Ready', count: transactions.filter((t) => (t.recovery_attempts?.length || 0) === 0 && t.status === 'failed').length },
              { id: 'in_recovery', label: 'In Recovery', count: transactions.filter((t) => t.status === 'in_recovery').length },
              { id: 'recovered', label: 'Recovered', count: transactions.filter((t) => t.status === 'recovered').length },
              { id: 'auto_resolved_late_capture', label: 'Late Captured', count: transactions.filter((t) => t.status === 'auto_resolved_late_capture').length },
              { id: 'not_economically_viable', label: 'ROI Skipped', count: transactions.filter((t) => t.status === 'not_economically_viable').length },
              { id: 'escalated_human_review', label: 'Human Review', count: transactions.filter((t) => t.status === 'escalated_human_review').length },
              { id: 'opted_out', label: 'Opted Out', count: transactions.filter((t) => t.status === 'opted_out').length },
            ].map((tab) => (
              <button
                key={tab.id}
                id={`tab-${tab.id}`}
                onClick={() => setSelectedStatus(tab.id)}
                style={{
                  background: selectedStatus === tab.id ? 'var(--brand-blue)' : 'transparent',
                  color: selectedStatus === tab.id ? '#ffffff' : 'var(--text-secondary)',
                  border: 'none',
                  padding: '6px 12px',
                  borderRadius: '7px',
                  fontSize: '0.8rem',
                  fontWeight: selectedStatus === tab.id ? 600 : 500,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  transition: 'all 0.15s ease',
                }}
              >
                <span>{tab.label}</span>
                <span
                  style={{
                    background: selectedStatus === tab.id ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.08)',
                    padding: '1px 6px',
                    borderRadius: '10px',
                    fontSize: '0.7rem',
                  }}
                >
                  {tab.count}
                </span>
              </button>
            ))}
          </div>

          {/* Search and Bucket Filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <select
              value={selectedBucket}
              onChange={(e) => setSelectedBucket(e.target.value)}
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-primary)',
                padding: '8px 12px',
                borderRadius: '8px',
                fontSize: '0.825rem',
                outline: 'none',
              }}
            >
              <option value="all">All Failure Buckets</option>
              <option value="upi_timeout">UPI Timeout</option>
              <option value="card_decline">Card Decline</option>
              <option value="network_error">Network Error</option>
              <option value="cart_abandon">Cart Abandon</option>
              <option value="insufficient_funds">Insufficient Funds</option>
              <option value="other">Other / Fraud Shield</option>
            </select>

            <div style={{ position: 'relative' }}>
              <Search size={15} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                id="search-input"
                type="text"
                placeholder="Search name, phone, or pay ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-primary)',
                  padding: '8px 12px 8px 32px',
                  borderRadius: '8px',
                  fontSize: '0.825rem',
                  width: '240px',
                  outline: 'none',
                }}
              />
            </div>
          </div>
        </div>

        {/* Transactions Table */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
                <th style={{ padding: '12px 14px', fontWeight: 600 }}>CUSTOMER / ID</th>
                <th style={{ padding: '12px 14px', fontWeight: 600 }}>FAILURE ROOT CAUSE</th>
                <th style={{ padding: '12px 14px', fontWeight: 600 }}>AMOUNT</th>
                <th style={{ padding: '12px 14px', fontWeight: 600 }}>RECOVERABILITY</th>
                <th style={{ padding: '12px 14px', fontWeight: 600 }}>ATTEMPTS</th>
                <th style={{ padding: '12px 14px', fontWeight: 600 }}>STATUS</th>
                <th style={{ padding: '12px 14px', fontWeight: 600, textAlign: 'right' }}>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {filteredTransactions.map((tx) => {
                const score = tx.recoverability_score;
                const scoreColor = score >= 75 ? '#34d399' : score >= 50 ? '#60a5fa' : '#f87171';
                const attemptCount = tx.recovery_attempts?.length || 0;

                return (
                  <tr
                    key={tx.id}
                    id={`row-${tx.id}`}
                    style={{
                      borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
                      transition: 'background 0.15s ease',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    {/* Customer & ID */}
                    <td style={{ padding: '14px' }}>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
                        <span>{tx.customer?.name || 'Customer'}</span>
                        {tx.customer?.do_not_contact && (
                          <span style={{ color: '#f87171', fontSize: '0.7rem' }}>[OPTED OUT]</span>
                        )}
                        {tx.has_recurring_failure && (
                          <span
                            title={tx.recurring_pattern_summary || 'Repeat failure pattern detected'}
                            style={{
                              background: 'rgba(168, 85, 247, 0.2)',
                              color: '#c084fc',
                              border: '1px solid rgba(168, 85, 247, 0.4)',
                              padding: '1px 6px',
                              borderRadius: '4px',
                              fontSize: '0.68rem',
                              fontWeight: 600,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '3px',
                            }}
                          >
                            <Repeat size={10} />
                            <span>Repeat Pattern</span>
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                        {maskPhoneNumber(tx.customer?.phone)} • {tx.razorpay_payment_id}
                      </div>
                    </td>

                    {/* Failure Bucket */}
                    <td style={{ padding: '14px' }}>
                      <span className={`badge ${getBucketBadgeClass(tx.failure_bucket)}`}>
                        {tx.failure_bucket.replace('_', ' ')}
                      </span>
                      <div
                        style={{
                          fontSize: '0.75rem',
                          color: 'var(--text-secondary)',
                          marginTop: '4px',
                          maxWidth: '240px',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                        title={tx.failure_reason_raw}
                      >
                        {tx.failure_reason_raw}
                      </div>
                    </td>

                    {/* Amount */}
                    <td style={{ padding: '14px', fontWeight: 600, color: '#ffffff' }}>
                      ₹{tx.amount.toLocaleString('en-IN')}
                    </td>

                    {/* Recoverability Score */}
                    <td style={{ padding: '14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontWeight: 700, color: scoreColor, width: '28px' }}>{score}</span>
                        <div
                          style={{
                            width: '60px',
                            height: '5px',
                            background: 'rgba(255,255,255,0.08)',
                            borderRadius: '3px',
                            overflow: 'hidden',
                          }}
                        >
                          <div style={{ width: `${score}%`, height: '100%', background: scoreColor }} />
                        </div>
                      </div>
                    </td>

                    {/* Attempts (1/3, 2/3, 3/3) */}
                    <td style={{ padding: '14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        {[1, 2, 3].map((num) => (
                          <span
                            key={num}
                            style={{
                              width: '7px',
                              height: '7px',
                              borderRadius: '50%',
                              background:
                                attemptCount >= num
                                  ? tx.status === 'recovered' && attemptCount === num
                                    ? '#10b981'
                                    : '#3b82f6'
                                  : 'rgba(255, 255, 255, 0.15)',
                            }}
                          />
                        ))}
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '4px' }}>
                          {attemptCount}/3
                        </span>
                      </div>
                    </td>

                    {/* Status */}
                    <td style={{ padding: '14px' }}>
                      <span className={`badge ${getStatusBadgeClass(tx.status)}`}>
                        {formatStatus(tx.status)}
                      </span>
                    </td>

                    {/* Actions */}
                    <td style={{ padding: '14px', textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '8px' }}>
                        {tx.status !== 'recovered' && !tx.customer?.do_not_contact && tx.status !== 'escalated_human_review' && (
                          <button
                            id={`btn-run-${tx.id}`}
                            className="btn-primary"
                            style={{ padding: '5px 10px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '6px' }}
                            onClick={() => handleTriggerRecovery(tx.id)}
                            disabled={actionLoading}
                            title="Run AI Hinglish Recovery Agent"
                          >
                            {runningTxId === tx.id ? (
                              <>
                                <RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} />
                                <span>Running...</span>
                              </>
                            ) : (
                              <>
                                <Send size={12} />
                                <span>Run Agent</span>
                              </>
                            )}
                          </button>
                        )}

                        <button
                          id={`btn-inspect-${tx.id}`}
                          className="btn-secondary"
                          style={{ padding: '5px 10px', fontSize: '0.75rem' }}
                          onClick={() => {
                            setSelectedTx(tx);
                            setModalOpen(true);
                          }}
                        >
                          <span>Inspect</span>
                          <ChevronRight size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {filteredTransactions.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
              No transactions match the selected filter.
            </div>
          )}
        </div>
      </section>

      {/* 5. INSPECT & SIMULATE MODAL */}
      {modalOpen && selectedTx && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '20px',
          }}
        >
          <div
            className="glass-panel"
            style={{
              width: '100%',
              maxWidth: '680px',
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: '28px',
              position: 'relative',
              boxShadow: '0 20px 50px rgba(0, 0, 0, 0.8)',
            }}
          >
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <h3 style={{ fontSize: '1.25rem', fontWeight: 700 }}>Recovery Agent Inspection</h3>
                  <span className={`badge ${getStatusBadgeClass(selectedTx.status)}`}>
                    {formatStatus(selectedTx.status)}
                  </span>
                </div>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                  <span>{selectedTx.razorpay_payment_id}</span>
                  <span>•</span>
                  <span>Customer: {selectedTx.customer?.name}</span>
                  <span>•</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    {revealedPhoneTxId === selectedTx.id ? (
                      <>
                        <span style={{ color: '#ffffff', fontWeight: 600 }}>{selectedTx.customer?.phone || 'N/A'}</span>
                        <span
                          style={{
                            fontSize: '0.68rem',
                            padding: '1px 6px',
                            borderRadius: '4px',
                            background: 'rgba(59, 130, 246, 0.2)',
                            color: '#93c5fd',
                            border: '1px solid rgba(59, 130, 246, 0.4)',
                          }}
                        >
                          Unmasked for Review
                        </span>
                        <button
                          onClick={() => setRevealedPhoneTxId(null)}
                          style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.7rem' }}
                        >
                          (hide)
                        </button>
                      </>
                    ) : (
                      <>
                        <span>{maskPhoneNumber(selectedTx.customer?.phone)}</span>
                        <button
                          onClick={() => {
                            setRevealedPhoneTxId(selectedTx.id);
                            setTimeout(() => {
                              setRevealedPhoneTxId((prev) => (prev === selectedTx.id ? null : prev));
                            }, 8000);
                          }}
                          style={{
                            background: 'rgba(255,255,255,0.06)',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: '4px',
                            padding: '1px 6px',
                            fontSize: '0.68rem',
                            color: '#60a5fa',
                            cursor: 'pointer',
                          }}
                        >
                          Reveal
                        </button>
                        <span
                          title="Customer PII masked under DPDP Act data protection principles"
                          style={{
                            fontSize: '0.68rem',
                            padding: '1px 6px',
                            borderRadius: '4px',
                            background: 'rgba(16, 185, 129, 0.12)',
                            color: '#6ee7b7',
                            border: '1px solid rgba(16, 185, 129, 0.3)',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px',
                          }}
                        >
                          <Lock size={10} />
                          <span>🔒 PII Protected</span>
                        </span>
                      </>
                    )}
                  </span>
                </p>
              </div>
              <button
                onClick={() => setModalOpen(false)}
                style={{
                  background: 'rgba(255,255,255,0.06)',
                  border: 'none',
                  borderRadius: '8px',
                  color: 'var(--text-secondary)',
                  padding: '6px',
                  cursor: 'pointer',
                }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Live Progress Notice inside Drawer */}
            {actionLoading && runningTxId === selectedTx.id && (
              <div
                style={{
                  marginBottom: '16px',
                  padding: '12px 16px',
                  borderRadius: '10px',
                  background: 'rgba(59, 130, 246, 0.15)',
                  border: '1px solid rgba(59, 130, 246, 0.4)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  color: '#93c5fd',
                  fontSize: '0.85rem',
                }}
              >
                <RefreshCw size={16} style={{ animation: 'spin 1s linear infinite' }} />
                <span>Generating live Hinglish message via Qwen 3.8-27b & creating Razorpay link...</span>
              </div>
            )}

            {/* Status Notice inside Drawer */}
            {actionMessage && (
              <div
                style={{
                  marginBottom: '16px',
                  padding: '12px 16px',
                  borderRadius: '10px',
                  background:
                    actionMessage.type === 'error'
                      ? 'rgba(239, 68, 68, 0.15)'
                      : actionMessage.type === 'success'
                      ? 'rgba(16, 185, 129, 0.15)'
                      : 'rgba(59, 130, 246, 0.15)',
                  border:
                    actionMessage.type === 'error'
                      ? '1px solid rgba(239, 68, 68, 0.4)'
                      : actionMessage.type === 'success'
                      ? '1px solid rgba(16, 185, 129, 0.4)'
                      : '1px solid rgba(59, 130, 246, 0.4)',
                  color:
                    actionMessage.type === 'error'
                      ? '#fca5a5'
                      : actionMessage.type === 'success'
                      ? '#6ee7b7'
                      : '#93c5fd',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  fontSize: '0.85rem',
                }}
              >
                {actionMessage.type === 'error' ? (
                  <AlertTriangle size={16} style={{ flexShrink: 0 }} />
                ) : (
                  <CheckCircle2 size={16} style={{ flexShrink: 0 }} />
                )}
                <span style={{ flex: 1 }}>{actionMessage.text}</span>
                <button
                  onClick={() => setActionMessage(null)}
                  style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: '2px' }}
                >
                  <X size={14} />
                </button>
              </div>
            )}

            {/* Explainable Recoverability Scoring Breakdown */}
            <div
              style={{
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '12px',
                padding: '16px',
                marginBottom: '20px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <div>
                  <span style={{ fontSize: '0.825rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                    EXPLAINABLE RECOVERABILITY SCORING BREAKDOWN
                  </span>
                  <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                    Additive transparent points computed from real checkout and customer signals
                  </p>
                </div>
                <span
                  style={{
                    fontSize: '1.15rem',
                    fontWeight: 800,
                    color: selectedTx.recoverability_score >= 70 ? '#34d399' : '#fbbf24',
                  }}
                >
                  {selectedTx.recoverability_score} / 100
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {computeExplainableScoreBreakdown(selectedTx, selectedTx.customer).items.map((item) => (
                  <div
                    key={item.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      background: item.points >= 0 ? 'rgba(52, 211, 153, 0.06)' : 'rgba(239, 68, 68, 0.07)',
                      border: item.points >= 0 ? '1px solid rgba(52, 211, 153, 0.18)' : '1px solid rgba(239, 68, 68, 0.22)',
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', paddingRight: '8px' }}>
                      <span style={{ fontSize: '0.8rem', fontWeight: 600, color: item.points >= 0 ? '#6ee7b7' : '#fca5a5' }}>
                        {item.label}
                      </span>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px', lineHeight: 1.3 }}>
                        {item.explanation}
                      </span>
                    </div>
                    <span
                      style={{
                        fontSize: '0.85rem',
                        fontWeight: 700,
                        color: item.points >= 0 ? '#34d399' : '#ef4444',
                        marginLeft: '8px',
                        flexShrink: 0,
                      }}
                    >
                      {item.points > 0 ? `+${item.points}` : item.points}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Guardrail Policy Audit */}
            <div
              style={{
                background: 'rgba(59, 130, 246, 0.05)',
                border: '1px solid rgba(59, 130, 246, 0.2)',
                borderRadius: '12px',
                padding: '16px',
                marginBottom: '20px',
              }}
            >
              <span style={{ fontSize: '0.825rem', fontWeight: 600, color: '#93c5fd', display: 'block', marginBottom: '10px' }}>
                HARD-CODED DEFENSIVE GUARDRAIL AUDIT
              </span>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '0.78rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <CheckCircle2 size={14} color="#34d399" />
                  <span>
                    Max Attempts: {(selectedTx.recovery_attempts?.length || 0)} /{' '}
                    {BUCKET_COOLDOWN_POLICIES[selectedTx.failure_bucket]?.max_attempts || 3} used
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <CheckCircle2 size={14} color="#34d399" />
                  <span>
                    Cooldown: {BUCKET_COOLDOWN_POLICIES[selectedTx.failure_bucket]?.label || 'Policy Gap Enforced'}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {selectedTx.customer?.do_not_contact ? (
                    <AlertTriangle size={14} color="#f87171" />
                  ) : (
                    <CheckCircle2 size={14} color="#34d399" />
                  )}
                  <span>
                    Opt-out Status: {selectedTx.customer?.do_not_contact ? 'BLOCKED (STOP active)' : 'Active Customer'}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <CheckCircle2 size={14} color="#34d399" />
                  <span>Tone: Zero Dark Patterns Verified</span>
                </div>
              </div>
            </div>

            {/* Real Timestamped Audit Trail */}
            <div
              style={{
                background: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '12px',
                padding: '16px',
                marginBottom: '20px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <span style={{ fontSize: '0.825rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  TRANSACTION LIFECYCLE AUDIT TRAIL
                </span>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  Authentic event timeline
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {generateTransactionAuditTrail(selectedTx).map((step, idx) => (
                  <div key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', fontSize: '0.78rem' }}>
                    <span
                      style={{
                        fontFamily: 'monospace',
                        fontSize: '0.72rem',
                        color: 'var(--text-muted)',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        background: 'rgba(255, 255, 255, 0.04)',
                        flexShrink: 0,
                      }}
                    >
                      {step.timestamp}
                    </span>
                    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                      <span style={{ fontWeight: 600, color: step.badgeType === 'success' ? '#34d399' : step.badgeType === 'error' ? '#f87171' : step.badgeType === 'warning' ? '#fbbf24' : '#60a5fa' }}>
                        {step.stage}
                      </span>
                      <span style={{ color: 'var(--text-secondary)', marginTop: '2px', lineHeight: 1.35 }}>
                        {step.detail}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* AI Agent Judgment & Remediation Strategy */}
            <div
              style={{
                background: 'rgba(124, 58, 237, 0.05)',
                border: '1px solid rgba(124, 58, 237, 0.25)',
                borderRadius: '12px',
                padding: '16px',
                marginBottom: '20px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <span style={{ fontSize: '0.825rem', fontWeight: 600, color: '#c4b5fd', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Sparkles size={14} color="#a78bfa" />
                  AI AGENT JUDGMENT & ROOT-CAUSE REMEDIATION
                </span>
                <span
                  style={{
                    fontSize: '0.72rem',
                    fontWeight: 600,
                    padding: '2px 8px',
                    borderRadius: '6px',
                    background: 'rgba(124, 58, 237, 0.2)',
                    color: '#ddd6fe',
                    border: '1px solid rgba(124, 58, 237, 0.4)',
                  }}
                >
                  Root-Cause Branched
                </span>
              </div>

              {/* Cost-Aware Economic Viability Gate */}
              <div
                style={{
                  background: 'rgba(0, 0, 0, 0.3)',
                  borderRadius: '8px',
                  padding: '10px 12px',
                  marginBottom: '12px',
                  fontSize: '0.78rem',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Cost-Aware Economic Gate:</span>
                  <span
                    style={{
                      fontWeight: 600,
                      color:
                        ((selectedTx.recoverability_score / 100) * selectedTx.amount) >= 2.55
                          ? '#34d399'
                          : '#f87171',
                    }}
                  >
                    {((selectedTx.recoverability_score / 100) * selectedTx.amount) >= 2.55
                      ? '✓ VIABLE TO DISPATCH'
                      : '✗ NOT ECONOMICALLY VIABLE (SKIP)'}
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', color: 'var(--text-muted)', fontSize: '0.72rem' }}>
                  <div>
                    <span>Expected Value: </span>
                    <strong style={{ color: '#ffffff' }}>
                      ₹{((selectedTx.recoverability_score / 100) * selectedTx.amount).toFixed(2)}
                    </strong>
                  </div>
                  <div>
                    <span>Message Cost: </span>
                    <strong style={{ color: '#ffffff' }}>₹0.85</strong>
                  </div>
                  <div>
                    <span>3.0x Hurdle: </span>
                    <strong style={{ color: '#ffffff' }}>₹2.55</strong>
                  </div>
                </div>
              </div>

              {/* Strategy Explanation */}
              <div style={{ fontSize: '0.78rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Remediation Strategy:</span>
                  <span style={{ fontWeight: 600, color: '#67e8f9' }}>
                    {selectedTx.remediation_strategy?.title ||
                      (selectedTx.failure_bucket === 'insufficient_funds'
                        ? 'Flexible Payment & EMI Options'
                        : selectedTx.failure_bucket === 'cart_abandon'
                        ? 'Cart Value Reminder & 5% Rescue Incentive'
                        : selectedTx.failure_bucket === 'card_decline'
                        ? 'Authentication Fallback to Instant UPI'
                        : 'Transient Gateway Retry')}
                  </span>
                </div>
                <p style={{ color: 'var(--text-secondary)', lineHeight: 1.4, margin: 0 }}>
                  {selectedTx.remediation_strategy?.reasoning ||
                    (selectedTx.failure_bucket === 'insufficient_funds'
                      ? 'Account balance or limit exceeded. Resending direct debit predictably fails; offering Card EMI & PayLater rails unlocks purchasing power.'
                      : selectedTx.failure_bucket === 'cart_abandon'
                      ? 'Customer exited cart before payment. A "payment failed" copy is factually wrong; sending transactional cart restoration link allows 1-tap completion complying with TRAI DLT guidelines.'
                      : selectedTx.failure_bucket === 'card_decline'
                      ? 'Card rejected by issuer bank (OTP/limits). Offering 1-click Instant UPI bypasses card authentication friction.'
                      : 'Transient bank/network timeout. Underlying account is valid; instant retry recovers without friction.')}
                </p>
              </div>
            </div>

            {/* Economic Skip Notice Banner if unviable */}
            {selectedTx.status === 'not_economically_viable' && (
              <div
                style={{
                  background: 'rgba(245, 158, 11, 0.1)',
                  border: '1px solid rgba(245, 158, 11, 0.35)',
                  borderRadius: '10px',
                  padding: '12px 14px',
                  marginBottom: '20px',
                  fontSize: '0.8rem',
                  color: '#fcd34d',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '8px',
                }}
              >
                <AlertTriangle size={16} color="#fbbf24" style={{ flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <strong>Outreach Skipped by Cost-Aware Decision Gate</strong>:
                  Expected recovery value (₹{((selectedTx.recoverability_score / 100) * selectedTx.amount).toFixed(2)}) is below the ₹2.55 economic hurdle rate (3.0x WhatsApp messaging cost). Message dispatch was prevented to protect merchant unit margins and customer goodwill.
                </div>
              </div>
            )}

            {/* Recurring Failure Telemetry Banner */}
            {(selectedTx.has_recurring_failure || selectedTx.recurring_pattern_summary) && (
              <div
                id="drawer-recurring-pattern-banner"
                style={{
                  background: 'rgba(168, 85, 247, 0.08)',
                  border: '1px solid rgba(168, 85, 247, 0.3)',
                  borderRadius: '10px',
                  padding: '12px 14px',
                  marginBottom: '20px',
                  fontSize: '0.8rem',
                  color: '#e9d5ff',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <Repeat size={15} color="#c084fc" />
                  <strong style={{ color: '#d8b4fe' }}>Explainable Recurring Failure Telemetry Detected</strong>
                </div>
                <div style={{ color: 'var(--text-secondary)' }}>
                  {selectedTx.recurring_pattern_summary || 'Customer has repeatedly encountered failures in this category across past checkouts.'}
                </div>
                <div style={{ marginTop: '6px', fontSize: '0.74rem', color: '#c084fc' }}>
                  ⚡ AI Outreach prompt automatically ingests this historical pattern to provide repeat-issue reassurance &amp; preventive troubleshooting.
                </div>
              </div>
            )}

            {/* WhatsApp Message Preview */}
            <div style={{ marginBottom: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.825rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                    HINGLISH RECOVERY OUTREACH (WhatsApp)
                  </span>
                  <span
                    title="Complies with India TRAI DLT Transactional (Service-Implicit) standards with zero promotional copy"
                    style={{
                      fontSize: '0.7rem',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      background: 'rgba(99, 102, 241, 0.15)',
                      color: '#a5b4fc',
                      border: '1px solid rgba(99, 102, 241, 0.3)',
                    }}
                  >
                    DLT: Transactional
                  </span>
                  {selectedTx.recovery_attempts && selectedTx.recovery_attempts.length > 0 && (
                    <span
                      style={{
                        fontSize: '0.7rem',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        background: 'rgba(59, 130, 246, 0.15)',
                        color: '#93c5fd',
                        border: '1px solid rgba(59, 130, 246, 0.3)',
                      }}
                    >
                      {selectedTx.recovery_attempts[selectedTx.recovery_attempts.length - 1].llm_model_used || 'Groq LLM'}
                    </span>
                  )}
                  {selectedTx.is_live_razorpay ? (
                    <span
                      style={{
                        fontSize: '0.7rem',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        background: 'rgba(16, 185, 129, 0.15)',
                        color: '#6ee7b7',
                        border: '1px solid rgba(16, 185, 129, 0.3)',
                      }}
                    >
                      Live Razorpay Link
                    </span>
                  ) : (
                    <span
                      style={{
                        fontSize: '0.7rem',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        background: 'rgba(245, 158, 11, 0.15)',
                        color: '#fcd34d',
                        border: '1px solid rgba(245, 158, 11, 0.3)',
                      }}
                    >
                      Simulated Link
                    </span>
                  )}
                </div>
                <span style={{ fontSize: '0.72rem', color: '#34d399' }}>● End-to-End Encrypted</span>
              </div>

              <div
                style={{
                  background: '#0b141a',
                  borderRadius: '12px',
                  padding: '16px',
                  border: '1px solid rgba(255,255,255,0.06)',
                }}
              >
                {selectedTx.recovery_attempts && selectedTx.recovery_attempts.length > 0 ? (
                  <div className="whatsapp-bubble">
                    {selectedTx.recovery_attempts[selectedTx.recovery_attempts.length - 1].message_sent}
                    <div className="whatsapp-meta">
                      <span>Attempt #{selectedTx.recovery_attempts.length}</span>
                      <CheckCircle2 size={12} color="#53bdeb" />
                    </div>
                  </div>
                ) : (
                  <div className="whatsapp-bubble">
                    <span style={{ color: 'var(--text-secondary)', fontStyle: 'italic', display: 'block', marginBottom: '8px' }}>
                      [Click &quot;Send Hinglish Recovery&quot; below to generate a real contextual message via Groq LLM]
                    </span>
                    Namaste {selectedTx.customer?.name.split(' ')[0]}! Dekha aapka ₹{selectedTx.amount} ka payment{' '}
                    {selectedTx.failure_bucket === 'upi_timeout'
                      ? 'bank UPI switch timeout'
                      : selectedTx.failure_bucket === 'card_decline'
                      ? 'card OTP verification'
                      : 'network glitch'}{' '}
                    ki wajah se interrupt ho gaya tha. Aap bina details re-enter kiye yahan se direct retry kar sakte hain:{' '}
                    <a
                      href={selectedTx.retry_payment_link}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: '#60a5fa', textDecoration: 'underline' }}
                    >
                      {selectedTx.retry_payment_link}
                    </a>
                    . (Reply STOP to opt out)
                    <div className="whatsapp-meta">
                      <span>Preview Draft</span>
                      <CheckCircle2 size={12} color="#53bdeb" />
                    </div>
                  </div>
                )}

                {/* Direct Action: Open Retry Link */}
                <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <a
                    href={selectedTx.retry_payment_link}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      fontSize: '0.78rem',
                      color: '#60a5fa',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      textDecoration: 'none',
                    }}
                  >
                    <span>Open Razorpay Checkout: {selectedTx.retry_payment_link}</span>
                    <ExternalLink size={12} />
                  </a>
                  {selectedTx.razorpay_payment_link_id && (
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      Link ID: {selectedTx.razorpay_payment_link_id}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Attribution Funnel Stage Progress */}
            {selectedTx.recovery_attempts && selectedTx.recovery_attempts.length > 0 && (
              <div
                style={{
                  background: 'rgba(255, 255, 255, 0.02)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '10px',
                  padding: '12px 16px',
                  marginBottom: '16px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                    Attribution Funnel Stage
                  </span>
                  <span style={{ fontSize: '0.72rem', color: '#10b981', fontWeight: 500 }}>
                    Traceable Journey
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', fontSize: '0.75rem' }}>
                  <span className={`badge ${selectedTx.funnel_stage ? 'badge-primary' : 'badge-neutral'}`}>
                    1. Messaged
                  </span>
                  <ChevronRight size={12} color="var(--text-muted)" />
                  <span className={`badge ${selectedTx.funnel_stage === 'link_clicked' || selectedTx.funnel_stage === 'payment_retried' || selectedTx.funnel_stage === 'recovered' || selectedTx.status === 'recovered' ? 'badge-info' : 'badge-neutral'}`}>
                    2. Link Clicked
                  </span>
                  <ChevronRight size={12} color="var(--text-muted)" />
                  <span className={`badge ${selectedTx.funnel_stage === 'payment_retried' || selectedTx.funnel_stage === 'recovered' || selectedTx.status === 'recovered' ? 'badge-warning' : 'badge-neutral'}`}>
                    3. Payment Retried
                  </span>
                  <ChevronRight size={12} color="var(--text-muted)" />
                  <span className={`badge ${selectedTx.funnel_stage === 'recovered' || selectedTx.status === 'recovered' ? 'badge-success' : 'badge-neutral'}`}>
                    4. Recovered
                  </span>
                </div>
              </div>
            )}

            {/* Interactive Simulation Controls */}
            <div
              style={{
                borderTop: '1px solid var(--border-subtle)',
                paddingTop: '20px',
                display: 'flex',
                flexWrap: 'wrap',
                gap: '10px',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                <button
                  id="btn-modal-optout"
                  className="btn-outline-danger"
                  onClick={() => handleSimulateAction(selectedTx.id, 'opt_out')}
                  disabled={actionLoading || selectedTx.customer?.do_not_contact}
                  title="Test customer replying STOP"
                >
                  <UserX size={14} style={{ marginRight: '4px' }} />
                  Reply &quot;STOP&quot; (Opt Out)
                </button>

                <button
                  id="btn-modal-sim-click"
                  className="btn-secondary"
                  style={{ fontSize: '0.8rem', padding: '6px 12px' }}
                  onClick={() => handleSimulateAction(selectedTx.id, 'simulate_click')}
                  disabled={actionLoading || selectedTx.status === 'recovered' || !selectedTx.recovery_attempts || selectedTx.recovery_attempts.length === 0}
                  title="Simulate customer clicking the recovery payment link"
                >
                  <MousePointerClick size={14} style={{ marginRight: '4px' }} />
                  Simulate Click
                </button>

                <button
                  id="btn-modal-sim-retry"
                  className="btn-secondary"
                  style={{ fontSize: '0.8rem', padding: '6px 12px' }}
                  onClick={() => handleSimulateAction(selectedTx.id, 'simulate_retry')}
                  disabled={actionLoading || selectedTx.status === 'recovered' || !selectedTx.recovery_attempts || selectedTx.recovery_attempts.length === 0}
                  title="Simulate customer re-initiating checkout retry"
                >
                  <RotateCcw size={14} style={{ marginRight: '4px' }} />
                  Simulate Retry
                </button>

                <button
                  id="btn-modal-pay"
                  className="btn-outline-success"
                  onClick={() => handleSimulateAction(selectedTx.id, 'pay_success')}
                  disabled={actionLoading || selectedTx.status === 'recovered'}
                  title="Complete payment recovery (Final funnel step)"
                >
                  <CheckCircle2 size={14} style={{ marginRight: '4px' }} />
                  Complete Payment (Recover)
                </button>

                {selectedTx.razorpay_payment_link_id && !selectedTx.razorpay_payment_link_id.startsWith('plink_sim_') && (
                  <button
                    id="btn-modal-sync-rzp"
                    className="btn-secondary"
                    style={{ fontSize: '0.8rem', padding: '6px 12px' }}
                    onClick={() => handleSimulateAction(selectedTx.id, 'check_razorpay_status')}
                    disabled={actionLoading || selectedTx.status === 'recovered'}
                    title="Poll live status directly from Razorpay's GET /v1/payment_links/:id"
                  >
                    <RefreshCw size={14} className={actionLoading ? 'animate-spin' : ''} />
                    Verify on Razorpay API
                  </button>
                )}

                <button
                  id="btn-modal-cooldown"
                  className="btn-secondary"
                  style={{ fontSize: '0.8rem', padding: '6px 12px' }}
                  onClick={() => handleSimulateAction(selectedTx.id, 'expire_cooldown')}
                  disabled={actionLoading || (selectedTx.recovery_attempts?.length || 0) === 0}
                  title="Fast-forward 6h cooldown to test next attempt during demo"
                >
                  <Clock size={14} />
                  Fast-forward 6h (Demo)
                </button>
              </div>

              {selectedTx.status !== 'recovered' && !selectedTx.customer?.do_not_contact && selectedTx.status !== 'escalated_human_review' && (
                <button
                  id="btn-modal-send"
                  className="btn-primary"
                  onClick={() => handleTriggerRecovery(selectedTx.id)}
                  disabled={actionLoading}
                >
                  <Send size={14} />
                  Send Hinglish Recovery
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* FLOATING TOAST NOTIFICATION (Always visible on screen wherever user is scrolled) */}
      {actionMessage && (
        <div
          id="floating-toast-alert"
          style={{
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            maxWidth: '480px',
            zIndex: 9999,
            padding: '14px 18px',
            borderRadius: '12px',
            background:
              actionMessage.type === 'error'
                ? 'rgba(30, 10, 10, 0.95)'
                : actionMessage.type === 'success'
                ? 'rgba(10, 30, 20, 0.95)'
                : 'rgba(10, 20, 35, 0.95)',
            border:
              actionMessage.type === 'error'
                ? '1px solid rgba(239, 68, 68, 0.6)'
                : actionMessage.type === 'success'
                ? '1px solid rgba(16, 185, 129, 0.6)'
                : '1px solid rgba(59, 130, 246, 0.6)',
            boxShadow: '0 10px 30px rgba(0, 0, 0, 0.6)',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            backdropFilter: 'blur(10px)',
            color: '#ffffff',
            fontSize: '0.85rem',
          }}
        >
          {actionMessage.type === 'error' ? (
            <AlertTriangle size={18} color="#ef4444" style={{ flexShrink: 0 }} />
          ) : actionMessage.type === 'success' ? (
            <CheckCircle2 size={18} color="#10b981" style={{ flexShrink: 0 }} />
          ) : (
            <Zap size={18} color="#3b82f6" style={{ flexShrink: 0 }} />
          )}
          <span style={{ flex: 1, lineHeight: 1.4 }}>{actionMessage.text}</span>
          <button
            onClick={() => setActionMessage(null)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: '2px',
            }}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </main>
  );
}
