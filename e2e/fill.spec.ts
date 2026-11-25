import type { Page } from '@playwright/test';
import { chooseExam, correctAnswers, expect, expectHash, loadExam, openApp, seedStore, test } from './helpers';

// 빠진 누름 채우기(작업 지시서 3-1의 3-1, src/tapGuard.ts).
// 아이폰의 웹뷰는 아주 빠른 두 번 누름에서 손뗌 두 번 뒤에 click(detail 2) 하나만 보내고 첫 click(detail 1)은 보내지 않는다.
// 그 click 하나만 온 경우의 끝 상태가 진짜 click 이 차례로 다 온 경우와 같은지 본다.
// 누름은 실제 순서대로 보낸다: 손뗌('r', 그 좌표에 pointerdown 과 pointerup)과 click(그 좌표의 맨 위 요소에 detail 을 정해 보냄).
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

/** 누름 하나의 손가락 움직임. pointer 이벤트로 보낸다(그 좌표의 맨 위 요소에). */
type PointerStep = { type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel'; at: Pt; id?: number; primary?: boolean };

async function pointerSteps(page: Page, steps: PointerStep[]): Promise<void> {
  await page.evaluate((list) => {
    for (const s of list) {
      const el = document.elementFromPoint(s.at.x, s.at.y) ?? document.body;
      el.dispatchEvent(
        new PointerEvent(s.type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          isPrimary: s.primary ?? true,
          pointerId: s.id ?? 1,
          pointerType: 'touch',
          button: 0,
          clientX: s.at.x,
          clientY: s.at.y,
        }),
      );
    }
  }, steps);
}

/** 그 좌표를 짧게 누르고 뗀다(pointerdown, pointerup). click 은 따로 보낸다. */
async function releaseAt(page: Page, p: Pt): Promise<void> {
  await pointerSteps(page, [
    { type: 'pointerdown', at: p },
    { type: 'pointerup', at: p },
  ]);
}

