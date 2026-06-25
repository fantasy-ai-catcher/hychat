import React from 'react';
import { describe, expect, it } from 'vitest';

import {
  App,
  AppShell,
  ColorPicker,
  MentionPicker,
  WatchReorder,
  InputComposer,
  isPanelToggle,
  MessageViewport,
  resolveEditorAction,
  StatusBar,
  StatusText,
  TopInfoPanel
} from './App.js';
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

  it('renders the full input with the prompt', () => {
    const element = InputComposer({
      promptLabel: '>',
      input: '/start liudong',
      cursor: 14,
      cursorVisible: true
    });

    expect(collectText(element)).toContain('> /start liudong');
  });

  it('renders a block caret over the character at the cursor', () => {
    const element = InputComposer({
      promptLabel: '>',
      input: 'abc',
      cursor: 1,
      cursorVisible: true
    });
    const caret = collectTextElements(element).find(
      (node) => (node.props as { inverse?: boolean }).inverse === true
    );

    expect(collectText(caret)).toBe('b');
  });

  it('drops the inverse caret on the blink-off frame', () => {
    const element = InputComposer({
      promptLabel: '>',
      input: 'abc',
      cursor: 1,
      cursorVisible: false
    });
    const inverted = collectTextElements(element).filter(
      (node) => (node.props as { inverse?: boolean }).inverse === true
    );

    expect(inverted).toHaveLength(0);
  });

  it('renders one row per line for multiline input', () => {
    const element = InputComposer({
      promptLabel: '>',
      input: 'line1\nline2',
      cursor: 11,
      cursorVisible: true
    }) as React.ReactElement<{ children: React.ReactNode[] }>;

    expect(element.props.children).toHaveLength(2);
    expect(collectText(element)).toContain('line1');
    expect(collectText(element)).toContain('line2');
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

  it('shows only identity, room, and connection in the bottom bar (members/stocks are in the top panel)', () => {
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
            kind: 'text',
            body: 'hello',
            createdAt: '2026-06-06T08:00:00.000Z'
          }
        ]
      },
      membersByRoom: {
        'room-1': [
          { roomId: 'room-1', userId: 'user-1', displayName: 'liudong', displayColor: 'rose', role: 'owner' },
          { roomId: 'room-1', userId: 'user-2', displayName: 'alice', displayColor: 'teal', role: 'member' },
          { roomId: 'room-1', userId: 'user-3', displayName: 'bob', displayColor: 'moss', role: 'member' }
        ]
      },
      onlineByRoom: { 'room-1': ['user-1', 'user-2', 'user-3'] },
      activeByRoom: { 'room-1': ['user-1', 'user-2', 'user-3'] },
      typingByRoom: {},
      activityByRoom: {},
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
    // Members and stocks are shown in the top panel, not duplicated here.
    expect(text).not.toContain('members');
    expect(text).not.toContain('alice');
    expect(text).not.toContain('stocks');
    expect(text).not.toContain('AAPL.US');
  });

  it('renders room members with role and selected color in the top panel', () => {
    const state: AppState = {
      rooms: [{ id: 'room-1', name: 'Friends' }],
      activeRoomId: 'room-1',
      messagesByRoom: {},
      membersByRoom: {
        'room-1': [
          { roomId: 'room-1', userId: 'user-1', displayName: 'liudong', displayColor: 'rose', role: 'owner' },
          { roomId: 'room-1', userId: 'user-2', displayName: 'alice', displayColor: 'teal', role: 'member' },
          { roomId: 'room-1', userId: 'user-3', displayName: 'bob', displayColor: 'moss', role: 'member' }
        ]
      },
      onlineByRoom: { 'room-1': ['user-1', 'user-2', 'user-3'] },
      activeByRoom: { 'room-1': ['user-1', 'user-2', 'user-3'] },
      typingByRoom: {},
      activityByRoom: {},
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
    // The dot and name share one colored Text cell, e.g. "● liudong".
    const liudong = textElements.find((element) => collectText(element) === '● liudong');
    const alice = textElements.find((element) => collectText(element) === '● alice');

    // Members carry no role/color-name noise — just a dot + colored name.
    expect(text).not.toContain('(owner');
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
          { roomId: 'room-1', userId: 'user-2', displayName: 'alice', displayColor: 'teal', role: 'member' }
        ]
      },
      onlineByRoom: { 'room-1': ['user-1'] },
      activeByRoom: { 'room-1': ['user-1'] },
      typingByRoom: {},
      activityByRoom: {},
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
    const alice = textElements.find((element) => collectText(element) === '○ alice');

    expect(text).toContain('○'); // offline (alice) hollow dot
    expect(text).toContain('●'); // active (liudong, focused) filled dot
    expect(alice?.props.dimColor).toBe(true);
  });

  it('renders all room members in the grid without a "+N more" cap', () => {
    const state: AppState = {
      rooms: [{ id: 'room-1', name: 'Friends' }],
      activeRoomId: 'room-1',
      messagesByRoom: {},
      membersByRoom: {
        'room-1': [
          { roomId: 'room-1', userId: 'user-1', displayName: 'liudong', displayColor: 'rose', role: 'owner' },
          { roomId: 'room-1', userId: 'user-2', displayName: 'alice', displayColor: 'teal', role: 'member' },
          { roomId: 'room-1', userId: 'user-3', displayName: 'bob', displayColor: 'moss', role: 'member' },
          { roomId: 'room-1', userId: 'user-4', displayName: 'carol', displayColor: 'sand', role: 'member' },
          { roomId: 'room-1', userId: 'user-5', displayName: 'dave', displayColor: 'steel', role: 'member' }
        ]
      },
      onlineByRoom: {
        'room-1': ['user-1', 'user-2', 'user-3', 'user-4', 'user-5']
      },
      activeByRoom: {
        'room-1': ['user-1', 'user-2', 'user-3', 'user-4', 'user-5']
      },
      typingByRoom: {},
      activityByRoom: {},
      watchlistByRoom: {},
      quotesBySymbol: {},
      connectionStatus: 'connected'
    };

    const panel = TopInfoPanel({
      state,
      userLabel: 'liudong',
      userRole: 'admin',
      terminalWidth: 120,
      height: 7
    });
    const text = collectText(panel);

    expect(text).toContain('liudong');
    expect(text).toContain('alice');
    expect(text).toContain('bob');
    expect(text).toContain('carol');
    expect(text).toContain('dave');
    expect(text).not.toContain('more');
  });

  it('hides the members section when showMembers is false', () => {
    const state: AppState = {
      rooms: [{ id: 'room-1', name: 'Friends' }],
      activeRoomId: 'room-1',
      messagesByRoom: {},
      membersByRoom: {
        'room-1': [
          { roomId: 'room-1', userId: 'user-1', displayName: 'liudong', displayColor: 'rose', role: 'owner' }
        ]
      },
      onlineByRoom: { 'room-1': ['user-1'] },
      activeByRoom: { 'room-1': ['user-1'] },
      typingByRoom: {},
      activityByRoom: {},
      watchlistByRoom: {},
      quotesBySymbol: {},
      connectionStatus: 'connected'
    };

    const shown = collectText(TopInfoPanel({ state, showMembers: true, height: 7 }));
    const hidden = collectText(TopInfoPanel({ state, showMembers: false, height: 7 }));

    expect(shown).toContain('Members');
    expect(shown).toContain('liudong');
    expect(hidden).not.toContain('Members');
    expect(hidden).not.toContain('liudong');
  });

  it('hides the stocks section when showStocks is false', () => {
    const state: AppState = {
      rooms: [{ id: 'room-1', name: 'Friends' }],
      activeRoomId: 'room-1',
      messagesByRoom: {},
      membersByRoom: {},
      onlineByRoom: {},
      activeByRoom: {},
      typingByRoom: {},
      activityByRoom: {},
      watchlistByRoom: { 'room-1': ['AAPL.US'] },
      quotesBySymbol: {
        'AAPL.US': { symbol: 'AAPL.US', price: 123, changePercent: 1.2, cacheStatus: 'hit' }
      },
      connectionStatus: 'connected'
    };

    const shown = collectText(TopInfoPanel({ state, showStocks: true, height: 7 }));
    const hidden = collectText(TopInfoPanel({ state, showStocks: false, height: 7 }));

    expect(shown).toContain('Stocks');
    expect(shown).toContain('AAPL.US');
    expect(hidden).not.toContain('Stocks');
    expect(hidden).not.toContain('AAPL.US');
  });

  it('colors watched-stock change green when up and red when down', () => {
    const state: AppState = {
      rooms: [{ id: 'room-1', name: 'Friends' }],
      activeRoomId: 'room-1',
      messagesByRoom: {},
      membersByRoom: {},
      onlineByRoom: {},
      activeByRoom: {},
      typingByRoom: {},
      activityByRoom: {},
      watchlistByRoom: { 'room-1': ['AAPL.US', '0700.HK'] },
      quotesBySymbol: {
        'AAPL.US': { symbol: 'AAPL.US', price: 123, changePercent: 1.2, cacheStatus: 'hit' },
        '0700.HK': { symbol: '0700.HK', price: 300, changePercent: -0.5, cacheStatus: 'hit' }
      },
      connectionStatus: 'connected'
    };

    const panel = TopInfoPanel({ state, userLabel: 'liudong', userRole: 'admin', height: 7 });
    const textElements = collectTextElements(panel);
    const up = textElements.find((element) => collectText(element) === '▲ 1.20%');
    const down = textElements.find((element) => collectText(element) === '▼ 0.50%');

    expect(up?.props.color).toBe('green');
    expect(down?.props.color).toBe('red');
  });

  it('renders the shortname as the label and the symbol code in its own column', () => {
    const state: AppState = {
      rooms: [{ id: 'room-1', name: 'Friends' }],
      activeRoomId: 'room-1',
      messagesByRoom: {},
      membersByRoom: {},
      onlineByRoom: {},
      activeByRoom: {},
      typingByRoom: {},
      activityByRoom: {},
      watchlistByRoom: { 'room-1': ['0700.HK'] },
      quotesBySymbol: {
        '0700.HK': { symbol: '0700.HK', name: '腾讯控股', price: 300, changePercent: 1, cacheStatus: 'hit' }
      },
      connectionStatus: 'connected'
    };

    const panel = TopInfoPanel({ state, userLabel: 'liudong', userRole: 'admin', height: 7 });
    const text = collectText(panel);

    expect(text).toContain('腾讯控股');
    // The code now shows as its own dim column alongside the shortname.
    expect(text).toContain('0700.HK');
  });

  it('renders every pickable color name in the picker', () => {
    const text = collectText(
      ColorPicker({ index: 0, terminalWidth: 100, currentColor: 'white' })
    );
    expect(text).toContain('default'); // the leading default cell
    expect(text).toContain('sage');
    expect(text).toContain('gray');
  });

  it('renders a dim reply-quote line above a reply message', () => {
    const text = collectText(
      MessageViewport({
        messages: [
          {
            id: 'm2',
            roomId: 'room-1',
            senderId: 'u2',
            senderName: 'bob',
            kind: 'text',
            body: 'agreed',
            metadata: { replyTo: 'm1', replyToName: 'alice', replyToSnippet: 'buy maotai' },
            createdAt: '2026-06-25T08:00:00.000Z'
          }
        ],
        width: 80,
        height: 10
      })
    );
    expect(text).toContain('▎'); // quote bar
    expect(text).toContain('alice buy maotai'); // quote: name + snippet, no colon
    expect(text).toContain('agreed'); // the reply body
  });

  it('shows the filter query and a no-match notice in the mention picker', () => {
    const text = collectText(MentionPicker({ members: [], index: 0, query: 'zz' }));
    expect(text).toContain('zz'); // the active filter
    expect(text).toContain('no match');
  });

  it('lists members (with @) in the mention picker', () => {
    const text = collectText(
      MentionPicker({
        members: [
          { roomId: 'room-1', userId: 'u1', displayName: 'alice', role: 'member', status: 'online', typing: false },
          { roomId: 'room-1', userId: 'u2', displayName: 'bob', role: 'member', status: 'offline', typing: false }
        ],
        index: 0
      })
    );
    expect(text).toContain('@alice');
    expect(text).toContain('@bob');
  });

  it('lists every watched stock in the reorder panel', () => {
    const text = collectText(
      WatchReorder({
        items: [
          { symbol: 'AAPL.US', name: 'Apple Inc.' },
          { symbol: '0700.HK', name: '腾讯控股' }
        ],
        index: 0,
        grabbed: false
      })
    );
    expect(text).toContain('Apple Inc.');
    expect(text).toContain('AAPL.US');
    expect(text).toContain('腾讯控股');
    expect(text).toContain('0700.HK');
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
            kind: 'text',
            body: 'hello',
            createdAt: '2026-06-06T08:00:00.000Z'
          }
        ]
      },
      membersByRoom: {},
      onlineByRoom: {},
      activeByRoom: {},
      typingByRoom: {},
      activityByRoom: {},
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

