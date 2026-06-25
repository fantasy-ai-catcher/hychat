#!/usr/bin/env node
// Default to production so React (via Ink) does not run its development build.
// React's dev build emits per-render performance-timing entries ("⚛" tracks)
// through the User Timing API; in Node nothing ever clears that global buffer, so
// it grows on every re-render until a JavaScript-heap out-of-memory crash after
// hours. Set NODE_ENV before anything pulls in React, then use a dynamic import
// so React's module evaluation sees this value.
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'production';
}

const { runCli } = await import('./cli.js');
await runCli({ argv: process.argv });
