import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkScreen } from './audit';
import { addMetric, expect, ROOT, settle, test } from './helpers';

// 단일 HTML 빌드: 파일 하나를 그대로 열어도 동작하고, 그 파일 밖으로 나가는 요청이 없다.

const SINGLE = resolve(ROOT, 'dist-single/index.html');

test('단일 HTML: 파일 하나로 열리고 외부 요청이 없다', async ({ page }) => {
  expect(existsSync(SINGLE), 'npm run build:single 을 먼저 실행해야 해요').toBe(true);
  expect(readdirSync(resolve(ROOT, 'dist-single'))).toEqual(['index.html']);
  const html = readFileSync(SINGLE, 'utf8');
  // 밖에서 불러오는 스크립트, 스타일, 글꼴이 없다.
  expect(html).not.toMatch(/<script[^>]+src=/);
  expect(html).not.toMatch(/<link[^>]+rel="stylesheet"/);
  expect(html).not.toMatch(/@font-face/);
  expect(html).not.toMatch(/url\(\s*["']?https?:/);

  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.goto(pathToFileURL(SINGLE).href);
  await page.locator('.app').first().waitFor();
  await settle(page);
  await expect(page.getByRole('heading', { name: '점수 해부' })).toBeVisible();
  // 시스템 글꼴만 쓴다.
  const family = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  expect(family).toBe('-apple-system, "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", system-ui, sans-serif');
  await checkScreen(page, '단일 HTML 시작', 'single-file');

  // 해시 라우팅으로 예시 결과까지 간다.
  await page.getByRole('button', { name: '예시 결과 보기' }).click();
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#/demo/anatomy');
  await expect(page.getByTestId('actual')).toHaveText('78점');
  await page.getByTestId('grade-2').click();
  await expect(page.getByTestId('cut-actual')).toHaveText('실제 78점 기준 3~7점 남았어요');
  await checkScreen(page, '단일 HTML 예시 결과', 'single-file');
  await page.getByTestId('to-steps').click();
  await expect(page.getByRole('heading', { name: '먼저 고칠 3가지' })).toBeVisible();

  // 답 입력도 된다.
  await page.goto(`${pathToFileURL(SINGLE).href}#/exams`);
  await page.getByTestId('exam-sample-a').click();
  await page.getByTestId('graded-not_yet').click();
  await page.getByRole('button', { name: '답 넣기', exact: true }).click();
  await page.locator('[data-key="3"]').click();
  await expect(page.getByTestId('now-no')).toHaveText('2번');

  const nonFile = requests.filter((u) => !u.startsWith('file:') && !u.startsWith('data:') && !u.startsWith('blob:'));
  expect(nonFile).toEqual([]);
  const others = requests.filter((u) => u.startsWith('file:') && !u.startsWith(pathToFileURL(SINGLE).href));
  expect(others, '단일 HTML 말고 다른 파일을 읽지 않는다').toEqual([]);
  addMetric({ kind: 'single', bytes: statSync(SINGLE).size, requests: requests.length, external: nonFile.length });
});
