import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, 'src/main/opencode-plugins/openkhodam-poc.ts'),
      fileName: () => 'openkhodam-poc.mjs',
      formats: ['es']
    },
    outDir: 'out/opencode-plugins'
  }
})
