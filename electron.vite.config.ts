import { builtinModules } from 'node:module';
import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

import pkg from './package.json';

const NODE_BUILTINS = [
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`)
];

/** Everything Electron resolves at runtime instead of us bundling it. */
const EXTERNAL = ['electron', ...NODE_BUILTINS, ...Object.keys(pkg.dependencies)];

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@main': resolve('src/main')
      }
    },
    build: {
      rollupOptions: {
        external: EXTERNAL,
        input: { index: resolve('src/main/index.ts') },
        output: {
          format: 'cjs',
          entryFileNames: '[name].js',
          chunkFileNames: 'chunks/[name].js'
        }
      }
    }
  },
  renderer: {
    root: resolve('src/renderer'),
    plugins: [react()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@renderer': resolve('src/renderer')
      }
    },
    build: {
      rollupOptions: {
        input: {
          stage: resolve('src/renderer/stage.html'),
          editor: resolve('src/renderer/editor.html')
        }
      }
    }
  }
});
