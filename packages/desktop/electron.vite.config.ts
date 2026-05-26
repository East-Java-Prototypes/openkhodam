import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import tanstackRouter from '@tanstack/router-plugin/vite'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: 'src/main/index.ts',
          'opencode-sidecar-worker': 'src/main/opencode-sidecar-worker.ts'
        }
      }
    }
  },
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@renderer': resolve('src/renderer/src'),
        '@openkhodam/ui': resolve('../ui/src')
      }
    },
    plugins: [
      tailwindcss(),
      tanstackRouter({
        target: 'react',
        routesDirectory: './src/routes',
        generatedRouteTree: './src/routeTree.gen.ts',
        autoCodeSplitting: true,
        quoteStyle: 'single',
        semicolons: false
      }),
      react()
    ]
  }
})
