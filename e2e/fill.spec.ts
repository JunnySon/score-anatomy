import type { Page } from '@playwright/test';
import { chooseExam, correctAnswers, expect, expectHash, loadExam, openApp, seedStore, test } from './helpers';

// 빠진 누름 채우기(작업 지시서 3-1의 3-1, src/tapGuard.ts).
// 아이폰의 웹뷰는 아주 빠른 두 번 누름에서 첫 click(detail 1)을 보내지 않고 click(detail 2) 하나만 보낸다.
// 그 click 하나만 온 경우의 끝 상태가 진짜 click 이 차례로 다 온 경우와 같은지 본다.
// click 은 그 좌표의 맨 위 요소에 detail 을 정해 보낸다(손가락이 누른 것과 같은 요소). 한 click 을 보낼 때마다
// page.evaluate 를 따로 불러서, 진짜 누름처럼 click 사이에 브라우저가 할 일(화면 그리기 등)을 할 틈을 둔다.

const exam = loadExam('a');
const all: Record<number, unknown> = correctAnswers(exam);

interface Pt {
  x: number;
  y: number;
}

async function centerOf(page: Page, selector: string): Promise<Pt> {
  const box = (await page.locator(selector).first().boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** 그 좌표의 맨 위 요소에 click 하나를 보낸다. 테스트가 보낸 click 에는 표시(__test)를 붙인다. */
async function clickAt(page: Page, p: Pt, detail: number): Promise<void> {
  await page.evaluate(
    ({ x, y, detail }) => {
      const el = document.elementFromPoint(x, y);
      if (!el) throw new Error('누를 요소가 없어요');
      const ev = new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, view: window, detail, clientX: x, clientY: y });
      (ev as MouseEvent & { __test?: boolean }).__test = true;
      el.dispatchEvent(ev);
    },
    { x: p.x, y: p.y, detail },
  );
}

/** 테스트가 보내지 않은 click(빠진 누름 채우기가 만들어 보낸 것)을 센다. */
async function countFills(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as Window & { __fills?: number[] };
    w.__fills = [];
    document.addEventListener(
      'click',
      (e) => {
        if (e.detail > 0 && !(e as MouseEvent & { __test?: boolean }).__test) w.__fills!.push(e.detail);
      },
      true,
    );
  });
}

async function fills(page: Page): Promise<number[]> {
  return page.evaluate(() => (window as Window & { __fills?: number[] }).__fills ?? []);
}

/** 끝 상태: 주소, 기록의 답과 표시와 채점 여부, 화면 글자, 누름 상태 속성, 열린 층, 버린 누름 알림. */
async function snapshot(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    const data = JSON.parse(window.localStorage.getItem('score-anatomy') ?? '{}');
    const s = (data.sessions ?? []).find((x: { id: string }) => x.id === data.currentId) ?? null;
    const attrs = Array.from(document.querySelectorAll('[aria-pressed], [data-mark], [aria-disabled], [aria-checked], [aria-current]')).map((el) =>
      ['aria-pressed', 'data-mark', 'aria-disabled', 'aria-checked', 'aria-current'].map((a) => el.getAttribute(a)).join('|'),
    );
    return {
      hash: window.location.hash,
      answers: s?.answers ?? null,
      marks: s?.marks ?? null,
      graded: s ? s.gradedAt !== null && s.gradedAt !== undefined : null,
      text: (document.querySelector('.app') as HTMLElement | null)?.innerText.replace(/\s+/g, ' ') ?? '',
      attrs,
      modal: document.querySelectorAll('[aria-modal="true"]').length,
      notice: document.querySelector('[data-testid="tap-notice"]') !== null,
    };
  });
}

/** 기록을 넣고 화면을 연다. */
async function seedAndOpen(page: Page, answers: Record<number, unknown>, hash: string, extra: Record<string, unknown> = {}): Promise<void> {
  await openApp(page, '/');
  await seedStore(page, {
    version: 1,
    sessions: [{ id: 's1', examId: 'sample-a', createdAt: '2026-11-22T10:00:00.000Z', gradedBefore: 'not_yet', seenBefore: 'first', answers, ...extra }],
    currentId: 's1',
  });
  await page.reload();
  await openApp(page, hash);
  // 화면이 처음 그려진 때의 막기가 끝나기를 기다린다.
  await page.waitForTimeout(600);
}

interface Case {
  name: string;
  /** 기록을 넣고 그 화면을 연 뒤 누르기 직전까지 만든다. 누를 자리를 돌려준다. */
  setup: (page: Page) => Promise<Pt>;
  /** 끝 상태에서 따로 볼 것. */
  check?: (page: Page) => Promise<void>;
}

