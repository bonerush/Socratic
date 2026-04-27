import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
  resolve: {
    alias: {
      obsidian: '/Users/yukisala/Documents/obsidian-plugin-dev/.obsidian/plugins/obsidian-sample-plugin/src/__mocks__/obsidian.ts',
    },
  },
});
