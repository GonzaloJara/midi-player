import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Set base to './' so all asset paths are relative.
  // This works whether hosted at the root domain OR a sub-path (e.g. /midi-piano-roll/).
  base: './',
})
