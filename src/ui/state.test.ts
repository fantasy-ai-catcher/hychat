import { describe, expect, it } from 'vitest';

import { createInitialAppState, reducer } from './state.js';

describe('UI state reducer', () => {
  it('loads rooms and joins a room', () => {
    const state = reducer(createInitialAppState(), {
      type: 'rooms-loaded',
      rooms: [{ id: 'room-1', name: 'Friends' }]
    });

    expect(state.rooms).toEqual([{ id: 'room-1', name: 'Friends' }]);

    expect(reducer(state, { type: 'room-joined', roomId: 'room-1' }).activeRoomId).toBe(
      'room-1'
    );
  });

  it('appends received messages per room', () => {
    const state = reducer(createInitialAppState(), {
      type: 'message-received',
      message: {
        id: 'message-1',
        roomId: 'room-1',
        senderId: 'user-1',
        body: 'hello',
        createdAt: '2026-06-06T08:00:00.000Z'
      }
    });

    expect(state.messagesByRoom['room-1']).toHaveLength(1);
  });

  it('replaces messages when a room is reloaded', () => {
    const initial = reducer(createInitialAppState(), {
      type: 'message-received',
      message: {
        id: 'old-message',
        roomId: 'room-1',
        senderId: 'user-1',
        body: 'old',
        createdAt: '2026-06-06T08:00:00.000Z'
      }
    });

    const state = reducer(initial, {
      type: 'messages-loaded',
      roomId: 'room-1',
      messages: [
        {
          id: 'new-message',
          roomId: 'room-1',
          senderId: 'user-2',
          body: 'new',
          createdAt: '2026-06-06T08:01:00.000Z'
        }
      ]
    });

    expect(state.messagesByRoom['room-1']).toEqual([
      {
        id: 'new-message',
        roomId: 'room-1',
        senderId: 'user-2',
        body: 'new',
        createdAt: '2026-06-06T08:01:00.000Z'
      }
    ]);
  });

  it('updates watchlist and quotes', () => {
    const state = reducer(
      reducer(createInitialAppState(), {
        type: 'watchlist-updated',
        roomId: 'room-1',
        symbols: ['AAPL.US', '0700.HK']
      }),
      {
        type: 'quotes-updated',
        quotes: [
          {
            symbol: 'AAPL.US',
            price: 123,
            changePercent: 1.2,
            cacheStatus: 'hit'
          }
        ]
      }
    );

    expect(state.watchlistByRoom['room-1']).toEqual(['AAPL.US', '0700.HK']);
    expect(state.quotesBySymbol['AAPL.US']).toEqual({
      symbol: 'AAPL.US',
      price: 123,
      changePercent: 1.2,
      cacheStatus: 'hit'
    });
  });

  it('tracks connection status', () => {
    expect(
      reducer(createInitialAppState(), {
        type: 'connection-changed',
        status: 'connected'
      }).connectionStatus
    ).toBe('connected');
  });
});
