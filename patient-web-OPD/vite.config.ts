import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    proxy: {
      '/api': {
        target: 'https://76ml0vk8-3000.inc1.devtunnels.ms',
        changeOrigin: true,
      },
    },
  },
})
