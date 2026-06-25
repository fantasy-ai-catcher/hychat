export type HychatUser = {
  id: string;
  displayName: string;
  displayColor: string;
  role: 'admin' | 'member';
  status: 'active' | 'disabled';
};

export type RoomSummary = {
  id: string;
  name: string;
};

export type RoomWithCountRow = {
  id: string;
  name: string;
  owner_id?: string;
  member_count?: number | string;
  is_member?: boolean;
};

export type ChatMessageRow = {
  id: string;
  room_id: string;
  sender_id: string;
  sender_display_name?: string;
  sender_display_color?: string;
  kind: 'text' | 'system';
  body: string;
  metadata?: Record<string, unknown>;
  created_at: string;
};

export type WatchlistRow = {
  room_id: string;
  canonical_symbol: string;
  added_by: string;
  created_at: string;
};

export type InviteCodeRow = {
  code: string;
  room_id?: string | null;
  room_name?: string | null;
  used_by_display_name?: string | null;
  used_at?: string | null;
  expires_at: string;
  created_at?: string;
};

export type RoomMemberRow = {
  room_id: string;
  user_id: string;
  display_name?: string;
  display_color?: string;
  role: 'owner' | 'member';
  created_at: string;
};

export type SendTextMessageInput = {
  roomId: string;
  senderId: string;
  body: string;
  metadata?: Record<string, unknown>;
};

export type AddWatchSymbolInput = {
  roomId: string;
  symbol: string;
  addedBy: string;
};

type ErrorLike = {
  message: string;
  code?: string;
};

type SupabaseLikeClient = {
  auth: {
    signInWithOtp: (input: { email: string }) => Promise<{ error: ErrorLike | null }>;
    verifyOtp: (
      input:
        | { email: string; token: string; type: 'email' }
        | { token_hash: string; type: 'email' }
    ) => Promise<{ error: ErrorLike | null }>;
    setSession: (input: {
      access_token: string;
      refresh_token: string;
    }) => Promise<{ error: ErrorLike | null }>;
    signOut: () => Promise<{ error: ErrorLike | null }>;
    getUser: () => Promise<{
      data: { user: { id: string; email?: string | null } | null };
      error: ErrorLike | null;
    }>;
  };
  from: (table: string) => any;
  rpc: (name: string, args: Record<string, unknown>) => any;
  functions: {
    invoke: (name: string, args: Record<string, unknown>) => any;
  };
};

type ProfileRow = {
  id: string;
  display_name: string;
  display_color?: string;
  role: 'admin' | 'member';
  status: 'active' | 'disabled';
};

