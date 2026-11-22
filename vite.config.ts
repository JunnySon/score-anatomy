import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// 일반 빌드는 Pretendard dynamic subset을 프로젝트 안에 싣고,
// 단일 HTML 빌드(mode single)는 시스템 글꼴만 쓴다.
export default defineConfig(({ mode }) => {
  const single = mode === 'single';
  const fontFile = single ? './src/styles/font-system.css' : './src/styles/font-pretendard.css';
  return {
    base: './',
    plugins: [react()],
    resolve: {
      alias: {
        '#font': fileURLToPath(new URL(fontFile, import.meta.url)),
      },
    },
    build: {
      outDir: single ? 'dist-single' : 'dist',
      assetsInlineLimit: 0,
      sourcemap: false,
      emptyOutDir: true,
    },
    server: { host: true },
    preview: { host: true },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    },
  };
});
