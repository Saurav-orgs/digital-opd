import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5176,
    // Dev only. Cashfree's live API refuses a non-HTTPS return_url, so
    // testing a real payment against this dev server means reaching it
    // through a tunnel — and Vite blocks hosts it does not know. Listed by
    // suffix rather than by name because a quick tunnel's name changes every
    // time it is started.
    allowedHosts: ['.trycloudflare.com', '.devtunnels.ms', '.ngrok-free.app'],
    proxy: {
      '/api': {
        target: 'https://api.mydigitalopd.com',
        changeOrigin: true,
      },
    },
  },
})
