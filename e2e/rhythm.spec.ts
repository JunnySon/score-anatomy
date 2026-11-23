import type { Locator, Page } from '@playwright/test';
import { exampleAnswers } from '../src/logic/example';
import { chooseExam, enterKeypad, expect, expectHash, loadExam, openApp, tapKey, test } from './helpers';

// 사람 손 박자: 기다리지 않는 좌표 누름(작업 지시서 1의 5장).
// e2e/helpers.ts 의 누름 도우미(locator.click)는 연달아 누르기 보호가 풀리기를 기다렸다가 누르므로
// 사람 손에서 생기는 문제를 가린다. 이 묶음은 그 도우미로 준비만 하고, 확인할 누름은 좌표를 정해진 간격으로 직접 누른다.

interface Point {
  x: number;
  y: number;
}

async function centerOf(loc: Locator): Promise<Point> {
  const box = await loc.first().boundingBox();
  if (!box) throw new Error('요소가 화면에 없음');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** 좌표를 차례로 누른다. 첫 누름은 바로, 그다음부터는 gap(ms) 간격. 보호가 풀리기를 기다리지 않는다. */
async function tapAtRhythm(page: Page, points: Point[], gap: number): Promise<void> {
  for (let i = 0; i < points.length; i += 1) {
    if (i > 0) await page.waitForTimeout(gap);
    await page.touchscreen.tap(points[i]!.x, points[i]!.y);
  }
}

const stored = (page: Page) => page.evaluate(() => JSON.parse(window.localStorage.getItem('score-anatomy') ?? '{}'));

async function startExamA(page: Page) {
  await openApp(page, '/?input=keypad');
  await page.getByRole('button', { name: '시험 고르기' }).click();
  await chooseExam(page, 'sample-a');
}

test('표시가 0개일 때 같은 칸을 0.2초 간격으로 두 번 누르면 "찍음"이 된다(채점 버튼 라벨이 바뀌어도 둘째 누름을 버리지 않는다)', async ({ page }) => {
  const exam = loadExam('a');
  await startExamA(page);
  await enterKeypad(page, exam, exampleAnswers(exam));
  await page.getByRole('button', { name: '맞아요, 다음으로' }).click();
  await expectHash(page, '/marks');
  await expect(page.getByTestId('grade')).toHaveText('없어요, 채점하기');
  // 화면이 막 바뀐 직후의 보호가 끝난 뒤에 시작한다(표시 화면으로 넘어간 누름은 다른 자리였다).
  await page.waitForTimeout(600);
  const cell = page.locator('[data-mark-cell="9"]');
  const at = await centerOf(cell);
  await tapAtRhythm(page, [at, at], 200);
  await expect(cell).toHaveAttribute('data-mark', 'guess');
  await expect(page.getByTestId('grade')).toHaveText('채점하기');
  await expect(page.getByTestId('tap-notice')).toHaveCount(0);
  // 다른 칸도 같은 박자로 두 번 누르면 찍음이 된다.
  const cell14 = page.locator('[data-mark-cell="14"]');
  const at14 = await centerOf(cell14);
  await tapAtRhythm(page, [at14, at14], 200);
  await expect(cell14).toHaveAttribute('data-mark', 'guess');
});

test('잠금 뒤에 0.3초 간격으로 이어 누른 답 키는 어디에도 들어가지 않는다', async ({ page }) => {
  const exam = loadExam('a');
  const answers = exampleAnswers(exam);
  await startExamA(page);
  await enterKeypad(page, exam, answers, 1, 11);
  await expect(page.getByTestId('now-no')).toHaveText('12번');
  await page.waitForTimeout(600);
  // 9번 칸을 눌러 고치고(답 2), 화면을 안 보고 12, 13, 14번에 넣으려던 답 키를 0.3초 간격으로 이어 누른다.
  const cell9 = await centerOf(page.locator('[data-cell="9"]'));
  const key = async (n: number | string) => centerOf(page.locator(`.pad [data-key="${n}"]`));
  await tapAtRhythm(page, [cell9], 0);
  await expect(page.getByTestId('now-no')).toHaveText('9번');
  await tapAtRhythm(page, [await key(2), await key(4), await key(1), await key(5), await key('skip')], 300);
  await expect(page.getByTestId('pad-panel')).toContainText('9번에 답을 넣었어요. 다음에 할 일을 골라 주세요.');
  await expect(page.getByTestId('now-no')).toHaveText('9번');
  const s = (await stored(page)).sessions[0];
  expect(s.answers[9]).toBe(2);
  for (const no of [10, 11]) expect(s.answers[no]).toBe(answers[no]);
  for (const no of [12, 13, 14]) expect(s.answers[no]).toBeUndefined();
  await expect(page.getByTestId('entered-count')).toHaveText('11문항 입력');
  // 잠긴 키는 받지 않은 것이지 버린 누름이 아니라서 알림을 띄우지 않는다.
  await expect(page.getByTestId('tap-notice')).toHaveCount(0);
  // "12번부터 이어서 넣기"를 누르면 12번으로 간다.
  await page.getByTestId('continue-from').click();
  await expect(page.getByTestId('now-no')).toHaveText('12번');
});

test('마지막 문항 뒤에 이어 누른 키가 입력 확인의 버튼을 누르지 않는다', async ({ page }) => {
  const exam = loadExam('a');
  const answers = exampleAnswers(exam);
  await startExamA(page);
  await enterKeypad(page, exam, answers, 1, 29);
  await expect(page.getByTestId('now-no')).toHaveText('30번');
  await page.waitForTimeout(600);
  // 30번(답 275)을 넣고 "다음", 그 박자로 키패드 자리를 몇 번 더 누른다.
  const key = async (n: number | string) => centerOf(page.locator(`.pad [data-key="${n}"]`));
  const k2 = await key(2);
  const k7 = await key(7);
  const k5 = await key(5);
  const go = await key('go');
  const erase = await key('erase');
  const skip = await key('skip');
  await tapAtRhythm(page, [k2, k7, k5, go, go, erase, skip, go, k2], 150);
  await expectHash(page, '/review');
  // 입력 확인의 버튼(맞아요, 다음으로)과 칸이 눌리지 않았다: 표시 화면으로 넘어가지 않았고 시트도 열리지 않았다.
  await page.waitForTimeout(300);
  await expectHash(page, '/review');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await stored(page)).sessions[0].answers[30]).toBe(275);
  // 받지 않은 누름은 알린다(같은 보호 구간에서는 한 번만, 겹쳐 뜨지 않게 하나만).
  await expect(page.locator('.tap-notice')).toHaveCount(1);
});