/** touch 이벤트로 누르고 뗀다(pointer 이벤트가 없는 브라우저를 흉내 낸다). 여러 손가락을 겹쳐 누를 수 있다. */
type TouchStep = { type: 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel'; at: Pt; id: number; others?: { at: Pt; id: number }[] };

async function touchSteps(page: Page, steps: TouchStep[]): Promise<void> {
  await page.evaluate((list) => {
    for (const s of list) {
      const el = document.elementFromPoint(s.at.x, s.at.y) ?? document.body;
      const touch = new Touch({ identifier: s.id, target: el, clientX: s.at.x, clientY: s.at.y });
      const others = (s.others ?? []).map((o) => new Touch({ identifier: o.id, target: el, clientX: o.at.x, clientY: o.at.y }));
      // touches 는 지금 눌려 있는 손가락이다(touchend 와 touchcancel 에서는 뗀 손가락을 뺀다).
      const touches = s.type === 'touchend' || s.type === 'touchcancel' ? others : [touch, ...others];
      el.dispatchEvent(new TouchEvent(s.type, { bubbles: true, cancelable: true, composed: true, changedTouches: [touch], touches }));
    }
  }, steps);
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
      // 글자의 가운데에서 10px 옆을 누른다. 채운 누름으로 글자가 비면 그 자리는 글자 요소 밖(버튼)이 된다(별도 검토 N11).
      const c = await centerOf(page, '[data-mark-cell="3"] .mark-cell__tag');
      return { x: c.x + 10, y: c.y };
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
  {
    name: '채점한 기록에서 처음 바꾸는 표시 칸의 위쪽(둘 다 "찍음", 안내 줄이 생겨도 칸 격자가 밀리지 않음)',
    setup: async (page) => {
      await seedAndOpen(page, all, '/marks', { gradedAt: '2026-11-22T10:05:00.000Z' });
      await expect(page.getByTestId('after-grading-note')).toHaveCount(0);
      // 8번 칸의 위 가장자리에서 10px 아래를 누른다. 첫 누름으로 안내 줄이 새로 생겨 격자가 내려가면, 진짜 click 이 다 오는 경우의
      // 둘째 누름은 윗줄의 3번 칸에 닿고 채운 경우의 지금 click 은 버려진다(별도 검토 C10).
      const box = (await page.locator('[data-mark-cell="8"]').boundingBox())!;
      return { x: box.x + box.width / 2, y: box.y + 10 };
    },
    check: async (page) => {
      await expect(page.locator('[data-mark-cell="8"]')).toHaveAttribute('data-mark', 'guess');
      await expect(page.getByTestId('after-grading-note')).toBeVisible();
      expect(((await snapshot(page)) as { marks: unknown }).marks).toEqual({ 8: 'guess' });
    },
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

  test('한 번 누른 뒤 0.3초 뒤에 아주 빠르게 두 번 누른 것(뒤의 첫 click 이 빠짐)은 하나를 채운다', async ({ page }) => {
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

  /**
   * 키패드 1번 키에서, 앞의 누름(before) 바로 뒤에 짧은 누름 하나와 click(detail 2) 하나가 온다. 앞의 누름을 빠진 누름으로 세면
   * 하나를 채워 두 번 들어가고, 세지 않으면 1번에 한 번만 들어간다. via 는 뒤의 짧은 누름을 보내는 이벤트(pointer 나 touch)다.
   * touch 로 보내는 경우에는 pointer 이벤트를 하나도 보내지 않아서 touch 쪽만 센다.
   */
  async function noFillAfter(page: Page, name: string, before: (page: Page, k: Pt) => Promise<void>, via: 'pointer' | 'touch' = 'pointer'): Promise<void> {
    await seedAndOpen(page, {}, '/input?input=keypad');
    await countFills(page);
    const k = await centerOf(page, '[data-key="1"]');
    await before(page, k);
    if (via === 'pointer') await releaseAt(page, k);
    else
      await touchSteps(page, [
        { type: 'touchstart', at: k, id: 9 },
        { type: 'touchend', at: k, id: 9 },
      ]);
    await clickAt(page, k, 2);
    expect(await fills(page), name).toEqual([]);
    expect(await answersOf(page), name).toEqual({ 1: 1 });
  }

  test('끌기나 취소로 끝난 누름은 세지 않는다(밀고 나서 같은 자리 누름, 움직여서 click 이 안 생긴 누름 뒤 다시 누름)', async ({ page }) => {
    const away = (k: Pt): Pt => ({ x: k.x, y: k.y - 40 });
    // 같은 자리에서 밀어 스크롤이 시작됨(pointercancel): 그 뒤 같은 자리를 누름.
    await noFillAfter(page, '밀고 나서 같은 자리 누름(취소)', (page, k) =>
      pointerSteps(page, [
        { type: 'pointerdown', at: k },
        { type: 'pointermove', at: away(k) },
        { type: 'pointercancel', at: away(k) },
      ]),
    );
    // 밀어서 다른 자리에서 뗌(click 이 생기지 않음): 그 뒤 같은 자리를 누름.
    await noFillAfter(page, '밀고 나서 같은 자리 누름(다른 자리에서 뗌)', (page, k) =>
      pointerSteps(page, [
        { type: 'pointerdown', at: k },
        { type: 'pointermove', at: away(k) },
        { type: 'pointerup', at: away(k) },
      ]),
    );
    // 움직였다가 제자리로 돌아와 뗌(click 이 생기지 않음): 누른 자리와 뗀 자리는 같지만 끌기다.
    await noFillAfter(page, '움직여서 click 이 안 생긴 누름 뒤 다시 누름', (page, k) =>
      pointerSteps(page, [
        { type: 'pointerdown', at: k },
        { type: 'pointermove', at: away(k) },
        { type: 'pointermove', at: k },
        { type: 'pointerup', at: k },
      ]),
    );
    // touch 이벤트만 오는 경우도 같다: 움직였다 돌아온 누름, 취소된 누름.
    await noFillAfter(page, 'touch: 움직였다 돌아온 누름', (page, k) =>
      touchSteps(page, [
        { type: 'touchstart', at: k, id: 1 },
        { type: 'touchmove', at: away(k), id: 1 },
        { type: 'touchmove', at: k, id: 1 },
        { type: 'touchend', at: k, id: 1 },
      ]),
      'touch',
    );
    await noFillAfter(
      page,
      'touch: 취소된 누름',
      (page, k) =>
        touchSteps(page, [
          { type: 'touchstart', at: k, id: 1 },
          { type: 'touchcancel', at: k, id: 1 },
        ]),
      'touch',
    );
  });

  test('길게 누른 손뗌은 세지 않는다(0.4초 넘게 누름, contextmenu 가 온 누름)', async ({ page }) => {
    // 길게 누름 시간을 짧게 둔 기기에서는 0.4초보다 짧아도 길게 누름이 되어 click 이 없다. 그때 오는 contextmenu 로 거른다(별도 검토 N1).
    await noFillAfter(page, 'contextmenu 가 온 누름', async (page, k) => {
      await pointerSteps(page, [{ type: 'pointerdown', at: k }]);
      await page.evaluate(({ x, y }) => {
        (document.elementFromPoint(x, y) ?? document.body).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
      }, k);
      await pointerSteps(page, [{ type: 'pointerup', at: k }]);
    });
    await noFillAfter(page, '길게 누름(pointer)', async (page, k) => {
      await pointerSteps(page, [{ type: 'pointerdown', at: k }]);
      await page.waitForTimeout(500);
      await pointerSteps(page, [{ type: 'pointerup', at: k }]);
    });
    await noFillAfter(
      page,
      '길게 누름(touch)',
      async (page, k) => {
        await touchSteps(page, [{ type: 'touchstart', at: k, id: 1 }]);
        await page.waitForTimeout(500);
        await touchSteps(page, [{ type: 'touchend', at: k, id: 1 }]);
      },
      'touch',
    );
  });

  test('두 손가락이 겹친 누름은 세지 않는다', async ({ page }) => {
    const second = (k: Pt): Pt => ({ x: k.x + 80, y: k.y });
    await noFillAfter(page, '두 손가락(pointer)', (page, k) =>
      pointerSteps(page, [
        { type: 'pointerdown', at: k, id: 1, primary: true },
        { type: 'pointerdown', at: second(k), id: 2, primary: false },
        { type: 'pointerup', at: second(k), id: 2, primary: false },
        { type: 'pointerup', at: k, id: 1, primary: true },
      ]),
    );
    await noFillAfter(page, '두 손가락(touch)', (page, k) =>
      touchSteps(page, [
        { type: 'touchstart', at: k, id: 1 },
        { type: 'touchstart', at: second(k), id: 2, others: [{ at: k, id: 1 }] },
        { type: 'touchend', at: second(k), id: 2, others: [{ at: k, id: 1 }] },
        { type: 'touchend', at: k, id: 1 },
      ]),
      'touch',
    );
  });

  test('이어진 손뗌 사이가 0.4초를 넘으면 빠진 누름으로 보지 않는다(0.3초면 채운다)', async ({ page }) => {
    // 앞 손뗌과 0.45초 떨어진 손뗌: 아이폰도 0.4초 간격이면 click 이 두 번 다 오므로 빠진 누름일 수 없다.
    await noFillAfter(page, '0.45초 떨어진 앞 손뗌', async (page, k) => {
      await releaseAt(page, k);
      await page.waitForTimeout(450);
    });
    // 이 click 자신의 손뗌이 0.45초 전이면(손뗌 두 번 뒤 한참 지나 click 이 옴) 애매하므로 채우지 않는다.
    await seedAndOpen(page, {}, '/input?input=keypad');
    await countFills(page);
    const k1 = await centerOf(page, '[data-key="1"]');
    await play(page, k1, ['r', 'r']);
    await page.waitForTimeout(450);
    await clickAt(page, k1, 2);
    expect(await fills(page), '자신의 손뗌이 0.45초 전').toEqual([]);
    expect(await answersOf(page)).toEqual({ 1: 1 });
    // 0.3초 떨어진 앞 손뗌은 한 묶음이다: 하나를 채운다.
    await seedAndOpen(page, {}, '/input?input=keypad');
    await countFills(page);
    const k2 = await centerOf(page, '[data-key="2"]');
    await releaseAt(page, k2);
    await page.waitForTimeout(300);
    await play(page, k2, ['r', 2]);
    expect(await fills(page), '0.3초 떨어진 앞 손뗌').toEqual([1]);
    expect(await answersOf(page)).toEqual({ 1: 2, 2: 2 });
  });

  test('애매하면 채우지 않는다(이어진 손뗌 가운데 다른 자리의 손뗌, pointer 와 touch 가 다르게 셈)', async ({ page }) => {
    await noFillAfter(page, '이어진 손뗌 가운데 다른 자리의 손뗌', async (page) => releaseAt(page, await centerOf(page, '[data-key="5"]')));
    // pointer 는 손뗌 둘(빠진 누름 하나)인데 touch 는 하나뿐이면 적은 쪽(빠진 누름 없음)을 쓴다.
    await seedAndOpen(page, {}, '/input?input=keypad');
    await countFills(page);
    const k = await centerOf(page, '[data-key="1"]');
    await releaseAt(page, k);
    await touchSteps(page, [
      { type: 'touchstart', at: k, id: 1 },
      { type: 'touchend', at: k, id: 1 },
    ]);
    await releaseAt(page, k);
    await clickAt(page, k, 2);
    expect(await fills(page), 'pointer 와 touch 가 다르게 셈').toEqual([]);
    expect(await answersOf(page)).toEqual({ 1: 1 });
  });

  test('스크롤이 움직이던 중에 시작한 누름(관성을 멈춘 누름)은 세지 않는다', async ({ page }) => {
    // 안드로이드 크롬은 스크롤 관성을 멈춘 누름의 click 을 보내지 않지만 그 누름을 탭으로 세어, 0.3초 안의 다음 누름이 detail 2 로 온다(별도 검토 N2).
    await noFillAfter(page, '스크롤 관성을 멈춘 누름', async (page, k) => {
      await page.evaluate(() => document.querySelector('main.body')!.dispatchEvent(new Event('scroll')));
      await releaseAt(page, k);
      await page.waitForTimeout(150);
    });
  });

  test('옆 요소 가장자리에서 뗀 손뗌은 지금 click 의 누름 묶음으로 세지 않는다(24px 안이어도)', async ({ page }) => {
    await seedAndOpen(page, {}, '/input?input=keypad');
    await countFills(page);
    const b3 = (await page.locator('[data-key="3"]').boundingBox())!;
    const b4 = (await page.locator('[data-key="4"]').boundingBox())!;
    const p3 = { x: b3.x + b3.width - 3, y: b3.y + b3.height / 2 };
    const p4 = { x: b4.x + 3, y: b4.y + b4.height / 2 };
    expect(Math.abs(p4.x - p3.x)).toBeLessThanOrEqual(24);
    // 3번 키 오른쪽 끝을 누르고 몇 ms 뒤 4번 키 왼쪽 끝을 눌렀는데 click 은 4번 키의 detail 2 하나만 왔다(별도 검토 N4).
    // 빠진 누름은 3번 키의 것이라 4번 키로 채우면 틀린 답이 들어간다. 채우지 않는다.
    await releaseAt(page, p3);
    await play(page, p4, ['r', 2]);
    expect(await fills(page)).toEqual([]);
    expect(await answersOf(page)).toEqual({ 1: 4 });
  });

  test('손뗌 사이에 막기가 끝나도, 채운 click 은 그 손뗌 시각에 걸려 있던 막기로 판정한다', async ({ page }) => {
    // 칸을 눌러 시트를 연 뒤(그 자리를 0.5초 막음) 0.4초쯤에 같은 자리를 아주 빠르게 두 번 누른다. 첫 손뗌은 막는 중이고,
    // 둘째 손뗌과 click 은 막기 타이머가 끝난 뒤다(별도 검토 N3, N6). 진짜 click 이 다 오면 둘 다 버려져 시트가 그대로 열려 있다.
    const run = async (lost: boolean) => {
      await seedAndOpen(page, all, '/review');
      await countFills(page);
      const cell = await centerOf(page, '[data-cell="2"]');
      await play(page, cell, ['r', 1]);
      await expect(page.locator('[aria-modal="true"]')).toHaveCount(1);
      await page.waitForTimeout(400);
      if (lost) await releaseAt(page, cell);
      else await play(page, cell, ['r', 1]);
      await page.waitForTimeout(150);
      await play(page, cell, ['r', 2]);
      await page.waitForTimeout(700);
      return { state: await snapshot(page), filled: await fills(page) };
    };
    const full = await run(false);
    const lone = await run(true);
    expect(full.filled).toEqual([]);
    expect(lone.filled).toEqual([1]);
    expect((lone.state as { modal: number }).modal).toBe(1);
    expect(lone.state).toEqual(full.state);
  });

  test('채우는 수는 많아도 detail - 1 개다(손뗌이 그보다 많아도)', async ({ page }) => {
    await seedAndOpen(page, {}, '/input?input=keypad');
    await countFills(page);
    const k = await centerOf(page, '[data-key="2"]');
    await play(page, k, ['r', 'r', 'r', 2]);
    expect(await fills(page)).toEqual([1]);
    expect(await answersOf(page)).toEqual({ 1: 2, 2: 2 });
  });

  test('pointer 이벤트 없이 touch 이벤트만 오는 브라우저에서도 손뗌을 센다', async ({ page }) => {
    await seedAndOpen(page, {}, '/input?input=keypad');
    await countFills(page);
    const k = await centerOf(page, '[data-key="2"]');
    await touchSteps(page, [
      { type: 'touchstart', at: k, id: 1 },
      { type: 'touchend', at: k, id: 1 },
      { type: 'touchstart', at: k, id: 2 },
      { type: 'touchend', at: k, id: 2 },
    ]);
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

// ---------------------------------------------------------------------------------------------------------------
// 누르는 동안 온 dblclick 으로 채우기(작업 지시서 4의 2-2, src/tapGuard.ts 의 FILL_HELD_DBLCLICK).
// 아이폰 시뮬레이터에서 잰 이벤트 열(docs/ios_검증결과.md 의 "웹이 받은 이벤트", docs/ios_진행기록.md)을 그대로 흉내 낸다.
// - iOS 18.4 의 사라지는 둘째 누름: pointerdown, touchstart, pointerup, touchend, click 1, pointerdown, touchstart, dblclick 2, pointerup, touchend
// - iOS 26.4 의 보통 두 번 누름: ..., click 1, pointerdown, touchstart, pointerup, touchend, click 2, dblclick 2
// - iOS 26.4 의 아주 빠른 두 번 누름: 누름, 손뗌, 누름, 손뗌 뒤에 click 2, dblclick 2
// - 세 번 빠르게 누름(iOS 26.4 와 18.4 가 같음): 누름, 손뗌, 누름, 손뗌, click 2, dblclick 2, 누름, 손뗌, click 1
// 누름 하나는 pointer 이벤트와 touch 이벤트를 함께 보낸다(아이폰 웹뷰와 같음). Touch 를 만들 수 없는 브라우저(이 PC 의 WebKit)에서는
// touch 이벤트를 빼고 pointer 이벤트만 보낸다.

/** 누르는 동안 온 dblclick 을 기다리는 시간(src/tapGuard.ts 의 HELD_WAIT_MS)보다 넉넉히 기다리는 시간(ms). */
const AFTER_HELD_WAIT = 250;

interface PressOptions {
  /** 누르는 동안(손을 떼기 전) 보낼 dblclick 의 detail. */
  dbl?: number;
  /** 누른 채 기다리는 시간(ms, 길게 누름). */
  holdMs?: number;
  /** 손을 떼기 전에 옮겨 갈 자리(끌기). */
  to?: Pt;
  /** 손을 떼기 전에 이 자리까지 끌었다가 누른 자리로 돌아온다(돌아와서 떼도 끌기다). */
  via?: Pt;
  /** 손을 떼기 전에 contextmenu 를 보낸다(길게 누름이 알려짐). */
  contextmenu?: boolean;
  /** 마우스로 누른다(데스크톱). touch 이벤트를 보내지 않는다. */
  mouse?: boolean;
  /** 손을 뗀 바로 뒤(같은 차례 안)에 보낼 click 의 detail. */
  thenClick?: number;
  /**
   * 손을 뗀 바로 뒤(같은 차례 안, 웹의 기다림 타이머가 돌기 전)에 이어서 누를 누름 하나와 그 click 의 detail.
   * 테스트 도구의 호출 사이 시간에 기대지 않고 "기다리는 동안"을 만든다.
   */
  next?: { at: Pt; click?: number };
  /** 손을 뗀 바로 뒤(next 가 있으면 그 뒤, 같은 차례 안)에 차례로 보낼 click 들의 detail. */
  clicks?: number[];
  /** 손을 뗀 바로 뒤(같은 차례 안)의 기록의 답을 돌려준다(웹의 기다림 타이머가 돌기 전의 상태). */
  readAnswers?: boolean;
  /** 누르기 시작만(down) 보내거나 손뗌만(up) 보낸다. 없으면 둘 다 보낸다. */
  phase?: 'down' | 'up';
}

/**
 * 아이폰 웹뷰가 보내는 차례대로 누름 하나를 보낸다: pointerdown, touchstart, (dblclick), pointerup, touchend, (click).
 * readAnswers 면 손을 뗀 바로 뒤의 기록의 답을 돌려준다.
 */
async function iosPress(page: Page, p: Pt, o: PressOptions = {}): Promise<Record<string, unknown> | null> {
  const send = async (phase: 'down' | 'up') =>
    page.evaluate(
      ({ phase, p, o }) => {
        const mouse = o.mouse === true;
        const hit = (q: { x: number; y: number }) => document.elementFromPoint(q.x, q.y) ?? document.body;
        const pointer = (type: string, q: { x: number; y: number }) =>
          hit(q).dispatchEvent(
            new PointerEvent(type, {
              bubbles: true,
              cancelable: true,
              composed: true,
              isPrimary: true,
              pointerId: 1,
              pointerType: mouse ? 'mouse' : 'touch',
              button: 0,
              clientX: q.x,
              clientY: q.y,
            }),
          );
        const touch = (type: string, q: { x: number; y: number }) => {
          if (mouse || typeof Touch !== 'function') return;
          try {
            const el = hit(q);
            const t = new Touch({ identifier: 1, target: el, clientX: q.x, clientY: q.y });
            const ending = type === 'touchend';
            el.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, composed: true, changedTouches: [t], touches: ending ? [] : [t] }));
          } catch {
            // Touch 를 만들 수 없는 브라우저는 pointer 이벤트만 보낸다.
          }
        };
        const mouseEvent = (type: string, q: { x: number; y: number }, detail: number) => {
          const ev = new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, view: window, detail, clientX: q.x, clientY: q.y });
          (ev as MouseEvent & { __test?: boolean }).__test = true;
          hit(q).dispatchEvent(ev);
        };
        if (phase === 'down') {
          pointer('pointerdown', p);
          touch('touchstart', p);
          return null;
        }
        const end = o.to ?? p;
        if (o.via) {
          pointer('pointermove', o.via);
          touch('touchmove', o.via);
          pointer('pointermove', p);
          touch('touchmove', p);
        }
        if (o.to) {
          pointer('pointermove', o.to);
          touch('touchmove', o.to);
        }
        if (o.contextmenu) hit(p).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y }));
        if (o.dbl) mouseEvent('dblclick', p, o.dbl);
        pointer('pointerup', end);
        touch('touchend', end);
        if (o.thenClick) mouseEvent('click', end, o.thenClick);
        if (o.next) {
          const q = o.next.at;
          pointer('pointerdown', q);
          touch('touchstart', q);
          pointer('pointerup', q);
          touch('touchend', q);
          if (o.next.click) mouseEvent('click', q, o.next.click);
        }
        for (const d of o.clicks ?? []) mouseEvent('click', end, d);
        if (!o.readAnswers) return null;
        const data = JSON.parse(window.localStorage.getItem('score-anatomy') ?? '{}');
        const s = (data.sessions ?? []).find((x: { id: string }) => x.id === data.currentId) ?? null;
        return (s?.answers ?? null) as Record<string, unknown> | null;
      },
      { phase, p, o },
    );
  if (o.phase !== 'up') await send('down');
  if (o.phase === 'down') return null;
  if (o.holdMs) await page.waitForTimeout(o.holdMs);
  return send('up');
}

