import { NextRequest, NextResponse } from 'next/server';
import { classifyFailureReason } from '@/lib/classifier';
import { computeRecoverabilityScore } from '@/lib/scorer';
import { db } from '@/lib/db';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { transaction_id, failure_reason_raw, amount, customer_id, channel } = body;

    // Mode A: Classify & Score an existing transaction by ID
    if (transaction_id) {
      const tx = await db.getTransactionById(transaction_id);
      if (!tx) {
        return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
      }

      const classification = await classifyFailureReason(tx.failure_reason_raw);
      const scoreBreakdown = computeRecoverabilityScore({
        failure_bucket: classification.bucket,
        amount: tx.amount,
        customer: tx.customer,
        channel: tx.channel,
        created_at: tx.created_at,
      });

      const updated = await db.updateTransaction(tx.id, {
        failure_bucket: classification.bucket,
        recoverability_score: scoreBreakdown.final_score,
        score_breakdown: scoreBreakdown,
      });

      return NextResponse.json({
        success: true,
        mode: 'transaction_updated',
        transaction: updated,
        classification,
        score_breakdown: scoreBreakdown,
      });
    }

    // Mode B: Classify & Score ad-hoc payload
    if (!failure_reason_raw || amount === undefined) {
      return NextResponse.json(
        { error: 'Missing required parameters: failure_reason_raw and amount' },
        { status: 400 }
      );
    }

    let customer = null;
    if (customer_id) {
      customer = await db.getCustomerById(customer_id);
    }

    const classification = await classifyFailureReason(failure_reason_raw);
    const scoreBreakdown = computeRecoverabilityScore({
      failure_bucket: classification.bucket,
      amount: Number(amount),
      customer,
      channel: channel || 'checkout_web',
      created_at: new Date().toISOString(),
    });

    return NextResponse.json({
      success: true,
      mode: 'ad_hoc_evaluation',
      classification,
      score_breakdown: scoreBreakdown,
    });
  } catch (err: any) {
    console.error('Error in classify-and-score API:', err);
    return NextResponse.json(
      { error: 'Failed to classify and score payment failure', details: err?.message },
      { status: 500 }
    );
  }
}
