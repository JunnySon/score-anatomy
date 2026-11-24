import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkScreen } from './audit';
import { addMetric, expect, OUT_DIR, ROOT, settle, test } from './helpers';

// 아티팩트용 파일(release/score-anatomy-artifact.html) 확인.
// 게시할 때 씌워지는 뼈대와 비슷한 틀에 넣어서 열어 본다. 실제 뷰어 안에서의 동작은 여기서 확인하지 못한다.

const FILE = resolve(ROOT, 'release/score-anatomy-artifact.html');

function wrapped(theme: string | null): string {
  const content = readFileSync(FILE, 'utf8');
  const html = `<!doctype html>
<html lang="ko"${theme ? ` data-theme="${theme}"` : ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>:root{color-scheme:light;padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>
</head>
<body>
${content}
</body>
</html>`;
  mkdirSync(OUT_DIR, { recursive: true });
  const path = resolve(OUT_DIR, `artifact-${theme ?? 'system'}.html`);
  writeFileSync(path, html);
  return pathToFileURL(path).href;
}

test('아티팩트용 파일: 뼈대 안에서 열리고, 주소를 건드리지 않고 화면을 옮긴다', async ({ page }) => {
  expect(existsSync(FILE), 'node scripts/make-artifact.mjs 를 먼저 실행해야 해요').toBe(true);
  const content = readFileSync(FILE, 'utf8');
  // 문서 뼈대 태그 없이 내용만 있고, 제목이 맨 위에 있다.
  expect(content.startsWith('<title>모고칸</title>')).toBe(true);
  expect(content).not.toMatch(/<!doctype|<html|<head|<body/i);
  expect(content).not.toMatch(/<script[^>]+src=/);
  expect(content).not.toMatch(/<link[^>]+href=/);
  expect(content).not.toMatch(/@font-face/);

  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  const url = wrapped(null);
  await page.goto(url);
  await page.locator('.app').first().waitFor();
  await settle(page);
  // 시작 화면의 제목은 앱 이름이다(작업 지시서 4: 모고칸).
  await expect(page.getByRole('heading', { name: '모고칸' })).toBeVisible();
  // 한 화면 앱이라 문서 자체는 스크롤되지 않는다.
  const fits = await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1);
  expect(fits).toBe(true);
  await checkScreen(page, '아티팩트 시작', 'artifact');

  // 버튼으로 옮겨도, 링크(탭)로 옮겨도 주소의 # 은 바뀌지 않는다.
  await page.getByRole('button', { name: '예시 결과 보기' }).click();
  await expect(page.getByTestId('actual')).toHaveText('78점');
  await expect(page.locator('html')).toHaveAttribute('data-route', '/demo/anatomy');
  expect(await page.evaluate(() => window.location.hash)).toBe('');
  await page.getByTestId('grade-2').click();
  await expect(page.getByTestId('cut-actual')).toHaveText('실제 78점 기준 3~7점 남았어요');
  await checkScreen(page, '아티팩트 예시 결과', 'artifact');
  await page.getByRole('link', { name: '기록', exact: true }).click();
  await expect(page.getByRole('heading', { name: '기록' })).toBeVisible();
  expect(await page.evaluate(() => window.location.hash)).toBe('');
  await page.getByRole('link', { name: '이번 시험', exact: true }).click();
  await page.getByRole('button', { name: '시험 고르기' }).click();
  await page.getByTestId('exam-sample-a').click();
  await page.getByTestId('graded-not_yet').click();
  await page.getByRole('button', { name: '답 넣기', exact: true }).click();
  await page.locator('[data-key="3"]').click();
  await expect(page.getByTestId('now-no')).toHaveText('2번');
  await page.getByRole('button', { name: '뒤로' }).click();
  await expect(page.getByRole('heading', { name: '어떤 시험을 넣을까요?' })).toBeVisible();
  expect(await page.evaluate(() => window.location.hash)).toBe('');

  const others = requests.filter((u) => u !== url && !u.startsWith('data:') && !u.startsWith('blob:'));
  expect(others, '파일 자신 말고 다른 요청이 없어야 함').toEqual([]);
  // 크기는 글자 수가 아니라 파일의 바이트 수로 잰다.
  addMetric({ kind: 'artifact', bytes: statSync(FILE).size, requests: requests.length, external: others.length });
});

test('아티팩트용 파일: 보는 사람이 고른 테마(data-theme)를 기기 설정보다 먼저 따른다', async ({ page }) => {
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const text = () => page.evaluate(() => getComputedStyle(document.body).color);
  // 기기는 밝은 화면인데 테마를 어둡게 고른 경우
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(wrapped('dark'));
  await page.locator('.app').first().waitFor();
  expect(await bg()).toBe('rgb(17, 19, 21)');
  expect(await text()).toBe('rgb(236, 238, 241)');
  // 기기는 어두운 화면인데 테마를 밝게 고른 경우
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(wrapped('light'));
  await page.locator('.app').first().waitFor();
  expect(await bg()).toBe('rgb(255, 255, 255)');
  expect(await text()).toBe('rgb(23, 25, 28)');
  // 테마를 고르지 않으면 기기 설정을 따른다
  await page.goto(wrapped(null));
  await page.locator('.app').first().waitFor();
  expect(await bg()).toBe('rgb(17, 19, 21)');
  await page.emulateMedia({ colorScheme: 'light' });
  expect(await bg()).toBe('rgb(255, 255, 255)');
});
