import { Command } from 'commander';
import ora from 'ora';
import { apiGet, requireApiKey } from '../client.js';
import { printHeader, printKV, printJson, printError } from '../output.js';

interface SpendAnalytics {
  total_spent_usd?: number;
  request_count?: number;
  avg_cost_per_request?: number;
  top_providers?: Array<{ provider?: string; spend?: number; requests?: number }>;
  period?: string;
  [key: string]: unknown;
}

export function analyticsCommand(): Command {
  const cmd = new Command('analytics');
  cmd.description('Spend and usage analytics');

  cmd
    .command('spend')
    .description('View spend analytics')
    .option('--period <period>', 'Time period: 1d|7d|30d', '7d')
    .option('--json', 'Output as JSON')
    .action(async (opts: { period?: string; json?: boolean }) => {
      requireApiKey();
      const spinner = ora('Fetching analytics…').start();
      try {
        const qs = opts.period ? `?period=${opts.period}` : '';
        const data = await apiGet<SpendAnalytics>(`/api/v2/analytics/spend${qs}`);
        spinner.stop();

        if (opts.json) {
          printJson(data);
          return;
        }

        printHeader('Spend Analytics');
        printKV({
          period: data.period ?? opts.period ?? '—',
          'total spent': data.total_spent_usd != null ? `$${data.total_spent_usd.toFixed(4)}` : '—',
          requests: data.request_count != null ? String(data.request_count) : '—',
          'avg/request': data.avg_cost_per_request != null ? `$${data.avg_cost_per_request.toFixed(6)}` : '—',
        });

        if (data.top_providers && data.top_providers.length > 0) {
          console.log('\n  Top providers:');
          for (const p of data.top_providers) {
            console.log(`    ${p.provider ?? '?'}  $${p.spend?.toFixed(4) ?? '?'}  (${p.requests ?? '?'} req)`);
          }
        }
        console.log();
      } catch (err: unknown) {
        spinner.stop();
        const msg = err instanceof Error ? err.message : String(err);
        printError('Failed to fetch analytics.', msg);
        process.exit(1);
      }
    });

  return cmd;
}
