import type { Locator, Page } from '@playwright/test';
import { exampleAnswers, exampleCauses, exampleMarks } from '../src/logic/example';
import { waitSettled } from './audit';
import { chooseExam, enterKeypad, expect, expectHash, loadExam, openApp, seedStore, tapKey, test } from './helpers';

// 연달아 누르기 보호(src/tapGuard.ts)를 확인한다.
// 1) 화면이 바뀐 직후에 다른 자리를 빨리 눌러도 누름이 버려지지 않는다.
// 2) 바텀시트나 대화상자가 닫힌 직후, 아래 버튼이나 묶음이 바뀐 직후, 화면이 저절로 스크롤된 직후에
//    같은 자리를 다시 눌러도 그 자리에 새로 온 버튼이 눌리지 않는다.
// 3) 단답형 숫자 키는 버리지 않고, 막는 자리에서 시작한 끌기는 그대로 스크롤된다.
// 4) 마지막 문항의 답을 넣어 저절로 입력 확인으로 넘어간 직후에는 다른 자리의 누름도 받지 않는다.
// 5) 표시 화면의 단답형 번호와 시간 선택지는 눌러도 자리가 바뀌지 않는다(같은 자리에 옆 요소가 오지 않는다).
// 누름은 좌표로 직접 보낸다(page.touchscreen.tap, page.mouse). locator 로 누르는 것은 보호가 풀릴 때까지 기다리므로
// (e2e/helpers.ts) 여기서는 준비 단계에만 쓴다.

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Point {
  x: number;
  y: number;
}

async function boxOf(loc: Locator): Promise<Box> {
  const box = await loc.first().boundingBox();
  if (!box) throw new Error('요소가 화면에 없음');
  return box;
}

const centerOf = (b: Box): Point => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

async function centerOfLoc(loc: Locator): Promise<Point> {
  return centerOf(await boxOf(loc));
}

/** 두 상자가 겹치는 곳의 가운데. 겹치지 않으면 이 테스트가 보려는 상황이 아니므로 실패시킨다. */
function overlapCenter(a: Box, b: Box): Point {
  const left = Math.max(a.x, b.x);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const top = Math.max(a.y, b.y);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  expect(right - left, '두 요소가 가로로 겹쳐야 함').toBeGreaterThan(8);
  expect(bottom - top, '두 요소가 세로로 겹쳐야 함').toBeGreaterThan(8);
  return { x: (left + right) / 2, y: (top + bottom) / 2 };
}

const far = (a: Point, b: Point): boolean => Math.abs(a.x - b.x) > 40 || Math.abs(a.y - b.y) > 40;

async function tap(page: Page, p: Point): Promise<void> {
  await page.touchscreen.tap(p.x, p.y);
}

/** 차례로 누른다. wait는 그 누름 앞에 기다리는 시간(ms). */
async function tapSeries(page: Page, steps: { at: Point; wait: number }[]): Promise<void> {
  for (const s of steps) {
    await page.waitForTimeout(s.wait);
    await tap(page, s.at);
  }
}

async function doubleTap(page: Page, p: Point, gap: number): Promise<void> {
  await tap(page, p);
  await page.waitForTimeout(gap);
  await tap(page, p);
}

const stored = (page: Page) => page.evaluate(() => JSON.parse(window.localStorage.getItem('score-anatomy') ?? '{}'));

/** 그 자리에 지금 놓인 요소가 주어진 선택자 안에 있는지. 테스트가 보려는 상황이 실제로 만들어졌는지 확인할 때 쓴다. */
const hitInside = (page: Page, p: Point, selector: string) =>
  page.evaluate(({ x, y, sel }) => document.elementFromPoint(x, y)?.closest(sel) != null, { x: p.x, y: p.y, sel: selector });

