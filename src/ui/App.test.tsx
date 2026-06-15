import React from 'react';
import { describe, expect, it } from 'vitest';

import { App, AppShell, InputComposer, StatusBar, StatusText, TopInfoPanel } from './App.js';
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

function collectTextElements(node: React.ReactNode): Array<React.ReactElement<{ children?: React.ReactNode; color?: string; dimColor?: boolean }>> {
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
      async sendOtp() {},
      async verifyOtp() {},
      async verifyOtpLink() {},
      async setSessionTokens() {},
      async getAuthEmail() {
        return null;
      },
      async ensureProfile() {
        return {
          id: 'user-1',
          displayName: 'liudong',
          displayColor: 'white',
          role: 'admin' as const,
          status: 'active' as const
        };
      },
      async setDisplayName() {
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
      async listRoomsWithCounts() {
        return [];
      },
      async createRoom() {
        return { id: 'room-1', name: 'Friends' };
      },
      async joinRoom() {},
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

  it('renders a welcome screen instead of placeholder panels when no room is active', () => {
    const shell = AppShell({
      state: createInitialAppState(),
      statusText: 'Use /start <email> to log in.',
      promptLabel: '>',
      input: '',
      cursorVisible: true,
      height: 24
    }) as React.ReactElement<{ children: React.ReactNode[] }>;
    const text = collectText(shell);

    expect(text).toContain('Get started:');
    expect(text).toContain('/start <email> [invite-code]');
    expect(text).toContain('/verify <code or pasted link>');
    expect(text).toContain('/help');
    expect(text).not.toContain('Members:');
    expect(text).not.toContain('Stocks:');
    expect(text).not.toContain('No messages');
  });

  it('greets a started user on the welcome screen', () => {
    const shell = AppShell({
      state: createInitialAppState(),
      statusText: 'Signed in as liudong.',
      userLabel: 'liudong',
      userRole: 'admin',
      promptLabel: '>',
      input: '',
      cursorVisible: true,
      height: 24
    }) as React.ReactElement<{ children: React.ReactNode[] }>;
    const text = collectText(shell);

    expect(text).toContain('Hi liudong! You are not in a room yet.');
    expect(text).toContain('/create <room name>');
    expect(text).not.toContain('/start <nickname>');
  });

  it('renders multiple status lines so help output is visible', () => {
    const status = StatusText({ text: 'Start\n/start [nickname]\nRooms\n/rooms' }) as React.ReactElement<{
      height?: number;
      children: React.ReactNode;
    }>;
    const text = collectText(status);

    expect(status.props.height).toBe(4);
    expect(text).toContain('Start');
    expect(text).toContain('/start [nickname]');
    expect(text).toContain('Rooms');
    expect(text).toContain('/rooms');
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
      onlineByRoom: { 'room-1': ['user-1', 'user-2', 'user-3'] },
      activeByRoom: { 'room-1': ['user-1', 'user-2', 'user-3'] },
      typingByRoom: {},
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

  it('renders room members with role and selected color in the top panel', () => {
    const state: AppState = {
      rooms: [{ id: 'room-1', name: 'Friends' }],
      activeRoomId: 'room-1',
      messagesByRoom: {},
      membersByRoom: {
        'room-1': [
          { roomId: 'room-1', userId: 'user-1', displayName: 'liudong', displayColor: 'rose', role: 'owner' },
          { roomId: 'room-1', userId: 'user-2', displayName: 'alice', displayColor: 'cyan', role: 'member' },
          { roomId: 'room-1', userId: 'user-3', displayName: 'bob', displayColor: 'green', role: 'member' }
        ]
      },
      onlineByRoom: { 'room-1': ['user-1', 'user-2', 'user-3'] },
      activeByRoom: { 'room-1': ['user-1', 'user-2', 'user-3'] },
      typingByRoom: {},
      watchlistByRoom: {},
      quotesBySymbol: {},
      connectionStatus: 'connected'
    };

    const panel = TopInfoPanel({
      state,
      userLabel: 'liudong',
      userRole: 'admin',
      height: 7
    });
    const text = collectText(panel);
    const textElements = collectTextElements(panel);
    const liudong = textElements.find((element) => collectText(element) === 'liudong');
    const alice = textElements.find((element) => collectText(element) === 'alice');

    // Owner is tagged; plain members carry no role/color-name noise.
    expect(text).toContain('(owner)');
    expect(text).not.toContain('(member');
    expect(text).not.toContain('rose');
    expect(text).toContain('●'); // online presence dot
    expect(liudong?.props.color).toMatch(/^#/);
    expect(alice?.props.color).toMatch(/^#/);
  });

  it('shows an offline member with a hollow dot and dimmed name', () => {
    const state: AppState = {
      rooms: [{ id: 'room-1', name: 'Friends' }],
      activeRoomId: 'room-1',
      messagesByRoom: {},
      membersByRoom: {
        'room-1': [
          { roomId: 'room-1', userId: 'user-1', displayName: 'liudong', displayColor: 'rose', role: 'owner' },
          { roomId: 'room-1', userId: 'user-2', displayName: 'alice', displayColor: 'cyan', role: 'member' }
        ]
      },
      onlineByRoom: { 'room-1': ['user-1'] },
      activeByRoom: { 'room-1': ['user-1'] },
      typingByRoom: {},
      watchlistByRoom: {},
      quotesBySymbol: {},
      connectionStatus: 'connected'
    };

    const panel = TopInfoPanel({
      state,
      userLabel: 'liudong',
      userRole: 'admin',
      currentUserId: 'user-1',
      currentUserActive: true,
      height: 7
    });
    const text = collectText(panel);
    const textElements = collectTextElements(panel);
    const alice = textElements.find((element) => collectText(element) === 'alice');

    expect(text).toContain('○'); // offline (alice) hollow dot
    expect(text).toContain('●'); // active (liudong, focused) filled dot
    expect(alice?.props.dimColor).toBe(true);
  });

  it('summarizes extra room members in the top panel', () => {
    const state: AppState = {
      rooms: [{ id: 'room-1', name: 'Friends' }],
      activeRoomId: 'room-1',
      messagesByRoom: {},
      membersByRoom: {
        'room-1': [
          { roomId: 'room-1', userId: 'user-1', displayName: 'liudong', displayColor: 'rose', role: 'owner' },
          { roomId: 'room-1', userId: 'user-2', displayName: 'alice', displayColor: 'cyan', role: 'member' },
          { roomId: 'room-1', userId: 'user-3', displayName: 'bob', displayColor: 'green', role: 'member' },
          { roomId: 'room-1', userId: 'user-4', displayName: 'carol', displayColor: 'amber', role: 'member' },
          { roomId: 'room-1', userId: 'user-5', displayName: 'dave', displayColor: 'blue', role: 'member' }
        ]
      },
      onlineByRoom: {
        'room-1': ['user-1', 'user-2', 'user-3', 'user-4', 'user-5']
      },
      activeByRoom: {
        'room-1': ['user-1', 'user-2', 'user-3', 'user-4', 'user-5']
      },
      typingByRoom: {},
      watchlistByRoom: {},
      quotesBySymbol: {},
      connectionStatus: 'connected'
    };

    const panel = TopInfoPanel({
      state,
      userLabel: 'liudong',
      userRole: 'admin',
      height: 7
    });
    const text = collectText(panel);

    expect(text).toContain('liudong');
    expect(text).toContain('alice');
    expect(text).toContain('bob');
    expect(text).toContain('+2 more');
    expect(text).not.toContain('carol');
    expect(text).not.toContain('dave');
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
      onlineByRoom: {},
      activeByRoom: {},
      typingByRoom: {},
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
