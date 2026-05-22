import { defineConfig } from 'vite'
import { resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  clearScreen: false,
  root: resolve(__dirname, 'src'),
  server: {
    port: 5173,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  build: {
    rollupOptions: {
      input: {
        overlay: resolve(__dirname, 'src/renderer/overlay/index.html'),
        settings: resolve(__dirname, 'src/renderer/settings/index.html'),
        speech: resolve(__dirname, 'src/renderer/speech/index.html'),
      },
    },
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
  },
  optimizeDeps: {
    include: [
      '@tauri-apps/api/core',
      '@tauri-apps/api/event',
      '@tauri-apps/api/webviewWindow',
      '@tauri-apps/plugin-dialog',
    ],
  },
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
})
