import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // 相对路径产物:webview 里通过 vscode-resource URI 加载,绝对 /assets 会 404
  base: './',
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
      '/ws': { target: 'ws://localhost:3002', ws: true, rewrite: (p) => p.replace(/^\/ws/, '') },
    },
  },
})
