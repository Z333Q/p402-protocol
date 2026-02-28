/**
 * P402 — OpenAI Drop-in Migration
 * --------------------------------
 * Shows two equivalent approaches:
 *   1. Raw fetch (same payload shape as OpenAI)
 *   2. OpenAI SDK with baseURL override
 *
 * Prerequisites:
 *   export P402_API_KEY=p402_live_...
 *   npm install openai   (for approach 2)
 */

const P402_API_KEY = process.env['P402_API_KEY'] ?? '';
const P402_BASE_URL = 'https://p402.io/api/v2';

const messages = [
  { role: 'user' as const, content: 'What is the capital of France? One word.' },
];

// =============================================================================
// Approach 1: Raw fetch — identical to OpenAI, just different URL + key
// =============================================================================

async function withFetch() {
  console.log('--- Approach 1: raw fetch ---');

  const res = await fetch(`${P402_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${P402_API_KEY}`,
    },
    body: JSON.stringify({
      messages,
      // Optionally add P402 extensions:
      p402: { mode: 'cost', cache: true },
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(`HTTP ${res.status}: ${err.error ?? res.statusText}`);
  }

  const data = await res.json() as {
    choices: Array<{ message: { content: string } }>;
    p402_metadata: { provider: string; cost_usd: number; latency_ms: number; cached: boolean };
  };

  console.log('Answer:', data.choices[0]?.message.content);
  console.log('Provider:', data.p402_metadata.provider);
  console.log('Cost:', `$${data.p402_metadata.cost_usd.toFixed(6)}`);
}

// =============================================================================
// Approach 2: Official OpenAI SDK with baseURL override
// =============================================================================

async function withOpenAISDK() {
  console.log('\n--- Approach 2: OpenAI SDK with baseURL override ---');

  // Dynamic import so the example still runs without openai installed
  let OpenAI: typeof import('openai').default;
  try {
    const mod = await import('openai');
    OpenAI = mod.default;
  } catch {
    console.log('(skipped — run: npm install openai)');
    return;
  }

  const client = new OpenAI({
    apiKey: P402_API_KEY,
    baseURL: P402_BASE_URL,  // ← Only change needed
  });

  const completion = await client.chat.completions.create({
    model: 'gpt-4o-mini',   // Optional — P402 can override
    messages,
    // @ts-expect-error — P402 extension, not in OpenAI types
    p402: { mode: 'quality' },
  });

  console.log('Answer:', completion.choices[0]?.message.content);
  // p402_metadata is in the raw response body but not in OpenAI SDK types
}

async function main() {
  if (!P402_API_KEY) {
    console.error('Set P402_API_KEY environment variable');
    process.exit(1);
  }

  await withFetch();
  await withOpenAISDK();
}

main().catch(console.error);