test.describe('버린 누름 알림', () => {
  test('누를 수 있는 요소 위의 누름만 알리고, 한 번만 전하며, 2초 뒤 사라지고, 받아들인 누름이 오면 바로 닫는다', async ({ page }) => {
    const exam = loadExam('a');
    const answers = exampleAnswers(exam);
    await startExamA(page);
    await enterKeypad(page, exam, answers);
    await expectHash(page, '/review');
    // 입력 확인 화면의 제목(빈 바탕)과 3번 칸의 자리를 먼저 재 둔다.
    await page.waitForTimeout(600);
    const title = await centerOf(page.getByRole('heading', { name: '넣은 답을 확인해 주세요' }));
    const cell = await centerOf(page.locator('main [data-cell="3"]'));
    // 답 입력으로 돌아가 30번을 다시 넣으면 저절로 입력 확인으로 넘어가며 화면 전체를 잠깐 막는다.
    await page.getByRole('button', { name: '뒤로' }).click();
    await expectHash(page, '/input');
    await page.locator('[data-cell="30"]').click();
    await tapKey(page, 'go');
    // 막고 있는 동안 빈 바탕(제목)을 누른 것은 알리지 않는다.
    await page.touchscreen.tap(title.x, title.y);
    await expectHash(page, '/review');
    await expect(page.getByTestId('tap-notice')).toHaveCount(0);
    // 누를 수 있는 요소(칸)를 누른 것은 알린다(빈 바탕을 버리면서 보호를 다시 셌으므로 아직 막고 있다).
    await page.touchscreen.tap(cell.x, cell.y);
    await expect(page.getByTestId('tap-notice')).toHaveText('화면이 막 바뀌어서 방금 누른 것은 받지 않았어요.');
    // 화면 낭독기에는 알림 영역(role=status)으로 한 번 전한다. 보이는 알림은 낭독에서 숨긴다.
    await expect(page.getByTestId('tap-notice')).toHaveAttribute('aria-hidden', 'true');
    await expect(page.getByTestId('tap-notice-live')).toHaveText('화면이 막 바뀌어서 방금 누른 것은 받지 않았어요.');
    // 같은 보호 구간에서 또 버려도 다시 띄우지 않는다(하나뿐이다).
    await page.touchscreen.tap(cell.x, cell.y);
    await expect(page.locator('.tap-notice')).toHaveCount(1);
    await expect(page.locator('[data-testid="tap-notice-live"]')).toHaveCount(1);
    // 누를 수 있는 요소를 가리지 않는 자리에 있고, 화면 구성을 밀지 않는다(고정 위치).
    const overlap = await page.evaluate(() => {
      const n = document.querySelector('.tap-notice')!.getBoundingClientRect();
      const hits: string[] = [];
      for (const el of Array.from(document.querySelectorAll('button, a[href], [role="radio"]'))) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.left < n.right && r.right > n.left && r.top < n.bottom && r.bottom > n.top) hits.push(el.textContent ?? '');
      }
      return { hits, position: getComputedStyle(document.querySelector('.tap-notice')!).position };
    });
    expect(overlap.hits).toEqual([]);
    expect(overlap.position).toBe('fixed');
    // 2초 뒤 사라진다.
    await expect(page.getByTestId('tap-notice')).toHaveCount(0, { timeout: 3000 });
    await expect(page.getByTestId('tap-notice-live')).toHaveCount(0);
  });

  test('대화상자가 열려 있으면 그 안에서 화면 낭독기에 전하고, 받아들인 누름이 오면 바로 닫는다', async ({ page }) => {
    // 기록 화면의 "이 기기의 기록 모두 지우기"를 두 번 누른다. 첫 누름에 삭제 확인 대화상자가 열리고,
    // 둘째 누름이 그 자리에 온 대화상자의 "그만두기" 위에 오게 기록 목록을 스크롤해 둔다.
    await openApp(page, '/');
    const sessions = Array.from({ length: 14 }, (_, i) => ({
      id: `s${i}`,
      examId: 'sample-a',
      createdAt: `2026-11-${String(10 + i).padStart(2, '0')}T10:00:00.000Z`,
      gradedBefore: 'not_yet',
      answers: {},
    }));
    await page.evaluate((d) => window.localStorage.setItem('score-anatomy', JSON.stringify(d)), { version: 1, sessions, currentId: null });
    // 주소의 # 뒤만 바꾸면 문서를 다시 읽지 않으므로 새로 고쳐서 넣은 기록을 읽게 한다.
    await page.reload();
    await openApp(page, '/history');
    await expect(page.getByTestId('history-item')).toHaveCount(14);
    const removeAll = page.getByTestId('history-remove-all');
    await removeAll.scrollIntoViewIfNeeded();
    await removeAll.click();
    const cancel = page.getByRole('alertdialog').getByRole('button', { name: '그만두기' });
    const cb = (await cancel.boundingBox())!;
    await cancel.click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    // "모두 지우기" 버튼이 "그만두기"와 같은 높이에 오도록 목록을 스크롤한다.
    let rb = (await removeAll.boundingBox())!;
    await page.locator('main.body').evaluate((el, dy) => {
      el.scrollTop += dy;
    }, rb.y + rb.height / 2 - (cb.y + cb.height / 2));
    rb = (await removeAll.boundingBox())!;
    const at: Point = { x: cb.x + cb.width / 2, y: rb.y + rb.height / 2 };
    expect(at.x).toBeGreaterThan(rb.x);
    expect(Math.abs(at.y - (cb.y + cb.height / 2)), '"모두 지우기"가 "그만두기"와 같은 높이에 와야 함').toBeLessThan(cb.height / 2 - 4);
    await page.waitForTimeout(600);
    await tapAtRhythm(page, [at, at], 120);
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await expect(page.getByTestId('tap-notice')).toBeVisible();
    // 화면 낭독기 알림 영역은 열린 대화상자 안에 둔다(대화상자 밖을 읽지 않는 화면 낭독기에도 전해지게).
    await expect(page.getByRole('alertdialog').getByTestId('tap-notice-live')).toHaveCount(1);
    await expect(page.getByRole('alertdialog').getByTestId('tap-notice-live')).toHaveText('화면이 막 바뀌어서 방금 누른 것은 받지 않았어요.');
    // 둘째 누름은 버렸으므로 대화상자는 그대로 열려 있고 기록도 그대로다.
    // 대화상자의 다른 자리를 누르면 받아들이고, 알림은 바로 닫힌다.
    await page.getByRole('alertdialog').getByRole('heading').click();
    await expect(page.getByTestId('tap-notice')).toHaveCount(0);
    await expect(page.getByTestId('tap-notice-live')).toHaveCount(0);
    await page.getByRole('alertdialog').getByRole('button', { name: '그만두기' }).click();
    await expect(page.getByTestId('history-item')).toHaveCount(14);
  });
});
