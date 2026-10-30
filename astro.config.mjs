import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  output: 'static',
  integrations: [tailwind({ applyBaseStyles: false })],
  build: { format: 'file' },
  vite: {
    build: {
      rollupOptions: {
        external: [/^https:\/\/www\.gstatic\.com\/firebasejs\/.*/]
      }
    }
  }
});