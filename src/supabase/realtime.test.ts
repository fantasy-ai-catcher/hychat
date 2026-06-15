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

    expect(client.channel).toHaveBeenCalledWith('room:room-1:updates');
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
});
