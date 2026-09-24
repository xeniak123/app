import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { tilecastApi } from './server/plugin';

export default defineConfig(({ mode }) => {
  // Load every variable from .env (not only VITE_*); they stay on the server side.
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  return {
    plugins: [react(), tilecastApi(env)],
  };
});
