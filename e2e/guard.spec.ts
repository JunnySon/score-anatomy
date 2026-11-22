import { exampleAnswers, exampleMarks } from '../src/logic/example';
import { chooseExam, enterKeypad, enterRows, expect, expectHash, loadExam, openApp, seedStore, setMarks, tapKey, test } from './helpers';

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
  // 지난 기록이 남아 있으므로 "이어서 보기"가 있고(지시서 8장 (1)), 눌러야 그 기록이 열린다.
  await expect(page.getByRole('button', { name: '이어서 보기' })).toHaveCount(1);
  const before = await page.evaluate(() => JSON.parse(window.localStorage.getItem('score-anatomy') ?? '{}'));
  expect(before.currentId).toBeNull();
  await page.getByRole('button', { name: '이어서 보기' }).click();
  await expectHash(page, '/input');
  await expect(page.getByRole('heading', { name: '예시 시험 B' })).toBeVisible();
  // 기록을 모두 지우면 "이어서 보기"도 없다.
  await openApp(page, '/history');
  await page.getByTestId('history-remove-all').click();
  await page.getByRole('alertdialog').getByRole('button', { name: '지우기' }).click();
  await openApp(page, '/');
  await expect(page.getByRole('button', { name: '시험 고르기' })).toBeVisible();
  await expect(page.getByRole('button', { name: '이어서 보기' })).toHaveCount(0);
});

