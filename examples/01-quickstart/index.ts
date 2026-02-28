/**
 * P402 Quickstart
 * ---------------
 * Login → chat → view spend in ~20 lines.
 *
 * Prerequisites:
 *   export P402_API_KEY=p402_live_...
 *   npm install @p402/sdk
 */

import P402Client, { P402Error } from '@p402/sdk';

const p402 = new P402Client({
  apiKey: process.env['P402_API_KEY'],
});

async function main() {
  // 1. Check connectivity
  const healthy = await p402.health();
  if (!healthy) {
    console.error('P402 router is unreachable. Check P402_API_KEY.');
    process.exit(1);
  }
  console.log('✓ Router healthy');

  // 2. Send a chat request — P402 picks the cheapest provider
  console.log('\nSending chat request (cost mode)...');
  try {
    const response = await p402.chat({
      messages: [
        { role: 'system', content: 'You are a helpful assistant. Keep answers under 50 words.' },
        { role: 'user', content: 'What is x402? Give me one sentence.' },
      ],
      p402: {
        mode: 'cost',   // Cheapest provider that can handle the request
        cache: true,    // Return cached response if semantically similar request exists
      },
    });

    const message = response.choices[0]?.message.content ?? '';
    console.log('\nResponse:', message);

    // 3. Inspect routing metadata
    const meta = response.p402_metadata;
    console.log('\nRouting metadata:');
    console.log(`  provider:    ${meta.provider}`);
    console.log(`  model:       ${meta.model}`);
    console.log(`  cost:        $${meta.cost_usd.toFixed(6)}`);
    console.log(`  latency:     ${meta.latency_ms}ms`);
    console.log(`  from cache:  ${meta.cached}`);
  } catch (err) {
    if (err instanceof P402Error) {
      console.error(`P402 error [${err.code}]:`, err.message);
    } else {
      throw err;
    }
  }
}

main();
