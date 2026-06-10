export type HychatUser = {
  id: string;
  displayName: string;
  role: 'admin' | 'member';
  status: 'active' | 'disabled';
};

export type RoomSummary = {
  id: string;
  name: string;
};

export type ChatMessageRow = {
  id: string;
  room_id: string;
  sender_id: string;
  sender_display_name?: string;
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

export type RoomMemberRow = {
  room_id: string;
  user_id: string;
  role: 'owner' | 'member';
  created_at: string;
};

export type SendTextMessageInput = {
  roomId: string;
  senderId: string;
  body: string;
};

export type AddWatchSymbolInput = {
  roomId: string;
  symbol: string;
  addedBy: string;
};

type ErrorLike = {
  message: string;
};

type SupabaseLikeClient = {
  auth: {
    signInAnonymously: () => Promise<{
      data: { user: { id: string } | null };
      error: ErrorLike | null;
    }>;
    signOut: () => Promise<{ error: ErrorLike | null }>;
    getUser: () => Promise<{ data: { user: { id: string } | null }; error: ErrorLike | null }>;
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

    async startProfile(displayName: string, inviteCode?: string): Promise<HychatUser> {
      await ensureAnonymousUser(supabase);
      const result = await supabase.rpc('start_profile', {
        target_display_name: displayName,
        invite_code: inviteCode ?? null
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

    async listRooms(): Promise<RoomSummary[]> {
      const result = await supabase
        .from('rooms')
        .select('id,name,owner_id,created_at,updated_at')
        .order('created_at', { ascending: false });
      return ensureData<RoomSummary[]>(result);
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

    async inviteMember(roomId: string, displayName: string): Promise<unknown> {
      const result = await supabase.rpc('invite_room_member_by_display_name', {
        target_room_id: roomId,
        target_display_name: displayName
      });
      return ensureData(result);
    },

    async listMembers(roomId: string): Promise<RoomMemberRow[]> {
      const result = await supabase
        .from('room_members')
        .select('room_id,user_id,role,created_at')
        .eq('room_id', roomId)
        .order('created_at', { ascending: true });
      return ensureData<RoomMemberRow[]>(result);
    },

    async listRecentMessages(roomId: string, limit = 50): Promise<ChatMessageRow[]> {
      const result = await supabase
        .from('messages')
        .select('id,room_id,sender_id,sender_display_name,kind,body,metadata,created_at')
        .eq('room_id', roomId)
        .order('created_at', { ascending: false })
        .limit(limit);
      const messages = await ensureData<ChatMessageRow[]>(result);
      return [...messages].reverse();
    },

    async sendTextMessage(input: SendTextMessageInput): Promise<void> {
      await ensureData(
        supabase.from('messages').insert({
          room_id: input.roomId,
          sender_id: input.senderId,
          kind: 'text',
          body: input.body,
          metadata: {}
        })
      );
    },

    async listWatchlist(roomId: string): Promise<WatchlistRow[]> {
      const result = await supabase
        .from('room_watchlist')
        .select('room_id,canonical_symbol,added_by,created_at')
        .eq('room_id', roomId)
        .order('created_at', { ascending: true });
      return ensureData<WatchlistRow[]>(result);
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
    }
  };
}

async function ensureAnonymousUser(supabase: SupabaseLikeClient): Promise<{ id: string }> {
  const current = await supabase.auth.getUser();
  if (!isMissingAuthSessionError(current.error)) {
    ensureNoError(current.error);
  }

  if (current.data.user) {
    return current.data.user;
  }

  const result = await supabase.auth.signInAnonymously();
  ensureNoError(result.error);
  if (!result.data.user) {
    throw new Error('Supabase did not return an authenticated user.');
  }

  return result.data.user;
}

async function getProfile(
  supabase: SupabaseLikeClient,
  userId: string
): Promise<ProfileRow | null> {
  const query = supabase
    .from('profiles')
    .select('id,display_name,role,status')
    .eq('id', userId);
  const result =
    typeof query.maybeSingle === 'function'
      ? query.maybeSingle()
      : typeof query.single === 'function'
        ? query.single()
        : query;
  return ensureData<ProfileRow | null>(result);
}

function toHychatUser(profile: ProfileRow): HychatUser {
  return {
    id: profile.id,
    displayName: profile.display_name,
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

function isMissingAuthSessionError(error: ErrorLike | null): boolean {
  return error?.message.toLowerCase().includes('auth session missing') ?? false;
}
