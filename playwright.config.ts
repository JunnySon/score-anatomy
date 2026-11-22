import { existsSync } from 'node:fs';
import { chromium, defineConfig } from '@playwright/test';

// 화면 흐름 테스트와 화면 검사 설정.
// Playwright 브라우저가 없으면 시스템에 설치된 크롬을 쓴다.
//   SA_CHROMIUM_PATH=/경로/chrome  실행 파일을 직접 지정
//   SA_BROWSER_CHANNEL=chrome      시스템 크롬을 지정
function browserOptions(): { channel?: string; launchOptions?: { executablePath: string } } {
  if (process.env.SA_CHROMIUM_PATH) return { launchOptions: { executablePath: process.env.SA_CHROMIUM_PATH } };
  if (process.env.SA_BROWSER_CHANNEL) return { channel: process.env.SA_BROWSER_CHANNEL };
  let bundled = '';
  try {
    bundled = chromium.executablePath();
  } catch {
    bundled = '';
  }
  if (bundled && existsSync(bundled)) return {};
  return { channel: 'chrome' };
}

export const PORT = Number(process.env.SA_PORT ?? 4173);
export const VARIANT_URL = `http://localhost:${PORT + 1}`;

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  timeout: 180_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: 4,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'verify-out/e2e.json' }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'off',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: true,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    ...browserOptions(),
  },
  // 4173: 배포하는 빌드(dist). 4174: 검증용 변형 빌드(정답만 다른 시험 A, 등급컷이 없는 시험 B).
  webServer: [
    {
      command: `npx vite preview --port ${PORT} --strictPort`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: `npx vite preview --mode variant --port ${PORT + 1} --strictPort`,
      url: `http://localhost:${PORT + 1}`,
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