test.describe('화면이 바뀐 직후에 다른 자리를 누르면 바로 들어간다', () => {
  test('5행 방식: 단답형 시트가 뜬 직후에 누른 숫자가 모두 들어간다', async ({ page }) => {
    await openApp(page, '/?input=rows');
    await page.getByRole('button', { name: '시험 고르기' }).click();
    await chooseExam(page, 'sample-a');
    for (let i = 0; i < 4; i += 1) await page.getByTestId('rows-next').click();
    await expect(page.getByTestId('page-range')).toHaveText('21~25번');
    const row = page.locator('[data-row="25"] [data-short]');
    const sheet = page.locator('.sheet');

    // 키 자리를 먼저 재 둔다.
    await row.click();
    await waitSettled(page);
    const one = await centerOfLoc(sheet.locator('[data-key="1"]'));
    const five = await centerOfLoc(sheet.locator('[data-key="5"]'));
    const zero = await centerOfLoc(sheet.locator('[data-key="0"]'));
    const go = await centerOfLoc(sheet.locator('[data-key="go"]'));
    await page.getByRole('button', { name: '닫기' }).click();
    await expect(sheet).toHaveCount(0);
    const rowAt = await centerOfLoc(row);
    for (const key of [one, five, zero, go]) expect(far(rowAt, key), '줄과 키의 자리가 달라야 함').toBe(true);

    // [줄을 누른 뒤 첫 키까지, 키 사이] 간격(ms). 예전에는 0.5초 안의 누름이 버려져 150이 50으로 들어갔다.
    for (const [first, gap] of [
      [350, 600],
      [200, 150],
      [450, 300],
    ] as const) {
      await page.waitForTimeout(600);
      await tap(page, rowAt);
      await tapSeries(page, [
        { at: one, wait: first },
        { at: five, wait: gap },
        { at: zero, wait: gap },
        { at: go, wait: gap },
      ]);
      await expect(sheet, `간격 ${first}, ${gap}`).toHaveCount(0);
      await expect(row, `간격 ${first}, ${gap}`).toContainText('150');
      expect((await stored(page)).sessions[0].answers[25], `간격 ${first}, ${gap}`).toBe(150);
      // 다음 차례를 위해 지운다.
      await page.locator('[data-row="25"] [data-row-no]').click();
      await page.locator('.sheet [data-menu="clear"]').click();
      await expect(row).not.toContainText('150');
    }
  });

  test('키패드 방식: 답 입력 화면이 뜬 직후에 누른 답이 밀리지 않는다', async ({ page }) => {
    await openApp(page, '/?input=keypad');
    await page.getByRole('button', { name: '시험 고르기' }).click();
    await chooseExam(page, 'sample-a');
    await waitSettled(page);
    const keys: Point[] = [];
    for (const n of [3, 5, 2, 4, 1]) keys.push(await centerOfLoc(page.locator(`[data-key="${n}"]`)));

    for (const [first, gap] of [
      [400, 550],
      [300, 300],
    ] as const) {
      // 시험 선택으로 돌아갔다가 다시 들어온다.
      await page.getByRole('button', { name: '뒤로' }).click();
      await expectHash(page, '/exams');
      await page.getByTestId('exam-sample-a').click();
      await page.getByTestId('graded-not_yet').click();
      const startBox = await boxOf(page.getByRole('button', { name: '답 넣기', exact: true }));
      // "답 넣기"는 첫 키(3)와 다른 자리에서 누른다. 같은 자리를 다시 누른 것은 일부러 받지 않기 때문이다.
      const startAt = { x: startBox.x + 24, y: startBox.y + startBox.height / 2 };
      expect(far(startAt, keys[0]!), '"답 넣기"를 누른 자리와 첫 키의 자리가 달라야 함').toBe(true);
      await page.waitForTimeout(600);
      await tap(page, startAt);
      await tapSeries(
        page,
        keys.map((at, i) => ({ at, wait: i === 0 ? first : gap })),
      );
      await expect(page.getByTestId('now-no'), `간격 ${first}, ${gap}`).toHaveText('6번');
      expect((await stored(page)).sessions[0].answers, `간격 ${first}, ${gap}`).toEqual({ 1: 3, 2: 5, 3: 2, 4: 4, 5: 1 });
      // 다음 차례를 위해 지운다.
      for (let i = 0; i < 5; i += 1) await tapKey(page, 'erase');
      await expect(page.getByTestId('now-no')).toHaveText('1번');
      await expect(page.getByTestId('entered-count')).toHaveText('0문항 입력');
    }
  });

  test('입력 확인: 답 고치기 시트가 뜬 직후에 누른 키가 들어간다', async ({ page }) => {
    const exam = loadExam('a');
    await openApp(page, '/?input=keypad');
    await page.getByRole('button', { name: '시험 고르기' }).click();
    await chooseExam(page, 'sample-a');
    await enterKeypad(page, exam, exampleAnswers(exam));
    await expectHash(page, '/review');
    const cell = page.locator('main [data-cell="3"]');
    const sheet = page.locator('.sheet');
    await cell.click();
    await waitSettled(page);
    const four = await centerOfLoc(sheet.locator('[data-key="4"]'));
    await page.getByRole('button', { name: '닫기' }).click();
    await expect(sheet).toHaveCount(0);
    const cellAt = await centerOfLoc(cell);
    expect(far(cellAt, four)).toBe(true);
    for (const wait of [251, 400, 480]) {
      // 2로 되돌려 두고 시작한다.
      await cell.click();
      await tapKey(sheet, 2);
      await expect(cell.locator('.cell__val')).toHaveText('2');
      await page.waitForTimeout(600);
      await tap(page, cellAt);
      await tapSeries(page, [{ at: four, wait }]);
      await expect(sheet, `${wait}ms 뒤`).toHaveCount(0);
      await expect(cell.locator('.cell__val'), `${wait}ms 뒤`).toHaveText('4');
    }
  });

  test('재풀이: 다음 문항의 키패드가 뜬 직후에 누른 숫자가 모두 들어간다', async ({ page }) => {
    const exam = loadExam('a');
    await openApp(page, '/');
    await seedStore(page, {
      version: 1,
      sessions: [
        {
          id: 's1',
          examId: 'sample-a',
          createdAt: '2026-11-22T10:00:00.000Z',
          gradedBefore: 'not_yet',
          answers: exampleAnswers(exam),
          marks: exampleMarks(),
          causes: exampleCauses(),
          gradedAt: '2026-11-22T10:05:00.000Z',
          firstGradedAt: '2026-11-22T10:05:00.000Z',
        },
      ],
      currentId: 's1',
    });
    await page.reload();

    // 수열 재풀이: 15번(5지선다) 다음이 29번(단답형)이다. 먼저 29번 키패드의 키 자리를 재 둔다.
    await openApp(page, '/retry/t03');
    await expect(page.getByTestId('retry-no')).toHaveText('15번');
    await tapKey(page, 3);
    await tapKey(page, 'go');
    await page.getByTestId('retry-next').click();
    await expect(page.getByTestId('retry-no')).toHaveText('29번');
    await waitSettled(page);
    const two = await centerOfLoc(page.locator('[data-key="2"]'));
    const five = await centerOfLoc(page.locator('[data-key="5"]'));
    const seven = await centerOfLoc(page.locator('[data-key="7"]'));
    const go = await centerOfLoc(page.locator('[data-key="go"]'));

    // 다시 들어와 15번을 맞히고, "다음 문항"을 누른 직후에 257을 누른다.
    await openApp(page, '/steps');
    await openApp(page, '/retry/t03');
    await expect(page.getByTestId('retry-no')).toHaveText('15번');
    await tapKey(page, 3);
    await tapKey(page, 'go');
    await expect(page.getByTestId('retry-result')).toBeVisible();
    await waitSettled(page);
    const nextBox = await boxOf(page.getByTestId('retry-next'));
    // "다음 문항"은 뒤이어 누를 키들과 다른 자리에서 누른다.
    let nextAt: Point | null = null;
    for (let x = nextBox.x + 24; x <= nextBox.x + nextBox.width - 24; x += 8) {
      const p = { x, y: nextBox.y + nextBox.height / 2 };
      if ([two, five, seven, go].every((k) => far(p, k))) {
        nextAt = p;
        break;
      }
    }
    expect(nextAt, '"다음 문항" 버튼에 키와 겹치지 않는 자리가 있어야 함').not.toBeNull();
    await page.waitForTimeout(600);
    await tap(page, nextAt!);
    await tapSeries(page, [
      { at: two, wait: 401 },
      { at: five, wait: 550 },
      { at: seven, wait: 550 },
      { at: go, wait: 550 },
    ]);
    await expect(page.getByTestId('retry-result')).toContainText('다시 풀어 맞혔어요.');
    await expect(page.getByTestId('retry-label')).toHaveText('실수로 표시함, 다시 풀어 맞힘');
    expect((await stored(page)).sessions[0].retries[29].correct).toBe(true);
  });
});

