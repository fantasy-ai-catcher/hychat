import { describe, expect, it, vi } from 'vitest';

import {
  getRoomUpdatesTopic,
  reconnectDelayMs,
  subscribeToRoomRealtime
} from './realtime.js';

// A channel double whose subscribe() captures the status callback so a test can
// drive SUBSCRIBED / CHANNEL_ERROR transitions by hand.
function makeFakeChannel() {
  let statusCallback: ((status: string) => void) | undefined;
  const channel = {
    on: () => channel,
    subscribe: vi.fn((cb: (status: string) => void) => {
      statusCallback = cb;
      return channel;
    }),
    unsubscribe: vi.fn(),
    track: vi.fn(),
    presenceState: () => ({}),
    send: vi.fn(),
    emitStatus(status: string) {
      statusCallback?.(status);
    }
  };
  return channel;
}

describe('room realtime subscriptions', () => {
  it('builds a stable room updates topic', () => {
    expect(getRoomUpdatesTopic('room-1')).toBe('room:room-1:updates');
  });

  it('subscribes to message inserts and watchlist changes for one room', () => {
    const calls: Array<{ event: string; filter: Record<string, unknown> }> = [];
    const subscribe = vi.fn();
    const unsubscribe = vi.fn();
    const channel = {
      on(event: string, filter: Record<string, unknown>) {
        calls.push({ event, filter });
        return channel;
      },
      subscribe,
      unsubscribe
    };
    const client = {
      channel: vi.fn(() => channel),
      removeChannel: vi.fn((ch: { unsubscribe: () => void }) => ch.unsubscribe())
    };

    const subscription = subscribeToRoomRealtime(client, {
      roomId: 'room-1',
      onMessage: vi.fn(),
      onWatchlistChange: vi.fn()
    });

    expect(client.channel).toHaveBeenCalledWith(
      'room:room-1:updates',
      expect.objectContaining({ config: expect.anything() })
    );
    expect(calls).toEqual([
      {
        event: 'postgres_changes',
        filter: {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: 'room_id=eq.room-1'
        }
      },
      {
        event: 'postgres_changes',
        filter: {
          event: '*',
          schema: 'public',
          table: 'room_watchlist',
          filter: 'room_id=eq.room-1'
        }
      },
      {
        event: 'postgres_changes',
        filter: {
          event: '*',
          schema: 'public',
          table: 'room_members',
          filter: 'room_id=eq.room-1'
        }
      },
      {
        event: 'broadcast',
        filter: { event: 'quotes' }
      },
      {
        event: 'presence',
        filter: { event: 'sync' }
      },
      {
        event: 'broadcast',
        filter: { event: 'typing' }
      },
      {
        event: 'broadcast',
        filter: { event: 'focus' }
      }
    ]);
    expect(subscribe).toHaveBeenCalledOnce();

    subscription.unsubscribe();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('forwards a batched quotes broadcast to the quote handler', () => {
    const handlers: Array<{
      filter: Record<string, unknown>;
      handler: (payload: { payload?: { quotes?: unknown[] } }) => void;
    }> = [];
    const channel = {
      on(
        _event: string,
        filter: Record<string, unknown>,
        handler: (payload: { payload?: { quotes?: unknown[] } }) => void
      ) {
        handlers.push({ filter, handler });
        return channel;
      },
      subscribe: vi.fn(),
      unsubscribe: vi.fn()
    };
    const onQuotesUpdate = vi.fn();

    subscribeToRoomRealtime(
      { channel: vi.fn(() => channel) },
      {
        roomId: 'room-1',
        onMessage: vi.fn(),
        onWatchlistChange: vi.fn(),
        onQuotesUpdate
      }
    );

    const quoteEntry = handlers.find((entry) => entry.filter.event === 'quotes');
    quoteEntry?.handler({
      payload: {
        quotes: [
          { symbol: 'AAPL.US', price: 222.5, changePercent: 2.1 },
          { symbol: '0700.HK', price: 440.2, changePercent: -1.17 }
        ]
      }
    });

    expect(onQuotesUpdate).toHaveBeenCalledWith([
      { symbol: 'AAPL.US', price: 222.5, changePercent: 2.1 },
      { symbol: '0700.HK', price: 440.2, changePercent: -1.17 }
    ]);
  });

  it('tracks presence and reports online user ids on sync', () => {
    const handlers: Array<{
      filter: Record<string, unknown>;
      handler: (payload: unknown) => void;
    }> = [];
    const track = vi.fn();
    const channel = {
      on(_event: string, filter: Record<string, unknown>, handler: (payload: unknown) => void) {
        handlers.push({ filter, handler });
        return channel;
      },
      subscribe: vi.fn((cb: (status: string) => void) => cb('SUBSCRIBED')),
      unsubscribe: vi.fn(),
      track,
      presenceState: () => ({ 'user-1': [{}], 'user-2': [{}] })
    };
    const onPresenceChange = vi.fn();

    subscribeToRoomRealtime(
      { channel: vi.fn(() => channel) },
      {
        roomId: 'room-1',
        userId: 'user-1',
        onMessage: vi.fn(),
        onWatchlistChange: vi.fn(),
        onPresenceChange
      }
    );

    // Presence carries connection only; focus rides a separate broadcast.
    expect(track).toHaveBeenCalledWith({ user_id: 'user-1' });

    const presenceEntry = handlers.find((entry) => entry.filter.event === 'sync');
    presenceEntry?.handler(undefined);
    expect(onPresenceChange).toHaveBeenCalledWith(['user-1', 'user-2']);
  });

  it('broadcasts and receives focus changes', () => {
    const handlers: Array<{
      filter: Record<string, unknown>;
      handler: (payload: { payload?: { userId?: string; active?: boolean } }) => void;
    }> = [];
    const send = vi.fn();
    const channel = {
      on(_event: string, filter: Record<string, unknown>, handler: (payload: unknown) => void) {
        handlers.push({ filter, handler });
        return channel;
      },
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      track: vi.fn(),
      presenceState: () => ({}),
      send
    };
    const onFocus = vi.fn();

    const subscription = subscribeToRoomRealtime(
      { channel: vi.fn(() => channel) },
      {
        roomId: 'room-1',
        userId: 'user-1',
        onMessage: vi.fn(),
        onWatchlistChange: vi.fn(),
        onFocus
      }
    );

    subscription.sendFocus?.(false);
    expect(send).toHaveBeenCalledWith({
      type: 'broadcast',
      event: 'focus',
      payload: { userId: 'user-1', active: false }
    });

    const focusEntry = handlers.find((entry) => entry.filter.event === 'focus');
    focusEntry?.handler({ payload: { userId: 'user-2', active: true } });
    expect(onFocus).toHaveBeenCalledWith('user-2', true);
  });

  it('backs off exponentially up to a cap', () => {
    expect(reconnectDelayMs(0)).toBe(1000);
    expect(reconnectDelayMs(1)).toBe(2000);
    expect(reconnectDelayMs(3)).toBe(8000);
    // Capped at 30s no matter how many attempts.
    expect(reconnectDelayMs(10)).toBe(30000);
  });

  it('rebuilds the channel after it errors, then re-tracks presence', () => {
    vi.useFakeTimers();
    const channels = [makeFakeChannel(), makeFakeChannel()];
    let built = 0;
    const client = {
      channel: vi.fn(() => channels[built++]),
      removeChannel: vi.fn((ch: { unsubscribe: () => void }) => ch.unsubscribe())
    };

    subscribeToRoomRealtime(client, {
      roomId: 'room-1',
      userId: 'user-1',
      onMessage: vi.fn(),
      onWatchlistChange: vi.fn()
    });

    expect(client.channel).toHaveBeenCalledTimes(1);

    // The first channel drops; nothing happens until the backoff elapses.
    channels[0].emitStatus('CHANNEL_ERROR');
    expect(client.channel).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1000);
    expect(channels[0].unsubscribe).toHaveBeenCalledOnce();
    expect(client.channel).toHaveBeenCalledTimes(2);

    // The fresh channel comes up and re-announces presence.
    channels[1].emitStatus('SUBSCRIBED');
    expect(channels[1].track).toHaveBeenCalledWith({ user_id: 'user-1' });

    vi.useRealTimers();
  });

  it('releases the dead channel from the client on reconnect (no channel leak)', () => {
    vi.useFakeTimers();
    const tracked: ReturnType<typeof makeFakeChannel>[] = [];
    const client = {
      channel: vi.fn(() => {
        const ch = makeFakeChannel();
        tracked.push(ch);
        return ch;
      }),
      // Model supabase-js: removeChannel unsubscribes AND drops it from the client.
      removeChannel: vi.fn((ch: ReturnType<typeof makeFakeChannel>) => {
        ch.unsubscribe();
        const index = tracked.indexOf(ch);
        if (index >= 0) tracked.splice(index, 1);
      })
    };

    subscribeToRoomRealtime(client, {
      roomId: 'room-1',
      userId: 'user-1',
      onMessage: vi.fn(),
      onWatchlistChange: vi.fn()
    });

    // Three error -> reconnect cycles. Each must release the dead channel so the
    // client never accumulates them (the OOM leak).
    for (let i = 0; i < 3; i += 1) {
      tracked[tracked.length - 1].emitStatus('CHANNEL_ERROR');
      vi.advanceTimersByTime(30000);
    }

    expect(client.removeChannel).toHaveBeenCalledTimes(3);
    expect(tracked).toHaveLength(1);
    vi.useRealTimers();
  });

  it('does not reconnect a channel that was intentionally unsubscribed', () => {
    vi.useFakeTimers();
    const channels = [makeFakeChannel(), makeFakeChannel()];
    let built = 0;
    const client = {
      channel: vi.fn(() => channels[built++]),
      removeChannel: vi.fn((ch: { unsubscribe: () => void }) => ch.unsubscribe())
    };

    const subscription = subscribeToRoomRealtime(client, {
      roomId: 'room-1',
      userId: 'user-1',
      onMessage: vi.fn(),
      onWatchlistChange: vi.fn()
    });

    // Error schedules a retry, but unsubscribing cancels it.
    channels[0].emitStatus('CHANNEL_ERROR');
    subscription.unsubscribe();
    vi.advanceTimersByTime(60000);

    expect(client.channel).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('broadcasts and receives typing events', () => {
    const handlers: Array<{
      filter: Record<string, unknown>;
      handler: (payload: { payload?: { userId?: string } }) => void;
    }> = [];
    const send = vi.fn();
    const channel = {
      on(_event: string, filter: Record<string, unknown>, handler: (payload: unknown) => void) {
        handlers.push({ filter, handler });
        return channel;
      },
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      track: vi.fn(),
      presenceState: () => ({}),
      send
    };
    const onTyping = vi.fn();

    const subscription = subscribeToRoomRealtime(
      { channel: vi.fn(() => channel) },
      {
        roomId: 'room-1',
        userId: 'user-1',
        onMessage: vi.fn(),
        onWatchlistChange: vi.fn(),
        onTyping
      }
    );

    subscription.sendTyping?.();
    expect(send).toHaveBeenCalledWith({
      type: 'broadcast',
      event: 'typing',
      payload: { userId: 'user-1' }
    });

    const typingEntry = handlers.find((entry) => entry.filter.event === 'typing');
    typingEntry?.handler({ payload: { userId: 'user-2' } });
    expect(onTyping).toHaveBeenCalledWith('user-2');
  });
});
