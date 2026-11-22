import { exampleAnswers, exampleMarks } from '../src/logic/example';
import { chooseExam, enterKeypad, enterRows, expect, expectHash, loadExam, openApp, setMarks, tapKey, test } from './helpers';

// 별도 검토에서 찾은 문제들이 다시 생기지 않는지 본다.

/** 요소의 가운데를 좌표로 연달아 누른다. 손가락으로 같은 자리를 빠르게 여러 번 누르는 것을 흉내 낸다. */
async function rapidTaps(page: import('@playwright/test').Page, selector: string, times: number, gapMs: number) {
  const box = (await page.locator(selector).first().boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  for (let i = 0; i < times; i += 1) {
    await page.mouse.click(x, y);
    await page.waitForTimeout(gapMs);
  }
}

for (const gap of [80, 250, 400]) {
  test(`같은 자리를 연달아 눌러도 다음 화면의 버튼까지 눌리지 않는다 (간격 ${gap}ms)`, async ({ page }) => {
    const exam = loadExam('a');
    const answers = exampleAnswers(exam);
    await openApp(page, '/?input=keypad');
    await page.getByRole('button', { name: '시험 고르기' }).click();
    await chooseExam(page, 'sample-a');
    await enterKeypad(page, exam, answers, 1, 29);
    await tapKey(page, 4);
    await tapKey(page, 8);
    // 마지막 문항의 "다음" 자리를 세 번 연달아 누른다. 입력 확인에서 멈춰야 한다.
    await rapidTaps(page, '[data-key="go"]', 3, gap);
    await page.waitForTimeout(600);
    await expectHash(page, '/review');

    // 입력 확인의 주 버튼 자리를 세 번 연달아 누른다. 표시 화면에서 멈춰야 하고 채점되면 안 된다.
    await page.getByRole('button', { name: '맞아요, 다음으로' }).waitFor();
    await page.waitForTimeout(500);
    await rapidTaps(page, '.btn--primary', 3, gap);
    await page.waitForTimeout(600);
    await expectHash(page, '/marks');
    const stored = await page.evaluate(() => JSON.parse(window.localStorage.getItem('score-anatomy') ?? '{}'));
    expect(stored.sessions[0].gradedAt).toBeNull();

    // "채점하기" 자리를 두 번 연달아 누른다. 점수 화면에서 멈춰야 한다.
    await page.waitForTimeout(500);
    await rapidTaps(page, '.btn--primary', 2, gap);
    await page.waitForTimeout(600);
    await expectHash(page, '/score');
  });
}

test('5행 방식 마지막 쪽에서 연달아 눌러도 채점까지 넘어가지 않는다', async ({ page }) => {
  const exam = loadExam('a');
  const answers = exampleAnswers(exam);
  await openApp(page, '/?input=rows');
  await page.getByRole('button', { name: '시험 고르기' }).click();
  await chooseExam(page, 'sample-a');
  const pages = Math.ceil(exam.items.length / 5);
  for (let p = 0; p < pages; p += 1) {
    for (const it of exam.items.slice(p * 5, p * 5 + 5)) {
      const row = page.locator(`[data-row="${it.no}"]`);
      if (it.kind === 'mc') {
        await row.locator(`[data-choice="${answers[it.no]}"]`).click();
      } else {
        await row.locator('[data-short]').click();
        for (const d of String(answers[it.no])) await tapKey(page.locator('.sheet'), d);
        await tapKey(page.locator('.sheet'), 'go');
        await expect(page.locator('.sheet')).toHaveCount(0);
      }
    }
    if (p < pages - 1) await page.getByTestId('rows-next').click();
  }
  await rapidTaps(page, '[data-testid="rows-next"]', 3, 120);
  await page.waitForTimeout(600);
  await expectHash(page, '/review');
});

test('바텀시트가 막 열렸을 때 같은 자리를 다시 눌러도 답이 바뀌지 않는다', async ({ page }) => {
  const exam = loadExam('a');
  const answers = exampleAnswers(exam);
  await openApp(page, '/?input=keypad');
  await page.getByRole('button', { name: '시험 고르기' }).click();
  await chooseExam(page, 'sample-a');
  await enterKeypad(page, exam, answers);
  await expectHash(page, '/review');
  // 아래쪽 칸(26번)을 두 번 연달아 누른다. 시트의 키가 그 자리에 올라와도 눌리지 않아야 한다.
  await page.locator('main [data-cell="26"]').waitFor();
  await page.waitForTimeout(500);
  await rapidTaps(page, 'main [data-cell="26"]', 2, 100);
  await page.waitForTimeout(500);
  await expect(page.getByRole('dialog')).toContainText('26번 답 고치기');
  await page.getByRole('button', { name: '닫기' }).click();
  await expect(page.locator('main [data-cell="26"] .cell__val')).toHaveText('24');
});

test('"없어요"는 붙여 둔 표시를 지우고 표시 없이 채점한다', async ({ page }) => {
  const exam = loadExam('a');
  const answers = exampleAnswers(exam);
  await openApp(page, '/?input=keypad');
  await page.getByRole('button', { name: '시험 고르기' }).click();
  await chooseExam(page, 'sample-a');
  await enterKeypad(page, exam, answers);
  await page.getByRole('button', { name: '맞아요, 다음으로' }).click();
  await expectHash(page, '/marks');
  await setMarks(page, exampleMarks());
  await page.getByRole('button', { name: '없어요' }).click();
  await expectHash(page, '/score');
  await expect(page.getByTestId('score')).toHaveText('78점');
  await page.getByRole('button', { name: '점수 해부 바로 보기' }).click();
  await expect(page.getByTestId('row-guess-empty')).toHaveText('표시한 문항이 없어서 나눠 볼 것이 없어요. 78점 그대로예요.');
  const stored = await page.evaluate(() => JSON.parse(window.localStorage.getItem('score-anatomy') ?? '{}'));
  expect(stored.sessions[0].marks).toEqual({});
});

test('채점한 뒤에 답을 고치면 다시 채점해야 점수가 바뀌고, 고친 문항이 적힌다', async ({ page }) => {
  const exam = loadExam('a');
  const answers = exampleAnswers(exam);
  await openApp(page, '/?input=keypad');
  await page.getByRole('button', { name: '시험 고르기' }).click();
  await chooseExam(page, 'sample-a');
  await enterKeypad(page, exam, answers);
  await page.getByRole('button', { name: '맞아요, 다음으로' }).click();
  await page.getByRole('button', { name: '없어요' }).click();
  await expect(page.getByTestId('score')).toHaveText('78점');

  // 입력 고치기로 11번을 4에서 2로 바꾼다.
  await page.getByRole('button', { name: '입력 고치기' }).click();
  await expectHash(page, '/review');
  await page.locator('main [data-cell="11"]').click();
  await tapKey(page.locator('.sheet'), 2);
  await expect(page.locator('main [data-cell="11"] .cell__val')).toHaveText('2');

  // 다시 채점하기 전에는 점수 화면과 점수 해부가 열리지 않는다.
  await page.evaluate(() => {
    window.location.hash = '#/score';
  });
  await expectHash(page, '/marks');
  await page.evaluate(() => {
    window.location.hash = '#/anatomy';
  });
  await expectHash(page, '/marks');
  await page.getByRole('link', { name: '기록', exact: true }).click();
  await expect(page.getByTestId('history-item')).toContainText('입력 중');

  // 다시 채점하면 81점이 되고, 채점한 뒤에 고친 문항이 작게 적힌다.
  await page.getByTestId('history-item').getByRole('button', { name: '예시 시험 A 기록 열기' }).click();
  await expectHash(page, '/review');
  await page.getByRole('button', { name: '맞아요, 다음으로' }).click();
  await page.getByRole('button', { name: '채점하기' }).click();
  await expectHash(page, '/score');
  await expect(page.getByTestId('score')).toHaveText('81점');
  await expect(page.getByTestId('edited-note')).toHaveText('채점한 뒤에 답을 고친 문항: 11번');
  await page.getByRole('button', { name: '점수 해부 바로 보기' }).click();
  await expect(page.getByTestId('edited-note')).toHaveText('채점한 뒤에 답을 고친 문항: 11번');
});

test('지금 보던 기록을 지운 뒤 뒤로 가도 다른 시험의 결과가 열리지 않는다', async ({ page }) => {
  const examA = loadExam('a');
  const answers = exampleAnswers(examA);
  // 예시 시험 B는 넣다 말고, 예시 시험 A는 채점까지 한다.
  await openApp(page, '/exams');
  await chooseExam(page, 'sample-b', 'not_yet', 'first');
  await openApp(page, '/exams');
  await chooseExam(page, 'sample-a');
  await openApp(page, '/input?input=rows');
  await enterRows(page, examA, answers);
  await page.getByRole('button', { name: '맞아요, 다음으로' }).click();
  await page.getByRole('button', { name: '없어요' }).click();
  await page.getByRole('button', { name: '점수 해부 바로 보기' }).click();
  await expectHash(page, '/anatomy');
  await page.getByRole('link', { name: '기록', exact: true }).click();
  await expectHash(page, '/history');
  await expect(page.getByTestId('history-item')).toHaveCount(2);
  // 예시 시험 A(지금 보던 기록)를 지운다.
  await page.getByRole('button', { name: '예시 시험 A 기록 지우기' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '지우기' }).click();
  await expect(page.getByTestId('history-item')).toHaveCount(1);
  await page.goBack();
  // 지운 기록의 점수 해부 주소로 돌아가도 다른 시험이 열리지 않고 시작 화면으로 간다.
  await expectHash(page, '/');
  await expect(page.getByRole('button', { name: '이어서 보기' })).toHaveCount(0);
});

test('저장된 값이 속까지 망가져 있어도 흰 화면이 되지 않는다', async ({ page }) => {
  const exam = loadExam('a');
  await openApp(page, '/');
  await page.evaluate((answers) => {
    window.localStorage.setItem(
      'score-anatomy',
      JSON.stringify({
        version: 1,
        sessions: [
          {
            id: 's1',
            examId: 'sample-a',
            createdAt: '2026-11-22T10:00:00.000Z',
            answers,
            marks: { 9: 'guess', 3: 42 },
            causes: { 11: 'slip', 15: {} },
            retries: { 15: null, 20: 'x' },
            answerViewed: 7,
            targetGrade: 'constructor',
            gradedAt: '2026-11-22T10:05:00.000Z',
          },
        ],
        currentId: 's1',
      }),
    );
  }, exampleAnswers(exam));
  await page.reload();
  for (const route of ['/anatomy', '/steps', '/causes', '/score', '/retry/t06', '/history']) {
    await openApp(page, route);
    await expect(page.locator('.app')).toBeVisible();
    await expect(page.getByText('화면을 그리지 못했어요.')).toHaveCount(0);
  }
  await openApp(page, '/anatomy');
  await expect(page.getByTestId('actual')).toHaveText('78점');
  // 엉뚱한 목표 등급은 고르지 않은 것으로 본다.
  await expect(page.getByTestId('cutbox')).toContainText('어디까지 가는 계단을 볼까요?');
});
