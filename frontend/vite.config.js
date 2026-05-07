import process from 'node:process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const API = process.env.VITE_DEV_API_TARGET ?? 'http://127.0.0.1:8080'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // All REST traffic under /api — avoids clashing with React routes /upload, /reports, etc.
      '/api': { target: API, changeOrigin: true },
      '/healthz': { target: API, changeOrigin: true },
      '/docs': { target: API, changeOrigin: true },
      '/redoc': { target: API, changeOrigin: true },
      '/openapi.json': { target: API, changeOrigin: true },
      '/static': { target: API, changeOrigin: true },
    },
  },
})
