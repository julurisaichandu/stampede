import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The actor binds loopback only, so the page's own host carries its socket.
const proxy = {
  '/api': 'http://127.0.0.1:8787',
  '/v1/socket': { target: 'ws://127.0.0.1:7100', ws: true },
}

export default defineConfig({
  plugins: [react()],
  resolve: { dedupe: ['zod'] },
  server: { fs: { allow: ['../..'] }, proxy },
  preview: { allowedHosts: true, proxy },
})
