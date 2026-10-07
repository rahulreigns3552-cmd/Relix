import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, root, '')
  const api = env.RELIX_API_URL || 'http://127.0.0.1:8787'
  return {
    plugins: [react()],
    envDir: root,
    server: {
      host: '0.0.0.0',
      port: 5173,
      proxy: {
        '/api': { target: api, changeOrigin: true },
        '/media': { target: api, changeOrigin: true },
      },
    },
  }
})
