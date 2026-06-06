import 'dotenv/config';
import React from 'react';
import { render } from 'ink';

import { createHychatService } from './app/hychat-service.js';
import { createRealtimeAdapter } from './app/realtime-adapter.js';
import { getDefaultSessionPath, JsonFileStorage } from './app/session-storage.js';
import { loadEnv } from './config/env.js';
import { createHychatSupabaseClient } from './supabase/client.js';
import { App } from './ui/App.js';

export type RunCliOptions = {
  argv: string[];
};

export function getCliName(): string {
  return 'hychat';
}

export async function runCli(_options: RunCliOptions): Promise<void> {
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
