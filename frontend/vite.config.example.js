// Plantilla: renombrar a vite.config.js cuando se instale Vite (pnpm add -D vite --filter @jiimatzin/frontend).
// El proxy hace que el navegador llame a /api/v1/... y Vite lo reenvíe a la API local:
// sin CORS en desarrollo y sin hardcodear el puerto del backend en el código del juego.
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
    },
  },
});
