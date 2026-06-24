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

// One quote inside a batched server broadcast (see refresh-active-quotes).
type BroadcastQuote = {
  symbol: string;
  name?: string | null;
  price?: number | null;
  changePercent?: number | null;
  cacheStatus?: string;
};

type ChannelOptions = { config: { presence: { key: string } } };

type SupabaseRealtimeClient = {
  channel: (topic: string, opts?: ChannelOptions) => any;
  // removeChannel unsubscribes AND drops the channel from the client's internal
  // list. A bare channel.unsubscribe() leaks the channel object in supabase-js.
  // Optional only so trivial test doubles can omit it; the real client always
  // provides it, so production always frees channels.
  removeChannel?: (channel: any) => void;
};

export type RoomRealtimeOptions = {
  roomId: string;
  // Identifies this client for presence + typing. When omitted (e.g. in unit
  // tests) presence is not tracked and typing/focus are no-ops.
  userId?: string;
  onMessage: (message: RoomMessageChange) => void;
  onWatchlistChange: (change: WatchlistChange) => void;
  onMembersChange?: (change: MemberChange) => void;
  // Connected members (online/offline). Terminal focus rides a separate
  // broadcast (onFocus), not presence, because re-tracking presence to update a
  // status field accumulates metas instead of replacing them.
  onPresenceChange?: (onlineUserIds: string[]) => void;
  onFocus?: (userId: string, active: boolean) => void;
  onTyping?: (userId: string) => void;
  // Server pushes all of a room's refreshed quotes in one broadcast message, so
  // realtime traffic is one message per tick regardless of symbol count.
  onQuotesUpdate?: (quotes: BroadcastQuote[]) => void;
  onStatus?: (status: string) => void;
};

const TYPING_BROADCAST_EVENT = 'typing';
const FOCUS_BROADCAST_EVENT = 'focus';
const QUOTES_BROADCAST_EVENT = 'quotes';

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

// A channel that drops into one of these states will not rejoin on its own here,
// stranding the client with no messages and no presence — so we rebuild it.
const UNHEALTHY_STATUSES = new Set(['CHANNEL_ERROR', 'TIMED_OUT']);

// Exponential backoff for rebuilding a dropped realtime channel, capped so a
// long outage still retries roughly twice a minute. Exported so the schedule is
// unit-testable without driving real timers.
export function reconnectDelayMs(attempt: number): number {
  const exponent = Math.max(0, attempt);
  return Math.min(RECONNECT_BASE_MS * 2 ** exponent, RECONNECT_MAX_MS);
}

// presenceState() is keyed by the presence key we track with (the user id), so
// its keys are exactly the online user ids.
function onlineUserIdsFrom(channel: { presenceState: () => Record<string, unknown> }): string[] {
  return Object.keys(channel.presenceState());
}

export function subscribeToRoomRealtime(
  client: SupabaseRealtimeClient,
  options: RoomRealtimeOptions
) {
  // The live channel is rebuilt on reconnect, so everything below closes over
  // this mutable reference rather than a fixed channel.
  let channel: any;
  let disposed = false;
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  function scheduleReconnect(): void {
    // One pending retry at a time, and never after the caller unsubscribed.
    if (disposed || reconnectTimer) {
      return;
    }
    const delay = reconnectDelayMs(reconnectAttempt);
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      if (disposed) {
        return;
      }
      // Remove the dead channel before rebuilding. removeChannel unsubscribes AND
      // drops it from the client's channel list; a bare unsubscribe() would strand
      // the channel in supabase-js, leaking one per reconnect (heap OOM over hours).
      try {
        if (channel) {
          client.removeChannel?.(channel);
        }
      } catch {
        // ignore — we are replacing it anyway
      }
      connect();
    }, delay);
  }

  function connect(): void {
    channel = buildChannel();
    channel.subscribe((status: string) => {
      options.onStatus?.(status);
      if (status === 'SUBSCRIBED') {
        reconnectAttempt = 0;
        if (options.userId) {
          void channel.track({ user_id: options.userId });
        }
        return;
      }
      if (UNHEALTHY_STATUSES.has(status)) {
        scheduleReconnect();
      }
    });
  }

  function buildChannel(): any {
    return client
    .channel(getRoomUpdatesTopic(options.roomId), {
      config: { presence: { key: options.userId ?? '' } }
    })
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
      'broadcast',
      { event: QUOTES_BROADCAST_EVENT },
      (payload: { payload?: { quotes?: BroadcastQuote[] } }) =>
        options.onQuotesUpdate?.(payload.payload?.quotes ?? [])
    )
    .on('presence', { event: 'sync' }, () =>
      options.onPresenceChange?.(onlineUserIdsFrom(channel))
    )
    .on(
      'broadcast',
      { event: TYPING_BROADCAST_EVENT },
      (payload: { payload?: { userId?: string } }) => {
        const userId = payload.payload?.userId;
        if (userId) {
          options.onTyping?.(userId);
        }
      }
    )
    .on(
      'broadcast',
      { event: FOCUS_BROADCAST_EVENT },
      (payload: { payload?: { userId?: string; active?: boolean } }) => {
        const userId = payload.payload?.userId;
        if (userId) {
          options.onFocus?.(userId, payload.payload?.active === true);
        }
      }
    );
  }

  connect();

  return {
    unsubscribe() {
      disposed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      }
      client.removeChannel?.(channel);
    },
    sendTyping() {
      if (!options.userId) {
        return;
      }
      void channel.send({
        type: 'broadcast',
        event: TYPING_BROADCAST_EVENT,
        payload: { userId: options.userId }
      });
    },
    sendFocus(active: boolean) {
      if (!options.userId) {
        return;
      }
      void channel.send({
        type: 'broadcast',
        event: FOCUS_BROADCAST_EVENT,
        payload: { userId: options.userId, active }
      });
    }
  };
}
