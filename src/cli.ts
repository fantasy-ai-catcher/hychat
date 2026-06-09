import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import React from 'react';
import { parse as parseDotenv } from 'dotenv';
import { render } from 'ink';

import { createHychatService } from './app/hychat-service.js';
import { createRealtimeAdapter } from './app/realtime-adapter.js';
import { getDefaultDisplayName } from './app/default-display-name.js';
import { getDefaultSessionPath, JsonFileStorage } from './app/session-storage.js';
import { loadEnv, parseEnv } from './config/env.js';
import { createHychatSupabaseClient } from './supabase/client.js';
import { App } from './ui/App.js';

export type RunCliOptions = {
  argv: string[];
};

export type RuntimeDotenvOptions = {
  cwd?: string;
  homeDir?: string;
  env?: Record<string, string | undefined>;
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

export function loadRuntimeDotenv(options: RuntimeDotenvOptions = {}): string[] {
  const env = options.env ?? process.env;
  const originalKeys = new Set(
    Object.entries(env)
      .filter(([, value]) => value !== undefined)
      .map(([key]) => key)
  );
  const files = [
    join(options.homeDir ?? homedir(), '.config', 'hychat', '.env'),
    join(options.cwd ?? process.cwd(), '.env')
  ];
  const loaded: string[] = [];

  for (const file of files) {
    if (!existsSync(file)) {
      continue;
    }

    const values = parseDotenv(readFileSync(file, 'utf8'));
    for (const [key, value] of Object.entries(values)) {
      if (!originalKeys.has(key)) {
        env[key] = value;
      }
    }
    loaded.push(file);
  }

  return loaded;
}

export async function runCli(options: RunCliOptions): Promise<void> {
  const args = options.argv.slice(2);

  if (args.includes('--version') || args.includes('-V')) {
    console.log(getCliVersion());
    return;
  }

  if (args[0] === 'doctor') {
    loadRuntimeDotenv();
    const report = createDoctorReport();
    for (const line of report.lines) {
      console.log(line);
    }
    process.exitCode = report.ok ? 0 : 1;
    return;
  }

  try {
    loadRuntimeDotenv();
    const config = loadEnv();
    const supabase = createHychatSupabaseClient(config, {
      authStorage: new JsonFileStorage(getDefaultSessionPath())
    });
    const service = createHychatService(supabase);
    const realtime = createRealtimeAdapter(supabase);

    render(React.createElement(App, { service, realtime, defaultDisplayName: getDefaultDisplayName() }));
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
