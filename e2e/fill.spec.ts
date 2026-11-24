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