const firstAnswers = (n: number) => Object.fromEntries(exam.items.slice(0, n).map((it) => [it.no, all[it.no]!]));
const allBut = (no: number) => Object.fromEntries(exam.items.filter((it) => it.no !== no).map((it) => [it.no, all[it.no]!]));

const CASES: Case[] = [
  {
    name: '표시 화면의 5지선다 칸(둘 다 "찍음")',
    setup: async (page) => {
      await seedAndOpen(page, all, '/marks');
      return centerOf(page, '[data-mark-cell="3"]');
    },
    check: async (page) => {
      await expect(page.locator('[data-mark-cell="3"]')).toHaveAttribute('data-mark', 'guess');
    },
  },
  {
    name: '표시 화면의 단답형 "자신 없음"',
    setup: async (page) => {
      await seedAndOpen(page, all, '/marks');
      await page.locator('[data-short-mark="24"]').scrollIntoViewIfNeeded();
      await page.waitForTimeout(100);
      return centerOf(page, '[data-short-mark="24"]');
    },
    check: async (page) => {
      await expect(page.locator('[data-short-mark="24"]')).toHaveAttribute('aria-pressed', 'false');
    },
  },
  {
    name: '키패드의 답 키: 이어진 두 문항이 빈칸이고 같은 묶음 안',
    setup: async (page) => {
      await seedAndOpen(page, {}, '/input?input=keypad');
      await expect(page.getByTestId('now-no')).toHaveText('1번');
      return centerOf(page, '[data-key="3"]');
    },
    check: async (page) => {
      await expect(page.getByTestId('now-no')).toHaveText('3번');
      const s = await snapshot(page);
      expect((s as { answers: Record<string, number> }).answers).toEqual({ 1: 3, 2: 3 });
    },
  },
  {
    name: '키패드의 답 키: 다음 문항이 다음 묶음',
    setup: async (page) => {
      await seedAndOpen(page, firstAnswers(4), '/input?input=keypad');
      await expect(page.getByTestId('now-no')).toHaveText('5번');
      return centerOf(page, '[data-key="2"]');
    },
    check: async (page) => {
      await expect(page.getByTestId('now-no')).toHaveText('7번');
      const s = (await snapshot(page)) as { answers: Record<string, number> };
      expect([s.answers[5], s.answers[6]]).toEqual([2, 2]);
    },
  },
  {
    name: '키패드의 답 키: 마지막 문항(입력 확인으로 넘어가고 넘어간 화면의 버튼은 눌리지 않는다)',
    setup: async (page) => {
      await seedAndOpen(page, allBut(21), '/input?input=keypad');
      await expect(page.getByTestId('now-no')).toHaveText('21번');
      return centerOf(page, '[data-key="4"]');
    },
    check: async (page) => {
      await expectHash(page, '/review');
      await expect(page.locator('[aria-modal="true"]')).toHaveCount(0);
      const s = (await snapshot(page)) as { answers: Record<string, number> };
      expect(s.answers[21]).toBe(4);
    },
  },
  {
    name: '키패드가 잠긴 상태의 답 키(아무것도 들어가지 않는다)',
    setup: async (page) => {
      await seedAndOpen(page, firstAnswers(11), '/input?input=keypad');
      await expect(page.getByTestId('now-no')).toHaveText('12번');
      await page.locator('[data-cell="9"]').click();
      await page.waitForTimeout(600);
      await page.locator('[data-key="5"]').click();
      await expect(page.getByTestId('pad-panel')).toHaveAttribute('data-lock', /.+/);
      await expect(page.getByTestId('pad-panel')).not.toHaveAttribute('data-lock', 'none');
      await page.waitForTimeout(600);
      return centerOf(page, '[data-key="1"]');
    },
    check: async (page) => {
      const s = (await snapshot(page)) as { answers: Record<string, number> };
      expect(s.answers[9]).toBe(5);
      expect(s.answers[12]).toBeUndefined();
      await expect(page.getByTestId('now-no')).toHaveText('9번');
    },
  },
  {
    name: '단답형 숫자 키(두 자리가 들어간다)',
    setup: async (page) => {
      await seedAndOpen(page, firstAnswers(21), '/input?input=keypad');
      await expect(page.getByTestId('now-no')).toHaveText('22번');
      return centerOf(page, '[data-key="7"]');
    },
    check: async (page) => {
      await expect(page.getByTestId('entry')).toContainText('77');
    },
  },
  {
    name: '표시 화면의 채점 버튼(채점은 한 번, 넘어간 화면의 요소는 눌리지 않는다)',
    setup: async (page) => {
      await seedAndOpen(page, all, '/marks');
      return centerOf(page, '[data-testid="grade"]');
    },
    check: async (page) => {
      await expectHash(page, '/score');
      const s = (await snapshot(page)) as { graded: boolean };
      expect(s.graded).toBe(true);
    },
  },
  {
    name: '바텀시트를 여는 버튼(입력 확인의 칸)',
    setup: async (page) => {
      await seedAndOpen(page, all, '/review');
      return centerOf(page, '[data-cell="2"]');
    },
    check: async (page) => {
      await expect(page.locator('[aria-modal="true"]')).toHaveCount(1);
    },
  },
  {
    name: '바텀시트를 닫는 버튼',
    setup: async (page) => {
      await seedAndOpen(page, all, '/review');
      await page.locator('[data-cell="2"]').click();
      await expect(page.locator('[aria-modal="true"]')).toHaveCount(1);
      await page.waitForTimeout(600);
      return centerOf(page, '[aria-modal="true"] button[aria-label="닫기"]');
    },
    check: async (page) => {
      await expect(page.locator('[aria-modal="true"]')).toHaveCount(0);
    },
  },
];

