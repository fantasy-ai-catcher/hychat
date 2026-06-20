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

const envSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
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
