import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    emptyOutDir: true,
    lib: {
      entry: {
        'google-workspace': resolve(__dirname, 'src/main/opencode-plugins/google-workspace.ts'),
        'openkhodam-poc': resolve(__dirname, 'src/main/opencode-plugins/openkhodam-poc.ts')
      },
      fileName: (_format, entryName) => `${entryName}.mjs`,
      formats: ['es']
    },
    outDir: 'out/opencode-plugins',
    rollupOptions: {
      external: [/^node:/]
    },
    target: 'node22'
  }
})
