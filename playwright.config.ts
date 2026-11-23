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
// 테스트는 늘 지금 폴더의 빌드로 새 서버를 띄운다. 포트에 이미 떠 있는 서버(옛 빌드나 다른 폴더의 것일 수 있다)를
// 말없이 다시 쓰지 않으려고, 포트가 쓰이고 있으면 실패하게 둔다. 다른 포트를 쓰려면 SA_PORT 를 준다.
// 개발 중에 떠 있는 서버를 일부러 다시 쓰려면 SA_REUSE_SERVER=1 을 준다(이때는 그 서버가 지금 빌드인지 직접 확인해야 한다).
const REUSE_SERVER = process.env.SA_REUSE_SERVER === '1';
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
  },
  // 화면 검사는 Chromium 으로 한다. WebKit(아이폰의 화면 엔진과 같은 계열)은 앱 시험용 묶음의 흐름 한 번만 돌리고,
  // 설치돼 있을 때 verify 가 SA_WEBKIT=1 로 켠다(e2e/webkit.spec.ts).
  projects: [
    { name: 'chromium', testIgnore: /webkit\.spec\.ts/, use: { ...browserOptions() } },
    ...(process.env.SA_WEBKIT === '1' ? [{ name: 'webkit', testMatch: /webkit\.spec\.ts/, use: { browserName: 'webkit' as const } }] : []),
  ],
  // 4173: 배포하는 빌드(dist). 4174: 검증용 변형 빌드(정답만 다른 시험 A, 등급컷이 없는 시험 B).
  webServer: [
    {
      command: `npx vite preview --port ${PORT} --strictPort`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: REUSE_SERVER,
      timeout: 60_000,
    },
    {
      command: `npx vite preview --mode variant --port ${PORT + 1} --strictPort`,
      url: `http://localhost:${PORT + 1}`,
      reuseExistingServer: REUSE_SERVER,
      timeout: 60_000,
    },
  ],
});
