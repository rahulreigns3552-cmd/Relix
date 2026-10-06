import { start } from './domain.js';

start().catch((error) => {
  console.error('[relix-api] failed to start', error);
  process.exit(1);
});