/** 누름 열을 보내고 막기가 풀릴 때까지 기다린 뒤 끝 상태를 읽는다. */
async function runSequence(page: Page, c: Case, details: number[]): Promise<{ state: unknown; filled: number[] }> {
  const p = await c.setup(page);
  await countFills(page);
  for (const d of details) await clickAt(page, p, d);
  // 버린 누름 알림은 2초 동안 남으므로 그 안에 읽는다. 막기(0.5초)는 끝난 뒤다.
  await page.waitForTimeout(700);
  if (c.check) await c.check(page);
  return { state: await snapshot(page), filled: await fills(page) };
}

test.describe('빠진 누름 채우기: click(detail 2) 하나만 온 것과 click(detail 1, 2)가 다 온 것의 끝 상태가 같다', () => {
  for (const c of CASES) {
    test(c.name, async ({ browser }) => {
      const full = await browser.newPage();
      const lone = await browser.newPage();
      try {
        const a = await runSequence(full, c, [1, 2]);
        const b = await runSequence(lone, c, [2]);
        expect(a.filled, '진짜 click 이 다 오면 채우지 않는다').toEqual([]);
        expect(b.filled, 'detail 2 하나만 오면 detail 1 하나를 채운다').toEqual([1]);
        expect(b.state).toEqual(a.state);
      } finally {
        await full.close();
        await lone.close();
      }
    });
  }
});

test.describe('빠진 누름 채우기: 세 번 누름', () => {
  const markCase = CASES[0]!;
  test('표시 칸: click(detail 3) 하나만, click(detail 1, 3)만 온 것이 세 번 다 온 것과 같다(표시 없음으로 돌아온다)', async ({ browser }) => {
    const pages = await Promise.all([browser.newPage(), browser.newPage(), browser.newPage()]);
    try {
      const noCheck = { ...markCase, check: undefined };
      const all3 = await runSequence(pages[0]!, noCheck, [1, 2, 3]);
      const only3 = await runSequence(pages[1]!, noCheck, [3]);
      const oneThree = await runSequence(pages[2]!, noCheck, [1, 3]);
      await expect(pages[0]!.locator('[data-mark-cell="3"]')).toHaveAttribute('data-mark', 'none');
      expect(all3.filled).toEqual([]);
      expect(only3.filled).toEqual([1, 2]);
      expect(oneThree.filled).toEqual([2]);
      expect(only3.state).toEqual(all3.state);
      expect(oneThree.state).toEqual(all3.state);
    } finally {
      await Promise.all(pages.map((p) => p.close()));
    }
  });
});

