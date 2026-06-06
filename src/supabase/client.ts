import { createClient } from '@supabase/supabase-js';

import type { AppConfig } from '../config/env.js';

export function createHychatSupabaseClient(config: AppConfig) {
  return createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true
    }
  });
}