export function createHychatService(supabase: SupabaseLikeClient) {
  return {
    async getCurrentUser(): Promise<HychatUser | null> {
      const result = await supabase.auth.getUser();
      if (isMissingAuthSessionError(result.error)) {
        return null;
      }

      ensureNoError(result.error);
      if (!result.data.user) {
        return null;
      }

      const profile = await getProfile(supabase, result.data.user.id);
      return profile?.status === 'active' ? toHychatUser(profile) : null;
    },

    async sendOtp(email: string): Promise<void> {
      const result = await supabase.auth.signInWithOtp({ email });
      ensureNoError(result.error);
    },

    async verifyOtp(email: string, code: string): Promise<void> {
      const result = await supabase.auth.verifyOtp({ email, token: code, type: 'email' });
      ensureNoError(result.error);
    },

    async verifyOtpLink(tokenHash: string): Promise<void> {
      const result = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'email' });
      ensureNoError(result.error);
    },

    async setSessionTokens(accessToken: string, refreshToken: string): Promise<void> {
      const result = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken
      });
      ensureNoError(result.error);
    },

    async getAuthEmail(): Promise<string | null> {
      const result = await supabase.auth.getUser();
      if (isMissingAuthSessionError(result.error)) {
        return null;
      }

      ensureNoError(result.error);
      return result.data.user?.email ?? null;
    },

    async ensureProfile(inviteCode?: string): Promise<HychatUser> {
      const result = await supabase.rpc('ensure_profile', {
        invite_code: inviteCode ?? null
      });
      const profile = await ensureData<ProfileRow | ProfileRow[]>(result);
      const row = Array.isArray(profile) ? profile[0] : profile;
      if (!row) {
        throw new Error('Supabase did not return a profile.');
      }
      return toHychatUser(row);
    },

    async setDisplayName(displayName: string): Promise<HychatUser> {
      const result = await supabase.rpc('set_display_name', {
        target_display_name: displayName
      });
      const profile = await ensureData<ProfileRow | ProfileRow[]>(result);
      const row = Array.isArray(profile) ? profile[0] : profile;
      if (!row) {
        throw new Error('Supabase did not return a profile.');
      }
      return toHychatUser(row);
    },

    async updateProfileColor(color: string): Promise<HychatUser> {
      const result = await supabase.rpc('update_profile_color', {
        target_display_color: color
      });
      const profile = await ensureData<ProfileRow | ProfileRow[]>(result);
      const row = Array.isArray(profile) ? profile[0] : profile;
      if (!row) {
        throw new Error('Supabase did not return a profile.');
      }
      return toHychatUser(row);
    },

    async signOut(): Promise<void> {
      const result = await supabase.auth.signOut();
      ensureNoError(result.error);
    },

    async createInviteCode(): Promise<string> {
      const result = await supabase.rpc('create_invite_code', {});
      return ensureData<string>(result);
    },

    async listInviteCodes(): Promise<InviteCodeRow[]> {
      const result = await supabase.rpc('list_invite_codes', {});
      return ensureData<InviteCodeRow[]>(result);
    },

    async revokeInviteCode(code: string): Promise<void> {
      const result = await supabase.rpc('revoke_invite_code', { target_code: code });
      await ensureData(result);
    },

    async listRoomsWithCounts(): Promise<RoomWithCountRow[]> {
      const result = await supabase.rpc('list_rooms_with_counts', {});
      return ensureData<RoomWithCountRow[]>(result);
    },

    async joinRoom(roomId: string): Promise<void> {
      const result = await supabase.rpc('join_room', { target_room_id: roomId });
      await ensureData(result);
    },

    async leaveRoom(roomId: string): Promise<void> {
      const result = await supabase.rpc('leave_room', { target_room_id: roomId });
      await ensureData(result);
    },

    async createRoom(name: string, userId: string): Promise<RoomSummary> {
      const created = await supabase
        .from('rooms')
        .insert({ name, owner_id: userId })
        .select('id,name')
        .single?.();
      const room = await ensureData<RoomSummary>(created);

      await ensureData(
        supabase
          .from('room_members')
          .insert({ room_id: room.id, user_id: userId, role: 'owner' })
      );

      return room;
    },

    async listMembers(roomId: string): Promise<RoomMemberRow[]> {
      const result = await supabase.rpc('list_room_members', {
        target_room_id: roomId
      });
      const awaited = (await result) as { data: RoomMemberRow[] | null; error: ErrorLike | null };
      if (isMissingRpcSchemaCacheError(awaited.error)) {
        return listMembersFromTable(supabase, roomId);
      }

      ensureNoError(awaited.error);
      return awaited.data ?? [];
    },

    async listRecentMessages(roomId: string, limit = 50): Promise<ChatMessageRow[]> {
      const result = await supabase
        .from('messages')
        .select('id,room_id,sender_id,sender_display_name,sender_display_color,kind,body,metadata,created_at')
        .eq('room_id', roomId)
        .order('created_at', { ascending: false })
        .limit(limit);
      const messages = await ensureData<ChatMessageRow[]>(result);
      return [...messages].reverse();
    },

    async sendTextMessage(input: SendTextMessageInput): Promise<ChatMessageRow> {
      const result = supabase
        .from('messages')
        .insert({
          room_id: input.roomId,
          sender_id: input.senderId,
          kind: 'text',
          body: input.body,
          metadata: input.metadata ?? {}
        })
        .select('id,room_id,sender_id,sender_display_name,sender_display_color,kind,body,metadata,created_at');
      const selected = typeof result.single === 'function' ? result.single() : result;
      const message = await ensureData<ChatMessageRow | ChatMessageRow[]>(selected);
      return Array.isArray(message) ? message[0] : message;
    },

    async listWatchlist(roomId: string): Promise<WatchlistRow[]> {
      const result = await supabase
        .from('room_watchlist')
        .select('room_id,canonical_symbol,added_by,created_at,sort_order')
        .eq('room_id', roomId)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true });
      return ensureData<WatchlistRow[]>(result);
    },

    async reorderWatchlist(roomId: string, orderedSymbols: string[]): Promise<void> {
      await ensureData(
        supabase.rpc('reorder_watchlist', {
          target_room_id: roomId,
          ordered_symbols: orderedSymbols
        })
      );
    },

    async addWatchSymbol(input: AddWatchSymbolInput): Promise<void> {
      await ensureData(
        supabase.from('room_watchlist').insert({
          room_id: input.roomId,
          canonical_symbol: input.symbol,
          added_by: input.addedBy
        })
      );
    },

    async removeWatchSymbol(roomId: string, symbol: string): Promise<void> {
      await ensureData(
        supabase
          .from('room_watchlist')
          .delete()
          .eq('room_id', roomId)
          .eq('canonical_symbol', symbol)
      );
    },

    async getQuotes(symbols: string[], force = false): Promise<unknown> {
      const result = await supabase.functions.invoke('get-stock-quotes', {
        body: { symbols, force }
      });
      return ensureData(result);
    },

    async touchPresence(roomId: string): Promise<void> {
      await ensureData(supabase.rpc('heartbeat_presence', { target_room_id: roomId }));
    }
  };
}