test.describe('화면이 바뀐 직후에 같은 자리를 다시 누르면 받지 않는다', () => {
  for (const gap of [120, 400]) {
    test(`입력 확인: 시트가 닫힌 직후 같은 자리를 다시 눌러도 밑의 버튼이 눌리지 않는다 (간격 ${gap}ms)`, async ({ page }) => {
      const exam = loadExam('a');
      const answers = exampleAnswers(exam);
      await openApp(page, '/?input=keypad');
      await page.getByRole('button', { name: '시험 고르기' }).click();
      await chooseExam(page, 'sample-a');
      await enterKeypad(page, exam, answers);
      await expectHash(page, '/review');
      await waitSettled(page);
      const primary = await boxOf(page.getByRole('button', { name: '맞아요, 다음으로' }));
      const historyTab = await boxOf(page.getByRole('link', { name: '기록', exact: true }));
      const sheet = page.locator('.sheet');
      const cell14 = page.locator('main [data-cell="14"]');

      // 5지선다 키 3과 밑의 주 버튼이 겹치는 자리. 예전에는 둘째 누름이 주 버튼에 들어가 표시 화면으로 넘어갔다.
      await cell14.click();
      await waitSettled(page);
      let at = overlapCenter(await boxOf(sheet.locator('[data-key="3"]')), primary);
      await doubleTap(page, at, gap);
      await page.waitForTimeout(700);
      await expectHash(page, '/review');
      await expect(sheet).toHaveCount(0);
      await expect(cell14.locator('.cell__val')).toHaveText('3');

      // "지우기"와 밑의 "기록" 탭이 겹치는 자리. 예전에는 기록 화면으로 나갔다.
      await cell14.click();
      await waitSettled(page);
      at = overlapCenter(await boxOf(sheet.locator('[data-key="erase"]')), historyTab);
      await doubleTap(page, at, gap);
      await page.waitForTimeout(700);
      await expectHash(page, '/review');
      await expect(sheet).toHaveCount(0);
      // 14번은 첫 누름으로 지워졌다. 다시 채운다.
      await cell14.click();
      await tapKey(sheet, answers[14] as number);
      await expect(cell14.locator('.cell__val')).toHaveText(String(answers[14]));

      // 단답형 시트의 "넣기"와 밑의 "기록" 탭이 겹치는 자리.
      await page.locator('main [data-cell="27"]').click();
      await waitSettled(page);
      at = overlapCenter(await boxOf(sheet.locator('[data-key="go"]')), historyTab);
      await doubleTap(page, at, gap);
      await page.waitForTimeout(700);
      await expectHash(page, '/review');
      await expect(sheet).toHaveCount(0);

      // 0.5초가 지난 뒤에는 같은 자리도 눌린다.
      await page.waitForTimeout(600);
      await tap(page, centerOf(primary));
      await expectHash(page, '/marks');
    });
  }

  test('5행 방식: 시트가 닫힌 직후 같은 자리를 다시 눌러도 쪽이 넘어가지 않고, 쪽 넘기기도 한 번에 한 쪽이다', async ({ page }) => {
    await openApp(page, '/?input=rows');
    await page.getByRole('button', { name: '시험 고르기' }).click();
    await chooseExam(page, 'sample-b', 'not_yet', 'first');
    for (let i = 0; i < 3; i += 1) await page.getByTestId('rows-next').click();
    await expect(page.getByTestId('page-range')).toHaveText('16~20번');
    await waitSettled(page);
    const next = await boxOf(page.getByTestId('rows-next'));
    const sheet = page.locator('.sheet');

    // 단답형 시트의 "넣기"와 밑의 "다음 5문항"이 겹치는 자리.
    await page.locator('[data-row="16"] [data-short]').click();
    await waitSettled(page);
    await tapKey(sheet, 7);
    let at = overlapCenter(await boxOf(sheet.locator('[data-key="go"]')), next);
    await page.waitForTimeout(600);
    await doubleTap(page, at, 120);
    await page.waitForTimeout(700);
    await expect(sheet).toHaveCount(0);
    await expect(page.getByTestId('page-range')).toHaveText('16~20번');
    await expect(page.locator('[data-row="16"] [data-short]')).toContainText('7');

    // 번호 메뉴의 "입력 지우기"와 밑의 "다음 5문항"이 겹치는 자리.
    await page.locator('[data-row="16"] [data-row-no]').click();
    await waitSettled(page);
    at = overlapCenter(await boxOf(sheet.locator('[data-menu="clear"]')), next);
    await doubleTap(page, at, 120);
    await page.waitForTimeout(700);
    await expect(sheet).toHaveCount(0);
    await expect(page.getByTestId('page-range')).toHaveText('16~20번');

    // "다음 5문항"을 연달아 눌러도 한 쪽만 넘어간다.
    await doubleTap(page, centerOf(next), 120);
    await page.waitForTimeout(700);
    await expect(page.getByTestId('page-range')).toHaveText('21~25번');
  });

  test('5행 방식: 다른 자리를 누른 뒤에는 처음 누른 자리도 바로 받는다', async ({ page }) => {
    await openApp(page, '/?input=rows');
    await page.getByRole('button', { name: '시험 고르기' }).click();
    await chooseExam(page, 'sample-a');
    await expect(page.getByTestId('page-range')).toHaveText('1~5번');
    await waitSettled(page);
    const next = await centerOfLoc(page.getByTestId('rows-next'));
    // 6~10번 쪽의 6번 줄 보기 3. 쪽이 바뀌어도 줄의 자리는 같으므로 1번 줄에서 재 둔다.
    const choice = await centerOfLoc(page.locator('[data-row="1"] [data-choice="3"]'));
    expect(far(next, choice), '"다음 5문항"과 보기의 자리가 달라야 함').toBe(true);
    await page.waitForTimeout(600);
    // "다음 5문항", 0.15초 뒤 보기 3, 0.15초 뒤 다시 "다음 5문항". 앞 누름에서 0.3초밖에 안 지났지만
    // 사이에 다른 자리를 눌렀으므로 연달아 누른 것이 아니다.
    await tapSeries(page, [
      { at: next, wait: 0 },
      { at: choice, wait: 150 },
      { at: next, wait: 150 },
    ]);
    await expect(page.getByTestId('page-range')).toHaveText('11~15번');
    expect((await stored(page)).sessions[0].answers[6]).toBe(3);
  });

  test('재풀이: 맞춰 보는 키를 연달아 눌러도 그 자리에 온 버튼이 눌리지 않는다', async ({ page }) => {
    const exam = loadExam('a');
    await openApp(page, '/');
    await seedStore(page, {
      version: 1,
      sessions: [
        {
          id: 's1',
          examId: 'sample-a',
          createdAt: '2026-11-22T10:00:00.000Z',
          gradedBefore: 'not_yet',
          answers: exampleAnswers(exam),
          marks: exampleMarks(),
          causes: exampleCauses(),
          gradedAt: '2026-11-22T10:05:00.000Z',
          firstGradedAt: '2026-11-22T10:05:00.000Z',
        },
      ],
      currentId: 's1',
    });
    await page.reload();
    for (const gap of [150, 400]) {
      await openApp(page, '/steps');
      await openApp(page, '/retry/t03');
      await expect(page.getByTestId('retry-no')).toHaveText('15번');
      await tapKey(page, 3);
      await waitSettled(page);
      const go = await centerOfLoc(page.locator('[data-key="go"]'));
      await page.waitForTimeout(600);
      await doubleTap(page, go, gap);
      await page.waitForTimeout(700);
      // 결과가 뜨면 키패드가 사라지고 그 자리에 다른 조작 요소(아래 버튼이나 탭)가 온다. 그래도 화면은 그대로다.
      await expectHash(page, '/retry/t03');
      await expect(page.getByTestId('retry-no')).toHaveText('15번');
      await expect(page.getByTestId('retry-result')).toBeVisible();
      expect(await hitInside(page, go, 'button, a'), `같은 자리에 다른 조작 요소가 와 있어야 함 (간격 ${gap}ms)`).toBe(true);
    }
  });

  test('정답 공개 전 시험: "답 저장하기"를 연달아 눌러도 안내문을 건너뛰지 않는다', async ({ page }) => {
    const exam = loadExam('c');
    const answers: Record<number, number> = {};
    for (const it of exam.items) answers[it.no] = 1;
    await openApp(page, '/?input=keypad');
    await page.getByRole('button', { name: '시험 고르기' }).click();
    await chooseExam(page, 'sample-c');
    await enterKeypad(page, exam, answers);
    await expectHash(page, '/review');
    await page.getByRole('button', { name: '맞아요, 다음으로' }).click();
    await expectHash(page, '/marks');
    await waitSettled(page);
    const save = await centerOfLoc(page.getByRole('button', { name: '답 저장하기' }));
    await page.waitForTimeout(600);
    await doubleTap(page, save, 120);
    await page.waitForTimeout(700);
    await expectHash(page, '/marks');
    await expect(page.getByText('정답이 아직 공개되지 않았어요. 답은 저장해 뒀어요. 공개되면 여기서 바로 채점돼요.')).toBeVisible();
    // 같은 자리에 "기록 보기"가 생겼는데도 눌리지 않았다.
    expect(await hitInside(page, save, 'button')).toBe(true);
    await expect(page.getByRole('button', { name: '기록 보기' })).toBeVisible();
  });

  test('기록: 삭제 확인의 "지우기"를 연달아 눌러도 밑에 있던 다른 기록이 열리지 않는다', async ({ page }) => {
    await openApp(page, '/');
    const sessions = Array.from({ length: 9 }, (_, i) => ({
      id: `s${i + 1}`,
      examId: 'sample-a',
      createdAt: `2026-11-22T10:0${i}:00.000Z`,
      gradedBefore: 'not_yet',
      answers: {},
    }));
    await seedStore(page, { version: 1, sessions, currentId: null });
    await page.reload();
    await openApp(page, '/history');
    await expect(page.getByTestId('history-item')).toHaveCount(9);
    await page.getByTestId('history-remove').first().click();
    await waitSettled(page);
    const yes = await centerOfLoc(page.getByRole('alertdialog').getByRole('button', { name: '지우기' }));
    await page.waitForTimeout(600);
    await doubleTap(page, yes, 120);
    await page.waitForTimeout(700);
    await expectHash(page, '/history');
    await expect(page.getByTestId('history-item')).toHaveCount(8);
    // 그 자리에는 다른 기록이 놓여 있다. 그런데도 열리지 않았다.
    expect(await hitInside(page, yes, '[data-testid="history-item"]')).toBe(true);
    expect((await stored(page)).currentId).toBeNull();
  });
});

