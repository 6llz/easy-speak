import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { miniMaxProxy } from './server/minimaxProxy';
import { buildGuard } from './server/buildGuard';

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), 'MINIMAX_');
  const headers = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(self), microphone=(self)',
  };
  return {
    plugins: [
      react(),
      miniMaxProxy(() => environment.MINIMAX_API_KEY || ''),
      buildGuard([environment.MINIMAX_API_KEY || '']),
    ],
    server: { headers },
    preview: { headers },
  };
});
