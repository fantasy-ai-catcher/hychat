import { describe, expect, it } from 'vitest';

import { parseChatInput } from './commands.js';

describe('parseChatInput', () => {
  it('parses regular text as a message', () => {
    expect(parseChatInput(' hello world ')).toEqual({
      type: 'message',
      body: 'hello world'
    });
  });

  it('returns empty for blank input', () => {
    expect(parseChatInput('   ')).toEqual({ type: 'empty' });
  });

  it('parses room commands', () => {
    expect(parseChatInput('/rooms')).toEqual({ type: 'command', name: 'rooms' });
    expect(parseChatInput('/join room-1')).toEqual({
      type: 'command',
      name: 'join',
      room: 'room-1'
    });
    expect(parseChatInput('/members')).toEqual({ type: 'command', name: 'members' });
  });

  it('parses account and help commands', () => {
    expect(parseChatInput('/start')).toEqual({ type: 'command', name: 'start' });
    expect(parseChatInput('/start ld@example.com')).toEqual({
      type: 'command',
      name: 'start',
      email: 'ld@example.com'
    });
    expect(parseChatInput('/start ld@example.com invite123')).toEqual({
      type: 'command',
      name: 'start',
      email: 'ld@example.com',
      inviteCode: 'invite123'
    });
    expect(parseChatInput('/start invite123 ld@example.com')).toEqual({
      type: 'command',
      name: 'start',
      email: 'ld@example.com',
      inviteCode: 'invite123'
    });
    expect(parseChatInput('/start liudong')).toEqual({
      type: 'error',
      message: 'Usage: /start <email> [invite-code].'
    });
    expect(parseChatInput('/start a@b.c d@e.f')).toEqual({
      type: 'error',
      message: 'Usage: /start <email> [invite-code].'
    });
    expect(parseChatInput('/name Cool Cat')).toEqual({
      type: 'command',
      name: 'name',
      displayName: 'Cool Cat'
    });
    expect(parseChatInput('/nick Cool Cat')).toEqual({
      type: 'command',
      name: 'name',
      displayName: 'Cool Cat'
    });
    expect(parseChatInput('/name')).toEqual({
      type: 'error',
      message: 'Usage: /name <new name>'
    });
    expect(parseChatInput('/verify 482913')).toEqual({
      type: 'command',
      name: 'verify',
      code: '482913'
    });
    expect(parseChatInput('/verify')).toEqual({
      type: 'error',
      message: 'Usage: /verify <code>'
    });
    expect(parseChatInput('/invite-code')).toEqual({ type: 'command', name: 'invite-code' });
    expect(parseChatInput('/invite-code list')).toEqual({
      type: 'command',
      name: 'invite-code-list'
    });
    expect(parseChatInput('/invite-code revoke abc123')).toEqual({
      type: 'command',
      name: 'invite-code-revoke',
      code: 'abc123'
    });
    expect(parseChatInput('/invite-code revoke')).toEqual({
      type: 'error',
      message: 'Usage: /invite-code [list|revoke <code>]'
    });
    expect(parseChatInput('/logout')).toEqual({ type: 'command', name: 'logout' });
    expect(parseChatInput('/logout confirm')).toEqual({
      type: 'command',
      name: 'logout',
      confirmed: true
    });
    expect(parseChatInput('/help')).toEqual({ type: 'command', name: 'help' });
    expect(parseChatInput('/color')).toEqual({ type: 'command', name: 'color-show' });
    expect(parseChatInput('/color list')).toEqual({ type: 'command', name: 'color-list' });
    expect(parseChatInput('/color set rose')).toEqual({
      type: 'command',
      name: 'color-set',
      color: 'rose'
    });
    expect(parseChatInput('/quit')).toEqual({ type: 'command', name: 'quit' });
  });

  it('parses room creation commands', () => {
    expect(parseChatInput('/create Friends Room')).toEqual({
      type: 'command',
      name: 'create-room',
      nameText: 'Friends Room'
    });
  });

  it('parses watchlist commands', () => {
    expect(parseChatInput('/watch add AAPL.US')).toEqual({
      type: 'command',
      name: 'watch-add',
      symbol: 'AAPL.US'
    });
    expect(parseChatInput('/watch remove 0700.HK')).toEqual({
      type: 'command',
      name: 'watch-remove',
      symbol: '0700.HK'
    });
  });

  it('parses stock and refresh commands', () => {
    expect(parseChatInput('/stock 600519.CN')).toEqual({
      type: 'command',
      name: 'stock',
      symbol: '600519.CN'
    });
    expect(parseChatInput('/refresh')).toEqual({
      type: 'command',
      name: 'refresh'
    });
    expect(parseChatInput('/refresh TSLA.US')).toEqual({
      type: 'command',
      name: 'refresh',
      symbol: 'TSLA.US'
    });
  });

  it('returns errors for unknown or incomplete commands', () => {
    expect(parseChatInput('/unknown')).toEqual({
      type: 'error',
      message: 'Unknown command: /unknown'
    });
    expect(parseChatInput('/join')).toEqual({
      type: 'error',
      message: 'Usage: /join <room>'
    });
    expect(parseChatInput('/create')).toEqual({
      type: 'error',
      message: 'Usage: /create <room name>'
    });
    expect(parseChatInput('/watch add')).toEqual({
      type: 'error',
      message: 'Usage: /watch add <symbol>'
    });
    expect(parseChatInput('/color nope')).toEqual({
      type: 'error',
      message: 'Usage: /color [list|set <color>]'
    });
    expect(parseChatInput('/color set')).toEqual({
      type: 'error',
      message: 'Usage: /color set <color>'
    });
  });
});
