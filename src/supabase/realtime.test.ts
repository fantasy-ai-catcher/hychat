import { describe, expect, it, vi } from 'vitest';

import { getRoomUpdatesTopic, subscribeToRoomRealtime } from './realtime.js';

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
      channel: vi.fn(() => channel)
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
        event: 'postgres_changes',
        filter: {
          event: '*',
          schema: 'public',
          table: 'stock_quotes'
        }
      },
      {
        event: 'presence',
        filter: { event: 'sync' }
      },
      {
        event: 'broadcast',
        filter: { event: 'typing' }
      }
    ]);
    expect(subscribe).toHaveBeenCalledOnce();

    subscription.unsubscribe();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('forwards stock quote changes to the quote handler', () => {
    const handlers: Array<{
      filter: Record<string, unknown>;
      handler: (payload: { new: Record<string, unknown>; old: unknown }) => void;
    }> = [];
    const channel = {
      on(
        _event: string,
        filter: Record<string, unknown>,
        handler: (payload: { new: Record<string, unknown>; old: unknown }) => void
      ) {
        handlers.push({ filter, handler });
        return channel;
      },
      subscribe: vi.fn(),
      unsubscribe: vi.fn()
    };
    const onQuoteChange = vi.fn();

    subscribeToRoomRealtime(
      { channel: vi.fn(() => channel) },
      {
        roomId: 'room-1',
        onMessage: vi.fn(),
        onWatchlistChange: vi.fn(),
        onQuoteChange
      }
    );

    const quoteEntry = handlers.find((entry) => entry.filter.table === 'stock_quotes');
    quoteEntry?.handler({
      new: { canonical_symbol: 'AAPL.US', price: 222.5, change_percent: 2.1 },
      old: null
    });

    expect(onQuoteChange).toHaveBeenCalledWith({
      canonical_symbol: 'AAPL.US',
      price: 222.5,
      change_percent: 2.1
    });
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

    expect(track).toHaveBeenCalledWith({ user_id: 'user-1' });

    const presenceEntry = handlers.find((entry) => entry.filter.event === 'sync');
    presenceEntry?.handler(undefined);
    expect(onPresenceChange).toHaveBeenCalledWith(['user-1', 'user-2']);
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
