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
  kind: 'text' | 'system';
  body: string;
  created_at: string;
};

type WatchlistChange = {
  room_id: string;
  canonical_symbol: string;
  added_by?: string;
  created_at?: string;
};

type SupabaseRealtimeClient = {
  channel: (topic: string) => any;
};

export type RoomRealtimeOptions = {
  roomId: string;
  onMessage: (message: RoomMessageChange) => void;
  onWatchlistChange: (change: WatchlistChange) => void;
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
    );

  channel.subscribe(options.onStatus);

  return {
    unsubscribe() {
      return channel.unsubscribe();
    }
  };
}
