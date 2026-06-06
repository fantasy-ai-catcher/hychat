import React from 'react';
import { render } from 'ink';

import { App } from './ui/App.js';
import { createInitialAppState } from './ui/state.js';

export type RunCliOptions = {
  argv: string[];
};

export function getCliName(): string {
  return 'hychat';
}

export async function runCli(_options: RunCliOptions): Promise<void> {
  render(React.createElement(App, { state: createInitialAppState() }));
}
