import type { Page } from '@playwright/test';
import { chooseExam, correctAnswers, expect, expectHash, loadExam, openApp, seedStore, test } from './helpers';

// 빠진 누름 채우기(작업 지시서 3-1의 3-1, src/tapGuard.ts).
// 아이폰의 웹뷰는 아주 빠른 두 번 누름에서 손뗌 두 번 뒤에 click(detail 2) 하나만 보내고 첫 click(detail 1)은 보내지 않는다.
// 그 click 하나만 온 경우의 끝 상태가 진짜 click 이 차례로 다 온 경우와 같은지 본다.
// 누름은 실제 순서대로 보낸다: 손뗌('r', 그 좌표에 pointerup)과 click(그 좌표의 맨 위 요소에 detail 을 정해 보냄).
// 진짜 click 이 다 오는 경우는 [손뗌, click 1, 손뗌, click 2], 첫 click 이 빠진 경우는 [손뗌, 손뗌, click 2]다.
// 한 번 보낼 때마다 page.evaluate 를 따로 불러서, 진짜 누름처럼 그 사이에 브라우저가 할 일(화면 그리기 등)을 할 틈을 둔다.

const exam = loadExam('a');
const all: Record<number, unknown> = correctAnswers(exam);

interface Pt {
  x: number;
  y: number;
}

/** 누름 열의 한 칸: 숫자는 그 detail 의 click, 'r' 는 손뗌. */
type Step = number | 'r';

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

/** 그 좌표에서 손을 뗀다(pointerup). from 을 주면 그 자리에서 누르기 시작한 것으로 한다(pointerdown). */
async function releaseAt(page: Page, p: Pt, from?: Pt): Promise<void> {
  await page.evaluate(
    ({ x, y, from }) => {
      const at = (px: number, py: number) => document.elementFromPoint(px, py) ?? document.body;
      const init = { bubbles: true, cancelable: true, composed: true, isPrimary: true, pointerId: 1, pointerType: 'touch', button: 0 };
      if (from) at(from.x, from.y).dispatchEvent(new PointerEvent('pointerdown', { ...init, clientX: from.x, clientY: from.y }));
      at(x, y).dispatchEvent(new PointerEvent('pointerup', { ...init, clientX: x, clientY: y }));
    },
    { x: p.x, y: p.y, from: from ?? null },
  );
}

/** 그 좌표에서 손을 뗀다(touchend 만, pointer 이벤트가 없는 브라우저를 흉내 낸다). */
async function touchEndAt(page: Page, p: Pt, id: number): Promise<void> {
  await page.evaluate(
    ({ x, y, id }) => {
      const el = document.elementFromPoint(x, y) ?? document.body;
      const touch = new Touch({ identifier: id, target: el, clientX: x, clientY: y });
      el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, composed: true, changedTouches: [touch], touches: [] }));
    },
    { x: p.x, y: p.y, id },
  );
}

async function play(page: Page, p: Pt, steps: Step[]): Promise<void> {
  for (const s of steps) {
    if (s === 'r') await releaseAt(page, p);
    else await clickAt(page, p, s);
  }
}

/**
 * 테스트가 보내지 않은 click(빠진 누름 채우기가 만들어 보낸 것)을 센다. 앱의 스크립트보다 먼저 붙인 window capture 듣기로 세서,
 * 보호가 버리는 채움도 센다(별도 검토 C12). 글자 요소가 바뀌어 지금 click 을 그 자리의 지금 요소로 다시 보낸 것도 여기에 들어간다
 * (그 click 의 detail 은 지금 click 과 같다).
 */
const counted = new WeakSet<Page>();
async function watchFills(page: Page): Promise<void> {
  if (counted.has(page)) return;
  counted.add(page);
  await page.addInitScript(() => {
    const w = window as Window & { __fills?: number[] };
    w.__fills = [];
    window.addEventListener(
      'click',
      (e) => {
        if (e.detail > 0 && !(e as MouseEvent & { __test?: boolean }).__test) w.__fills!.push(e.detail);
      },
      true,
    );
  });
}

/** 센 채움을 비운다(화면을 연 뒤, 누르기 직전에 부른다). */
async function countFills(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as Window & { __fills?: number[] }).__fills = [];
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
  await watchFills(page);
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

async function answersOf(page: Page): Promise<Record<string, unknown>> {
  return ((await snapshot(page)) as { answers: Record<string, unknown> }).answers;
}

