import { cloudflare } from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig(({ command }) => {
  // Each build gets its own id, written into index.html and into the code. A running page compares its own id with
  // the one the server now serves and offers "Refresh now" when they differ (the new-version bar). Dev stays "dev".
  const build = command === 'build' ? new Date().toISOString().replace(/\D/g, '').slice(0, 14) : 'dev';
  return {
    define: { __APP_BUILD__: JSON.stringify(build) },
    plugins: [
      { name: 'app-build', transformIndexHtml: (html: string) => html.replace('<meta name="app-build" content="dev" />', `<meta name="app-build" content="${build}" />`) },
      react(),
      tailwindcss(),
      cloudflare({
        // The mock WIREGUARD only runs in development; a build/deploy binds to the real one.
        auxiliaryWorkers: command === 'serve' ? [{ configPath: './mock-wireguard/wrangler.jsonc' }] : [],
      }),
    ],
    server: { port: 5173, strictPort: true },
  };
});
