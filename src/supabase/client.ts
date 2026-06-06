import { createClient } from '@supabase/supabase-js';

import type { AppConfig } from '../config/env.js';

type AuthStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

export type CreateHychatSupabaseClientOptions = {
  authStorage?: AuthStorage;
};

export function createHychatSupabaseClient(
  config: AppConfig,
  options: CreateHychatSupabaseClientOptions = {}
) {
  return createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      ...(options.authStorage ? { storage: options.authStorage } : {})
    }
  });
}