test.describe('같은 화면 안에서 누른 자리의 내용이 바뀌는 경우', () => {
  for (const gap of [120, 400]) {
    test(`키패드 방식: 직전 묶음의 칸을 연달아 눌러도 다섯 문항 앞의 칸까지 넘어가지 않는다 (간격 ${gap}ms)`, async ({ page }) => {
      const exam = loadExam('a');
      const answers: Record<number, number> = {};
      for (const it of exam.items.slice(0, 16)) answers[it.no] = 1;
      await openApp(page, '/');
      await seedStore(page, {
        version: 1,
        sessions: [{ id: 's1', examId: 'sample-a', createdAt: '2026-11-22T10:00:00.000Z', gradedBefore: 'not_yet', answers }],
        currentId: 's1',
      });
      await page.reload();
      await openApp(page, '/input?input=keypad');
      await expect(page.getByTestId('now-no')).toHaveText('17번');
      await waitSettled(page);
      // 윗줄(11~15번)의 13번 칸. 누르면 묶음이 바뀌어 같은 자리에 8번 칸이 온다.
      const at = await centerOfLoc(page.locator('[data-cell="13"]'));
      await page.waitForTimeout(600);
      await doubleTap(page, at, gap);
      await page.waitForTimeout(700);
      await expect(page.getByTestId('now-no')).toHaveText('13번');
      expect(await hitInside(page, at, '[data-cell="8"]'), '같은 자리에 8번 칸이 와 있어야 함').toBe(true);
      // 이어 누른 키는 13번에 들어간다.
      await tapKey(page, 4);
      const saved = (await stored(page)).sessions[0].answers;
      expect(saved[13]).toBe(4);
      expect(saved[8]).toBe(1);
      // 0.5초가 지난 뒤에는 같은 자리의 칸(8번)도 눌린다.
      await page.waitForTimeout(600);
      await tap(page, at);
      await expect(page.getByTestId('now-no')).toHaveText('8번');
    });
  }

  test('키패드 방식: 확정하지 않은 숫자가 있을 때 "전체 보기"를 연달아 눌러도 안내문을 건너뛰지 않는다', async ({ page }) => {
    const exam = loadExam('a');
    await openApp(page, '/?input=keypad');
    await page.getByRole('button', { name: '시험 고르기' }).click();
    await chooseExam(page, 'sample-a');
    await enterKeypad(page, exam, exampleAnswers(exam));
    await expectHash(page, '/review');
    await openApp(page, '/input?input=keypad');
    await page.locator('[data-cell="27"]').click();
    await tapKey(page, 9);
    await tapKey(page, 9);
    await waitSettled(page);
    const showAll = await centerOfLoc(page.getByRole('button', { name: '전체 보기' }));
    await page.waitForTimeout(600);
    await doubleTap(page, showAll, 120);
    await page.waitForTimeout(300);
    await expectHash(page, '/input');
    await expect(page.getByRole('status')).toHaveText("27번에 누른 숫자는 '다음'을 누르지 않아서 들어가지 않았어요.");
    // 0.5초가 지난 뒤에 누르면 넘어간다.
    await page.waitForTimeout(600);
    await tap(page, showAll);
    await expectHash(page, '/review');
    await expect(page.locator('main [data-cell="27"] .cell__val')).toHaveText('146');
  });

  test('키패드 방식: 5지선다에서 단답형으로 넘어간 직후 같은 자리의 숫자 키는 버리지 않는다', async ({ page }) => {
    const exam = loadExam('a');
    const answers = exampleAnswers(exam);
    await openApp(page, '/?input=keypad');
    await page.getByRole('button', { name: '시험 고르기' }).click();
    await chooseExam(page, 'sample-a');
    await enterKeypad(page, exam, answers, 1, 20);
    await expect(page.getByTestId('now-no')).toHaveText('21번');
    await waitSettled(page);
    // 21번(5지선다)의 키 3 자리에는 22번(단답형)의 키 8이 온다.
    const at = await centerOfLoc(page.locator('[data-key="3"]'));
    await page.waitForTimeout(600);
    await doubleTap(page, at, 150);
    await expect(page.getByTestId('now-no')).toHaveText('22번');
    expect(await hitInside(page, at, '[data-key="8"]'), '같은 자리에 숫자 키 8이 와 있어야 함').toBe(true);
    await expect(page.getByTestId('entry')).toContainText('8');
    await tapKey(page, 5);
    await tapKey(page, 'go');
    const saved = (await stored(page)).sessions[0].answers;
    expect(saved[21]).toBe(3);
    expect(saved[22]).toBe(85);
  });

  test('키패드 방식: 단답형의 "다음"을 연달아 눌러도 다음 문항의 "지우기"가 눌리지 않는다', async ({ page }) => {
    const exam = loadExam('b');
    const answers = exampleAnswers(loadExam('a'));
    const filled: Record<number, number> = {};
    for (const it of exam.items.slice(0, 21)) filled[it.no] = it.kind === 'mc' ? 1 : (answers[22] as number);
    await openApp(page, '/');
    await seedStore(page, {
      version: 1,
      sessions: [{ id: 's1', examId: 'sample-b', createdAt: '2026-11-22T10:00:00.000Z', gradedBefore: 'not_yet', seenBefore: 'first', answers: filled }],
      currentId: 's1',
    });
    await page.reload();
    await openApp(page, '/input?input=keypad');
    await expect(page.getByTestId('now-no')).toHaveText('22번');
    await tapKey(page, 3);
    await tapKey(page, 1);
    await tapKey(page, 5);
    await waitSettled(page);
    const go = await centerOfLoc(page.locator('[data-key="go"]'));
    await page.waitForTimeout(600);
    await doubleTap(page, go, 120);
    await page.waitForTimeout(700);
    // 22번(단답형)의 "다음" 자리에는 23번(5지선다)의 "지우기"가 온다. 그런데도 22번 답은 지워지지 않았다.
    await expect(page.getByTestId('now-no')).toHaveText('23번');
    expect(await hitInside(page, go, '[data-key="erase"]'), '같은 자리에 "지우기"가 와 있어야 함').toBe(true);
    expect((await stored(page)).sessions[0].answers[22]).toBe(315);
  });

  test('누르고 있다가 뗀 누름도 화면이 바뀐 때부터 0.5초 동안 같은 자리를 막는다', async ({ page }) => {
    const exam = loadExam('a');
    await openApp(page, '/');
    await seedStore(page, {
      version: 1,
      sessions: [
        {
          id: 's1',
          examId: 'sample-a',
          createdAt: '2026-11-22T10:00:00.000Z',
          gradedBefore: 'not_yet',
          answers: exampleAnswers(exam),
          marks: exampleMarks(),
          gradedAt: '2026-11-22T10:05:00.000Z',
          firstGradedAt: '2026-11-22T10:05:00.000Z',
        },
      ],
      currentId: 's1',
    });
    await page.reload();
    for (const hold of [300, 450]) {
      await openApp(page, '/score');
      await waitSettled(page);
      const at = await centerOfLoc(page.getByRole('button', { name: '틀린 문항 살펴보기' }));
      await page.waitForTimeout(600);
      // 버튼을 누르고 있다가 뗀다. 화면은 뗄 때 바뀐다.
      await page.mouse.move(at.x, at.y);
      await page.mouse.down();
      await page.waitForTimeout(hold);
      await page.mouse.up();
      await page.waitForTimeout(200);
      await page.mouse.click(at.x, at.y);
      await page.waitForTimeout(700);
      // 같은 자리에 오답 원인 화면의 주 버튼이 있지만 눌리지 않았다.
      await expectHash(page, '/causes');
      expect(await hitInside(page, at, 'button'), `누른 시간 ${hold}ms`).toBe(true);
    }
  });
});

