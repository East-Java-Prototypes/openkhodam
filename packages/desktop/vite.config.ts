import { resolve } from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// shadcn detects Vite through vite.config.*; Electron builds use electron.vite.config.ts.
export default defineConfig({
  root: 'src/renderer',
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer/src')
    }
  },
  plugins: [tailwindcss(), react()]
})