interface Case {
  name: string;
  /** 기록을 넣고 그 화면을 연 뒤 누르기 직전까지 만든다. 누를 자리를 돌려준다. */
  setup: (page: Page) => Promise<Pt>;
  /** 끝 상태에서 따로 볼 것. */
  check?: (page: Page) => Promise<void>;
  /** 첫 click 이 빠진 경우에 테스트가 보내지 않은 click 의 detail(기본은 채운 detail 1 하나). */
  loneFills?: number[];
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
      expect(await answersOf(page)).toEqual({ 1: 3, 2: 3 });
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
      const a = await answersOf(page);
      expect([a[5], a[6]]).toEqual([2, 2]);
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
      expect((await answersOf(page))[21]).toBe(4);
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
      const a = await answersOf(page);
      expect(a[9]).toBe(5);
      expect(a[12]).toBeUndefined();
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
  {
    name: '아래 탭의 링크("기록", 앱이 링크를 직접 받아 화면을 바로 바꿈)',
    setup: async (page) => {
      await seedAndOpen(page, all, '/marks');
      return centerOf(page, 'a.tab[href="#/history"]');
    },
    check: async (page) => {
      await expectHash(page, '/history');
    },
  },
  {
    name: '표시 칸이 "찍음"일 때 "찍음" 글자 위(채운 누름으로 글자가 지워짐)',
    setup: async (page) => {
      await seedAndOpen(page, all, '/marks', { marks: { 3: 'guess' } });
      await expect(page.locator('[data-mark-cell="3"]')).toHaveAttribute('data-mark', 'guess');
      return centerOf(page, '[data-mark-cell="3"] .mark-cell__tag');
    },
    check: async (page) => {
      // 찍음에서 두 번 누르면 표시 없음을 거쳐 고민이 된다.
      await expect(page.locator('[data-mark-cell="3"]')).toHaveAttribute('data-mark', 'doubt');
    },
  },
  {
    name: '단답형 칸이 켜져 있을 때 "자신 없음" 글자 위(채운 누름으로 글자 요소가 빠짐)',
    setup: async (page) => {
      await seedAndOpen(page, all, '/marks', { marks: { 24: 'unsure' } });
      await page.locator('[data-short-mark="24"]').scrollIntoViewIfNeeded();
      await page.waitForTimeout(100);
      await expect(page.locator('[data-short-mark="24"]')).toHaveAttribute('aria-pressed', 'true');
      return centerOf(page, '[data-short-mark="24"] small');
    },
    check: async (page) => {
      // 켜짐에서 두 번 누르면 꺼졌다가 다시 켜진다.
      await expect(page.locator('[data-short-mark="24"]')).toHaveAttribute('aria-pressed', 'true');
    },
    // 채운 click(detail 1)으로 누른 글자 요소가 빠져서, 지금 click(detail 2)을 그 자리의 지금 요소로 다시 보낸다.
    loneFills: [1, 2],
  },
];

/** 누름 열을 보내고 막기가 풀릴 때까지 기다린 뒤 끝 상태를 읽는다. */
async function runSequence(page: Page, c: Case, steps: Step[]): Promise<{ state: unknown; filled: number[] }> {
  const p = await c.setup(page);
  await countFills(page);
  await play(page, p, steps);
  // 버린 누름 알림은 2초 동안 남으므로 그 안에 읽는다. 막기(0.5초)는 끝난 뒤다.
  await page.waitForTimeout(700);
  if (c.check) await c.check(page);
  return { state: await snapshot(page), filled: await fills(page) };
}

test.describe('빠진 누름 채우기: click(detail 2) 하나만 온 것과 click(detail 1, 2)가 다 온 것의 끝 상태가 같다', () => {
  for (const c of CASES) {
    test(c.name, async ({ page }) => {
      // 같은 페이지에서 차례로 돌린다. 열 때마다 기록을 새로 넣고 다시 읽으므로 앞 차례의 상태(보호, 알림, 기록)가 남지 않는다.
      const full = await runSequence(page, c, ['r', 1, 'r', 2]);
      const lone = await runSequence(page, c, ['r', 'r', 2]);
      expect(full.filled, '진짜 click 이 다 오면 채우지 않는다').toEqual([]);
      expect(lone.filled, '손뗌 둘 뒤에 detail 2 하나만 오면 detail 1 하나를 채운다').toEqual(c.loneFills ?? [1]);
      expect(lone.state).toEqual(full.state);
    });
  }
});

