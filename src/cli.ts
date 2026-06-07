import 'dotenv/config';
import { readFileSync } from 'node:fs';
import React from 'react';
import { render } from 'ink';

import { createHychatService } from './app/hychat-service.js';
import { createRealtimeAdapter } from './app/realtime-adapter.js';
import { getDefaultSessionPath, JsonFileStorage } from './app/session-storage.js';
import { loadEnv, parseEnv } from './config/env.js';
import { createHychatSupabaseClient } from './supabase/client.js';
import { App } from './ui/App.js';

export type RunCliOptions = {
  argv: string[];
};

export function getCliName(): string {
  return 'hychat';
}

export function getCliVersion(): string {
  for (const path of ['../package.json', '../../package.json']) {
    try {
      const packageJson = JSON.parse(
        readFileSync(new URL(path, import.meta.url), 'utf8')
      ) as { version: string };
      return packageJson.version;
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error;
      }
    }
  }

  throw new Error('Unable to locate package.json for version output.');
}

export type DoctorReport = {
  ok: boolean;
  lines: string[];
};

export function createDoctorReport(
  env: Record<string, string | undefined> = process.env
): DoctorReport {
  const lines = [`${getCliName()} ${getCliVersion()}`];
  const parsed = parseEnv(env);

  if (parsed.success) {
    lines.push('Runtime env: ok');
    lines.push(`Supabase URL: ${parsed.value.supabaseUrl}`);
    lines.push(`Stock provider: ${parsed.value.stockProvider}`);
    lines.push(`Quote cache TTL: ${parsed.value.stockQuoteCacheTtlSeconds}s`);
    return { ok: true, lines };
  }

  lines.push('Runtime env: missing or invalid');
  lines.push(...parsed.errors);
  return { ok: false, lines };
}

export async function runCli(options: RunCliOptions): Promise<void> {
  const args = options.argv.slice(2);

  if (args.includes('--version') || args.includes('-V')) {
    console.log(getCliVersion());
    return;
  }

  if (args[0] === 'doctor') {
    const report = createDoctorReport();
    for (const line of report.lines) {
      console.log(line);
    }
    process.exitCode = report.ok ? 0 : 1;
    return;
  }

  try {
    const config = loadEnv();
    const supabase = createHychatSupabaseClient(config, {
      authStorage: new JsonFileStorage(getDefaultSessionPath())
    });
    const service = createHychatService(supabase);
    const realtime = createRealtimeAdapter(supabase);

    render(React.createElement(App, { service, realtime }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to start HyChat.';
    console.error(message);
    process.exitCode = 1;
  }
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'ENOENT'
  );
}
