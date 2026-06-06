import React from 'react';
import { describe, expect, it } from 'vitest';

import { App } from './App.js';
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
      async signIn() {
        return { id: 'user-1', email: 'me@example.com' };
      },
      async signUp() {
        return { id: 'user-1', email: 'me@example.com' };
      },
      async signOut() {},
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
});
