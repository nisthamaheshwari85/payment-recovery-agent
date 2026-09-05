import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { detectRecurringFailurePatterns } from '@/lib/patterns';
import { evaluateCircuitBreakers } from '@/lib/circuitBreaker';

export async function GET() {
  try {
    const [analytics, customers, transactions] = await Promise.all([
      db.getAnalytics(),
      db.getCustomers(),
      db.getTransactions(),
    ]);

    const recurringPatterns = detectRecurringFailurePatterns(customers, transactions);
    const circuitBreakers = evaluateCircuitBreakers(transactions);
    const activeCircuitBreakers = Object.values(circuitBreakers).filter((cb) => cb.tripped);

    return NextResponse.json({
      success: true,
      analytics,
      recurring_patterns: recurringPatterns,
      circuit_breakers: activeCircuitBreakers,
    });
  } catch (err: any) {
    console.error('Error fetching analytics:', err);
    return NextResponse.json(
      { error: 'Failed to fetch analytics', details: err?.message },
      { status: 500 }
    );
  }
}
