import { cloudflare } from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    tailwindcss(),
    cloudflare({
      // The mock WIREGUARD only runs in development; a build/deploy binds to the real one.
      auxiliaryWorkers: command === 'serve' ? [{ configPath: './mock-wireguard/wrangler.jsonc' }] : [],
    }),
  ],
  server: { port: 5173, strictPort: true },
}));
