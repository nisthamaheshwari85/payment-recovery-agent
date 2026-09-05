import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  try {
    const escalations = await db.getHumanEscalations();
    return NextResponse.json({
      success: true,
      count: escalations.length,
      escalations,
    });
  } catch (err: any) {
    console.error('Error fetching escalations:', err);
    return NextResponse.json(
      { error: 'Failed to fetch escalations', details: err?.message },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { escalation_id, status, notes, assigned_to } = body;

    if (!escalation_id) {
      return NextResponse.json({ error: 'escalation_id is required' }, { status: 400 });
    }

    const updated = await db.updateHumanEscalation(escalation_id, {
      status,
      notes,
      assigned_to,
      resolved_at: status === 'resolved' || status === 'closed' ? new Date().toISOString() : undefined,
    });

    return NextResponse.json({
      success: true,
      escalation: updated,
    });
  } catch (err: any) {
    console.error('Error updating escalation:', err);
    return NextResponse.json(
      { error: 'Failed to update escalation', details: err?.message },
      { status: 500 }
    );
  }
}