describe('resolveEditorAction', () => {
  type Key = Parameters<typeof resolveEditorAction>[1];

  function key(overrides: Partial<Key> = {}): Key {
    return {
      upArrow: false,
      downArrow: false,
      leftArrow: false,
      rightArrow: false,
      pageDown: false,
      pageUp: false,
      home: false,
      end: false,
      return: false,
      escape: false,
      ctrl: false,
      shift: false,
      tab: false,
      backspace: false,
      delete: false,
      meta: false,
      ...overrides
    } as Key;
  }

  it('inserts printable characters', () => {
    expect(resolveEditorAction('a', key())).toEqual({ type: 'insert', text: 'a' });
  });

  it('inserts pasted multi-character text', () => {
    expect(resolveEditorAction('hello', key())).toEqual({ type: 'insert', text: 'hello' });
  });

  it('maps Shift+Tab to a newline and ignores a plain Tab', () => {
    expect(resolveEditorAction('', key({ tab: true, shift: true }))).toEqual({ type: 'newline' });
    expect(resolveEditorAction('', key({ tab: true }))).toBeUndefined();
  });

  it('maps arrows to cursor movement, with Option for word jumps', () => {
    expect(resolveEditorAction('', key({ leftArrow: true }))).toEqual({ type: 'moveLeft' });
    expect(resolveEditorAction('', key({ rightArrow: true }))).toEqual({ type: 'moveRight' });
    expect(resolveEditorAction('', key({ leftArrow: true, meta: true }))).toEqual({
      type: 'moveWordLeft'
    });
    expect(resolveEditorAction('', key({ rightArrow: true, meta: true }))).toEqual({
      type: 'moveWordRight'
    });
    expect(resolveEditorAction('', key({ upArrow: true }))).toEqual({ type: 'moveUp' });
    expect(resolveEditorAction('', key({ downArrow: true }))).toEqual({ type: 'moveDown' });
  });

  it('maps backspace/delete to deleting before the cursor (Option deletes a word)', () => {
    expect(resolveEditorAction('', key({ backspace: true }))).toEqual({ type: 'backspace' });
    expect(resolveEditorAction('', key({ delete: true }))).toEqual({ type: 'backspace' });
    expect(resolveEditorAction('', key({ delete: true, meta: true }))).toEqual({
      type: 'deleteWordBack'
    });
  });

  it('maps the readline control shortcuts', () => {
    expect(resolveEditorAction('a', key({ ctrl: true }))).toEqual({ type: 'moveLineStart' });
    expect(resolveEditorAction('e', key({ ctrl: true }))).toEqual({ type: 'moveLineEnd' });
    expect(resolveEditorAction('u', key({ ctrl: true }))).toEqual({ type: 'killToLineStart' });
    expect(resolveEditorAction('k', key({ ctrl: true }))).toEqual({ type: 'killToLineEnd' });
    expect(resolveEditorAction('w', key({ ctrl: true }))).toEqual({ type: 'deleteWordBack' });
  });

  it('ignores Option-modified characters and empty keys', () => {
    expect(resolveEditorAction('a', key({ meta: true }))).toBeUndefined();
    expect(resolveEditorAction('', key())).toBeUndefined();
  });

  it('does not treat the top-panel toggle keys as editor actions', () => {
    // Ctrl+S / Ctrl+P fall through to undefined so they never edit the buffer.
    expect(resolveEditorAction('s', key({ ctrl: true }))).toBeUndefined();
    expect(resolveEditorAction('p', key({ ctrl: true }))).toBeUndefined();
  });
});