test.describe('작은 화면(360x640)', () => {
  test.use({ viewport: { width: 360, height: 640 } });

  test('시험 선택: 화면이 저절로 스크롤된 뒤 같은 자리에 온 다른 선택지가 눌리지 않는다', async ({ page }) => {
    await openApp(page, '/exams');
    await waitSettled(page);
    const examB = page.getByTestId('exam-sample-b');
    const at = await centerOfLoc(examB);
    await doubleTap(page, at, 120);
    await page.waitForTimeout(700);
    await expect(examB).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('exam-sample-a')).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByTestId('exam-sample-c')).toHaveAttribute('aria-checked', 'false');
    // 화면이 스크롤되어 그 자리에는 이제 다른 것이 놓여 있다. 그런데도 채점 여부는 골라지지 않았다.
    expect(await hitInside(page, at, '[data-testid="exam-sample-b"]'), '스크롤되어 다른 것이 와 있어야 함').toBe(false);
    await expect(page.getByTestId('graded-not_yet')).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByTestId('graded-already')).toHaveAttribute('aria-checked', 'false');

    // "아직 안 했어요"를 연달아 눌러도 그 아래에서 올라온 선택지가 골라지지 않는다.
    await page.locator('main').evaluate((el) => {
      el.scrollTop = 160;
    });
    await page.waitForTimeout(600);
    const notYet = await centerOfLoc(page.getByTestId('graded-not_yet'));
    await doubleTap(page, notYet, 120);
    await page.waitForTimeout(700);
    await expect(page.getByTestId('graded-not_yet')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('graded-already')).toHaveAttribute('aria-checked', 'false');
    for (const seen of ['first', 'partial', 'solved']) {
      await expect(page.getByTestId(`seen-${seen}`)).toHaveAttribute('aria-checked', 'false');
    }
    // 저장되는 기록도 고른 그대로다.
    await page.getByTestId('seen-first').click();
    await page.getByRole('button', { name: '답 넣기', exact: true }).click();
    await expectHash(page, '/input');
    const saved = (await stored(page)).sessions[0];
    expect(saved.examId).toBe('sample-b');
    expect(saved.gradedBefore).toBe('not_yet');
  });

  test('화면이 바뀐 직후 같은 자리에서 시작한 끌기는 그대로 스크롤된다', async ({ page }) => {
    const exam = loadExam('a');
    await openApp(page, '/');
    await seedStore(page, {
      version: 1,
      sessions: [
        {
          id: 's1',
          examId: 'sample-a',
          createdAt: '2026-11-22T10:00:00.000Z',
          gradedBefore: 'not_yet',
          answers: exampleAnswers(exam),
          marks: exampleMarks(),
          causes: exampleCauses(),
          gradedAt: '2026-11-22T10:05:00.000Z',
          firstGradedAt: '2026-11-22T10:05:00.000Z',
        },
      ],
      currentId: null,
    });
    await page.reload();
    await openApp(page, '/history');
    await waitSettled(page);
    const at = await centerOfLoc(page.getByTestId('history-item').locator('.hitem__open'));
    const cdp = await page.context().newCDPSession(page);
    await page.waitForTimeout(600);
    // 기록을 눌러 점수 해부로 간 뒤, 0.2초 만에 같은 자리에서 위로 끈다.
    await tap(page, at);
    await expectHash(page, '/anatomy');
    await page.waitForTimeout(200);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: at.x, y: at.y }] });
    for (let i = 1; i <= 6; i += 1) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: at.x, y: at.y - i * 15 }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(300);
    const scrolled = await page.locator('main').evaluate((el) => el.scrollTop);
    expect(scrolled, '본문이 스크롤돼야 함').toBeGreaterThan(30);
    await expectHash(page, '/anatomy');
  });
});

