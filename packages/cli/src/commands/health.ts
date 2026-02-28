import { Command } from 'commander';
import ora from 'ora';
import { apiGet } from '../client.js';
import { getRouterUrl } from '../config.js';
import { printHeader, printKV, printJson, printError, fmt } from '../output.js';

interface FacilitatorHealth {
  status?: string;
  network?: string;
  treasury?: string;
  usdc?: string;
  gas_price_gwei?: number;
  block_number?: number;
  uptime_ms?: number;
  [key: string]: unknown;
}

export function healthCommand(): Command {
  const cmd = new Command('health');
  cmd
    .description('Check P402 facilitator health')
    .option('--json', 'Output as JSON')
    .action(async (opts: { json?: boolean }) => {
      const url = getRouterUrl();
      const spinner = ora(`Checking ${fmt.dim(url)} …`).start();

      try {
        const data = await apiGet<FacilitatorHealth>('/api/v1/facilitator/health');
        spinner.stop();

        if (opts.json) {
          printJson(data);
          return;
        }

        printHeader('Facilitator Health');
        printKV({
          status: data.status ?? '?',
          network: data.network ?? '?',
          treasury: data.treasury ?? '?',
          'gas (gwei)': data.gas_price_gwei != null ? String(data.gas_price_gwei) : '?',
          'block': data.block_number != null ? String(data.block_number) : '?',
        });
        console.log();
      } catch (err: unknown) {
        spinner.stop();
        const msg = err instanceof Error ? err.message : String(err);
        printError('Health check failed.', msg);
        process.exit(1);
      }
    });

  return cmd;
}
