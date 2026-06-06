import React from 'react';
import { describe, expect, it } from 'vitest';

import { App } from './App.js';
import { createInitialAppState } from './state.js';

describe('App', () => {
  it('creates a React element for the terminal UI shell', () => {
    expect(React.isValidElement(<App state={createInitialAppState()} />)).toBe(true);
  });
});
