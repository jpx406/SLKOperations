import { defineConfig } from 'vitest/config';

// Plain Node tests for shared rules. Kept separate from vite.config.ts so the Cloudflare plugin is not loaded.
export default defineConfig({ test: { include: ['tests/**/*.test.ts'], environment: 'node' } });
