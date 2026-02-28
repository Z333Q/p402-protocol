/**
 * P402 chat route handler with session budget enforcement.
 * Each session gets $1 — requests beyond that get a 402 response.
 */

import { NextRequest, NextResponse } from 'next/server';
import P402Client, { P402Error } from '@p402/sdk';

const p402 = new P402Client({
  apiKey: process.env['P402_API_KEY'],
});

// In production: store session IDs in a database or Redis keyed by user ID
const SESSION_BUDGET_USD = 1.00;

export async function POST(req: NextRequest) {
  const { messages, sessionId } = await req.json() as {
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    sessionId?: string;
  };

  if (!messages || messages.length === 0) {
    return NextResponse.json({ error: 'messages required' }, { status: 400 });
  }

  try {
    // Create a session on first request; reuse on subsequent ones
    let activeSessionId = sessionId;
    if (!activeSessionId) {
      const session = await p402.createSession({
        budget_usd: SESSION_BUDGET_USD,
        expires_in_hours: 1,
      });
      activeSessionId = session.id;
    }

    // Check remaining budget before proceeding
    const session = await p402.getSession(activeSessionId);
    if (session.budget.remaining_usd <= 0) {
      return NextResponse.json({
        error: 'BUDGET_EXCEEDED',
        message: 'Session budget exhausted. Please start a new session.',
        budget: session.budget,
      }, { status: 402 });
    }

    // Route the request — P402 picks the cheapest adequate provider
    const response = await p402.chat({
      messages,
      p402: {
        mode: 'cost',
        session_id: activeSessionId,
        cache: true,
      },
    });

    // Return answer + session metadata so the client can track budget
    const updatedSession = await p402.getSession(activeSessionId);
    return NextResponse.json({
      message: response.choices[0]?.message.content ?? '',
      sessionId: activeSessionId,
      budget: updatedSession.budget,
      p402_metadata: response.p402_metadata,
    });

  } catch (err) {
    if (err instanceof P402Error) {
      if (err.code === 'BUDGET_EXCEEDED') {
        return NextResponse.json({
          error: 'BUDGET_EXCEEDED',
          message: 'Session budget exhausted.',
        }, { status: 402 });
      }
      return NextResponse.json({ error: err.code, message: err.message }, { status: 500 });
    }
    console.error('Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