describe('isPanelToggle', () => {
  type Key = Parameters<typeof isPanelToggle>[1];

  function key(overrides: Partial<Key> = {}): Key {
    return { ctrl: false, shift: false, meta: false, ...overrides } as Key;
  }

  it('matches Ctrl+S', () => {
    expect(isPanelToggle('s', key({ ctrl: true }))).toBe(true);
  });

  it('ignores plain s and other Ctrl keys', () => {
    expect(isPanelToggle('s', key())).toBe(false);
    expect(isPanelToggle('p', key({ ctrl: true }))).toBe(false);
  });
});

describe('MessageViewport timestamps', () => {
  const messages = [
    {
      id: 'message-1',
      roomId: 'room-1',
      senderId: 'user-1',
      senderName: 'liudong',
      senderColor: 'rose',
      kind: 'text' as const,
      body: 'hello',
      // 08:00 UTC -> 16:00 Beijing.
      createdAt: '2026-06-06T08:00:00.000Z'
    }
  ];

  it('shows the Beijing date and time before a message when timestamps are on', () => {
    const view = MessageViewport({ messages, height: 10, showTimestamps: true });
    const text = collectText(view);
    expect(text).toContain('06-06 16:00');
    expect(text).toContain('liudong:');
  });

  it('hides the timestamp by default', () => {
    const text = collectText(MessageViewport({ messages, height: 10 }));
    expect(text).not.toContain('16:00');
    expect(text).toContain('liudong:');
  });
});

describe('MessageViewport system messages', () => {
  const systemMessage = {
    id: 'sys-1',
    roomId: 'room-1',
    senderId: 'user-2',
    senderName: 'alice',
    senderColor: 'teal',
    kind: 'system' as const,
    body: 'added AAPL.US',
    metadata: { event: 'watch_add', symbol: 'AAPL.US' },
    createdAt: '2026-06-06T08:00:00.000Z'
  };

  it('renders an activity line with the actor and event, not a "name:" chat line', () => {
    const text = collectText(MessageViewport({ messages: [systemMessage], height: 10 }));
    expect(text).toContain('alice added AAPL.US');
    expect(text).not.toContain('alice:');
  });

  it('renders the activity line dimmed so it reads as a system note', () => {
    const elements = collectTextElements(MessageViewport({ messages: [systemMessage], height: 10 }));
    const line = elements.find((element) => collectText(element).includes('added AAPL.US'));
    expect(line?.props.dimColor).toBe(true);
  });
});
