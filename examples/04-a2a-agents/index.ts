/**
 * P402 A2A Agents Example
 * ------------------------
 * Demonstrates the A2A JSON-RPC protocol with x402 payment gate.
 *
 * Prerequisites:
 *   export P402_API_KEY=p402_live_...
 *   npm install @p402/sdk
 */

const P402_BASE = 'https://p402.io';
const HEADERS = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${process.env['P402_API_KEY'] ?? ''}`,
};

// =============================================================================
// Step 1: Agent Discovery
// =============================================================================

interface AgentCard {
  name: string;
  description: string;
  url: string;
  capabilities?: { streaming?: boolean };
  skills?: Array<{ id: string; name: string; description: string }>;
  extensions?: Array<{ uri: string; params?: Record<string, unknown> }>;
}

async function discoverAgent(): Promise<AgentCard> {
  console.log('1. Discovering P402 agent capabilities...');
  const res = await fetch(`${P402_BASE}/.well-known/agent.json`);
  if (!res.ok) throw new Error(`Discovery failed: ${res.status}`);
  const card: AgentCard = await res.json();
  console.log(`   Agent: ${card.name}`);
  console.log(`   Skills: ${card.skills?.map(s => s.id).join(', ') ?? 'none'}`);
  const hasX402 = card.extensions?.some(e => e.uri.includes('x402'));
  console.log(`   x402 payment extension: ${hasX402 ? 'yes' : 'no'}`);
  return card;
}

// =============================================================================
// Step 2: Submit A2A Task
// =============================================================================

interface A2ATask {
  id: string;
  status: { state: string; message?: { parts?: Array<{ type: string; text?: string; data?: unknown }> } };
  artifacts?: Array<{ parts: Array<{ type: string; text?: string; data?: unknown }> }>;
}

interface JsonRpcResponse {
  result?: A2ATask;
  error?: { code: number; message: string; data?: unknown };
}

async function sendTask(message: string): Promise<A2ATask | null> {
  console.log('\n2. Submitting A2A task...');

  const payload = {
    jsonrpc: '2.0',
    method: 'tasks/send',
    id: crypto.randomUUID(),
    params: {
      message: {
        role: 'user',
        parts: [{ type: 'text', text: message }],
      },
    },
  };

  const res = await fetch(`${P402_BASE}/api/a2a`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(payload),
  });

  const data: JsonRpcResponse = await res.json();

  if (data.error) {
    // -32000 block errors are billing/auth related — safe to surface
    console.log(`   Task rejected: [${data.error.code}] ${data.error.message}`);
    return null;
  }

  const task = data.result;
  if (!task) return null;

  console.log(`   Task ID: ${task.id}`);
  console.log(`   State:   ${task.status.state}`);
  return task;
}

// =============================================================================
// Step 3: Poll for completion (or stream)
// =============================================================================

async function pollTask(taskId: string, maxAttempts = 10): Promise<A2ATask | null> {
  console.log('\n3. Polling for task completion...');

  for (let i = 0; i < maxAttempts; i++) {
    const payload = {
      jsonrpc: '2.0',
      method: 'tasks/get',
      id: crypto.randomUUID(),
      params: { id: taskId },
    };

    const res = await fetch(`${P402_BASE}/api/a2a`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify(payload),
    });

    const data: JsonRpcResponse = await res.json();
    const task = data.result;
    if (!task) break;

    console.log(`   Attempt ${i + 1}: ${task.status.state}`);

    if (task.status.state === 'completed') {
      return task;
    }
    if (task.status.state === 'failed' || task.status.state === 'cancelled') {
      console.log('   Task ended without completion');
      return task;
    }

    // Wait 1s between polls
    await new Promise(r => setTimeout(r, 1000));
  }

  return null;
}

// =============================================================================
// Step 4: Using AP2 Mandates for pre-authorized spending
// =============================================================================

interface Mandate {
  id: string;
  status: string;
  constraints: { max_amount_usd?: number };
  amount_spent_usd: number;
}

async function demonstrateMandates() {
  console.log('\n4. AP2 Mandate demonstration...');

  // Create a mandate — authorizes an agent to spend up to $5 on AI completions
  const createRes = await fetch(`${P402_BASE}/api/v2/governance/mandates`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      user_did: 'did:pkh:eip155:8453:0xYourWalletAddress',
      agent_did: 'did:pkh:eip155:8453:0xAgentAddress',
      type: 'payment',
      constraints: {
        max_amount_usd: 5.00,
        allowed_categories: ['ai.completion', 'ai.embedding'],
        valid_until: new Date(Date.now() + 86400_000).toISOString(), // 24h
      },
    }),
  });

  if (!createRes.ok) {
    console.log('   (Mandate creation requires authenticated tenant — skipping)');
    return;
  }

  const mandate: Mandate = await createRes.json();
  console.log(`   Created mandate: ${mandate.id}`);
  console.log(`   Max spend: $${mandate.constraints.max_amount_usd ?? '?'}`);
  console.log(`   Status: ${mandate.status}`);
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  if (!process.env['P402_API_KEY']) {
    console.error('Set P402_API_KEY environment variable');
    process.exit(1);
  }

  console.log('=== P402 A2A Protocol Demo ===\n');

  // Discover agent capabilities
  await discoverAgent();

  // Submit a task
  const task = await sendTask('Summarize the x402 payment protocol in 2 sentences.');
  if (!task) {
    console.log('\n(Task submission requires an authenticated P402 tenant account)');
  } else if (task.status.state === 'processing' || task.status.state === 'pending') {
    // Poll for result
    const completed = await pollTask(task.id);
    if (completed?.artifacts) {
      console.log('\nResult:');
      for (const artifact of completed.artifacts) {
        for (const part of artifact.parts) {
          if (part.type === 'text') {
            console.log(' ', part.text);
          }
        }
      }
    }
  } else if (task.status.state === 'completed' && task.artifacts) {
    console.log('\nResult (immediate):');
    for (const artifact of task.artifacts) {
      for (const part of artifact.parts) {
        if (part.type === 'text') console.log(' ', part.text);
      }
    }
  }

  // Demonstrate mandates
  await demonstrateMandates();

  console.log('\n=== Done ===');
}

main().catch(console.error);
