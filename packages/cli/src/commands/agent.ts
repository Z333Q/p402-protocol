import { Command } from 'commander';
import ora from 'ora';
import { requireApiKey } from '../client.js';
import { getRouterUrl } from '../config.js';
import { printError, printHeader, printKV, fmt } from '../output.js';

interface AgentLookupResponse {
  address: string;
  registered: boolean;
  human_id: string | null;
  agentkit_enabled: boolean;
  agentbook_contract?: string;
  network?: string;
  message: string;
  error?: string;
}

export function agentCommand(): Command {
  const cmd = new Command('agent');
  cmd.description('Manage World AgentKit identity and proof-of-human verification');

  // ──────────────────────────────────────────────────────────────────────────
  // p402 agent register <address>
  // ──────────────────────────────────────────────────────────────────────────
  cmd
    .command('register <address>')
    .description('Check if a wallet address is registered in AgentBook (World ID–verified)')
    .option('--json', 'Output raw JSON')
    .action(async (address: string, opts: { json?: boolean }) => {
      requireApiKey();
      const routerUrl = getRouterUrl();

      if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
        printError('Invalid address', 'Must be a 0x-prefixed 40-hex-char EVM address');
        process.exit(1);
      }

      const spinner = ora('Checking AgentBook on Base mainnet…').start();

      try {
        const res = await fetch(
          `${routerUrl}/api/v1/agentkit/lookup?address=${encodeURIComponent(address)}`,
          { headers: { 'Authorization': `Bearer ${requireApiKey()}` } }
        );
        const data = await res.json() as AgentLookupResponse;
        spinner.stop();

        if (opts.json) {
          console.log(JSON.stringify(data, null, 2));
          return;
        }

        if (data.error) {
          printError('AgentBook lookup failed', data.error);
          process.exit(1);
        }

        if (!data.agentkit_enabled) {
          console.log(`\n${fmt.warn('⚠')}  World AgentKit is not enabled on this P402 instance.\n`);
          return;
        }

        printHeader('World AgentKit Registration');
        printKV({
          address: data.address,
          status: data.registered
            ? fmt.success('[VERIFIED]') + ' Registered in AgentBook'
            : fmt.warn('NOT REGISTERED'),
          'human id': data.human_id ?? '—',
          network: data.network ?? '—',
          'agentbook contract': data.agentbook_contract ?? '—',
        });
        console.log(`\n${fmt.dim(data.message)}\n`);

        if (!data.registered) {
          console.log(fmt.info('→') + ' To register, verify your humanity at https://worldcoin.org');
          console.log(fmt.info('→') + ' Then add your agent wallet in the World App under Developer settings\n');
        }
      } catch (err: unknown) {
        spinner.stop();
        const msg = err instanceof Error ? err.message : String(err);
        printError('Request failed', msg);
        process.exit(1);
      }
    });

  // ──────────────────────────────────────────────────────────────────────────
  // p402 agent status
  // ──────────────────────────────────────────────────────────────────────────
  cmd
    .command('status')
    .description('Show World AgentKit status for the configured agent address')
    .option('--address <addr>', 'Agent wallet address (default: P402_AGENT_ADDRESS env var)')
    .option('--json', 'Output raw JSON')
    .action(async (opts: { address?: string; json?: boolean }) => {
      requireApiKey();
      const routerUrl = getRouterUrl();

      const address = opts.address ?? process.env['P402_AGENT_ADDRESS'];

      if (!address) {
        printError(
          'No agent address configured.',
          'Pass --address <addr> or set P402_AGENT_ADDRESS env var'
        );
        process.exit(1);
      }

      if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
        printError('Invalid address', 'Must be a 0x-prefixed 40-hex-char EVM address');
        process.exit(1);
      }

      const spinner = ora('Fetching AgentKit status…').start();

      try {
        const res = await fetch(
          `${routerUrl}/api/v1/agentkit/lookup?address=${encodeURIComponent(address)}`,
          { headers: { 'Authorization': `Bearer ${requireApiKey()}` } }
        );
        const data = await res.json() as AgentLookupResponse;
        spinner.stop();

        if (opts.json) {
          console.log(JSON.stringify(data, null, 2));
          return;
        }

        if (data.error) {
          printError('Status check failed', data.error);
          process.exit(1);
        }

        printHeader('World AgentKit Status');

        if (!data.agentkit_enabled) {
          printKV({ 'agentkit enabled': fmt.warn('false') });
          console.log(fmt.dim('\n  Set AGENTKIT_ENABLED=true on the P402 instance to enable.\n'));
          return;
        }

        const badge = data.registered
          ? fmt.primary('[VERIFIED]')
          : fmt.warn('[UNVERIFIED]');

        printKV({
          address: data.address,
          'world id status': badge,
          'human id': data.human_id ?? '—',
          'agentkit enabled': fmt.success('true'),
          network: data.network ?? 'eip155:8453',
        });
        console.log(`\n${fmt.dim(data.message)}\n`);
      } catch (err: unknown) {
        spinner.stop();
        const msg = err instanceof Error ? err.message : String(err);
        printError('Request failed', msg);
        process.exit(1);
      }
    });

  return cmd;
}
