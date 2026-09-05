import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status') || undefined;
    const bucket = searchParams.get('bucket') || undefined;
    const limitParam = searchParams.get('limit');
    const limit = limitParam ? parseInt(limitParam, 10) : undefined;

    const transactions = await db.getTransactions({
      status,
      bucket,
      limit,
    });

    return NextResponse.json({
      success: true,
      count: transactions.length,
      transactions,
    });
  } catch (err: any) {
    console.error('Error fetching transactions:', err);
    return NextResponse.json(
      { error: 'Failed to fetch transactions', details: err?.message },
      { status: 500 }
    );
  }
}
