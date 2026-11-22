import type { Locator, Page } from '@playwright/test';
import { exampleAnswers, exampleCauses, exampleMarks } from '../src/logic/example';
import { waitSettled } from './audit';
import { chooseExam, enterKeypad, expect, expectHash, loadExam, openApp, seedStore, tapKey, test } from './helpers';

// 연달아 누르기 보호(src/tapGuard.ts)를 확인한다.
// 1) 화면이 바뀐 직후에 다른 자리를 빨리 눌러도 누름이 버려지지 않는다.
// 2) 바텀시트나 대화상자가 닫힌 직후, 또는 아래 버튼이 바뀐 직후에 같은 자리를 다시 눌러도 새로 드러난 버튼이 눌리지 않는다.
// 누름은 좌표로 직접 보낸다(page.touchscreen.tap). locator.click()은 가림막이 사라질 때까지 기다리므로 여기서는 준비 단계에만 쓴다.

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
