import { test } from './helpers';
import { tour } from './tour';

// 10장 4, 5, 7, 9, 10번: 모든 화면을 돌며 검사하고 밝은 화면과 어두운 화면으로 캡처한다.
// 작은 화면(360x640)으로도 같은 코스를 돌아 3번을 확인한다.

test.describe('밝은 화면 390x844', () => {
  test.use({ viewport: { width: 390, height: 844 }, colorScheme: 'light', deviceScaleFactor: 2, permissions: ['clipboard-read', 'clipboard-write'] });
  test('모든 화면 검사와 캡처', async ({ page }) => {
    await tour(page, { id: 'light-390x844', shotDir: 'light' });
  });
});

test.describe('어두운 화면 390x844', () => {
  test.use({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', deviceScaleFactor: 2, permissions: ['clipboard-read', 'clipboard-write'] });
  test('모든 화면 검사와 캡처', async ({ page }) => {
    await tour(page, { id: 'dark-390x844', shotDir: 'dark' });
  });
});

test.describe('작은 화면 360x640', () => {
  test.use({ viewport: { width: 360, height: 640 }, colorScheme: 'light', deviceScaleFactor: 1, permissions: ['clipboard-read', 'clipboard-write'] });
  test('모든 화면 검사와 캡처', async ({ page }) => {
    await tour(page, { id: 'light-360x640', shotDir: 'small' });
  });
});

test.describe('넓은 폭 430x932', () => {
  test.use({ viewport: { width: 430, height: 932 }, colorScheme: 'dark', deviceScaleFactor: 1, permissions: ['clipboard-read', 'clipboard-write'] });
  test('모든 화면 검사', async ({ page }) => {
    await tour(page, { id: 'dark-430x932', shotDir: null });
  });
});