/** 그 좌표의 맨 위 요소에 dblclick 하나를 보낸다(손을 뗀 뒤에 오는 보통의 dblclick). */
async function dblclickAt(page: Page, p: Pt, detail = 2): Promise<void> {
  await page.evaluate(
    ({ x, y, detail }) => {
      const el = document.elementFromPoint(x, y) ?? document.body;
      el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, composed: true, view: window, detail, clientX: x, clientY: y }));
    },
    { x: p.x, y: p.y, detail },
  );
}

/**
 * 아이폰 차례의 누름 열. 'p' 는 누름 하나(손가락 이벤트), 'h' 는 누르는 동안 dblclick 2 가 온 누름, 숫자는 그 detail 의 click,
 * 'dbl' 은 손을 뗀 뒤의 dblclick 2(누르는 중이면 누르는 동안 온 것), 'd' 와 'u' 는 누르기 시작과 손뗌만, { wait } 는 기다림이다.
 */
type IosStep = 'p' | 'h' | 'dbl' | 'd' | 'u' | number | { wait: number };

async function playIos(page: Page, p: Pt, steps: IosStep[], gap = 0): Promise<void> {
  for (const s of steps) {
    if (s === 'p') await iosPress(page, p);
    else if (s === 'd') await iosPress(page, p, { phase: 'down' });
    else if (s === 'u') await iosPress(page, p, { phase: 'up' });
    else if (s === 'h') await iosPress(page, p, { dbl: 2 });
    else if (s === 'dbl') await dblclickAt(page, p);
    else if (typeof s === 'number') await clickAt(page, p, s);
    else await page.waitForTimeout(s.wait);
    if (gap > 0) await page.waitForTimeout(gap);
  }
}