test.describe('마지막 문항을 넣어 저절로 입력 확인으로 넘어간 직후', () => {
  for (const gap of [150, 450]) {
    test(`답을 넣던 박자로 더 눌러도 입력 확인 화면에 머문다 (간격 ${gap}ms)`, async ({ page }) => {
      const exam = loadExam('b');
      const answers: Record<number, number> = {};
      for (const it of exam.items.slice(0, 29)) answers[it.no] = it.kind === 'mc' ? 1 : 12;
      await openApp(page, '/');
      await seedStore(page, {
        version: 1,
        sessions: [{ id: 's1', examId: 'sample-b', createdAt: '2026-11-22T10:00:00.000Z', gradedBefore: 'not_yet', seenBefore: 'first', answers }],
        currentId: 's1',
      });
      await page.reload();
      await openApp(page, '/input?input=keypad');
      await expect(page.getByTestId('now-no')).toHaveText('30번');
      await tapKey(page, 4);
      await tapKey(page, 8);
      await waitSettled(page);
      const nine = await centerOfLoc(page.locator('[data-key="9"]'));
      const seven = await centerOfLoc(page.locator('[data-key="7"]'));
      const go = await centerOfLoc(page.locator('[data-key="go"]'));
      await page.waitForTimeout(600);
      // "다음"으로 30번을 확정하면 입력 확인으로 넘어간다. 같은 박자로 9, 7, "다음" 자리를 더 누른다.
      await tapSeries(page, [
        { at: go, wait: 0 },
        { at: nine, wait: gap },
        { at: seven, wait: gap },
        { at: go, wait: gap },
      ]);
      await page.waitForTimeout(700);
      await expectHash(page, '/review');
      const session = (await stored(page)).sessions[0];
      expect(session.answers[30]).toBe(48);
      expect(session.gradedAt ?? null).toBeNull();
      // 더 누른 자리에는 입력 확인 화면의 버튼이 있다. 화면 전체를 막지 않았다면 그 버튼이 눌렸을 것이다.
      expect(await hitInside(page, nine, 'button, a'), '키 9 자리에 다른 조작 요소가 와 있어야 함').toBe(true);
      // 0.5초 동안 누르지 않으면 풀린다.
      await page.getByRole('button', { name: '맞아요, 다음으로' }).click();
      await expectHash(page, '/marks');
    });
  }

  test('"전체 보기"로 넘어간 때는 화면 전체를 막지 않는다(다른 자리는 바로 받는다)', async ({ page }) => {
    const exam = loadExam('a');
    await openApp(page, '/');
    await seedStore(page, {
      version: 1,
      sessions: [{ id: 's1', examId: 'sample-a', createdAt: '2026-11-22T10:00:00.000Z', gradedBefore: 'not_yet', answers: exampleAnswers(exam) }],
      currentId: 's1',
    });
    await page.reload();
    // 입력 확인 화면에서 14번 칸의 자리를 재 둔다.
    await openApp(page, '/review');
    await waitSettled(page);
    const cell = await centerOfLoc(page.locator('main [data-cell="14"]'));
    await openApp(page, '/input?input=keypad');
    await waitSettled(page);
    const showAll = await centerOfLoc(page.getByRole('button', { name: '전체 보기' }));
    expect(far(showAll, cell), '"전체 보기"와 14번 칸의 자리가 달라야 함').toBe(true);
    await page.waitForTimeout(600);
    await tapSeries(page, [
      { at: showAll, wait: 0 },
      { at: cell, wait: 250 },
    ]);
    await expectHash(page, '/review');
    await expect(page.locator('.sheet')).toBeVisible();
  });
});

