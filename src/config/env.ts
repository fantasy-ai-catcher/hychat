import { z } from 'zod';

export type AppConfig = {
  supabaseUrl: string;
  supabasePublishableKey: string;
  stockProvider: 'yahoo_finance';
  stockQuoteCacheTtlSeconds: number;
};

export type ParseEnvResult =
  | { success: true; value: AppConfig }
  | { success: false; errors: string[] };

// Baked-in connection defaults so a `brew install`ed binary runs with zero
// configuration for our small circle of friends. Both values are safe to ship
// in a public build: the URL is just the project endpoint and the publishable
// key is the anon key, with all data access gated by Supabase RLS + the invite
// code. Override either via env or ~/.config/hychat/.env (e.g. for local dev
// against a different project).
const DEFAULT_SUPABASE_URL = 'https://vsehfqpteqykbnvlwqyd.supabase.co';
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_AVB8zG24fpR0kVC5hozjlQ_60QnJp3B';

const envSchema = z.object({
  SUPABASE_URL: z.string().url().default(DEFAULT_SUPABASE_URL),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1).default(DEFAULT_SUPABASE_PUBLISHABLE_KEY),
  STOCK_PROVIDER: z.literal('yahoo_finance').default('yahoo_finance'),
  STOCK_QUOTE_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(60)
});

export function parseEnv(env: Record<string, string | undefined>): ParseEnvResult {
  const parsed = envSchema.safeParse(env);

  if (!parsed.success) {
    return {
      success: false,
      errors: parsed.error.issues.map((issue) => {
        const path = issue.path.join('.') || 'env';
        return `${path}: ${issue.message}`;
      })
    };
  }

  return {
    success: true,
    value: {
      supabaseUrl: parsed.data.SUPABASE_URL,
      supabasePublishableKey: parsed.data.SUPABASE_PUBLISHABLE_KEY,
      stockProvider: parsed.data.STOCK_PROVIDER,
      stockQuoteCacheTtlSeconds: parsed.data.STOCK_QUOTE_CACHE_TTL_SECONDS
    }
  };
}

export function loadEnv(env: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = parseEnv(env);

  if (!parsed.success) {
    throw new Error(`Invalid environment:\n${parsed.errors.join('\n')}`);
  }

  return parsed.value;
}