test('단답형: 저장된 답은 확정할 때만 바뀌고, 안내문이 사실과 맞고, 확정하지 않은 숫자는 말없이 사라지지 않는다', async ({ page }) => {
  const exam = loadExam('a');
  const answers = exampleAnswers(exam);
  const answerOf = async (no: number) => {
    const stored = await page.evaluate(() => JSON.parse(window.localStorage.getItem('score-anatomy') ?? '{}'));
    return stored.sessions[0].answers[no];
  };
  await openApp(page, '/?input=keypad');
  await page.getByRole('button', { name: '시험 고르기' }).click();
  await chooseExam(page, 'sample-a');
  await enterKeypad(page, exam, answers);
  await expectHash(page, '/review');

  // 키패드 방식 26번(24): 숫자를 다 지워도 "다음"을 누르기 전에는 저장된 답이 그대로다.
  await openApp(page, '/input?input=keypad');
  await page.locator('[data-cell="26"]').click();
  await expect(page.getByTestId('now-no')).toHaveText('26번');
  await expect(page.getByTestId('entry')).toContainText('24');
  await tapKey(page, 'erase');
  await expect(page.getByTestId('entry')).toContainText('2');
  await tapKey(page, 'erase');
  await expect(page.getByTestId('entry')).not.toContainText('2');
  await expect(page.locator('[data-cell="26"] .cell__val')).toHaveText('24');
  expect(await answerOf(26)).toBe(24);
  // 다 지운 채 다른 칸으로 가면 지운 것이 들어가지 않았다고 알리고, 답은 그대로 남는다.
  await page.locator('[data-cell="27"]').click();
  await expect(page.getByRole('status')).toHaveText("26번에 누른 숫자는 '다음'을 누르지 않아서 들어가지 않았어요.");
  expect(await answerOf(26)).toBe(24);

  // 다 지우고 "다음"을 누르면 그때 저장된 답이 지워지고, "비어 있어요"라는 안내문이 사실과 맞다.
  await page.locator('[data-cell="26"]').click();
  await tapKey(page, 'erase');
  await tapKey(page, 'erase');
  await tapKey(page, 'go');
  await expect(page.getByRole('status')).toHaveText("26번이 비어 있어요. 안 푼 문항이면 '안 풂'을 눌러 주세요.");
  await expect(page.getByTestId('now-no')).toHaveText('26번');
  await expect(page.locator('[data-cell="26"] .cell__val')).toHaveText('');
  await expect(page.getByTestId('entered-count')).toHaveText('29문항 입력');
  expect(await answerOf(26)).toBeUndefined();
  // 이제 다른 칸을 눌러도 "들어가지 않았어요"라는 말은 나오지 않는다(확정하지 않은 숫자가 없다).
  await page.locator('[data-cell="27"]').click();
  await expect(page.getByTestId('now-no')).toHaveText('27번');
  await expect(page.getByRole('status')).toHaveCount(0);
  await page.locator('[data-cell="26"]').click();
  await tapKey(page, 2);
  await tapKey(page, 4);
  await tapKey(page, 'go');
  expect(await answerOf(26)).toBe(24);

  // 27번(146)에 99를 누르고 "다음" 없이 "전체 보기"를 누르면, 버린 숫자를 알리고 머문다. 다시 누르면 넘어간다.
  await expect(page.getByTestId('now-no')).toHaveText('27번');
  await tapKey(page, 9);
  await tapKey(page, 9);
  await page.getByRole('button', { name: '전체 보기' }).click();
  await expectHash(page, '/input');
  await expect(page.getByRole('status')).toHaveText("27번에 누른 숫자는 '다음'을 누르지 않아서 들어가지 않았어요.");
  await expect(page.getByTestId('entry')).toContainText('146');
  expect(await answerOf(27)).toBe(146);
  await page.getByRole('button', { name: '전체 보기' }).click();
  await expectHash(page, '/review');
  await expect(page.locator('main [data-cell="27"] .cell__val')).toHaveText('146');

  // 위쪽 뒤로 가기도 같다.
  await openApp(page, '/input?input=keypad');
  await page.locator('[data-cell="29"]').click();
  await tapKey(page, 1);
  await tapKey(page, 1);
  await page.getByRole('button', { name: '뒤로' }).click();
  await expectHash(page, '/input');
  await expect(page.getByRole('status')).toHaveText("29번에 누른 숫자는 '다음'을 누르지 않아서 들어가지 않았어요.");
  expect(await answerOf(29)).toBe(275);
  await page.getByRole('button', { name: '뒤로' }).click();
  await expectHash(page, '/exams');

  // 입력 확인의 27번(146) 시트: 숫자를 다 지우고 "지우기"를 더 눌러도, "넣기" 없이 닫으면 답은 바뀌지 않는다.
  await openApp(page, '/review');
  const sheet = page.locator('.sheet');
  const cell27 = page.locator('main [data-cell="27"]');
  await cell27.click();
  for (let i = 0; i < 5; i += 1) await tapKey(sheet, 'erase');
  expect(await answerOf(27)).toBe(146);
  await page.getByRole('button', { name: '닫기' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(cell27.locator('.cell__val')).toHaveText('146');
  // 다 지우고 "넣기"를 누르면 그때 지워지고, 안내문이 사실과 맞다.
  await cell27.click();
  for (let i = 0; i < 3; i += 1) await tapKey(sheet, 'erase');
  await tapKey(sheet, 'go');
  await expect(sheet.getByRole('status')).toHaveText("27번이 비어 있어요. 안 푼 문항이면 '안 풂'을 눌러 주세요.");
  expect(await answerOf(27)).toBeUndefined();
  await page.getByRole('button', { name: '닫기' }).click();
  await expect(cell27.locator('.cell__val')).toHaveText('미입력');
  // 안 풂으로 둔 문항의 시트에서 "지우기"를 눌러도 안 풂은 그대로다.
  await cell27.click();
  await tapKey(sheet, 'skip');
  await expect(cell27.locator('.cell__val')).toHaveText('안 풂');
  await cell27.click();
  await tapKey(sheet, 'erase');
  await page.getByRole('button', { name: '닫기' }).click();
  await expect(cell27.locator('.cell__val')).toHaveText('안 풂');
  expect(await answerOf(27)).toBe('skip');
});

test('기록 화면: 같은 시험의 기록이 여러 건이어도 접근성 이름으로 구분되고, 삭제 확인이 어느 기록인지 말한다', async ({ page }) => {
  const exam = loadExam('a');
  await openApp(page, '/');
  await seedStore(page, {
    version: 1,
    sessions: [
      { id: 's1', examId: 'sample-a', createdAt: '2026-11-22T10:00:00.000Z', gradedBefore: 'not_yet', answers: {} },
      {
        id: 's2',
        examId: 'sample-a',
        createdAt: '2026-11-21T10:00:00.000Z',
        gradedBefore: 'not_yet',
        answers: exampleAnswers(exam),
        gradedAt: '2026-11-21T10:05:00.000Z',
        firstGradedAt: '2026-11-21T10:05:00.000Z',
      },
      // 정답 공개 전에 저장해 둔 기록을 정답이 공개된 뒤에 여는 경우.
      {
        id: 's3',
        examId: 'sample-a',
        createdAt: '2026-11-20T10:00:00.000Z',
        gradedBefore: 'not_yet',
        answers: exampleAnswers(exam),
        savedAt: '2026-11-20T10:05:00.000Z',
      },
    ],
    currentId: null,
  });
  await page.reload();
  await openApp(page, '/history');
  await expect(page.getByTestId('history-item')).toHaveCount(3);
  await expect(page.getByRole('button', { name: '예시 시험 A 기록 열기, 2026년 11월 22일, 입력 중' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: '예시 시험 A 기록 열기, 2026년 11월 21일, 78점' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: '예시 시험 A 기록 열기, 2026년 11월 20일, 채점 전' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: '예시 시험 A 기록 지우기, 2026년 11월 21일, 78점' })).toHaveCount(1);
  await page.getByRole('button', { name: '예시 시험 A 기록 지우기, 2026년 11월 21일, 78점' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('예시 시험 A, 2026년 11월 21일, 78점 기록이에요. 지우면 되돌릴 수 없어요.');
  await page.getByRole('alertdialog').getByRole('button', { name: '그만두기' }).click();
  await expect(page.getByTestId('history-item')).toHaveCount(3);

  // 시험, 날짜, 점수가 모두 같은 기록이 생기면 넣은 시각으로 구분한다.
  await page.evaluate(() => {
    const data = JSON.parse(window.localStorage.getItem('score-anatomy') ?? '{}');
    const twin = { ...data.sessions[1], id: 's4', createdAt: '2026-11-21T11:30:00.000Z' };
    data.sessions.push(twin);
    window.localStorage.setItem('score-anatomy', JSON.stringify(data));
  });
  await page.reload();
  await openApp(page, '/history');
  await expect(page.getByTestId('history-item')).toHaveCount(4);
  // 테스트의 시간대는 Asia/Seoul 이라 10:00Z 는 19시 0분, 11:30Z 는 20시 30분이다.
  await expect(page.getByRole('button', { name: '예시 시험 A 기록 열기, 2026년 11월 21일 19시 0분, 78점' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: '예시 시험 A 기록 열기, 2026년 11월 21일 20시 30분, 78점' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: '예시 시험 A 기록 지우기, 2026년 11월 21일 20시 30분, 78점' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: '예시 시험 A 기록 열기, 2026년 11월 22일, 입력 중' })).toHaveCount(1);
  await page.getByRole('button', { name: '예시 시험 A 기록 지우기, 2026년 11월 21일 20시 30분, 78점' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('예시 시험 A, 2026년 11월 21일 20시 30분, 78점 기록이에요.');
  await page.getByRole('alertdialog').getByRole('button', { name: '지우기' }).click();
  await expect(page.getByTestId('history-item')).toHaveCount(3);
  await expect(page.getByRole('button', { name: '예시 시험 A 기록 열기, 2026년 11월 21일, 78점' })).toHaveCount(1);

  // 저장해 둔 기록은 안내문이 말한 대로 표시 화면에서 바로 채점할 수 있다.
  await page.getByRole('button', { name: '예시 시험 A 기록 열기, 2026년 11월 20일, 채점 전' }).click();
  await expectHash(page, '/marks');
  await expect(page.getByRole('button', { name: '채점하기' })).toBeVisible();
  await page.getByRole('link', { name: '이번 시험' }).click();
  await page.getByRole('button', { name: '이어서 보기' }).click();
  await expectHash(page, '/marks');
  await page.getByRole('button', { name: '채점하기' }).click();
  await expectHash(page, '/score');
  await expect(page.getByTestId('score')).toHaveText('78점');
});

test('기록 화면: 같은 분에 만든 같은 시험, 같은 점수의 기록은 초까지 적어 구분한다', async ({ page }) => {
  await openApp(page, '/');
  const base = { examId: 'sample-a', gradedBefore: 'not_yet', answers: {} };
  await seedStore(page, {
    version: 1,
    sessions: [
      // 테스트의 시간대는 Asia/Seoul 이라 10:00Z 는 19시 0분이다.
      { ...base, id: 's1', createdAt: '2026-11-22T10:00:12.000Z' },
      { ...base, id: 's2', createdAt: '2026-11-22T10:00:05.000Z' },
      // 분이 다른 기록은 시와 분까지만 적는다.
      { ...base, id: 's3', createdAt: '2026-11-22T09:30:00.000Z' },
    ],
    currentId: null,
  });
  await page.reload();
  await openApp(page, '/history');
  await expect(page.getByTestId('history-item')).toHaveCount(3);
  await expect(page.getByRole('button', { name: '예시 시험 A 기록 열기, 2026년 11월 22일 19시 0분 12초, 입력 중' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: '예시 시험 A 기록 열기, 2026년 11월 22일 19시 0분 5초, 입력 중' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: '예시 시험 A 기록 열기, 2026년 11월 22일 18시 30분, 입력 중' })).toHaveCount(1);
  // 목록에 보이는 글자, 지우기 버튼의 이름, 삭제 확인 문구도 같은 값으로 구분된다.
  await expect(page.getByTestId('history-item').filter({ hasText: '19시 0분 5초' })).toHaveCount(1);
  await page.getByRole('button', { name: '예시 시험 A 기록 지우기, 2026년 11월 22일 19시 0분 5초, 입력 중' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('예시 시험 A, 2026년 11월 22일 19시 0분 5초, 입력 중 기록이에요.');
  await page.getByRole('alertdialog').getByRole('button', { name: '지우기' }).click();
  await expect(page.getByTestId('history-item')).toHaveCount(2);
  // 같은 분의 기록이 하나만 남으면 초는 적지 않는다.
  await expect(page.getByRole('button', { name: '예시 시험 A 기록 열기, 2026년 11월 22일 19시 0분, 입력 중' })).toHaveCount(1);
  expect((await page.evaluate(() => JSON.parse(window.localStorage.getItem('score-anatomy') ?? '{}'))).sessions.map((x: { id: string }) => x.id)).toEqual(['s1', 's3']);
});

test('표시 화면 격자: "안 풂" 글자가 옆 칸의 답 숫자와 같은 높이에 있다', async ({ page }) => {
  const exam = loadExam('a');
  const answers = { ...exampleAnswers(exam), 7: 'skip' };
  await openApp(page, '/');
  await seedStore(page, {
    version: 1,
    sessions: [{ id: 's1', examId: 'sample-a', createdAt: '2026-11-22T10:00:00.000Z', gradedBefore: 'not_yet', answers }],
    currentId: 's1',
  });
  await page.reload();
  await openApp(page, '/marks');
  await expect(page.locator('[data-mark-cell="7"] .cell__val')).toHaveText('안 풂');
  const centers = await page.evaluate(() => {
    // 글자가 실제로 그려진 자리의 세로 가운데.
    const textCenter = (selector: string) => {
      const range = document.createRange();
      range.selectNodeContents(document.querySelector(selector)!);
      const r = range.getBoundingClientRect();
      return r.top + r.height / 2;
    };
    return { skip: textCenter('[data-mark-cell="7"] .cell__val'), next: textCenter('[data-mark-cell="8"] .cell__val') };
  });
  expect(Math.abs(centers.skip - centers.next)).toBeLessThanOrEqual(1);
});

test('5행 방식: 안 풂으로 둔 문항은 접근성 이름으로도 구분된다', async ({ page }) => {
  await openApp(page, '/?input=rows');
  await page.getByRole('button', { name: '시험 고르기' }).click();
  await chooseExam(page, 'sample-b', 'not_yet', 'first');
  await page.locator('[data-row="2"] [data-row-no]').click();
  await page.locator('.sheet [data-menu="skip"]').click();
  await expect(page.locator('[data-row="2"] [data-row-no]')).toHaveAccessibleName('2번, 넣은 답 안 풂, 안 풂 또는 입력 지우기');
  await expect(page.locator('[data-row="3"] [data-row-no]')).toHaveAccessibleName('3번, 안 풂 또는 입력 지우기');
  for (let i = 0; i < 3; i += 1) await page.getByTestId('rows-next').click();
  await page.locator('[data-row="16"] [data-row-no]').click();
  await page.locator('.sheet [data-menu="skip"]').click();
  await expect(page.locator('[data-row="16"] [data-short]')).toHaveAccessibleName('16번 답 안 풂, 눌러서 고치기');
  await expect(page.locator('[data-row="17"] [data-short]')).toHaveAccessibleName('17번 답 넣기');
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