test.describe('빠진 누름 채우기: 채우지 않는 경우', () => {
  test('보호가 click(detail 1)을 버린 뒤에 온 click(detail 2)에서는 채우는 것이 0개다', async ({ page }) => {
    await seedAndOpen(page, all, '/review');
    await countFills(page);
    const cell = await centerOf(page, '[data-cell="2"]');
    // 칸을 눌러 시트를 연다. 화면이 바뀌어 그 자리를 0.5초 막는다.
    await clickAt(page, cell, 1);
    await expect(page.locator('[aria-modal="true"]')).toHaveCount(1);
    // 같은 자리의 새 누름 묶음: detail 1 은 보호가 버리고, 이어 온 detail 2 는 버린 것을 앞 누름으로 보고 채우지 않는다.
    await clickAt(page, cell, 1);
    await clickAt(page, cell, 2);
    expect(await fills(page)).toEqual([]);
    // 둘 다 버려져 시트는 그대로 열려 있고 시트 안의 다른 것도 바뀌지 않는다.
    await expect(page.locator('[aria-modal="true"]')).toHaveCount(1);
    const s = (await snapshot(page)) as { answers: Record<string, number> };
    expect(s.answers[2]).toBe(all[2]);
  });

  test('다른 자리에서 이어진 click 과 한참 지난 뒤의 click 은 채우지 않는다', async ({ page }) => {
    await seedAndOpen(page, {}, '/input?input=keypad');
    await countFills(page);
    const k1 = await centerOf(page, '[data-key="1"]');
    const k2 = await centerOf(page, '[data-key="2"]');
    // 다른 자리(다른 키)를 이어 누른 것: 각각 한 번씩만 들어간다.
    await clickAt(page, k1, 1);
    await clickAt(page, k2, 1);
    // 같은 자리를 한참(1.5초) 지난 뒤에 누른 것: 한 번만 들어간다.
    await page.waitForTimeout(1500);
    await clickAt(page, k2, 1);
    expect(await fills(page)).toEqual([]);
    await expect(page.getByTestId('now-no')).toHaveText('4번');
    const s = (await snapshot(page)) as { answers: Record<string, number> };
    expect(s.answers).toEqual({ 1: 1, 2: 2, 3: 2 });
  });

  test('진짜 click 이 다 오는 브라우저의 두 번 누름(같은 요소 안에서 조금 옮겨 누름)은 채우지 않는다', async ({ page }) => {
    await seedAndOpen(page, {}, '/input?input=keypad');
    await countFills(page);
    const box = (await page.locator('[data-key="3"]').boundingBox())!;
    // 같은 키의 왼쪽 끝과 오른쪽 끝(보호의 거리 24px 보다 멀다)을 detail 1, 2 로 누른다.
    await clickAt(page, { x: box.x + 4, y: box.y + box.height / 2 }, 1);
    await clickAt(page, { x: box.x + box.width - 4, y: box.y + box.height / 2 }, 2);
    expect(await fills(page)).toEqual([]);
    const s = (await snapshot(page)) as { answers: Record<string, number> };
    expect(s.answers).toEqual({ 1: 3, 2: 3 });
  });

  test('키보드로 낸 click 은 한 번에 한 번씩만 들어간다', async ({ page }) => {
    await seedAndOpen(page, {}, '/input?input=keypad');
    await countFills(page);
    await page.locator('[data-key="4"]').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('now-no')).toHaveText('2번');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('now-no')).toHaveText('3번');
    expect(await fills(page)).toEqual([]);
    const s = (await snapshot(page)) as { answers: Record<string, number> };
    expect(s.answers).toEqual({ 1: 4, 2: 4 });
  });
});

test('측정 중 채운 누름이 filled_taps 에 세어진다', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openApp(page, '/test');
  await page.getByLabel('참가자 코드').fill('P07');
  await page.getByTestId('mode-keypad').click();
  await page.getByTestId('start-run').click();
  await expectHash(page, '/');
  await page.getByRole('button', { name: '시험 고르기' }).click();
  await chooseExam(page, 'sample-a');
  await expect(page.getByTestId('now-no')).toHaveText('1번');
  await page.waitForTimeout(600);
  const key = await centerOf(page, '[data-key="2"]');
  // detail 2 하나만 온 아주 빠른 두 번 누름을 두 번 한다: 채운 누름 2번.
  await clickAt(page, key, 2);
  await page.waitForTimeout(1200);
  await clickAt(page, key, 2);
  await expect(page.getByTestId('now-no')).toHaveText('5번');
  await openApp(page, '/test');
  const card = page.locator('[data-testid="run-card"][data-participant="P07"]');
  await expect(card.getByTestId('m-filled')).toHaveText('2번');
  await expect(card.getByTestId('m-discarded')).toHaveText('0번');
  await page.getByTestId('copy-csv').click();
  await expect(page.getByText('복사했어요.')).toBeVisible();
  const csv = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n').trim().split('\n');
  const head = csv[0]!.split(',');
  const row = csv.find((l) => l.startsWith('P07,'))!.split(',');
  expect(row[head.indexOf('filled_taps')]).toBe('2');
  expect(row[head.indexOf('discarded_taps')]).toBe('0');
});
