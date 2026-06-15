export function getRoomMessagesTopic(roomId: string): string {
  return `room:${roomId}:messages`;
}

export function getRoomPresenceTopic(roomId: string): string {
  return `room:${roomId}:presence`;
}

export function getRoomQuotesTopic(roomId: string): string {
  return `room:${roomId}:quotes`;
}

export function getRoomUpdatesTopic(roomId: string): string {
  return `room:${roomId}:updates`;
}

type RealtimePayload<T> = {
  new: T;
  old: T | null;
};

type RoomMessageChange = {
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

type WatchlistChange = {
  room_id: string;
  canonical_symbol: string;
  added_by?: string;
  created_at?: string;
};

type MemberChange = {
  room_id: string;
  user_id: string;
  role?: 'owner' | 'member';
};

type StockQuoteChange = {
  canonical_symbol: string;
  price?: number | null;
  change_percent?: number | null;
  status?: string;
  updated_at?: string;
};

type SupabaseRealtimeClient = {
  channel: (topic: string) => any;
};

export type RoomRealtimeOptions = {
  roomId: string;
  onMessage: (message: RoomMessageChange) => void;
  onWatchlistChange: (change: WatchlistChange) => void;
  onMembersChange?: (change: MemberChange) => void;
  onQuoteChange?: (quote: StockQuoteChange) => void;
  onStatus?: (status: string) => void;
};

export function subscribeToRoomRealtime(
  client: SupabaseRealtimeClient,
  options: RoomRealtimeOptions
) {
  const channel = client
    .channel(getRoomUpdatesTopic(options.roomId))
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `room_id=eq.${options.roomId}`
      },
      (payload: RealtimePayload<Record<string, unknown>>) =>
        options.onMessage(payload.new as RoomMessageChange)
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'room_watchlist',
        filter: `room_id=eq.${options.roomId}`
      },
      (payload: RealtimePayload<Record<string, unknown>>) =>
        options.onWatchlistChange(payload.new as WatchlistChange)
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'room_members',
        filter: `room_id=eq.${options.roomId}`
      },
      (payload: RealtimePayload<Record<string, unknown>>) =>
        options.onMembersChange?.(
          (payload.new ?? payload.old) as MemberChange
        )
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        // RLS already limits quote rows to symbols on the member's
        // watchlists, so no room filter is possible or needed here.
        table: 'stock_quotes'
      },
      (payload: RealtimePayload<Record<string, unknown>>) =>
        options.onQuoteChange?.(payload.new as StockQuoteChange)
    );

  channel.subscribe(options.onStatus);

  return {
    unsubscribe() {
      return channel.unsubscribe();
    }
  };
}
