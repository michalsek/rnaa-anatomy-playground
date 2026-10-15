import { defineConfig } from 'vitest/config';
import typegpu from 'unplugin-typegpu/vite';

// The typegpu plugin makes 'use gpu' functions runnable on the CPU in Node.
export default defineConfig({
  plugins: [typegpu({})],
  test: { include: ['tests/**/*.test.ts'] },
});
