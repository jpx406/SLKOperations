import { defineConfig } from 'vitest/config';

// Plain Node tests for shared rules. Kept separate from vite.config.ts so the Cloudflare plugin is not loaded.
// tests/worker/ holds the Worker integration tests, run by npm run test:worker (vitest.worker.config.ts).
export default defineConfig({ test: { include: ['tests/**/*.test.ts'], exclude: ['tests/worker/**', 'node_modules/**'], environment: 'node' } });