async function getProfile(
  supabase: SupabaseLikeClient,
  userId: string
): Promise<ProfileRow | null> {
  const query = supabase
    .from('profiles')
    .select('id,display_name,display_color,role,status')
    .eq('id', userId);
  const result =
    typeof query.maybeSingle === 'function'
      ? query.maybeSingle()
      : typeof query.single === 'function'
        ? query.single()
        : query;
  return ensureData<ProfileRow | null>(result);
}

async function listMembersFromTable(
  supabase: SupabaseLikeClient,
  roomId: string
): Promise<RoomMemberRow[]> {
  const result = await supabase
    .from('room_members')
    .select('room_id,user_id,role,created_at')
    .eq('room_id', roomId)
    .order('created_at', { ascending: true });
  return ensureData<RoomMemberRow[]>(result);
}

function toHychatUser(profile: ProfileRow): HychatUser {
  return {
    id: profile.id,
    displayName: profile.display_name,
    displayColor: profile.display_color ?? 'white',
    role: profile.role,
    status: profile.status
  };
}

async function ensureData<T>(result: unknown | undefined): Promise<T> {
  if (!result) {
    throw new Error('Supabase query did not return a result.');
  }

  const awaited = (await result) as { data: T; error: ErrorLike | null };
  ensureNoError(awaited.error);
  return awaited.data;
}

function ensureNoError(error: ErrorLike | null): void {
  if (error) {
    throw new Error(error.message);
  }
}

function isMissingRpcSchemaCacheError(error: ErrorLike | null): boolean {
  if (!error) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    error.code === 'PGRST202' ||
    (message.includes('could not find the function') && message.includes('schema cache'))
  );
}

function isMissingAuthSessionError(error: ErrorLike | null): boolean {
  return error?.message.toLowerCase().includes('auth session missing') ?? false;
}
