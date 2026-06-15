import { describe, expect, it } from 'vitest';

import { createHychatService } from './hychat-service.js';

function createMockSupabase() {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const user = { id: 'user-1' };
  const profile = {
    id: 'user-1',
    display_name: 'liudong',
    display_color: 'white',
    role: 'admin',
    status: 'active'
  };
  let lastTable = '';

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
      if (lastTable === 'messages') {
        return Promise.resolve({
          data: {
            id: 'message-1',
            room_id: 'room-1',
            sender_id: 'user-1',
            sender_display_name: 'liudong',
            sender_display_color: 'white',
            kind: 'text',
            body: 'hello',
            metadata: {},
            created_at: '2026-06-06T08:00:00.000Z'
          },
          error: null
        });
      }

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
        async signInWithOtp(input: { email: string }) {
          calls.push({ method: 'signInWithOtp', args: [input] });
          return { error: null };
        },
        async verifyOtp(
          input:
            | { email: string; token: string; type: 'email' }
            | { token_hash: string; type: 'email' }
        ) {
          calls.push({ method: 'verifyOtp', args: [input] });
          return { error: null };
        },
        async setSession(input: { access_token: string; refresh_token: string }) {
          calls.push({ method: 'setSession', args: [input] });
          return { error: null };
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
        lastTable = table;
        calls.push({ method: 'from', args: [table] });
        return query;
      },
      rpc(name: string, args: unknown) {
        calls.push({ method: 'rpc', args: [name, args] });
        if (name === 'ensure_profile') {
          return Promise.resolve({ data: [profile], error: null });
        }
        if (name === 'set_display_name') {
          return Promise.resolve({
            data: [
              { ...profile, display_name: (args as { target_display_name: string }).target_display_name }
            ],
            error: null
          });
        }
        if (name === 'create_invite_code') {
          return Promise.resolve({ data: 'invite123', error: null });
        }
        if (name === 'join_room') {
          return Promise.resolve({ data: null, error: null });
        }
        if (name === 'list_rooms_with_counts') {
          return Promise.resolve({
            data: [
              {
                id: 'room-1',
                name: 'Friends',
                owner_id: 'user-1',
                member_count: 3,
                is_member: true
              }
            ],
            error: null
          });
        }
        if (name === 'list_invite_codes') {
          return Promise.resolve({
            data: [
              {
                code: 'invite123',
                room_name: 'Friends',
                used_by_display_name: null,
                used_at: null,
                expires_at: '2026-07-10T00:00:00.000Z'
              }
            ],
            error: null
          });
        }
        if (name === 'revoke_invite_code') {
          return Promise.resolve({ data: true, error: null });
        }
        if (name === 'update_profile_color') {
          return Promise.resolve({
            data: [{ ...profile, display_color: (args as { target_display_color: string }).target_display_color }],
            error: null
          });
        }
        if (name === 'list_room_members') {
          return Promise.resolve({
            data: [
              {
                room_id: 'room-1',
                user_id: 'user-1',
                display_name: 'liudong',
                display_color: 'white',
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

  it('sends and verifies an email OTP through supabase auth', async () => {
    const { supabase, calls } = createMockSupabase();
    const service = createHychatService(supabase);

    await service.sendOtp('ld@example.com');
    await service.verifyOtp('ld@example.com', '482913');
    await service.verifyOtpLink('pkce_abc123');

    expect(calls).toEqual(
      expect.arrayContaining([
        { method: 'signInWithOtp', args: [{ email: 'ld@example.com' }] },
        {
          method: 'verifyOtp',
          args: [{ email: 'ld@example.com', token: '482913', type: 'email' }]
        },
        {
          method: 'verifyOtp',
          args: [{ token_hash: 'pkce_abc123', type: 'email' }]
        }
      ])
    );
  });

  it('ensures a profile through the invite-aware RPC', async () => {
    const { supabase, calls } = createMockSupabase();
    const service = createHychatService(supabase);

    await expect(service.ensureProfile('invite123')).resolves.toEqual({
      id: 'user-1',
      displayName: 'liudong',
      displayColor: 'white',
      role: 'admin',
      status: 'active'
    });

    expect(calls).toEqual(
      expect.arrayContaining([
        {
          method: 'rpc',
          args: ['ensure_profile', { invite_code: 'invite123' }]
        }
      ])
    );
    expect(calls.some((call) => call.method === 'signInWithOtp')).toBe(false);
  });

  it('changes the display name through RPC', async () => {
    const { supabase, calls } = createMockSupabase();
    const service = createHychatService(supabase);

    await expect(service.setDisplayName('Cool Cat')).resolves.toEqual({
      id: 'user-1',
      displayName: 'Cool Cat',
      displayColor: 'white',
      role: 'admin',
      status: 'active'
    });

    expect(calls).toEqual(
      expect.arrayContaining([
        {
          method: 'rpc',
          args: ['set_display_name', { target_display_name: 'Cool Cat' }]
        }
      ])
    );
  });

  it('updates the current profile color through RPC', async () => {
    const { supabase, calls } = createMockSupabase();
    const service = createHychatService(supabase);

    await expect(service.updateProfileColor('rose')).resolves.toEqual({
      id: 'user-1',
      displayName: 'liudong',
      displayColor: 'rose',
      role: 'admin',
      status: 'active'
    });

    expect(calls).toEqual(
      expect.arrayContaining([
        {
          method: 'rpc',
          args: ['update_profile_color', { target_display_color: 'rose' }]
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

  it('creates a global invite code, lists rooms with counts, self-joins, and invokes the quote function', async () => {
    const { supabase, calls } = createMockSupabase();
    const service = createHychatService(supabase);

    await service.createInviteCode();
    const rooms = await service.listRoomsWithCounts();
    await service.joinRoom('room-1');
    await service.getQuotes(['AAPL.US'], false);

    expect(rooms).toEqual([
      { id: 'room-1', name: 'Friends', owner_id: 'user-1', member_count: 3, is_member: true }
    ]);
    expect(calls).toEqual(
      expect.arrayContaining([
        {
          method: 'rpc',
          args: ['create_invite_code', {}]
        },
        {
          method: 'rpc',
          args: ['list_rooms_with_counts', {}]
        },
        {
          method: 'rpc',
          args: ['join_room', { target_room_id: 'room-1' }]
        },
        {
          method: 'invoke',
          args: ['get-stock-quotes', { body: { symbols: ['AAPL.US'], force: false } }]
        }
      ])
    );
  });

  it('lists and revokes invite codes through RPC', async () => {
    const { supabase, calls } = createMockSupabase();
    const service = createHychatService(supabase);

    await expect(service.listInviteCodes()).resolves.toEqual([
      expect.objectContaining({ code: 'invite123', room_name: 'Friends' })
    ]);
    await service.revokeInviteCode('invite123');

    expect(calls).toEqual(
      expect.arrayContaining([
        { method: 'rpc', args: ['list_invite_codes', {}] },
        { method: 'rpc', args: ['revoke_invite_code', { target_code: 'invite123' }] }
      ])
    );
  });

  it('returns the inserted chat message without requiring a follow-up message list query', async () => {
    const { supabase, calls } = createMockSupabase();
    const service = createHychatService(supabase);

    await expect(
      service.sendTextMessage({
        roomId: 'room-1',
        senderId: 'user-1',
        body: 'hello'
      })
    ).resolves.toEqual({
      id: 'message-1',
      room_id: 'room-1',
      sender_id: 'user-1',
      sender_display_name: 'liudong',
      sender_display_color: 'white',
      kind: 'text',
      body: 'hello',
      metadata: {},
      created_at: '2026-06-06T08:00:00.000Z'
    });

    expect(calls).toEqual(
      expect.arrayContaining([
        { method: 'from', args: ['messages'] },
        {
          method: 'insert',
          args: [
            {
              room_id: 'room-1',
              sender_id: 'user-1',
              kind: 'text',
              body: 'hello',
              metadata: {}
            }
          ]
        },
        {
          method: 'select',
          args: ['id,room_id,sender_id,sender_display_name,sender_display_color,kind,body,metadata,created_at']
        },
        { method: 'single', args: [] }
      ])
    );
    expect(calls).not.toContainEqual({ method: 'limit', args: [50] });
  });

  it('lists room members', async () => {
    const { supabase, calls } = createMockSupabase();
    const service = createHychatService(supabase);

    await expect(service.listMembers('room-1')).resolves.toEqual([
      {
        room_id: 'room-1',
        user_id: 'user-1',
        display_name: 'liudong',
        display_color: 'white',
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

  it('falls back to room_members when the member RPC is missing from the schema cache', async () => {
    const { supabase, calls } = createMockSupabase();
    (supabase as { rpc: (name: string, args: unknown) => Promise<unknown> }).rpc = (
      name: string,
      args: unknown
    ) => {
      calls.push({ method: 'rpc', args: [name, args] });
      if (name === 'list_room_members') {
        return Promise.resolve({
          data: null,
          error: {
            code: 'PGRST202',
            message:
              'Could not find the function public.list_room_members(target_room_id) in the schema cache'
          }
        });
      }

      return Promise.resolve({ data: null, error: null });
    };
    const service = createHychatService(supabase);

    await expect(service.listMembers('room-1')).resolves.toEqual([]);

    expect(calls).toEqual(
      expect.arrayContaining([
        {
          method: 'rpc',
          args: ['list_room_members', { target_room_id: 'room-1' }]
        },
        { method: 'from', args: ['room_members'] },
        { method: 'select', args: ['room_id,user_id,role,created_at'] },
        { method: 'eq', args: ['room_id', 'room-1'] },
        { method: 'order', args: ['created_at', { ascending: true }] }
      ])
    );
  });
});
