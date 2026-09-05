import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import {
  Customer,
  Transaction,
  RecoveryAttempt,
  HumanEscalation,
  AnalyticsSummary,
  FailureBucket,
} from './types';
import { computeExplainableScoreBreakdown } from './scoringBreakdown';

// Supabase client config
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

export const supabase = (supabaseUrl && supabaseAnonKey)
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

// Local JSON File Store Path (for deterministic fallback and offline demo mode)
const DATA_DIR = path.join(process.cwd(), 'data');
const STORE_PATH = path.join(DATA_DIR, 'store.json');

interface DatabaseStore {
  customers: Customer[];
  transactions: Transaction[];
  recovery_attempts: RecoveryAttempt[];
  human_escalations: HumanEscalation[];
}

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readStore(): DatabaseStore {
  ensureDataDir();
  if (!fs.existsSync(STORE_PATH)) {
    const empty: DatabaseStore = {
      customers: [],
      transactions: [],
      recovery_attempts: [],
      human_escalations: [],
    };
    fs.writeFileSync(STORE_PATH, JSON.stringify(empty, null, 2), 'utf8');
    return empty;
  }
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    return JSON.parse(raw) as DatabaseStore;
  } catch (err) {
    console.error('Error reading local store:', err);
    return {
      customers: [],
      transactions: [],
      recovery_attempts: [],
      human_escalations: [],
    };
  }
}

function writeStore(store: DatabaseStore): void {
  ensureDataDir();
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
}

