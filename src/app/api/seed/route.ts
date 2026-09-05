import { NextResponse } from 'next/server';
import { executeSeed } from '@/lib/seed';

export async function POST() {
  try {
    const counts = await executeSeed();
    return NextResponse.json({
      success: true,
      message: 'Synthetic test dataset seeded successfully',
      counts,
    });
  } catch (err: any) {
    console.error('Seed error:', err);
    return NextResponse.json(
      { error: 'Failed to seed dataset', details: err?.message },
      { status: 500 }
    );
  }
}