/** 웹의 판단 기록에서 그 판단들의 why 칸(채운 까닭: timer, click, next). */
async function tracedWhy(page: Page, what: string): Promise<unknown[]> {
  return page.evaluate(
    (w) => ((window as Window & { __saTapTrace?: { what: string; why?: unknown }[] }).__saTapTrace ?? []).filter((e) => e.what === w).map((e) => e.why),
    what,
  );
}

/** 웹의 판단 기록(src/tapGuard.ts 의 window.__saTapTrace)에서 그 판단의 수. */
async function traced(page: Page, what: string): Promise<number> {
  return page.evaluate((w) => ((window as Window & { __saTapTrace?: { what: string }[] }).__saTapTrace ?? []).filter((e) => e.what === w).length, what);
}

/** 아이폰 차례의 누름 열을 보내고 막기와 기다림이 끝난 뒤 끝 상태를 읽는다. */
async function runIos(page: Page, c: Case, steps: IosStep[]): Promise<{ state: unknown; filled: number[] }> {
  const p = await c.setup(page);
  await countFills(page);
  await playIos(page, p, steps);
  await page.waitForTimeout(700);
  if (c.check) await c.check(page);
  return { state: await snapshot(page), filled: await fills(page) };
}

/**
 * 누르는 동안 온 dblclick 이 와도 채우지 않는 경우. 첫 click 으로 손가락 아래의 요소가 바뀌어(다른 화면, 바텀시트, 닫힌 시트 뒤)
 * 둘째 누름이 앞 click 과 같은 요소가 아니거나, 키가 잠겨 누를 수 없다. 진짜 click 이 다 오는 경우에도 둘째 click 은 바뀐 화면에서
 * 막기가 버리거나 잠긴 키라 아무것도 하지 않아서 기록과 화면은 같다. 다만 그 버린 click 이 누를 수 있는 요소 위였으면
 * 진짜 click 이 다 온 쪽에만 버린 누름 알림이 뜬다(noticeOnlyInFull).
 */
const HELD_NO_FILL: { prefix: string; noticeOnlyInFull: boolean }[] = [
  { prefix: '키패드의 답 키: 마지막 문항', noticeOnlyInFull: true },
  { prefix: '키패드가 잠긴 상태의 답 키', noticeOnlyInFull: false },
  { prefix: '표시 화면의 채점 버튼', noticeOnlyInFull: true },
  { prefix: '바텀시트를 여는 버튼', noticeOnlyInFull: false },
  // 시트가 닫힌 뒤 그 자리는 누를 수 없는 바탕이라, 진짜 click 이 다 온 쪽도 막기가 버리지만 알림은 없다.
  { prefix: '바텀시트를 닫는 버튼', noticeOnlyInFull: false },
  { prefix: '아래 탭의 링크', noticeOnlyInFull: true },
];

test.describe('누르는 동안 온 dblclick 으로 채우기: iOS 18.4 의 사라지는 둘째 누름이 iOS 26.4 의 보통 두 번 누름과 끝 상태가 같다', () => {
  for (const c of CASES) {
    test(c.name, async ({ page }) => {
      const noFill = HELD_NO_FILL.find((n) => c.name.startsWith(n.prefix));
      // iOS 26.4 의 보통 두 번 누름: click 1, click 2 가 다 오고 dblclick 2 는 둘째 손뗌 뒤에 온다.
      const full = await runIos(page, c, ['p', 1, 'p', 2, 'dbl']);
      // iOS 18.4: 둘째 누름에서 손을 떼기 전에 dblclick 2 가 오고 그 누름의 click 은 오지 않는다.
      const held = await runIos(page, c, ['p', 1, 'h']);
      expect(full.filled, '진짜 click 이 다 오면 채우지 않는다').toEqual([]);
      if (!noFill) {
        expect(held.filled, '누르는 동안 dblclick 2 가 온 누름의 click(detail 2)을 하나 채운다').toEqual([2]);
        expect(held.state).toEqual(full.state);
        return;
      }
      expect(held.filled, '첫 click 으로 손가락 아래의 요소가 바뀌었거나 키가 잠겨 채우지 않는다').toEqual([]);
      const { notice: fullNotice, ...fullRest } = full.state as { notice: boolean };
      const { notice: heldNotice, ...heldRest } = held.state as { notice: boolean };
      expect(heldRest).toEqual(fullRest);
      expect(heldNotice).toBe(false);
      expect(fullNotice).toBe(noFill.noticeOnlyInFull);
    });
  }
});

