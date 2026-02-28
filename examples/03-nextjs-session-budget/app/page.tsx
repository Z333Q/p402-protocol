'use client';

import { useState, useRef } from 'react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface Budget {
  total_usd: number;
  used_usd: number;
  remaining_usd: number;
}

interface ChatResponse {
  message?: string;
  sessionId?: string;
  budget?: Budget;
  error?: string;
  p402_metadata?: {
    provider: string;
    cost_usd: number;
    latency_ms: number;
    cached: boolean;
  };
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [budget, setBudget] = useState<Budget | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function sendMessage() {
    const text = input.trim();
    if (!text || loading) return;

    const userMessages: Message[] = [...messages, { role: 'user', content: text }];
    setMessages(userMessages);
    setInput('');
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: userMessages,
          sessionId,
        }),
      });

      const data: ChatResponse = await res.json();

      if (!res.ok || data.error) {
        if (data.error === 'BUDGET_EXCEEDED') {
          setError('Budget exhausted ($1 limit reached). Reload to start a new session.');
        } else {
          setError(data.error ?? 'Request failed');
        }
        return;
      }

      if (data.sessionId) setSessionId(data.sessionId);
      if (data.budget) setBudget(data.budget);

      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: data.message ?? '' },
      ]);

      setTimeout(() => inputRef.current?.focus(), 50);
    } catch {
      setError('Network error — check your connection');
    } finally {
      setLoading(false);
    }
  }

  const budgetPct = budget
    ? Math.max(0, (budget.remaining_usd / budget.total_usd) * 100)
    : 100;

  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: '2rem', fontFamily: 'monospace' }}>
      <h1 style={{ marginBottom: 4 }}>P402 Chat</h1>
      <p style={{ color: '#888', marginBottom: 24, fontSize: 14 }}>
        Budget-capped AI — $1.00 per session
      </p>

      {/* Budget bar */}
      {budget && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
            <span>Budget</span>
            <span>${budget.remaining_usd.toFixed(4)} remaining / ${budget.total_usd.toFixed(2)}</span>
          </div>
          <div style={{ height: 6, background: '#eee', borderRadius: 3 }}>
            <div style={{
              height: '100%',
              width: `${budgetPct}%`,
              background: budgetPct > 20 ? '#B6FF2E' : '#ef4444',
              borderRadius: 3,
              transition: 'width 0.3s',
            }} />
          </div>
        </div>
      )}

      {/* Messages */}
      <div style={{ minHeight: 300, marginBottom: 16 }}>
        {messages.length === 0 && (
          <p style={{ color: '#aaa', fontSize: 14 }}>Ask anything — cheapest provider is auto-selected.</p>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{
            marginBottom: 12,
            padding: '8px 12px',
            background: m.role === 'user' ? '#f5f5f5' : '#fff',
            border: '1px solid #eee',
          }}>
            <span style={{ fontSize: 11, color: '#999', textTransform: 'uppercase' }}>{m.role}</span>
            <p style={{ margin: '4px 0 0', lineHeight: 1.5 }}>{m.content}</p>
          </div>
        ))}
        {loading && <p style={{ color: '#aaa', fontSize: 14 }}>Routing request…</p>}
        {error && <p style={{ color: '#ef4444', fontSize: 14 }}>{error}</p>}
      </div>

      {/* Input */}
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && sendMessage()}
          placeholder="Type a message…"
          disabled={loading || !!error}
          style={{
            flex: 1, padding: '8px 12px', border: '2px solid #000',
            fontFamily: 'monospace', fontSize: 14,
          }}
        />
        <button
          onClick={sendMessage}
          disabled={loading || !input.trim() || !!error}
          style={{
            padding: '8px 16px', background: '#B6FF2E', border: '2px solid #000',
            fontFamily: 'monospace', fontWeight: 700, cursor: 'pointer',
          }}
        >
          Send
        </button>
      </div>
    </main>
  );
}