test.describe('빠진 누름 채우기: 세 번 누름', () => {
  const markCase = CASES[0]!;
  test('표시 칸: click(detail 3) 하나만, click(detail 1, 3)만 온 것이 세 번 다 온 것과 같다(표시 없음으로 돌아온다)', async ({ page }) => {
    const noCheck = { ...markCase, check: undefined };
    const all3 = await runSequence(page, noCheck, ['r', 1, 'r', 2, 'r', 3]);
    await expect(page.locator('[data-mark-cell="3"]')).toHaveAttribute('data-mark', 'none');
    const only3 = await runSequence(page, noCheck, ['r', 'r', 'r', 3]);
    const oneThree = await runSequence(page, noCheck, ['r', 1, 'r', 'r', 3]);
    expect(all3.filled).toEqual([]);
    expect(only3.filled).toEqual([1, 2]);
    expect(oneThree.filled).toEqual([2]);
    expect(only3.state).toEqual(all3.state);
    expect(oneThree.state).toEqual(all3.state);
  });
});

test.describe('빠진 누름 채우기: detail 3 하나만 온 경우 둘째 채움부터는 앞 채움이 바꾼 화면을 본다', () => {
  for (const c of [CASES.find((x) => x.name.startsWith('표시 화면의 채점 버튼'))!, CASES.find((x) => x.name.startsWith('바텀시트를 여는 버튼'))!]) {
    test(`${c.name}: 세 번 다 온 것과 detail 3 하나만 온 것이 같다`, async ({ page }) => {
      const all3 = await runSequence(page, c, ['r', 1, 'r', 2, 'r', 3]);
      const only3 = await runSequence(page, c, ['r', 'r', 'r', 3]);
      expect(all3.filled).toEqual([]);
      // 첫 채움이 화면을 바꾸고 그 자리를 막아서, 둘째 채움은 진짜 누름처럼 보호가 버린다(채움으로는 센다).
      expect(only3.filled).toEqual([1, 2]);
      expect(only3.state).toEqual(all3.state);
    });
  }
});

