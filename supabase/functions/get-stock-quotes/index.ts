import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { resolveStockQuotes } from '../_shared/stocks/cache.ts';
import { createSupabaseQuoteCache, createYahooAuthStore } from '../_shared/stocks/store.ts';
import { createYahooProvider } from '../_shared/stocks/yahoo.ts';

type RequestBody = {
  symbols?: string[];
  force?: boolean;
};

const MAX_SYMBOLS_PER_REQUEST = 50;

Deno.serve(async (request) => {
  try {
    const body = (await request.json()) as RequestBody;
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');

    // Yahoo's quote endpoint is keyless, so no provider API key is required.
    if (!supabaseUrl || !serviceRoleKey || !anonKey) {
      return Response.json({ error: 'missing_server_configuration' }, { status: 500 });
    }

    if (
      !Array.isArray(body.symbols) ||
      body.symbols.length === 0 ||
      body.symbols.length > MAX_SYMBOLS_PER_REQUEST ||
      body.symbols.some((symbol) => typeof symbol !== 'string' || symbol.trim() === '')
    ) {
      return Response.json({ error: 'invalid_symbols' }, { status: 400 });
    }

    const authHeader = request.headers.get('Authorization');
    if (!authHeader) {
      return Response.json({ error: 'missing_authorization' }, { status: 401 });
    }

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } }
    });
    const { data: callerData, error: callerError } = await callerClient.auth.getUser();
    if (callerError || !callerData.user) {
      return Response.json({ error: 'invalid_token' }, { status: 401 });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Quote refreshes spend provider quota, so only activated profiles
    // (nickname + invite onboarding completed) may trigger them.
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', callerData.user.id)
      .eq('status', 'active')
      .maybeSingle();
    if (profileError) {
      return Response.json({ error: 'profile_lookup_failed' }, { status: 500 });
    }
    if (!profile) {
      return Response.json({ error: 'profile_not_active' }, { status: 403 });
    }
    const cache = createSupabaseQuoteCache(supabase);

    const result = await resolveStockQuotes({
      symbols: body.symbols,
      force: body.force ?? false,
      cache,
      provider: createYahooProvider({ store: createYahooAuthStore(supabase) }),
      now: new Date(),
      ttlSeconds: Number(Deno.env.get('STOCK_QUOTE_CACHE_TTL_SECONDS') ?? '60'),
      forceMinIntervalSeconds: Number(
        Deno.env.get('STOCK_QUOTE_FORCE_MIN_INTERVAL_SECONDS') ?? '30'
      ),
      failureRetrySeconds: Number(Deno.env.get('STOCK_QUOTE_FAILURE_RETRY_SECONDS') ?? '15')
    });

    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown_error';
    return Response.json({ error: message }, { status: 400 });
  }
});