test.describe('표시 화면: 눌러도 자리가 바뀌지 않는다', () => {
  // 기본 글자 크기를 키운 경우(20px, 24px)도 본다. 글자가 커지면 "자신 없음" 줄이 칸보다 높아질 수 있다.
  for (const c of [
    { width: 390, height: 844, fontPx: 16 },
    { width: 360, height: 640, fontPx: 16 },
    { width: 360, height: 640, fontPx: 20 },
    { width: 360, height: 640, fontPx: 24 },
    { width: 390, height: 844, fontPx: 24 },
  ]) {
    test(`단답형 번호와 시간 선택지 (${c.width}x${c.height}, 기본 글자 ${c.fontPx}px)`, async ({ page }) => {
      await page.setViewportSize({ width: c.width, height: c.height });
      if (c.fontPx !== 16) {
        // 브라우저의 기본 글자 크기를 키운 것과 같은 효과(rem 기준이 커진다).
        await page.addInitScript((px) => {
          const apply = () => {
            const style = document.createElement('style');
            style.textContent = `html { font-size: ${px}px; }`;
            document.head.appendChild(style);
          };
          if (document.head) apply();
          else document.addEventListener('DOMContentLoaded', apply);
        }, c.fontPx);
      }
      const exam = loadExam('a');
      await openApp(page, '/');
      await seedStore(page, {
        version: 1,
        sessions: [{ id: 's1', examId: 'sample-a', createdAt: '2026-11-22T10:00:00.000Z', gradedBefore: 'not_yet', answers: exampleAnswers(exam) }],
        currentId: 's1',
      });
      await page.reload();
      await openApp(page, '/marks');
      await waitSettled(page);
      // 본문 안에서의 자리(스크롤과 상관없는 값)와 크기를 모은다.
      const layout = () =>
        page.evaluate(() => {
          const body = document.querySelector('main')!;
          const top = body.getBoundingClientRect().top - body.scrollTop;
          return [...document.querySelectorAll('[data-short-mark], [data-mark-cell], .chip')].map((el) => {
            const r = el.getBoundingClientRect();
            return [Math.round(r.left * 2) / 2, Math.round((r.top - top) * 2) / 2, Math.round(r.width * 2) / 2, Math.round(r.height * 2) / 2].join(' ');
          });
        });
      const before = await layout();
      expect(before.length).toBeGreaterThan(30);
      // 표시를 여러 개 붙이고 시간 답을 고른다.
      for (const no of [22, 27, 30]) await page.locator(`[data-short-mark="${no}"]`).click();
      for (const no of [3, 14]) await page.locator(`[data-mark-cell="${no}"]`).click();
      await page.getByTestId('time-enough').click();
      await expect(page.locator('[data-short-mark="27"]')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('time-enough')).toHaveAttribute('aria-checked', 'true');
      expect(await layout()).toEqual(before);
      // "자신 없음"은 한 줄에 다 들어가고, 글자가 칸의 안쪽 여백을 넘지 않는다.
      const overflow = await page.evaluate(() =>
        [...document.querySelectorAll('[data-short-mark] small')].filter((el) => {
          const range = document.createRange();
          range.selectNodeContents(el);
          const text = range.getBoundingClientRect();
          const cell = el.closest('[data-short-mark]')!;
          const cs = getComputedStyle(cell);
          const box = cell.getBoundingClientRect();
          const left = box.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft);
          const right = box.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight);
          const oneLine = text.height <= parseFloat(getComputedStyle(el).lineHeight) + 1;
          return !oneLine || text.left < left - 0.5 || text.right > right + 0.5;
        }).length,
      );
      expect(overflow).toBe(0);
      await page.getByTestId('time-missed').click();
      expect(await layout()).toEqual(before);

      // 자신 없음이 붙은 27번을 같은 자리에서 연달아 누르면 27번만 두 번 바뀐다(옆 번호로 옮겨 가지 않는다).
      const mark27 = page.locator('[data-short-mark="27"]');
      await mark27.scrollIntoViewIfNeeded();
      await waitSettled(page);
      const at = await centerOfLoc(mark27);
      await page.waitForTimeout(600);
      await doubleTap(page, at, 180);
      await page.waitForTimeout(300);
      let marks = (await stored(page)).sessions[0].marks;
      expect(Object.keys(marks).sort()).toEqual(['14', '22', '27', '3', '30']);
      expect(marks[27]).toBe('unsure');
      // 한 번만 누르면 27번의 표시만 지워진다.
      await tap(page, at);
      await page.waitForTimeout(300);
      marks = (await stored(page)).sessions[0].marks;
      expect(Object.keys(marks).sort()).toEqual(['14', '22', '3', '30']);
      expect(await layout()).toEqual(before);

      // 고른 시간 선택지의 오른쪽 끝을 연달아 눌러도 옆 선택지가 골라지지 않는다.
      const chip = page.getByTestId('time-enough');
      await chip.click();
      await chip.scrollIntoViewIfNeeded();
      await waitSettled(page);
      const box = await boxOf(chip);
      const edge = { x: box.x + box.width - 6, y: box.y + box.height / 2 };
      await page.waitForTimeout(600);
      await doubleTap(page, edge, 150);
      await page.waitForTimeout(300);
      // 두 번 눌렀으므로 고른 것이 풀렸다가 다시 골라진다.
      expect((await stored(page)).sessions[0].timeFeel).toBe('enough');
      await tap(page, edge);
      await page.waitForTimeout(300);
      expect((await stored(page)).sessions[0].timeFeel ?? null).toBeNull();
    });
  }
});