export const db = {
  // Customers
  async getCustomers(): Promise<Customer[]> {
    const store = readStore();
    return store.customers;
  },

  async getCustomerById(id: string): Promise<Customer | null> {
    const store = readStore();
    return store.customers.find((c) => c.id === id) || null;
  },

  async getCustomerByPhone(phone: string): Promise<Customer | null> {
    const store = readStore();
    return store.customers.find((c) => c.phone === phone) || null;
  },

  async updateCustomer(id: string, updates: Partial<Customer>): Promise<Customer | null> {
    const store = readStore();
    const index = store.customers.findIndex((c) => c.id === id);
    if (index === -1) return null;
    store.customers[index] = {
      ...store.customers[index],
      ...updates,
      updated_at: new Date().toISOString(),
    };
    writeStore(store);
    return store.customers[index];
  },

  async optOutCustomer(identifier: { customer_id?: string; phone?: string }): Promise<Customer | null> {
    const store = readStore();
    let customer: Customer | undefined;
    if (identifier.customer_id) {
      customer = store.customers.find((c) => c.id === identifier.customer_id);
    } else if (identifier.phone) {
      customer = store.customers.find((c) => c.phone === identifier.phone);
    }

    if (!customer) return null;

    customer.do_not_contact = true;
    customer.opted_out_at = new Date().toISOString();
    customer.updated_at = new Date().toISOString();

    // Mark active transactions for this customer as opted_out
    store.transactions.forEach((tx) => {
      if (tx.customer_id === customer!.id && (tx.status === 'failed' || tx.status === 'in_recovery')) {
        tx.status = 'opted_out';
        tx.updated_at = new Date().toISOString();
      }
    });

    writeStore(store);
    return customer;
  },

  // Transactions
  async getTransactions(filter?: {
    status?: string;
    bucket?: string;
    limit?: number;
  }): Promise<Transaction[]> {
    const store = readStore();
    let result = [...store.transactions];

    if (filter?.status && filter.status !== 'all') {
      result = result.filter((tx) => tx.status === filter.status);
    }
    if (filter?.bucket && filter.bucket !== 'all') {
      result = result.filter((tx) => tx.failure_bucket === filter.bucket);
    }

    // Hydrate customer and attempts with fail-safe defaults (no blank names/IDs/scores)
    const customerMap = new Map(store.customers.map((c) => [c.id, c]));
    result = result.map((tx) => {
      let cust = customerMap.get(tx.customer_id) || tx.customer;
      if (!cust) {
        cust = {
          id: tx.customer_id || `cust_${tx.id}`,
          name: `Customer ${tx.id.replace(/^tx_/, '').toUpperCase()}`,
          phone: '+919876543210',
          total_failed: 1,
          total_recovered: tx.status === 'recovered' ? 1 : 0,
          do_not_contact: false,
          created_at: tx.created_at || new Date().toISOString(),
        };
      }
      const score = tx.recoverability_score ?? computeExplainableScoreBreakdown(tx, cust).total_score;
      const paymentId = tx.razorpay_payment_id || `pay_${tx.id}`;

      return {
        ...tx,
        customer: cust,
        recoverability_score: score,
        razorpay_payment_id: paymentId,
        recovery_attempts: store.recovery_attempts.filter((a) => a.transaction_id === tx.id),
      };
    });

    // Sort descending by created_at
    result.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    if (filter?.limit) {
      result = result.slice(0, filter.limit);
    }
    return result;
  },

  async getTransactionById(id: string): Promise<Transaction | null> {
    const store = readStore();
    const tx = store.transactions.find((t) => t.id === id);
    if (!tx) return null;

    let customer = store.customers.find((c) => c.id === tx.customer_id) || tx.customer;
    if (!customer) {
      customer = {
        id: tx.customer_id || `cust_${tx.id}`,
        name: `Customer ${tx.id.replace(/^tx_/, '').toUpperCase()}`,
        phone: '+919876543210',
        total_failed: 1,
        total_recovered: tx.status === 'recovered' ? 1 : 0,
        do_not_contact: false,
        created_at: tx.created_at || new Date().toISOString(),
      };
    }
    const score = tx.recoverability_score ?? computeExplainableScoreBreakdown(tx, customer).total_score;
    const paymentId = tx.razorpay_payment_id || `pay_${tx.id}`;
    const attempts = store.recovery_attempts.filter((a) => a.transaction_id === tx.id);

    return {
      ...tx,
      customer,
      recoverability_score: score,
      razorpay_payment_id: paymentId,
      recovery_attempts: attempts,
    };
  },

  async createTransaction(tx: Transaction): Promise<Transaction> {
    const store = readStore();
    store.transactions.unshift(tx);
    writeStore(store);
    return tx;
  },

  async updateTransaction(id: string, updates: Partial<Transaction>): Promise<Transaction | null> {
    const store = readStore();
    const index = store.transactions.findIndex((t) => t.id === id);
    if (index === -1) return null;
    store.transactions[index] = {
      ...store.transactions[index],
      ...updates,
      updated_at: new Date().toISOString(),
    };
    writeStore(store);
    return store.transactions[index];
  },

  async deleteTransaction(id: string): Promise<boolean> {
    const store = readStore();
    const index = store.transactions.findIndex((t) => t.id === id);
    if (index === -1) return false;
    store.transactions.splice(index, 1);
    store.recovery_attempts = store.recovery_attempts.filter((a) => a.transaction_id !== id);
    writeStore(store);
    return true;
  },

  // Recovery Attempts
  async getRecoveryAttempts(transaction_id?: string): Promise<RecoveryAttempt[]> {
    const store = readStore();
    if (transaction_id) {
      return store.recovery_attempts
        .filter((a) => a.transaction_id === transaction_id)
        .sort((a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime());
    }
    return store.recovery_attempts.sort(
      (a, b) => new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime()
    );
  },

  async createRecoveryAttempt(attempt: RecoveryAttempt): Promise<RecoveryAttempt> {
    const store = readStore();
    store.recovery_attempts.push(attempt);
    writeStore(store);
    return attempt;
  },

  async updateRecoveryAttempt(id: string, updates: Partial<RecoveryAttempt>): Promise<RecoveryAttempt | null> {
    const store = readStore();
    const index = store.recovery_attempts.findIndex((a) => a.id === id);
    if (index === -1) return null;
    store.recovery_attempts[index] = {
      ...store.recovery_attempts[index],
      ...updates,
    };
    writeStore(store);
    return store.recovery_attempts[index];
  },

  // Human Escalations
  async getHumanEscalations(): Promise<HumanEscalation[]> {
    const store = readStore();
    const customerMap = new Map(store.customers.map((c) => [c.id, c]));
    const txMap = new Map(store.transactions.map((t) => [t.id, t]));

    return store.human_escalations
      .map((e) => ({
        ...e,
        customer: customerMap.get(e.customer_id),
        transaction: txMap.get(e.transaction_id),
      }))
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  },

  async createHumanEscalation(escalation: HumanEscalation): Promise<HumanEscalation> {
    const store = readStore();
    store.human_escalations.unshift(escalation);
    writeStore(store);
    return escalation;
  },

  async updateHumanEscalation(
    id: string,
    updates: Partial<HumanEscalation>
  ): Promise<HumanEscalation | null> {
    const store = readStore();
    const index = store.human_escalations.findIndex((e) => e.id === id);
    if (index === -1) return null;
    store.human_escalations[index] = {
      ...store.human_escalations[index],
      ...updates,
    };
    writeStore(store);
    return store.human_escalations[index];
  },

  // Seed & Reset
  async seed(data: DatabaseStore): Promise<void> {
    writeStore(data);
  },

  async getStore(): Promise<DatabaseStore> {
    return readStore();
  },

  // Analytics Computation
  async getAnalytics(): Promise<AnalyticsSummary> {
    const store = readStore();
    const transactions = store.transactions;
    const attempts = store.recovery_attempts;

    const buckets: FailureBucket[] = [
      'card_decline',
      'upi_timeout',
      'network_error',
      'cart_abandon',
      'insufficient_funds',
      'other',
    ];

    let totalRevenueAtRisk = 0;
    let totalRecoveredRevenue = 0;
    let recoveredCount = 0;
    let activeInRecovery = 0;
    let escalatedCount = 0;
    let unviableCount = 0;
    let optedOutCount = 0;

    const bucketMetrics: Record<
      FailureBucket,
      { count: number; revenue_at_risk: number; revenue_recovered: number; recovery_rate: number }
    > = {
      card_decline: { count: 0, revenue_at_risk: 0, revenue_recovered: 0, recovery_rate: 0 },
      upi_timeout: { count: 0, revenue_at_risk: 0, revenue_recovered: 0, recovery_rate: 0 },
      network_error: { count: 0, revenue_at_risk: 0, revenue_recovered: 0, recovery_rate: 0 },
      cart_abandon: { count: 0, revenue_at_risk: 0, revenue_recovered: 0, recovery_rate: 0 },
      insufficient_funds: { count: 0, revenue_at_risk: 0, revenue_recovered: 0, recovery_rate: 0 },
      other: { count: 0, revenue_at_risk: 0, revenue_recovered: 0, recovery_rate: 0 },
    };

    transactions.forEach((tx) => {
      totalRevenueAtRisk += tx.amount;
      const b = tx.failure_bucket;
      if (bucketMetrics[b]) {
        bucketMetrics[b].count++;
        bucketMetrics[b].revenue_at_risk += tx.amount;
      }

      if (tx.status === 'recovered') {
        recoveredCount++;
        totalRecoveredRevenue += tx.amount;
        if (bucketMetrics[b]) {
          bucketMetrics[b].revenue_recovered += tx.amount;
        }
      } else if (tx.status === 'in_recovery') {
        activeInRecovery++;
      } else if (tx.status === 'escalated_human_review') {
        escalatedCount++;
      } else if (tx.status === 'not_economically_viable') {
        unviableCount++;
      } else if (tx.status === 'opted_out') {
        optedOutCount++;
      }
    });

    // Calculate rates
    for (const b of buckets) {
      const metric = bucketMetrics[b];
      metric.recovery_rate = metric.count > 0 ? Math.round((metric.revenue_recovered / (metric.revenue_at_risk || 1)) * 100) : 0;
    }

    const blendedRecoveryRate =
      totalRevenueAtRisk > 0 ? Math.round((totalRecoveredRevenue / totalRevenueAtRisk) * 100) : 0;

    // Funnel breakdown: Attempt 1 vs 2 vs 3
    const attempt1 = attempts.filter((a) => a.attempt_number === 1);
    const attempt2 = attempts.filter((a) => a.attempt_number === 2);
    const attempt3 = attempts.filter((a) => a.attempt_number === 3);

    const converted1 = attempt1.filter((a) => a.outcome === 'recovered').length;
    const converted2 = attempt2.filter((a) => a.outcome === 'recovered').length;
    const converted3 = attempt3.filter((a) => a.outcome === 'recovered').length;

    // Recovery Attribution Funnel computation
    // Messaged -> Link Clicked -> Payment Retried -> Payment Successful (Recovered)
    const messagedTxIds = new Set(attempts.map((a) => a.transaction_id));
    const messagedTransactions = transactions.filter(
      (t) => messagedTxIds.has(t.id) || (t.recovery_attempts?.length || 0) > 0
    );
    const messagedCount = messagedTransactions.length;

    // Link Clicked
    const clickedTxIds = new Set([
      ...attempts.filter((a) => ['clicked', 'retried', 'recovered'].includes(a.outcome)).map((a) => a.transaction_id),
      ...transactions
        .filter((t) => ['link_clicked', 'payment_retried', 'recovered'].includes(t.funnel_stage || '') || t.status === 'recovered')
        .map((t) => t.id),
    ]);
    const clickedCount = Math.min(
      messagedCount,
      messagedTransactions.filter((t) => clickedTxIds.has(t.id)).length
    );

    // Payment Retried
    const retriedTxIds = new Set([
      ...attempts.filter((a) => ['retried', 'recovered'].includes(a.outcome)).map((a) => a.transaction_id),
      ...transactions
        .filter((t) => ['payment_retried', 'recovered'].includes(t.funnel_stage || '') || t.status === 'recovered')
        .map((t) => t.id),
    ]);
    const retriedCount = Math.min(
      clickedCount,
      messagedTransactions.filter((t) => retriedTxIds.has(t.id)).length
    );

    // Payment Successful
    const successTransactions = messagedTransactions.filter((t) => t.status === 'recovered');
    const successfulCount = successTransactions.length;
    const recoveredRevenueAttributed = successTransactions.reduce((sum, t) => sum + t.amount, 0);

    const clickRate = messagedCount > 0 ? Math.round((clickedCount / messagedCount) * 100) : 0;
    const retryRate = clickedCount > 0 ? Math.round((retriedCount / clickedCount) * 100) : 0;
    const conversionRate = retriedCount > 0 ? Math.round((successfulCount / retriedCount) * 100) : 0;

    return {
      total_revenue_at_risk: Math.round(totalRevenueAtRisk),
      total_recovered_revenue: Math.round(totalRecoveredRevenue),
      blended_recovery_rate: blendedRecoveryRate,
      total_transactions: transactions.length,
      active_in_recovery: activeInRecovery,
      recovered_count: recoveredCount,
      escalated_count: escalatedCount,
      unviable_count: unviableCount,
      opted_out_count: optedOutCount,
      bucket_metrics: bucketMetrics,
      attempts_funnel: {
        attempt_1: {
          sent: attempt1.length,
          converted: converted1,
          rate: attempt1.length > 0 ? Math.round((converted1 / attempt1.length) * 100) : 0,
        },
        attempt_2: {
          sent: attempt2.length,
          converted: converted2,
          rate: attempt2.length > 0 ? Math.round((converted2 / attempt2.length) * 100) : 0,
        },
        attempt_3: {
          sent: attempt3.length,
          converted: converted3,
          rate: attempt3.length > 0 ? Math.round((converted3 / attempt3.length) * 100) : 0,
        },
      },
      attribution_funnel: {
        messaged_count: messagedCount,
        link_clicked_count: clickedCount,
        payment_retried_count: retriedCount,
        payment_successful_count: successfulCount,
        click_rate: clickRate,
        retry_rate: retryRate,
        conversion_rate: conversionRate,
        recovered_revenue: recoveredRevenueAttributed,
      },
    };
  },
};
