import { describe, expect, it } from 'vitest';

import { createHychatService } from './hychat-service.js';

function createMockSupabase() {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const user = { id: 'user-1' };
  const profile = {
    id: 'user-1',
    display_name: 'liudong',
    role: 'admin',
    status: 'active'
  };

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
    maybeSingle() {
      calls.push({ method: 'maybeSingle', args: [] });
      return Promise.resolve({ data: profile, error: null });
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
        async signInAnonymously(args?: unknown) {
          calls.push({ method: 'signInAnonymously', args: args ? [args] : [] });
          return { data: { user }, error: null };
        },
        async signOut() {
          calls.push({ method: 'signOut', args: [] });
          return { error: null };
        },
        async getUser(): Promise<{
          data: { user: typeof user | null };
          error: { message: string } | null;
        }> {
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
        if (name === 'start_profile') {
          return Promise.resolve({ data: [profile], error: null });
        }
        if (name === 'create_invite_code') {
          return Promise.resolve({ data: 'invite123', error: null });
        }
        if (name === 'list_room_members') {
          return Promise.resolve({
            data: [
              {
                room_id: 'room-1',
                user_id: 'user-1',
                display_name: 'liudong',
                role: 'owner',
                created_at: '2026-06-06T08:00:00.000Z'
              }
            ],
            error: null
          });
        }
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
  it('treats a missing auth session as a signed-out user', async () => {
    const { supabase } = createMockSupabase();
    supabase.auth.getUser = async () => ({
      data: { user: null },
      error: { message: 'Auth session missing!' }
    });
    const service = createHychatService(supabase);

    await expect(service.getCurrentUser()).resolves.toBeNull();
  });

  it('starts an anonymous profile through the invite-aware RPC', async () => {
    const { supabase, calls } = createMockSupabase();
    supabase.auth.getUser = async () => ({
      data: { user: null },
      error: { message: 'Auth session missing!' }
    });
    const service = createHychatService(supabase);

    await expect(service.startProfile('liudong', 'invite123')).resolves.toEqual({
      id: 'user-1',
      displayName: 'liudong',
      role: 'admin',
      status: 'active'
    });

    expect(calls).toEqual(
      expect.arrayContaining([
        { method: 'signInAnonymously', args: [] },
        {
          method: 'rpc',
          args: [
            'start_profile',
            { target_display_name: 'liudong', invite_code: 'invite123' }
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

  it('creates invite codes, invites by nickname, and invokes the quote function', async () => {
    const { supabase, calls } = createMockSupabase();
    const service = createHychatService(supabase);

    await service.createInviteCode();
    await service.inviteMember('room-1', 'alice');
    await service.getQuotes(['AAPL.US'], false);

    expect(calls).toEqual(
      expect.arrayContaining([
        {
          method: 'rpc',
          args: [
            'create_invite_code',
            {}
          ]
        },
        {
          method: 'rpc',
          args: [
            'invite_room_member_by_display_name',
            { target_room_id: 'room-1', target_display_name: 'alice' }
          ]
        },
        {
          method: 'invoke',
          args: ['get-stock-quotes', { body: { symbols: ['AAPL.US'], force: false } }]
        }
      ])
    );
  });

  it('lists room members', async () => {
    const { supabase, calls } = createMockSupabase();
    const service = createHychatService(supabase);

    await expect(service.listMembers('room-1')).resolves.toEqual([
      {
        room_id: 'room-1',
        user_id: 'user-1',
        display_name: 'liudong',
        role: 'owner',
        created_at: '2026-06-06T08:00:00.000Z'
      }
    ]);

    expect(calls).toEqual(
      expect.arrayContaining([
        {
          method: 'rpc',
          args: ['list_room_members', { target_room_id: 'room-1' }]
        }
      ])
    );
  });
});
