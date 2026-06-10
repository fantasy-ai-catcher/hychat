import React from 'react';
import { describe, expect, it } from 'vitest';

import { App, AppShell, InputComposer, StatusBar } from './App.js';
import { createInitialAppState, type AppState } from './state.js';

function collectText(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') {
    return '';
  }

  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }

  if (Array.isArray(node)) {
    return node.map(collectText).join('');
  }

  if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
    return collectText(node.props.children);
  }

  return '';
}

function collectTextElements(node: React.ReactNode): Array<React.ReactElement<{ children?: React.ReactNode; color?: string }>> {
  if (node === null || node === undefined || typeof node === 'boolean') {
    return [];
  }

  if (Array.isArray(node)) {
    return node.flatMap(collectTextElements);
  }

  if (!React.isValidElement<{ children?: React.ReactNode; color?: string }>(node)) {
    return [];
  }

  const own =
    typeof node.type === 'function' && node.type.name === 'Text'
      ? [node as React.ReactElement<{ children?: React.ReactNode; color?: string }>]
      : [];
  return [...own, ...collectTextElements(node.props.children)];
}

describe('App', () => {
  it('creates a React element for the terminal UI shell', () => {
    expect(React.isValidElement(<App state={createInitialAppState()} />)).toBe(true);
  });

  it('creates a React element for the interactive terminal app', () => {
    const service = {
      async getCurrentUser() {
        return null;
      },
      async startProfile() {
        return {
          id: 'user-1',
          displayName: 'liudong',
          displayColor: 'white',
          role: 'admin' as const,
          status: 'active' as const
        };
      },
      async updateProfileColor() {
        return {
          id: 'user-1',
          displayName: 'liudong',
          displayColor: 'rose',
          role: 'admin' as const,
          status: 'active' as const
        };
      },
      async signOut() {},
      async createInviteCode() {
        return 'invite123';
      },
      async listRooms() {
        return [];
      },
      async createRoom() {
        return { id: 'room-1', name: 'Friends' };
      },
      async inviteMember() {},
      async listRecentMessages() {
        return [];
      },
      async sendTextMessage() {},
      async listWatchlist() {
        return [];
      },
      async addWatchSymbol() {},
      async removeWatchSymbol() {},
      async getQuotes() {
        return { quotes: [], failed: [] };
      }
    };

    expect(React.isValidElement(<App service={service} />)).toBe(true);
  });

  it('renders a bordered input composer', () => {
    const element = InputComposer({
      promptLabel: '>',
      input: '/start liudong',
      cursorVisible: true
    }) as React.ReactElement<{ borderStyle?: string; paddingX?: number }>;

    expect(element.props.borderStyle).toBe('round');
    expect(element.props.paddingX).toBe(1);
  });

  it('renders a cursor after the current input', () => {
    const visibleElement = InputComposer({
      promptLabel: '>',
      input: '/start liudong',
      cursorVisible: true
    }) as React.ReactElement<{ children: React.ReactNode[] }>;
    const hiddenElement = InputComposer({
      promptLabel: '>',
      input: '/start liudong',
      cursorVisible: false
    }) as React.ReactElement<{ children: React.ReactNode[] }>;

    expect(visibleElement.props.children.at(-1)).toMatchObject({
      props: { children: '|' }
    });
    expect(hiddenElement.props.children.at(-1)).toMatchObject({
      props: { children: ' ' }
    });
  });

  it('renders session details, members, and watched stocks in a compact status bar', () => {
    const state: AppState = {
      rooms: [{ id: 'room-1', name: 'Friends' }],
      activeRoomId: 'room-1',
      messagesByRoom: {
        'room-1': [
          {
            id: 'message-1',
            roomId: 'room-1',
            senderId: 'user-1',
            senderName: 'liudong',
            senderColor: 'rose',
            body: 'hello',
            createdAt: '2026-06-06T08:00:00.000Z'
          }
        ]
      },
      membersByRoom: {
        'room-1': [
          { roomId: 'room-1', userId: 'user-1', displayName: 'liudong', displayColor: 'rose', role: 'owner' },
          { roomId: 'room-1', userId: 'user-2', displayName: 'alice', displayColor: 'cyan', role: 'member' },
          { roomId: 'room-1', userId: 'user-3', displayName: 'bob', displayColor: 'green', role: 'member' }
        ]
      },
      watchlistByRoom: { 'room-1': ['AAPL.US', '0700.HK', '600519.CN'] },
      quotesBySymbol: {
        'AAPL.US': {
          symbol: 'AAPL.US',
          price: 123,
          changePercent: 1.2,
          cacheStatus: 'hit'
        }
      },
      connectionStatus: 'connected'
    };

    const bar = StatusBar({
      state,
      userLabel: 'liudong',
      userRole: 'admin'
    }) as React.ReactElement<{ borderStyle?: string; children: React.ReactNode }>;
    const text = collectText(bar);

    expect(bar.props.borderStyle).toBeUndefined();
    expect(text).toContain('liudong');
    expect(text).toContain('admin');
    expect(text).toContain('Friends');
    expect(text).toContain('connected');
    expect(text).toContain('members');
    expect(text).toContain('alice');
    expect(text).toContain('+1');
    expect(text).toContain('stocks');
    expect(text).toContain('AAPL.US');
    expect(text).toContain('+1.2%');
    expect(text).toContain('+2');
  });

  it('renders message sender names with their profile color', () => {
    const state: AppState = {
      rooms: [{ id: 'room-1', name: 'Friends' }],
      activeRoomId: 'room-1',
      messagesByRoom: {
        'room-1': [
          {
            id: 'message-1',
            roomId: 'room-1',
            senderId: 'user-1',
            senderName: 'liudong',
            senderColor: 'rose',
            body: 'hello',
            createdAt: '2026-06-06T08:00:00.000Z'
          }
        ]
      },
      membersByRoom: {},
      watchlistByRoom: {},
      quotesBySymbol: {},
      connectionStatus: 'connected'
    };

    const shell = AppShell({
      state,
      statusText: 'ready',
      userLabel: 'liudong',
      userRole: 'admin',
      promptLabel: '>',
      input: '',
      cursorVisible: true
    }) as React.ReactElement<{ children: React.ReactNode[] }>;
    const textElements = collectTextElements(shell);
    const sender = textElements.find((element) => collectText(element).includes('liudong:'));

    expect(sender?.props.color).toMatch(/^#/);
  });
});