test.describe('누르는 동안 온 dblclick 으로 채우기: 채우는 경우와 채우지 않는 경우', () => {
  async function keypad(page: Page): Promise<{ k: (n: number) => Promise<Pt> }> {
    await seedAndOpen(page, {}, '/input?input=keypad');
    await expect(page.getByTestId('now-no')).toHaveText('1번');
    await countFills(page);
    return { k: (n: number) => centerOf(page, `[data-key="${n}"]`) };
  }

  test('iOS 26.4 의 보통 두 번 누름(click 1, click 2, dblclick 2)은 두 번 그대로이고 채움은 0이다', async ({ page }) => {
    const { k } = await keypad(page);
    await playIos(page, await k(3), ['p', 1, 'p', 2, 'dbl', { wait: AFTER_HELD_WAIT }]);
    expect(await fills(page)).toEqual([]);
    expect(await traced(page, 'held-wait')).toBe(0);
    expect(await answersOf(page)).toEqual({ 1: 3, 2: 3 });
  });

  test('iOS 26.4 의 아주 빠른 두 번 누름(click 2 하나와 dblclick 2)은 지금처럼 손뗌 수 규칙으로 하나를 채워 두 번이 된다', async ({ page }) => {
    const { k } = await keypad(page);
    await playIos(page, await k(3), ['p', 'p', 2, 'dbl', { wait: AFTER_HELD_WAIT }]);
    expect(await fills(page)).toEqual([1]);
    expect(await traced(page, 'held-fill')).toBe(0);
    expect(await answersOf(page)).toEqual({ 1: 3, 2: 3 });
  });

  test('iOS 18.4 의 사라지는 둘째 누름(손을 떼기 전에 dblclick 2, 그 누름의 click 없음)은 하나를 채워 두 번이 된다', async ({ page }) => {
    const { k } = await keypad(page);
    const p = await k(3);
    await playIos(page, p, ['p', 1]);
    // 손을 뗀 바로 뒤(웹이 그 누름의 click 을 기다리는 동안)에는 아직 채우지 않는다.
    expect(await iosPress(page, p, { dbl: 2, readAnswers: true })).toEqual({ 1: 3 });
    await page.waitForTimeout(AFTER_HELD_WAIT);
    expect(await fills(page)).toEqual([2]);
    expect(await traced(page, 'held-fill')).toBe(1);
    expect(await answersOf(page)).toEqual({ 1: 3, 2: 3 });
    await expect(page.getByTestId('now-no')).toHaveText('3번');
  });

  test('데스크톱 브라우저의 더블클릭(마우스)은 채우지 않고 세 번 들어가지 않는다', async ({ page }) => {
    const { k } = await keypad(page);
    const p = await k(3);
    await iosPress(page, p, { mouse: true, thenClick: 1 });
    await iosPress(page, p, { mouse: true, thenClick: 2 });
    await dblclickAt(page, p);
    await page.waitForTimeout(AFTER_HELD_WAIT);
    expect(await fills(page)).toEqual([]);
    expect(await answersOf(page)).toEqual({ 1: 3, 2: 3 });
  });

  test('안드로이드 크롬(결정기록 7.1): 같은 키 두 번 누름과 옆 키를 빠르게 이어 눌러 detail 이 오른 것은 채우지 않고 세 번 들어가지 않는다', async ({ page }) => {
    const { k } = await keypad(page);
    // 같은 키를 두 번: click 1, click 2 가 다 오고 dblclick 2 는 손을 뗀 뒤에 온다.
    await playIos(page, await k(3), ['p', 1, 'p', 2, 'dbl']);
    await page.waitForTimeout(600);
    // 옆 키를 빠르게 이어 누름: 키마다 손뗌과 click 이 하나씩 오고 detail 은 1, 2, 3 으로 오른다(dblclick 2 도 온다).
    await playIos(page, await k(4), ['p', 1]);
    await playIos(page, await k(5), ['p', 2, 'dbl']);
    await playIos(page, await k(1), ['p', 3]);
    await page.waitForTimeout(AFTER_HELD_WAIT);
    expect(await fills(page)).toEqual([]);
    expect(await answersOf(page)).toEqual({ 1: 3, 2: 3, 3: 4, 4: 5, 5: 1 });
  });

  test('누르는 동안 dblclick 이 온 뒤 끌거나 길게 눌러 뗀 누름은 채우지 않는다', async ({ page }) => {
    const cases: [string, PressOptions][] = [
      ['끌기(40px 옮겨 뗌)', { dbl: 2, to: { x: 0, y: -40 } }],
      ['길게 누름(0.5초)', { dbl: 2, holdMs: 500 }],
      ['contextmenu 가 온 누름', { dbl: 2, contextmenu: true }],
    ];
    for (const [name, o] of cases) {
      const { k } = await keypad(page);
      const p = await k(3);
      await playIos(page, p, ['p', 1]);
      await iosPress(page, p, o.to ? { ...o, to: { x: p.x + o.to.x, y: p.y + o.to.y } } : o);
      await page.waitForTimeout(AFTER_HELD_WAIT);
      expect(await fills(page), name).toEqual([]);
      expect(await answersOf(page), name).toEqual({ 1: 3 });
    }
  });

  test('채운 뒤에 늦게 온 그 누름의 진짜 click 은 버린다(두 번 들어가지 않는다)', async ({ page }) => {
    const { k } = await keypad(page);
    await playIos(page, await k(3), ['p', 1, 'h', { wait: AFTER_HELD_WAIT }, 2]);
    await page.waitForTimeout(700);
    expect(await fills(page)).toEqual([2]);
    expect(await traced(page, 'held-late-drop')).toBe(1);
    expect(await answersOf(page)).toEqual({ 1: 3, 2: 3 });
    // 늦게 온 click 은 보호가 버린 누름이 아니라서 알림을 띄우지 않는다.
    await expect(page.getByTestId('tap-notice')).toHaveCount(0);
  });

  test('기다리는 동안 그 누름의 click 이 오면 채우지 않는다', async ({ page }) => {
    const { k } = await keypad(page);
    const p = await k(3);
    await playIos(page, p, ['p', 1]);
    // 손을 떼고 곧바로(같은 차례 안) 그 누름의 click 2 가 온다.
    await iosPress(page, p, { dbl: 2, thenClick: 2 });
    await page.waitForTimeout(AFTER_HELD_WAIT);
    expect(await fills(page)).toEqual([]);
    expect(await traced(page, 'held-cancel')).toBe(1);
    expect(await answersOf(page)).toEqual({ 1: 3, 2: 3 });
  });

  test('앞 click 과 다른 요소에서 누르는 동안 dblclick 이 온 누름은 채우지 않는다', async ({ page }) => {
    const { k } = await keypad(page);
    await playIos(page, await k(3), ['p', 1]);
    // 다른 키(4번, 3번 키에서 한 칸 옆)에서 누르는 동안 dblclick 2: 앞 click 과 요소도 자리도 달라 채우지 않는다.
    // 같은 자리에서 손가락 아래의 요소만 바뀐 경우는 아래 점수 해부 테스트와 같은 결과 테스트의 HELD_NO_FILL 경우들이 본다.
    await iosPress(page, await k(4), { dbl: 2 });
    await page.waitForTimeout(AFTER_HELD_WAIT);
    expect(await fills(page)).toEqual([]);
    expect(await answersOf(page)).toEqual({ 1: 3 });
  });

  test('기다리는 동안 다른 키의 click 이 먼저 오면 기다리던 누름을 먼저 채워 누른 차례를 지킨다', async ({ page }) => {
    const { k } = await keypad(page);
    const p3 = await k(3);
    const p4 = await k(4);
    await playIos(page, p3, ['p', 1]);
    // 손을 뗀 바로 뒤(기다리는 동안)에 4번 키를 누르고 그 click 이 온다.
    await iosPress(page, p3, { dbl: 2, next: { at: p4, click: 1 } });
    expect(await tracedWhy(page, 'held-fill'), '4번 키의 click 이 와서 기다리던 누름을 먼저 채움').toEqual(['click']);
    await page.waitForTimeout(AFTER_HELD_WAIT);
    expect(await fills(page)).toEqual([2]);
    expect(await answersOf(page)).toEqual({ 1: 3, 2: 3, 3: 4 });
  });

  test('맥에서 잰 간격 그대로(손뗌에서 다음 누름까지 215ms, 누른 시간 66ms)면 채우고, 앞 click 에서 0.4초를 넘겨 뗀 누름은 채우지 않는다', async ({ page }) => {
    {
      const { k } = await keypad(page);
      const p = await k(3);
      await playIos(page, p, ['p', 1, { wait: 215 }]);
      await iosPress(page, p, { dbl: 2, holdMs: 66 });
      await page.waitForTimeout(AFTER_HELD_WAIT);
      expect(await fills(page), '잰 간격').toEqual([2]);
      expect(await answersOf(page), '잰 간격').toEqual({ 1: 3, 2: 3 });
    }
    {
      const { k } = await keypad(page);
      const p = await k(3);
      await playIos(page, p, ['p', 1, { wait: 420 }, 'h', { wait: AFTER_HELD_WAIT }]);
      expect(await fills(page), '0.4초를 넘겨 뗌').toEqual([]);
      expect(await answersOf(page), '0.4초를 넘겨 뗌').toEqual({ 1: 3 });
    }
  });

  test('채운 뒤 그 자리의 새 누름은 셀 수 없는 누름이어도 그 click 을 받는다(길게 누름, 끌었다 돌아옴, 손뗌 둘 뒤 click 둘)', async ({ page }) => {
    const variants: [string, (page: Page, p: Pt) => Promise<void>, Record<number, number>][] = [
      ['길게 누름(0.5초)', (page, p) => iosPress(page, p, { holdMs: 500, thenClick: 1 }).then(() => undefined), { 1: 3, 2: 3, 3: 3 }],
      ['30px 끌었다 돌아옴', (page, p) => iosPress(page, p, { via: { x: p.x, y: p.y - 30 }, thenClick: 1 }).then(() => undefined), { 1: 3, 2: 3, 3: 3 }],
      // 손뗌 둘 뒤 click 둘: 두 click 은 따로 보낸다(진짜 이벤트처럼 그 사이에 화면을 다시 그릴 틈을 둔다).
      ['손뗌 둘 뒤 click 둘(iOS 26.4 의 마지막 문항 차례)', (page, p) => iosPress(page, p, { next: { at: p }, clicks: [1] }).then(() => clickAt(page, p, 2)), { 1: 3, 2: 3, 3: 3, 4: 3 }],
    ];
    for (const [name, press, want] of variants) {
      const { k } = await keypad(page);
      const p = await k(3);
      await playIos(page, p, ['p', 1, 'h', { wait: AFTER_HELD_WAIT }]);
      expect(await answersOf(page), `${name}: 채움`).toEqual({ 1: 3, 2: 3 });
      await press(page, p);
      await page.waitForTimeout(300);
      expect(await traced(page, 'held-late-drop'), name).toBe(0);
      expect(await answersOf(page), name).toEqual(want);
    }
  });

  test('채운 누름의 진짜 click 이 새 누름의 손뗌 뒤에 늦게 와도 누른 수만큼만 들어간다', async ({ page }) => {
    const { k } = await keypad(page);
    const p = await k(3);
    await playIos(page, p, ['p', 1, 'h', { wait: AFTER_HELD_WAIT }]);
    // 셋째 누름을 뗀 뒤에 채운 누름의 늦은 click 2 와 셋째 누름의 click 1 이 차례로 온다. 둘 가운데 하나만 들어간다.
    await iosPress(page, p, { clicks: [2, 1] });
    await page.waitForTimeout(300);
    expect(await traced(page, 'held-late-drop')).toBe(1);
    expect(await answersOf(page)).toEqual({ 1: 3, 2: 3, 3: 3 });
  });

  test('마지막 문항의 iOS 26.4 차례(손뗌 둘 뒤 click 1, click 2, dblclick 2)는 채우지 않고 진짜 click 이 따로 온 것과 같다', async ({ page }) => {
    const last = CASES.find((x) => x.name.startsWith('키패드의 답 키: 마지막 문항'))!;
    const full = await runIos(page, last, ['p', 1, 'p', 2, 'dbl']);
    const zero = await runIos(page, last, ['p', 'p', 1, 2, 'dbl']);
    expect(zero.filled).toEqual([]);
    expect(zero.state).toEqual(full.state);
  });

  test('점수 해부: 등급을 고르자 스크롤로 손가락 아래가 바뀐 같은 자리의 사라지는 둘째 누름은 채우지 않는다(iOS 18.4 에서 잰 경우)', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 360, height: 640 });
    const anatomy: Case = {
      name: '점수 해부 등급 칩',
      setup: async (page) => {
        await watchFills(page);
        // 예시 결과의 기록은 메모리에만 있어서, 앞 실행의 고른 등급이 남지 않게 새 문서로 연다.
        await page.goto('about:blank');
        await openApp(page, '/demo/anatomy');
        // 등급 칩이 화면 아래 끝에 오게 내려 둔다(고르면 그 아래의 첫 줄이 보이게 스크롤된다, 결정기록 7.4).
        await page.evaluate(() => {
          const chip = document.querySelector('[data-testid="grade-2"]')!;
          const body = chip.closest('.body')!;
          body.scrollTop += chip.getBoundingClientRect().bottom - body.getBoundingClientRect().bottom + 4;
        });
        await page.waitForTimeout(600);
        return centerOf(page, '[data-testid="grade-2"]');
      },
      check: async (page) => {
        await expect(page.getByTestId('grade-2')).toHaveAttribute('aria-checked', 'true');
      },
    };
    const full = await runIos(page, anatomy, ['p', 1, 'p', 2, 'dbl']);
    const held = await runIos(page, anatomy, ['p', 1, 'h']);
    // 첫 click 으로 스크롤되어 둘째 누름의 자리에는 칩이 아닌 다른 요소가 있었다.
    const p = await anatomy.setup(page);
    await playIos(page, p, ['p', 1]);
    expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-testid="grade-2"]') ?? null, p)).toBeNull();
    expect(full.filled).toEqual([]);
    expect(held.filled).toEqual([]);
    expect(held.state).toEqual(full.state);
  });
});

