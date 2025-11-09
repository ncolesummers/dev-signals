import { NextResponse } from 'next/server';

/**
 * Health check endpoint
 * Returns 200 OK if the application is running
 */
export async function GET() {
  return NextResponse.json(
    {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'DevSignals',
      version: '1.0.0',
    },
    { status: 200 }
  );
}
