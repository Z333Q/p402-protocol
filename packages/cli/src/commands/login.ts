import { Command } from 'commander';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { readConfig, writeConfig, getApiKey, getRouterUrl } from '../config.js';
import { printSuccess, printError, printInfo, printKV, printHeader, fmt } from '../output.js';
import { apiGet } from '../client.js';

export function loginCommand(): Command {
  const cmd = new Command('login');
  cmd
    .description('Authenticate with P402 — store API key in ~/.p402/config.json')
    .option('--key <apiKey>', 'API key (skip interactive prompt)')
    .option('--url <routerUrl>', 'Router base URL (default: https://p402.io)')
    .action(async (opts: { key?: string; url?: string }) => {
      let apiKey = opts.key;

      if (!apiKey) {
        const rl = readline.createInterface({ input, output });
        console.log('\n' + fmt.primary('P402 CLI — Login'));
        console.log(fmt.dim('Get your API key at https://p402.io/dashboard/settings\n'));
        apiKey = (await rl.question('  API key: ')).trim();
        rl.close();
      }

      if (!apiKey) {
        printError('No API key provided.');
        process.exit(1);
      }

      const routerUrl = opts.url ?? 'https://p402.io';

      // Verify key works
      printInfo('Verifying API key…');
      try {
        await apiGet('/api/health', { apiKey, routerUrl });
      } catch {
        printError('Could not reach router — check URL and key.');
        process.exit(1);
      }

      const existing = readConfig();
      writeConfig({ ...existing, apiKey, routerUrl });
      printSuccess(`Logged in. Config saved to ~/.p402/config.json`);
    });

  return cmd;
}

export function configCommand(): Command {
  const cmd = new Command('config');
  cmd
    .description('Show current CLI configuration')
    .option('--json', 'Output as JSON')
    .action((opts: { json?: boolean }) => {
      const key = getApiKey();
      const url = getRouterUrl();
      const masked = key ? key.slice(0, 8) + '…' + key.slice(-4) : '(not set)';

      if (opts.json) {
        console.log(JSON.stringify({ apiKey: masked, routerUrl: url }, null, 2));
        return;
      }

      printHeader('P402 CLI Config');
      printKV({ 'api key': masked, 'router url': url });
      console.log();
    });

  return cmd;
}