test.describe('누르는 동안 온 dblclick 으로 채우기: 세 번 빠르게 누름의 끝 상태가 실행마다 같다', () => {
  const markCase = { ...CASES[0]!, check: undefined };

  test('표시 칸: 잰 이벤트 열(click 2, dblclick 2, click 1)을 이벤트 사이 간격을 바꿔 돌려도 끝 상태가 같다(표시 없음)', async ({ page }) => {
    // 세 번 다 따로 온 것(진짜 click 이 다 옴): 표시 없음.
    const all3 = await runIos(page, markCase, ['p', 1, 'p', 2, 'p', 3]);
    expect((all3.state as { attrs: string[] }).attrs.length).toBeGreaterThan(0);
    await expect(page.locator('[data-mark-cell="3"]')).toHaveAttribute('data-mark', 'none');
    const seen: unknown[] = [];
    // 잰 차례와, 셋째 누름의 손뗌이 click 2 보다 먼저 온 차례(손가락 이벤트의 차례만 다르고 click 열은 같다).
    const orders: [string, IosStep[]][] = [
      ['잰 차례', ['p', 'p', 2, 'dbl', 'p', 1]],
      ['셋째 손뗌이 click 2 보다 먼저', ['p', 'p', 'p', 2, 'dbl', 1]],
    ];
    for (const [order, steps] of orders) {
      for (const gap of [0, 30, 80, 150]) {
        const p = await markCase.setup(page);
        await countFills(page);
        await playIos(page, p, steps, gap);
        await page.waitForTimeout(700);
        expect(await fills(page), `${order}, 간격 ${gap}ms`).toEqual([1]);
        await expect(page.locator('[data-mark-cell="3"]'), `${order}, 간격 ${gap}ms`).toHaveAttribute('data-mark', 'none');
        seen.push(await snapshot(page));
      }
    }
    for (const s of seen) expect(s).toEqual(all3.state);
  });

  test('표시 칸: 둘째 누름이 사라지는 세 번 누름도 셋째 누름이 기다림 안이든 뒤든 끝 상태가 같다(표시 없음)', async ({ page }) => {
    const all3 = await runIos(page, markCase, ['p', 1, 'p', 2, 'p', 3]);
    // 셋째 누름의 click 은 아이폰이 dblclick 뒤에 detail 을 1로 되돌려 보낸 것과 같게 detail 1 로 보낸다.
    // 기다림 안: 둘째 누름을 뗀 바로 뒤(같은 차례 안)에 셋째 누름과 그 click 이 온다.
    {
      const p = await markCase.setup(page);
      await countFills(page);
      await playIos(page, p, ['p', 1]);
      await iosPress(page, p, { dbl: 2, next: { at: p, click: 1 } });
      expect(await tracedWhy(page, 'held-fill'), '셋째 누름의 click 이 기다리던 누름을 먼저 채움').toEqual(['click']);
      await page.waitForTimeout(700);
      expect(await fills(page), '셋째 누름이 기다림 안').toEqual([2]);
      expect(await snapshot(page), '셋째 누름이 기다림 안').toEqual(all3.state);
    }
    // 셋째 누름을 누르는 동안 click 2 와 dblclick 2 가 온 차례(셋째 누름에 표시가 붙음). 셋째 누름의 click 1 이 곧 오든
    // 기다림 뒤에 오든 표시 없음으로 같다(곧 오면 기다림을 그만두고, 늦으면 dblclick 의 detail 이 앞 click 과 이어지지 않아 채우지 않음).
    for (const late of [false, true]) {
      const steps: IosStep[] = late ? ['p', 'p', 'd', 2, 'dbl', 'u', { wait: AFTER_HELD_WAIT }, 1] : ['p', 'p', 'd', 2, 'dbl', 'u', 1];
      const r = await runIos(page, markCase, steps);
      expect(r.filled, `셋째 누름 안의 dblclick, 셋째 click ${late ? '늦게' : '곧'}`).toEqual([1]);
      expect(r.state, `셋째 누름 안의 dblclick, 셋째 click ${late ? '늦게' : '곧'}`).toEqual(all3.state);
    }
    // 기다림 뒤: 둘째 누름을 채운 뒤에 셋째 누름이 온다.
    const r = await runIos(page, markCase, ['p', 1, 'h', { wait: AFTER_HELD_WAIT }, 'p', 1]);
    expect(r.filled, '셋째 누름이 기다림 뒤').toEqual([2]);
    expect(r.state, '셋째 누름이 기다림 뒤').toEqual(all3.state);
  });
});

