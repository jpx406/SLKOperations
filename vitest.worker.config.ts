import { defineConfig } from 'vitest/config';

// Worker integration tests (npm run test:worker): the real Hono app against a local, in-memory D1, KV and R2 from
// wrangler's getPlatformProxy. Separate from vitest.config.ts so `npm test` stays fast and plain Node.
// (@cloudflare/vitest-pool-workers does not support Vitest 5 yet, see tests/worker/helpers.ts.)
export default defineConfig({
  test: {
    include: ['tests/worker/**/*.test.ts'],
    environment: 'node',
    // each file starts its own workerd; one at a time keeps Windows machines responsive
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
