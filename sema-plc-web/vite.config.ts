import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  // 相对路径产物:webview 里通过 vscode-resource URI 加载,绝对 /assets 会 404
  base: './',
  build: {
    rollupOptions: {
      // index = web 版整页(插件的整合面板下线后只剩浏览器在用);
      // chat  = VSCode 对话侧边栏,不引 TopBar/CodeView,CodeMirror 因此不进这个 chunk。
      input: {
        index: resolve(__dirname, 'index.html'),
        chat: resolve(__dirname, 'chat.html'),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
      '/ws': { target: 'ws://localhost:3002', ws: true, rewrite: (p) => p.replace(/^\/ws/, '') },
    },
  },
})
