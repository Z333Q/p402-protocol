import { getApiKey, getRouterUrl } from './config.js';
import { printError } from './output.js';

export interface ApiOptions {
  apiKey?: string;
  routerUrl?: string;
}

function buildHeaders(overrideKey?: string): Record<string, string> {
  const key = overrideKey ?? getApiKey();
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (key) h['Authorization'] = `Bearer ${key}`;
  return h;
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json() as { error?: string; message?: string };
      detail = body.error ?? body.message ?? res.statusText;
    } catch {
      detail = res.statusText;
    }
    throw new Error(`HTTP ${res.status}: ${detail}`);
  }
  return res.json() as Promise<T>;
}

export async function apiGet<T>(path: string, opts?: ApiOptions): Promise<T> {
  const base = opts?.routerUrl ?? getRouterUrl();
  const res = await fetch(`${base}${path}`, {
    headers: buildHeaders(opts?.apiKey),
  });
  return handleResponse<T>(res);
}

export async function apiPost<T>(path: string, body: unknown, opts?: ApiOptions): Promise<T> {
  const base = opts?.routerUrl ?? getRouterUrl();
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: buildHeaders(opts?.apiKey),
    body: JSON.stringify(body),
  });
  return handleResponse<T>(res);
}

export function requireApiKey(): string {
  const key = getApiKey();
  if (!key) {
    printError('No API key configured.', 'Run: p402 login  or set P402_API_KEY env var');
    process.exit(1);
  }
  return key;
}
