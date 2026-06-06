import { createClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import { createHychatSupabaseClient } from './client.js';

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ mocked: true }))
}));

describe('createHychatSupabaseClient', () => {
  it('passes persistent auth storage to supabase-js', () => {
    const storage = {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn()
    };

    createHychatSupabaseClient(
      {
        supabaseUrl: 'https://example.supabase.co',
        supabasePublishableKey: 'sb_publishable_test',
        stockProvider: 'twelve_data',
        stockQuoteCacheTtlSeconds: 60
      },
      { authStorage: storage }
    );

    expect(createClient).toHaveBeenCalledWith(
      'https://example.supabase.co',
      'sb_publishable_test',
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          storage
        }
      }
    );
  });
});
