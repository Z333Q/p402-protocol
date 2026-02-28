import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const CONFIG_DIR = join(homedir(), '.p402');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

export interface P402Config {
  apiKey?: string;
  routerUrl?: string;
}

export function readConfig(): P402Config {
  if (!existsSync(CONFIG_FILE)) return {};
  try {
    const raw = readFileSync(CONFIG_FILE, 'utf-8');
    return JSON.parse(raw) as P402Config;
  } catch {
    return {};
  }
}

export function writeConfig(config: P402Config): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

export function getApiKey(): string | undefined {
  // Priority: env var → config file
  return process.env['P402_API_KEY'] ?? readConfig().apiKey;
}

export function getRouterUrl(): string {
  return (
    process.env['P402_ROUTER_URL'] ??
    readConfig().routerUrl ??
    'https://p402.io'
  );
}