test('측정 중 누르는 동안 온 dblclick 으로 채운 누름은 filled_taps 에 들어가고 filled_held_taps 에 따로 세어진다', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openApp(page, '/test');
  await page.getByLabel('참가자 코드').fill('P08');
  await page.getByTestId('mode-keypad').click();
  await page.getByTestId('start-run').click();
  await expectHash(page, '/');
  await page.getByRole('button', { name: '시험 고르기' }).click();
  await chooseExam(page, 'sample-a');
  await expect(page.getByTestId('now-no')).toHaveText('1번');
  await page.waitForTimeout(600);
  const key = await centerOf(page, '[data-key="2"]');
  // 손뗌 수 규칙으로 하나(아주 빠른 두 번 누름), 누르는 동안 온 dblclick 규칙으로 하나(사라지는 둘째 누름).
  await playIos(page, key, ['p', 'p', 2, 'dbl']);
  await page.waitForTimeout(1200);
  await playIos(page, key, ['p', 1, 'h', { wait: AFTER_HELD_WAIT }]);
  await expect(page.getByTestId('now-no')).toHaveText('5번');
  await openApp(page, '/test');
  const card = page.locator('[data-testid="run-card"][data-participant="P08"]');
  await expect(card.getByTestId('m-filled')).toHaveText('2번');
  await expect(card.getByTestId('m-filled-held')).toHaveText('1번');
  await expect(card.getByTestId('m-discarded')).toHaveText('0번');
  await page.getByTestId('copy-csv').click();
  await expect(page.getByText('복사했어요.')).toBeVisible();
  const csv = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n').trim().split('\n');
  const head = csv[0]!.split(',');
  const row = csv.find((l) => l.startsWith('P08,'))!.split(',');
  expect(row[head.indexOf('filled_taps')]).toBe('2');
  expect(row[head.indexOf('filled_held_taps')]).toBe('1');
});