test.describe('같은 자리로 보는 거리와 키보드', () => {
  const seedAll = async (page: Page) => {
    const exam = loadExam('a');
    await openApp(page, '/');
    await seedStore(page, {
      version: 1,
      sessions: [{ id: 's1', examId: 'sample-a', createdAt: '2026-11-22T10:00:00.000Z', gradedBefore: 'not_yet', answers: exampleAnswers(exam) }],
      currentId: 's1',
    });
    await page.reload();
  };

  test('앞 누름에서 가로나 세로로 20px 떨어진 자리는 받지 않고, 30px 떨어진 자리는 받는다', async ({ page }) => {
    await seedAll(page);
    // 입력 확인의 "맞아요, 다음으로"를 누르면 표시 화면으로 넘어가고, 그 자리 둘레에는 "채점하기"가 온다.
    const cases = [
      { dx: 20, dy: 0, accepted: false },
      { dx: 0, dy: -20, accepted: false },
      { dx: -20, dy: 20, accepted: false },
      { dx: 30, dy: 0, accepted: true },
      { dx: -30, dy: 0, accepted: true },
    ];
    for (const c of cases) {
      await openApp(page, '/review');
      await waitSettled(page);
      const box = await boxOf(page.getByRole('button', { name: '맞아요, 다음으로' }));
      const at = { x: box.x + box.width * 0.65, y: box.y + box.height / 2 };
      const near = { x: at.x + c.dx, y: at.y + c.dy };
      await page.waitForTimeout(600);
      await tap(page, at);
      await page.waitForTimeout(150);
      await tap(page, near);
      await page.waitForTimeout(700);
      const label = `옮긴 거리 (${c.dx}, ${c.dy})`;
      if (c.accepted) {
        // 받은 누름은 그 자리의 "채점하기"를 눌러 점수 화면으로 간다.
        await expectHash(page, '/score');
      } else {
        await expectHash(page, '/marks');
        expect(await hitInside(page, near, 'button'), `${label}: 그 자리에 버튼이 와 있어야 함`).toBe(true);
        expect((await stored(page)).sessions[0].gradedAt ?? null, label).toBeNull();
      }
      // 다음 경우를 위해 채점을 지운다.
      await page.evaluate(() => {
        const data = JSON.parse(window.localStorage.getItem('score-anatomy') ?? '{}');
        delete data.sessions[0].gradedAt;
        delete data.sessions[0].firstGradedAt;
        window.localStorage.setItem('score-anatomy', JSON.stringify(data));
      });
      await page.reload();
    }
  });

  test('키보드로 누른 것은 막지 않는다(화면 전체를 막고 있는 동안에도)', async ({ page }) => {
    const exam = loadExam('b');
    const answers: Record<number, number> = {};
    for (const it of exam.items.slice(0, 29)) answers[it.no] = it.kind === 'mc' ? 1 : 12;
    await openApp(page, '/');
    await seedStore(page, {
      version: 1,
      sessions: [{ id: 's1', examId: 'sample-b', createdAt: '2026-11-22T10:00:00.000Z', gradedBefore: 'not_yet', seenBefore: 'first', answers }],
      currentId: 's1',
    });
    await page.reload();
    await openApp(page, '/input?input=keypad');
    await expect(page.getByTestId('now-no')).toHaveText('30번');
    await tapKey(page, 4);
    await waitSettled(page);
    const go = await centerOfLoc(page.locator('[data-key="go"]'));
    await page.waitForTimeout(600);
    // 마지막 문항을 넣으면 입력 확인으로 넘어가고 0.5초 동안 화면 전체가 누름을 받지 않는다.
    await tap(page, go);
    await expectHash(page, '/review');
    await expect(page.locator('.tap-shield[data-area="screen"]')).toHaveCount(1);
    // 그동안에도 키보드(초점을 두고 Enter)로 누른 버튼은 눌린다.
    await page.getByRole('button', { name: '맞아요, 다음으로' }).focus();
    await page.keyboard.press('Enter');
    await expectHash(page, '/marks');
  });
});

