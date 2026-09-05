import { NextRequest, NextResponse } from 'next/server';
import { executeRecoveryOutreach } from '@/lib/agent';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { transaction_id } = body;

    if (!transaction_id) {
      return NextResponse.json({ error: 'transaction_id is required' }, { status: 400 });
    }

    const result = await executeRecoveryOutreach(transaction_id);

    return NextResponse.json({
      success: result.success,
      guardrail: result.guardrail,
      economic_evaluation: result.economic_evaluation,
      remediation_strategy: result.remediation_strategy,
      attempt: result.attempt,
      transaction: result.transaction,
    });
  } catch (err: any) {
    console.error('Error triggering recovery:', err);
    return NextResponse.json(
      { error: 'Recovery execution failed', details: err?.message },
      { status: 500 }
    );
  }
}
