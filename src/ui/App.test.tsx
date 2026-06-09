import React from 'react';
import { describe, expect, it } from 'vitest';

import { App, InputComposer } from './App.js';
import { createInitialAppState } from './state.js';

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
        return { id: 'user-1', displayName: 'liudong', role: 'admin' as const, status: 'active' as const };
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
      input: '/start liudong'
    }) as React.ReactElement<{ borderStyle?: string; paddingX?: number }>;

    expect(element.props.borderStyle).toBe('round');
    expect(element.props.paddingX).toBe(1);
  });
});