test.describe('빠진 누름 채우기: 채우는 경우와 채우지 않는 경우', () => {
  test('보호가 click(detail 1)을 버린 뒤에 온 click(detail 2)에서는 채우는 것이 0개다', async ({ page }) => {
    await seedAndOpen(page, all, '/review');
    await countFills(page);
    const cell = await centerOf(page, '[data-cell="2"]');
    // 칸을 눌러 시트를 연다. 화면이 바뀌어 그 자리를 0.5초 막는다.
    await play(page, cell, ['r', 1]);
    await expect(page.locator('[aria-modal="true"]')).toHaveCount(1);
    // 같은 자리의 새 누름 묶음: detail 1 은 보호가 버리고, 이어 온 detail 2 는 버린 click 을 받은 것으로 세어 채우지 않는다.
    // 채움은 보호보다 먼저 세므로, 채웠다가 보호가 버린 경우도 여기에 잡힌다.
    await play(page, cell, ['r', 1, 'r', 2]);
    expect(await fills(page)).toEqual([]);
    // 둘 다 버려져 시트는 그대로 열려 있고 시트 안의 다른 것도 바뀌지 않는다.
    await expect(page.locator('[aria-modal="true"]')).toHaveCount(1);
    expect((await answersOf(page))[2]).toBe(all[2]);
  });

  test('다른 자리에서 이어진 click 과 한참 지난 뒤의 click 은 채우지 않는다', async ({ page }) => {
    await seedAndOpen(page, {}, '/input?input=keypad');
    await countFills(page);
    const k1 = await centerOf(page, '[data-key="1"]');
    const k2 = await centerOf(page, '[data-key="2"]');
    // 다른 자리(다른 키)를 이어 누른 것: 각각 한 번씩만 들어간다.
    await play(page, k1, ['r', 1]);
    await play(page, k2, ['r', 1]);
    // 같은 자리를 한참(1.5초) 지난 뒤에 누른 것: 한 번만 들어간다.
    await page.waitForTimeout(1500);
    await play(page, k2, ['r', 1]);
    expect(await fills(page)).toEqual([]);
    await expect(page.getByTestId('now-no')).toHaveText('4번');
    expect(await answersOf(page)).toEqual({ 1: 1, 2: 2, 3: 2 });
  });

  test('진짜 click 이 다 오는 브라우저의 두 번 누름(같은 요소 안에서 조금 옮겨 누름)은 채우지 않는다', async ({ page }) => {
    await seedAndOpen(page, {}, '/input?input=keypad');
    await countFills(page);
    const box = (await page.locator('[data-key="3"]').boundingBox())!;
    // 같은 키의 왼쪽 끝과 오른쪽 끝(보호의 거리 24px 보다 멀다)을 detail 1, 2 로 누른다.
    await play(page, { x: box.x + 4, y: box.y + box.height / 2 }, ['r', 1]);
    await play(page, { x: box.x + box.width - 4, y: box.y + box.height / 2 }, ['r', 2]);
    expect(await fills(page)).toEqual([]);
    expect(await answersOf(page)).toEqual({ 1: 3, 2: 3 });
  });

  test('안드로이드 크롬처럼 다른 키를 빠르게 이어 눌러 detail 이 오른 click 은 채우지 않는다(키마다 손뗌이 하나씩)', async ({ page }) => {
    await seedAndOpen(page, {}, '/input?input=keypad');
    await countFills(page);
    // 안드로이드 크롬은 0.3초 안에 약 100dp 안을 다시 누르면 요소가 달라도 detail 을 1, 2, 3 으로 올린다(별도 검토 F1).
    await play(page, await centerOf(page, '[data-key="3"]'), ['r', 1]);
    await play(page, await centerOf(page, '[data-key="4"]'), ['r', 2]);
    await play(page, await centerOf(page, '[data-key="5"]'), ['r', 3]);
    expect(await fills(page)).toEqual([]);
    expect(await answersOf(page)).toEqual({ 1: 3, 2: 4, 3: 5 });
  });

  test('윈도우의 Chromium 처럼 detail 이 3에서 멈춰도 채우지 않는다(같은 자리를 네 번 누름)', async ({ page }) => {
    await seedAndOpen(page, {}, '/input?input=keypad');
    await countFills(page);
    // 윈도우, 리눅스, ChromeOS 의 Chromium 은 detail 을 3까지만 올린다(1, 2, 3, 3, 별도 검토 F2).
    await play(page, await centerOf(page, '[data-key="3"]'), ['r', 1, 'r', 2, 'r', 3, 'r', 3]);
    expect(await fills(page)).toEqual([]);
    expect(await answersOf(page)).toEqual({ 1: 3, 2: 3, 3: 3, 4: 3 });
  });

  test('한 번 누른 뒤 1초 안에 아주 빠르게 두 번 누른 것(뒤의 첫 click 이 빠짐)은 하나를 채운다', async ({ page }) => {
    await seedAndOpen(page, {}, '/input?input=keypad');
    await countFills(page);
    const k = await centerOf(page, '[data-key="3"]');
    // 아이폰은 보통 누름을 detail 1, 두 번 누름 인식을 detail 2 로 보낸다(별도 검토 F4). 앞의 detail 1 은 다른 누름 묶음이다.
    await play(page, k, ['r', 1]);
    await page.waitForTimeout(300);
    await play(page, k, ['r', 'r', 2]);
    expect(await fills(page)).toEqual([1]);
    expect(await answersOf(page)).toEqual({ 1: 3, 2: 3, 3: 3 });
  });

  test('끌기(누른 자리에서 16px 넘게 움직인 손뗌), 다른 자리의 손뗌, 1초가 지난 손뗌은 세지 않는다', async ({ page }) => {
    const cases: { name: string; before: (page: Page, k: Pt) => Promise<void> }[] = [
      { name: '끌기', before: (page, k) => releaseAt(page, k, { x: k.x, y: k.y - 20 }) },
      { name: '다른 자리', before: async (page) => releaseAt(page, await centerOf(page, '[data-key="5"]')) },
      {
        name: '1초가 지남',
        before: async (page, k) => {
          await releaseAt(page, k);
          await page.waitForTimeout(1100);
        },
      },
    ];
    for (const c of cases) {
      await seedAndOpen(page, {}, '/input?input=keypad');
      await countFills(page);
      const k = await centerOf(page, '[data-key="1"]');
      await c.before(page, k);
      await play(page, k, ['r', 2]);
      expect(await fills(page), c.name).toEqual([]);
      expect(await answersOf(page), c.name).toEqual({ 1: 1 });
    }
  });

  test('pointer 이벤트 없이 touchend 만 오는 브라우저에서도 손뗌을 센다', async ({ page }) => {
    await seedAndOpen(page, {}, '/input?input=keypad');
    await countFills(page);
    const k = await centerOf(page, '[data-key="2"]');
    await touchEndAt(page, k, 1);
    await touchEndAt(page, k, 2);
    await clickAt(page, k, 2);
    expect(await fills(page)).toEqual([1]);
    expect(await answersOf(page)).toEqual({ 1: 2, 2: 2 });
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
    expect(await answersOf(page)).toEqual({ 1: 4, 2: 4 });
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
  // 첫 click 이 빠진 아주 빠른 두 번 누름을 두 번 한다: 채운 누름 2번.
  await play(page, key, ['r', 'r', 2]);
  await page.waitForTimeout(1200);
  await play(page, key, ['r', 'r', 2]);
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
