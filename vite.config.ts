import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages serves the site at https://<user>.github.io/piano-app/, so
  // asset links must start with /piano-app/. Locally (npm run dev) this is ignored.
  base: process.env.GITHUB_ACTIONS ? "/piano-app/" : "/",
  plugins: [react()],
})