test.describe('채운 곳의 장부: 채운 뒤 늦게 온 진짜 click 버리기(작업 지시서 4-1 의 2-1, 맥의 iOS 18.4 에서 잰 차례)', () => {
  // 맥의 iOS 18.4 시뮬레이터(웹 0.3.2): 표시 칸을 아주 빠르게 두 번 누르자 click 2(손가락), 손뗌 수 규칙이 채운 click 1, dblclick 2 뒤에
  // 첫 누름의 click 1 이 늦게(click 2 의 5ms 뒤) 와서 두 번 누름이 세 번 들어갔다. 채운 곳에서는 받아들인 입력 수가 뗀 누름 수를 넘지 않게 한다.
  // 표시 칸(5지선다 3번)과 답 키(3)에서 같은 차례를 돌린다. "들어간 수"는 표시 칸이면 표시가 바뀐 수(표시 없음, 고민, 찍음 차례로 돈다),
  // 답 키면 3이 들어간 문항 수다.
  interface Target {
    name: string;
    /** 그 화면을 열고 누를 요소와 그 가운데를 돌려준다. */
    open: (page: Page) => Promise<{ el: string; p: Pt }>;
    /** 이웃한 같은 종류 요소 둘(안드로이드의 옆 요소 이어 누름). */
    neighbors: string[];
    expectEntered: (page: Page, n: number) => Promise<void>;
  }
  const MARKS = ['none', 'doubt', 'guess'];
  const TARGETS: Target[] = [
    {
      name: '표시 칸',
      open: async (page) => {
        await seedAndOpen(page, all, '/marks');
        await countFills(page);
        return { el: '[data-mark-cell="3"]', p: await centerOf(page, '[data-mark-cell="3"]') };
      },
      neighbors: ['[data-mark-cell="4"]', '[data-mark-cell="5"]'],
      expectEntered: async (page, n) => {
        await expect(page.locator('[data-mark-cell="3"]')).toHaveAttribute('data-mark', MARKS[n % 3]!);
      },
    },
    {
      name: '답 키',
      open: async (page) => {
        await seedAndOpen(page, {}, '/input?input=keypad');
        await expect(page.getByTestId('now-no')).toHaveText('1번');
        await countFills(page);
        return { el: '[data-key="3"]', p: await centerOf(page, '[data-key="3"]') };
      },
      neighbors: ['[data-key="4"]', '[data-key="5"]'],
      expectEntered: async (page, n) => {
        const a = await answersOf(page);
        expect(Object.values(a).filter((v) => v === 3).length).toBe(n);
      },
    },
  ];

  /** 그 요소에 그 좌표로 click 하나를 보낸다(좌표 아래의 요소가 아니라 그 요소로. 확대 중에 좌표가 어긋난 click 을 흉내 낸다). */
  async function clickOn(page: Page, selector: string, at: Pt, detail: number): Promise<void> {
    await page.evaluate(
      ({ selector, at, detail }) => {
        const el = document.querySelector(selector)!;
        const ev = new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, view: window, detail, clientX: at.x, clientY: at.y });
        (ev as MouseEvent & { __test?: boolean }).__test = true;
        el.dispatchEvent(ev);
      },
      { selector, at, detail },
    );
  }

  /** 끝난 뒤 공통으로 보는 것: 늦은 click 을 버린 수, 버린 누름 알림이 없음. */
  async function expectDrops(page: Page, n: number, label: string): Promise<void> {
    await page.waitForTimeout(150);
    expect(await traced(page, 'late-drop'), `${label}: 버린 늦은 click`).toBe(n);
    await expect(page.locator('[data-testid="tap-notice"]'), `${label}: 알림 없음`).toHaveCount(0);
  }

  test('1. 맥이 잰 차례(누름, 손뗌, 누름, 손뗌, click 2, dblclick 2, click 1): 두 번 들어가고 하나를 버리며 알림이 없다', async ({ page }) => {
    for (const t of TARGETS) {
      const { p } = await t.open(page);
      // 누름 시작 사이 70ms 안팎(앞 누름 뒤 60ms 기다림), 마지막 click 1 은 click 2 의 몇 ms 뒤.
      await playIos(page, p, ['p', { wait: 60 }, 'p', 2, 'dbl', { wait: 5 }, 1]);
      expect(await fills(page), t.name).toEqual([1]);
      await expectDrops(page, 1, t.name);
      await t.expectEntered(page, 2);
    }
  });

  test('2. 세 번 누름(누름 둘, click 2, dblclick 2, 셋째 누름과 손뗌, click 1): 세 번 들어간다', async ({ page }) => {
    for (const t of TARGETS) {
      const { p } = await t.open(page);
      await playIos(page, p, ['p', 'p', 2, 'dbl', 'p', 1]);
      await expectDrops(page, 0, t.name);
      await t.expectEntered(page, 3);
    }
  });

  test('3. 세 번 누름인데 셋째 손뗌이 click 2 보다 먼저 옴(누름 셋, click 2, dblclick 2, click 1): 셋째 누름의 click 을 받아 세 번 들어간다', async ({ page }) => {
    for (const t of TARGETS) {
      const { p } = await t.open(page);
      await playIos(page, p, ['p', 'p', 'p', 2, 'dbl', 1]);
      await expectDrops(page, 0, t.name);
      await t.expectEntered(page, 3);
    }
  });

  test('4. 채운 뒤 1초 안에 같은 자리를 보통 빠르기로 한 번 더 누르면 받는다', async ({ page }) => {
    for (const t of TARGETS) {
      const { p } = await t.open(page);
      await playIos(page, p, ['p', 'p', 2, 'dbl', { wait: 300 }, 'p', 1]);
      await expectDrops(page, 0, t.name);
      await t.expectEntered(page, 3);
    }
  });

  test('5. 채운 누름의 늦은 click 이 새 누름의 손뗌 뒤에 와도 들어간 수가 누른 수와 같다', async ({ page }) => {
    for (const t of TARGETS) {
      const { p } = await t.open(page);
      await playIos(page, p, ['p', 'p', 2, 'dbl']);
      // 셋째 누름을 뗀 뒤 첫 누름의 늦은 click 1 과 셋째 누름의 click 1 이 차례로 온다(누른 수 3).
      await iosPress(page, p, { clicks: [1] });
      await clickAt(page, p, 1);
      await expectDrops(page, 1, t.name);
      await t.expectEntered(page, 3);
    }
  });

  test('6. detail 3 인 click 하나로 둘을 채운 뒤 손뗌 없이 click 이 둘 더 오면 둘 다 버린다', async ({ page }) => {
    for (const t of TARGETS) {
      const { p } = await t.open(page);
      await playIos(page, p, ['p', 'p', 'p', 3, 1, 2]);
      expect(await fills(page), t.name).toEqual([1, 2]);
      await expectDrops(page, 2, t.name);
      await t.expectEntered(page, 3);
    }
  });

  test('7. 마우스 더블클릭과 안드로이드 크롬의 차례(결정기록 7.1, 7.8)는 채움 0, 버림 0 이다', async ({ page }) => {
    for (const t of TARGETS) {
      // 마우스 더블클릭: 누름마다 click 이 오고 dblclick 은 둘째 click 뒤에 온다.
      const { p } = await t.open(page);
      await iosPress(page, p, { mouse: true, thenClick: 1 });
      await iosPress(page, p, { mouse: true, thenClick: 2 });
      await dblclickAt(page, p);
      expect(await fills(page), `${t.name} 마우스`).toEqual([]);
      await expectDrops(page, 0, `${t.name} 마우스`);
      await t.expectEntered(page, 2);
      expect(await traced(page, 'ledger'), `${t.name} 마우스: 장부를 열지 않음`).toBe(0);
      // 안드로이드 크롬: 같은 요소 두 번(click 1, click 2, dblclick 2), 그 뒤 옆 요소 둘을 빠르게 이어 누름(detail 이 오름).
      const again = await t.open(page);
      await playIos(page, again.p, ['p', 1, 'p', 2, 'dbl']);
      await page.waitForTimeout(600);
      await playIos(page, await centerOf(page, t.neighbors[0]!), ['p', 1]);
      await playIos(page, await centerOf(page, t.neighbors[1]!), ['p', 2, 'dbl']);
      expect(await fills(page), `${t.name} 안드로이드`).toEqual([]);
      await expectDrops(page, 0, `${t.name} 안드로이드`);
      await t.expectEntered(page, 2);
      expect(await traced(page, 'ledger'), `${t.name} 안드로이드: 장부를 열지 않음`).toBe(0);
    }
  });

  test('8. 채운 곳에서 1초 안에 키보드(Enter, Space)나 스크립트로 낸 click 은 받는다', async ({ page }) => {
    for (const t of TARGETS) {
      const { el, p } = await t.open(page);
      await playIos(page, p, ['p', 'p', 2]);
      expect(await traced(page, 'ledger'), t.name).toBe(1);
      await page.locator(el).focus();
      await page.keyboard.press('Enter');
      await page.keyboard.press('Space');
      await page.evaluate((s) => (document.querySelector(s) as HTMLElement).click(), el);
      await expectDrops(page, 0, t.name);
      await t.expectEntered(page, 5);
    }
  });

  test('10. 1번과 같은데 마지막 click 1 의 좌표가 채운 자리에서 가로 74px, 세로 96px 어긋나고 대상은 같은 버튼이면 버린다', async ({ page }) => {
    for (const t of TARGETS) {
      const { el, p } = await t.open(page);
      await playIos(page, p, ['p', { wait: 60 }, 'p', 2, 'dbl']);
      // 맥의 기록처럼 확대가 시작돼 click 의 좌표가 어긋났다(197,255 에서 123,159). 대상은 같은 버튼이다.
      await clickOn(page, el, { x: p.x - 74, y: p.y - 96 }, 1);
      await expectDrops(page, 1, t.name);
      await t.expectEntered(page, 2);
    }
  });

  test('11. 채운 뒤 1초 안에 같은 버튼의 다른 자리(24px 밖)를 새로 누르면 받는다', async ({ page }) => {
    for (const t of TARGETS) {
      const { el, p } = await t.open(page);
      await playIos(page, p, ['p', 'p', 2, 'dbl']);
      const box = (await page.locator(el).boundingBox())!;
      const q = { x: box.x + box.width - 3, y: p.y };
      expect(Math.abs(q.x - p.x), `${t.name}: 24px 밖`).toBeGreaterThan(24);
      await iosPress(page, q, { thenClick: 1 });
      await expectDrops(page, 0, t.name);
      await t.expectEntered(page, 3);
    }
  });

  test('이미 채운 두 버튼에 늦은 click이 하나씩 오면 각각 버린다', async ({ page }) => {
    for (const t of TARGETS) {
      const { p } = await t.open(page);
      const other = await centerOf(page, t.neighbors[0]!);
      await playIos(page, p, ['p', 'p', 2]);
      await playIos(page, other, ['p', 'p', 2]);
      await clickAt(page, p, 1);
      await clickAt(page, other, 1);
      await expectDrops(page, 2, t.name);
      await t.expectEntered(page, 2);
      if (t.name === '표시 칸') await expect(page.locator(t.neighbors[0]!)).toHaveAttribute('data-mark', 'guess');
      else expect(Object.values(await answersOf(page)).filter((v) => v === 4)).toHaveLength(2);
    }
  });

  test('같은 버튼을 연달아 채워도 앞서 뗀 셋째 누름과 두 번의 버림 횟수가 남는다', async ({ page }) => {
    for (const t of TARGETS) {
      const { p } = await t.open(page);
      await playIos(page, p, ['p', 'p', 'p', 2, 'p', 'p', 2, 1, 1, 1]);
      await expectDrops(page, 2, t.name);
      await t.expectEntered(page, 5);
    }
  });

  test('손가락으로 채운 뒤 같은 버튼을 실제 마우스로 누르면 즉시 받고 늦은 손가락 click만 버린다', async ({ page }) => {
    for (const t of TARGETS) {
      const { p } = await t.open(page);
      await playIos(page, p, ['p', 'p', 2]);
      await page.mouse.click(p.x, p.y);
      await t.expectEntered(page, 3);
      expect(await traced(page, 'late-drop'), t.name).toBe(0);
      await clickAt(page, p, 1);
      await expectDrops(page, 1, t.name);
      await t.expectEntered(page, 3);
    }
  });
});
