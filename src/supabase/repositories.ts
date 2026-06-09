type QueryBuilder = {
  select: (...args: unknown[]) => QueryBuilder;
  insert: (...args: unknown[]) => QueryBuilder;
  delete: (...args: unknown[]) => QueryBuilder;
  eq: (...args: unknown[]) => QueryBuilder;
  order: (...args: unknown[]) => QueryBuilder;
  limit: (...args: unknown[]) => QueryBuilder;
};

type SupabaseLikeClient = {
  from: (table: string) => QueryBuilder;
};

export function createRoomRepository(client: SupabaseLikeClient) {
  return {
    listRooms() {
      return client
        .from('rooms')
        .select('id,name,owner_id,created_at,updated_at')
        .order('created_at', { ascending: false });
    }
  };
}

export type SendTextMessageInput = {
  roomId: string;
  senderId: string;
  body: string;
};

export function createMessageRepository(client: SupabaseLikeClient) {
  return {
    listRecentMessages(roomId: string, limit = 50) {
      return client
        .from('messages')
        .select('id,room_id,sender_id,sender_display_name,kind,body,metadata,created_at')
        .eq('room_id', roomId)
        .order('created_at', { ascending: false })
        .limit(limit);
    },

    sendTextMessage(input: SendTextMessageInput) {
      return client.from('messages').insert({
        room_id: input.roomId,
        sender_id: input.senderId,
        kind: 'text',
        body: input.body,
        metadata: {}
      });
    }
  };
}

export type AddWatchlistSymbolInput = {
  roomId: string;
  symbol: string;
  addedBy: string;
};

export type RemoveWatchlistSymbolInput = {
  roomId: string;
  symbol: string;
};

export function createWatchlistRepository(client: SupabaseLikeClient) {
  return {
    listSymbols(roomId: string) {
      return client
        .from('room_watchlist')
        .select('room_id,canonical_symbol,added_by,created_at')
        .eq('room_id', roomId)
        .order('created_at', { ascending: true });
    },

    addSymbol(input: AddWatchlistSymbolInput) {
      return client.from('room_watchlist').insert({
        room_id: input.roomId,
        canonical_symbol: input.symbol,
        added_by: input.addedBy
      });
    },

    removeSymbol(input: RemoveWatchlistSymbolInput) {
      return client
        .from('room_watchlist')
        .delete()
        .eq('room_id', input.roomId)
        .eq('canonical_symbol', input.symbol);
    }
  };
}
