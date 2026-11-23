import { exampleAnswers, exampleCauses, exampleMarks } from '../src/logic/example';
import { openBundle, storeMessages } from './appBridge';
import { addMetric, chooseCauses, chooseExam, enterKeypad, expect, expectHash, loadExam, setMarks, test } from './helpers';

// WebKit 엔진(아이폰의 화면 엔진과 같은 계열)으로 앱 시험용 묶음의 예시 시험 A 흐름을 한 번 돌린다.
// Playwright 의 WebKit 이 설치돼 있을 때만 verify 가 SA_WEBKIT=1 로 돌린다(playwright.config.ts 의 webkit 프로젝트).
// 윈도우의 WebKit 은 아이폰의 WKWebView 와 같은 것이 아니라서, 통과해도 아이폰에서 확인한 것으로 보지 않는다.

test('WebKit: 앱 시험용 묶음에서 예시 시험 A를 검산 예시대로 넣으면 78점, 약 75점, 계단 3개', async ({ page, browserName }) => {
  const exam = loadExam('a');
  await openBundle(page, 'app-test');
  await page.getByRole('button', { name: '시험 고르기' }).click();
  await chooseExam(page, 'sample-a');
  await enterKeypad(page, exam, exampleAnswers(exam));
  await expectHash(page, '/review');
  await page.getByRole('button', { name: '맞아요, 다음으로' }).click();
  await setMarks(page, exampleMarks());
  await page.getByTestId('grade').click();
  await expect(page.getByTestId('score')).toHaveText('78점');
  await page.getByRole('button', { name: '틀린 문항 살펴보기' }).click();
  await chooseCauses(page, exampleCauses());
  await page.getByRole('button', { name: '점수 해부 보기' }).click();
  await expect(page.getByTestId('row-guess')).toContainText('7점');
  await expect(page.getByTestId('row-slip')).toContainText('8점');
  await page.getByTestId('grade-2').click();
  await expect(page.getByTestId('cut-actual')).toHaveText('실제 78점 기준 3~7점 남았어요');
  await expect(page.getByTestId('cut-luck')).toContainText('약 75점');
  await expect(page.getByTestId('cut-luck')).toContainText('6~10점');
  await page.getByTestId('to-steps').click();
  await expect(page.locator('[data-testid^="step-"][data-type]')).toHaveCount(3);
  const saves = await storeMessages(page);
  expect(saves.length).toBeGreaterThan(30);
  expect(await page.evaluate(() => window.localStorage.length)).toBe(0);
  addMetric({ kind: 'webkit', browser: browserName, version: page.context().browser()?.version() ?? null, score: 78, steps: 3 });
});
