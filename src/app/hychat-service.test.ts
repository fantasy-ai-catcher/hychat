import { describe, expect, it } from 'vitest';

import { createHychatService } from './hychat-service.js';

function createMockSupabase() {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const user = { id: 'user-1', email: 'me@example.com' };

  const query = {
    select(...args: unknown[]) {
      calls.push({ method: 'select', args });
      return query;
    },
    insert(...args: unknown[]) {
      calls.push({ method: 'insert', args });
      return query;
    },
    upsert(...args: unknown[]) {
      calls.push({ method: 'upsert', args });
      return query;
    },
    delete(...args: unknown[]) {
      calls.push({ method: 'delete', args });
      return query;
    },
    eq(...args: unknown[]) {
      calls.push({ method: 'eq', args });
      return query;
    },
    order(...args: unknown[]) {
      calls.push({ method: 'order', args });
      return query;
    },
    limit(...args: unknown[]) {
      calls.push({ method: 'limit', args });
      return query;
    },
    single() {
      calls.push({ method: 'single', args: [] });
      return Promise.resolve({ data: { id: 'room-1', name: 'Friends' }, error: null });
    },
    then(resolve: (value: unknown) => void) {
      resolve({ data: [], error: null });
    }
  };

  return {
    calls,
    supabase: {
      auth: {
        async signInWithPassword(args: unknown) {
          calls.push({ method: 'signInWithPassword', args: [args] });
          return { data: { user }, error: null };
        },
        async signUp(args: unknown) {
          calls.push({ method: 'signUp', args: [args] });
          return { data: { user }, error: null };
        },
        async signOut() {
          calls.push({ method: 'signOut', args: [] });
          return { error: null };
        },
        async getUser() {
          calls.push({ method: 'getUser', args: [] });
          return { data: { user }, error: null };
        }
      },
      from(table: string) {
        calls.push({ method: 'from', args: [table] });
        return query;
      },
      rpc(name: string, args: unknown) {
        calls.push({ method: 'rpc', args: [name, args] });
        return Promise.resolve({ data: 'user-2', error: null });
      },
      functions: {
        invoke(name: string, args: unknown) {
          calls.push({ method: 'invoke', args: [name, args] });
          return Promise.resolve({ data: { quotes: [], failed: [] }, error: null });
        }
      }
    }
  };
}

describe('createHychatService', () => {
  it('signs in and upserts the user profile', async () => {
    const { supabase, calls } = createMockSupabase();
    const service = createHychatService(supabase);

    await service.signIn('me@example.com', 'secret');

    expect(calls).toEqual(
      expect.arrayContaining([
        {
          method: 'signInWithPassword',
          args: [{ email: 'me@example.com', password: 'secret' }]
        },
        { method: 'from', args: ['profiles'] },
        {
          method: 'upsert',
          args: [
            {
              id: 'user-1',
              email: 'me@example.com',
              display_name: 'me'
            }
          ]
        }
      ])
    );
  });

  it('creates rooms and inserts the owner membership', async () => {
    const { supabase, calls } = createMockSupabase();
    const service = createHychatService(supabase);

    await service.createRoom('Friends', 'user-1');

    expect(calls).toEqual(
      expect.arrayContaining([
        {
          method: 'insert',
          args: [{ name: 'Friends', owner_id: 'user-1' }]
        },
        {
          method: 'insert',
          args: [{ room_id: 'room-1', user_id: 'user-1', role: 'owner' }]
        }
      ])
    );
  });

  it('invites by email and invokes the quote function', async () => {
    const { supabase, calls } = createMockSupabase();
    const service = createHychatService(supabase);

    await service.inviteMember('room-1', 'friend@example.com');
    await service.getQuotes(['AAPL.US'], false);

    expect(calls).toEqual(
      expect.arrayContaining([
        {
          method: 'rpc',
          args: [
            'invite_room_member_by_email',
            { target_room_id: 'room-1', target_email: 'friend@example.com' }
          ]
        },
        {
          method: 'invoke',
          args: ['get-stock-quotes', { body: { symbols: ['AAPL.US'], force: false } }]
        }
      ])
    );
  });
});
