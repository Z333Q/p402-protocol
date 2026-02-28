import chalk from 'chalk';
import Table from 'cli-table3';

export const fmt = {
  primary: (s: string) => chalk.hex('#B6FF2E').bold(s),
  dim: (s: string) => chalk.dim(s),
  success: (s: string) => chalk.green(s),
  error: (s: string) => chalk.red(s),
  warn: (s: string) => chalk.yellow(s),
  info: (s: string) => chalk.cyan(s),
  bold: (s: string) => chalk.bold(s),
  mono: (s: string) => chalk.hex('#A8A8A8')(s),
};

export function printSuccess(msg: string): void {
  console.log(fmt.success('✓ ') + msg);
}

export function printError(msg: string, detail?: string): void {
  console.error(fmt.error('✗ ') + msg);
  if (detail) console.error(fmt.dim('  ' + detail));
}

export function printWarning(msg: string): void {
  console.warn(fmt.warn('⚠ ') + msg);
}

export function printInfo(msg: string): void {
  console.log(fmt.info('→ ') + msg);
}

export function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

export function printHeader(title: string): void {
  console.log('\n' + fmt.primary(title));
  console.log(fmt.dim('─'.repeat(Math.min(title.length + 2, 60))));
}

export function printKV(pairs: Record<string, string | number | boolean | undefined | null>): void {
  const maxKey = Math.max(...Object.keys(pairs).map((k) => k.length));
  for (const [k, v] of Object.entries(pairs)) {
    if (v === undefined || v === null) continue;
    const pad = ' '.repeat(maxKey - k.length);
    console.log(`  ${fmt.dim(k)}${pad}  ${v}`);
  }
}

export function makeTable(head: string[], rows: (string | number)[][]): void {
  const table = new Table({
    head: head.map((h) => fmt.bold(h)),
    style: { head: [], border: ['dim'] },
    chars: {
      top: '─', 'top-mid': '┬', 'top-left': '┌', 'top-right': '┐',
      bottom: '─', 'bottom-mid': '┴', 'bottom-left': '└', 'bottom-right': '┘',
      left: '│', 'left-mid': '├', mid: '─', 'mid-mid': '┼',
      right: '│', 'right-mid': '┤', middle: '│',
    },
  });
  for (const row of rows) table.push(row.map(String));
  console.log(table.toString());
}

export function truncate(s: string, max = 40): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
