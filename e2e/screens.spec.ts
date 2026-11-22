import { test } from './helpers';
import { tour, type TourRun } from './tour';

// 10장 3, 4, 5, 7, 8, 9, 10번: 모든 화면을 돌며 검사하고 밝은 화면과 어두운 화면으로 캡처한다.
// 작은 화면(360x640)과 넓은 폭(430x932)으로도 같은 코스를 돈다.

const RUNS: (TourRun & { title: string })[] = [
  { title: '밝은 화면 390x844', id: 'light-390x844', shotDir: 'light', viewport: { width: 390, height: 844 }, colorScheme: 'light', deviceScaleFactor: 2 },
  { title: '어두운 화면 390x844', id: 'dark-390x844', shotDir: 'dark', viewport: { width: 390, height: 844 }, colorScheme: 'dark', deviceScaleFactor: 2 },
  { title: '작은 화면 360x640', id: 'light-360x640', shotDir: 'small', viewport: { width: 360, height: 640 }, colorScheme: 'light', deviceScaleFactor: 1 },
  { title: '넓은 폭 430x932', id: 'dark-430x932', shotDir: null, viewport: { width: 430, height: 932 }, colorScheme: 'dark', deviceScaleFactor: 1 },
];

for (const run of RUNS) {
  test.describe(run.title, () => {
    test.use({
      viewport: run.viewport,
      colorScheme: run.colorScheme,
      deviceScaleFactor: run.deviceScaleFactor,
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    test(run.shotDir ? '모든 화면 검사와 캡처' : '모든 화면 검사', async ({ page, browser }) => {
      await tour(page, browser, run);
    });
  });
}
