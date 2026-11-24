import type { Page } from '@playwright/test';
import { correctAnswers, expect, loadExam, openApp, seedStore, test } from './helpers';

// 작업 지시서 3-1: 아이폰에서 찾은 웹 쪽 문제(3-2 ~ 3-5). 3-1(빠진 누름 채우기)은 e2e/fill.spec.ts 가 본다.

const examA = loadExam('a');

/** 요소 안의 글자 조각(비어 있지 않은 글자 노드) 수와 글자. */
async function textPieces(page: Page, selector: string): Promise<{ count: number; texts: string[] }[]> {
  return page.locator(selector).evaluateAll((els) =>
    els.map((el) => {
      const texts: string[] = [];
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) if ((n.textContent ?? '').trim() !== '') texts.push(n.textContent ?? '');
      return { count: texts.length, texts };
    }),
  );
}

/** 보이는 글자(줄바꿈 없는 빈칸은 빈칸으로). */
async function shownText(page: Page, selector: string): Promise<string[]> {
  return page.locator(selector).evaluateAll((els) => els.map((el) => (el as HTMLElement).innerText.replace(/ /g, ' ')));
}

test.describe('3-2 계단 카드의 번호와 이름이 한 조각의 글자로 그려진다', () => {
  test('계단 카드 제목, 오늘 할 일의 번호, 첫 줄은 글자 조각이 하나이고 보이는 글자는 고치기 전과 같다', async ({ page }) => {
    await openApp(page, '/demo/steps');
    await expect(page.getByTestId('step-title')).toHaveCount(3);
    // 고치기 전의 화면(docs/screens 의 계단 캡처)과 같은 글자다.
    expect(await shownText(page, '[data-testid="step-title"]')).toEqual(['1. 적분', '2. 수열', '3. 확률']);
    for (const p of await textPieces(page, '[data-testid="step-title"]')) expect(p.count).toBe(1);
    expect(await shownText(page, '[data-testid="todo-today"]')).toEqual([
      '1. 오늘 시험지의 14번, 20번, 21번을 다시 풀기',
      '1. 오늘 시험지의 15번과 29번을 다시 풀기',
      '1. 오늘 시험지의 9번과 11번을 다시 풀기',
    ]);
    for (const p of await textPieces(page, '[data-testid="todo-today"]')) expect(p.count).toBe(1);
    for (const p of await textPieces(page, '[data-testid="todo-coords-title"]')) {
      expect(p.count).toBe(1);
      expect(p.texts[0]).toBe('2. 비슷한 문항 좌표');
    }
    // 카드의 이름표(aria-labelledby)도 한 번에 읽힌다.
    await expect(page.getByRole('listitem', { name: '1. 적분' })).toHaveCount(1);
  });

  test('점수 해부의 등급컷 첫 줄도 한 조각의 글자이고, 앞 조각과 뒤 조각은 각각 끊기지 않는다', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await openApp(page, '/demo/anatomy');
    await page.getByTestId('grade-2').click();
    await expect(page.getByTestId('cut-actual')).toHaveText('실제 78점 기준 3~7점 남았어요');
    const [p] = await textPieces(page, '[data-testid="cut-actual"]');
    expect(p!.count).toBe(1);
    // 조각 안의 빈칸은 줄바꿈 없는 빈칸이고 조각 사이만 보통 빈칸이다.
    expect(p!.texts[0]).toBe('실제 78점 기준 3~7점 남았어요');
    // 폭 360px 에서 첫 줄은 두 줄로 나뉜다. 나뉘는 곳은 두 조각 사이이고, 각 조각은 한 줄 안에 있다.
    const lines = await page.getByTestId('cut-actual').evaluate((el) => {
      const node = el.firstChild!;
      const text = node.textContent ?? '';
      const cut = text.indexOf(' ');
      const tops = (from: number, to: number) => {
        const range = document.createRange();
        range.setStart(node, from);
        range.setEnd(node, to);
        return new Set(Array.from(range.getClientRects()).map((r) => Math.round(r.top))).size;
      };
      return { all: tops(0, text.length), first: tops(0, cut), second: tops(cut + 1, text.length) };
    });
    expect(lines.first).toBe(1);
    expect(lines.second).toBe(1);
    expect(lines.all).toBeLessThanOrEqual(2);
  });
});

test.describe('3-3 키패드 판의 바탕이 화면 아래 끝까지 이어진다', () => {
  async function openKeypad(page: Page) {
    await openApp(page, '/');
    await seedStore(page, {
      version: 1,
      sessions: [{ id: 's1', examId: 'sample-a', createdAt: '2026-11-22T10:00:00.000Z', gradedBefore: 'not_yet', seenBefore: 'first', answers: {} }],
      currentId: 's1',
    });
    await page.reload();
    await openApp(page, '/input?input=keypad');
  }

  /** 아래 안전 영역 값을 넣고 키패드 판과 키의 자리를 잰다. */
  async function measure(page: Page, safe: string) {
    await page.evaluate((v) => document.documentElement.style.setProperty('--safe-bottom', v), safe);
    return page.evaluate(() => {
      const r = (el: Element | null) => {
        const b = el!.getBoundingClientRect();
        return { top: b.top, bottom: b.bottom, left: b.left, width: b.width, height: b.height };
      };
      const pad = document.querySelector('.dock > .pad')!;
      const bottomHit = document.elementFromPoint(window.innerWidth / 2, window.innerHeight - 1);
      return {
        vh: window.innerHeight,
        dock: r(document.querySelector('.dock')),
        pad: r(pad),
        padBg: getComputedStyle(pad).backgroundColor,
        dockPadBottom: getComputedStyle(document.querySelector('.dock')!).paddingBottom,
        padPadBottom: getComputedStyle(pad).paddingBottom,
        keys: Array.from(document.querySelectorAll('.dock .key')).map(r),
        bottomInPad: bottomHit !== null && pad.contains(bottomHit),
      };
    });
  }

  test('안전 영역 34px: 판의 바탕은 화면 아래 끝에 닿고, 키는 안전 영역 위에 있고 크기는 그대로다', async ({ page }) => {
    await openKeypad(page);
    const zero = await measure(page, '0px');
    const safe = await measure(page, '34px');
    expect(safe.pad.bottom).toBeCloseTo(safe.vh, 0);
    expect(safe.dock.bottom).toBeCloseTo(safe.vh, 0);
    expect(safe.bottomInPad).toBe(true);
    expect(safe.dockPadBottom).toBe('0px');
    expect(safe.padPadBottom).toBe('42px');
    for (const k of safe.keys) expect(k.bottom).toBeLessThanOrEqual(safe.vh - 34 + 0.5);
    // 키의 크기와 가로 자리는 그대로이고, 세로 자리는 판 안에서 같다(판 위쪽에서 잰 거리).
    expect(safe.keys.map((k) => [k.width, k.height, k.left])).toEqual(zero.keys.map((k) => [k.width, k.height, k.left]));
    expect(safe.keys.map((k) => Math.round(k.top - safe.pad.top))).toEqual(zero.keys.map((k) => Math.round(k.top - zero.pad.top)));
  });

  test('안전 영역 0: 고치기 전과 같다(판 아래 여백 8px, 띠 아래 여백 0)', async ({ page }) => {
    await openKeypad(page);
    const zero = await measure(page, '0px');
    expect(zero.dockPadBottom).toBe('0px');
    expect(zero.padPadBottom).toBe('8px');
    expect(zero.pad.bottom).toBeCloseTo(zero.vh, 0);
    expect(zero.bottomInPad).toBe(true);
  });

  test('키패드가 없는 화면의 아래 여백은 그대로다(안전 영역만큼 띠 아래에 둔다)', async ({ page }) => {
    await openApp(page, '/');
    await seedStore(page, {
      version: 1,
      sessions: [{ id: 's1', examId: 'sample-a', createdAt: '2026-11-22T10:00:00.000Z', gradedBefore: 'not_yet', seenBefore: 'first', answers: correctAnswers(examA) }],
      currentId: 's1',
    });
    await page.reload();
    await openApp(page, '/marks');
    for (const v of ['0px', '34px']) {
      await page.evaluate((x) => document.documentElement.style.setProperty('--safe-bottom', x), v);
      expect(await page.locator('.dock').evaluate((el) => getComputedStyle(el).paddingBottom)).toBe(v);
    }
  });
});

test.describe('3-4 목표 등급을 고르면 등급컷 상자의 첫 줄이 보이게 한다', () => {
  /** 첫 줄이 점수 해부 화면의 스크롤 영역 안에 다 들어와 있는지. */
  async function firstLineShown(page: Page): Promise<boolean> {
    return page.getByTestId('cut-actual').evaluate((el) => {
      const r = el.getBoundingClientRect();
      const b = el.closest('.body')!.getBoundingClientRect();
      return r.top >= b.top - 0.5 && r.bottom <= b.bottom + 0.5;
    });
  }
  const scrollTop = (page: Page) => page.locator('main.body').evaluate((el) => el.scrollTop);
  /** 등급 칩이 화면 아래쪽 끝에 오게 내려 둔다(그 아래의 첫 줄은 화면 밖). */
  async function chipAtBottom(page: Page, testId: string): Promise<void> {
    await page.evaluate((id) => {
      const chip = document.querySelector(`[data-testid="${id}"]`)!;
      const body = chip.closest('.body')!;
      const c = chip.getBoundingClientRect();
      const b = body.getBoundingClientRect();
      body.scrollTop += c.bottom - b.bottom + 4;
    }, testId);
    await page.waitForTimeout(600);
  }

  test('세로가 짧은 화면에서 등급을 고르면 첫 줄이 화면 안에 들어온다(미끄러지는 움직임)', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await openApp(page, '/demo/anatomy');
    await chipAtBottom(page, 'grade-2');
    // 아직 등급을 고르지 않아 첫 줄이 없다. 고르면 칩 아래(화면 밖)에 생긴다.
    await expect(page.getByTestId('cut-actual')).toHaveCount(0);
    const before = await scrollTop(page);
    await page.getByTestId('grade-2').click();
    await expect.poll(() => firstLineShown(page)).toBe(true);
    expect(await scrollTop(page)).toBeGreaterThan(before);
    await expect(page.getByTestId('cut-actual')).toHaveText('실제 78점 기준 3~7점 남았어요');
  });

  test('움직임 줄이기 설정이면 미끄러지지 않고 바로 옮긴다', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 360, height: 640 });
    await openApp(page, '/demo/anatomy');
    await chipAtBottom(page, 'grade-2');
    await expect(page.getByTestId('cut-actual')).toHaveCount(0);
    const before = await scrollTop(page);
    await page.getByTestId('grade-2').click();
    expect(await scrollTop(page)).toBeGreaterThan(before);
    // 기다리지 않고 바로 본다.
    expect(await firstLineShown(page)).toBe(true);
  });

  test('이미 보이는 화면에서는 스크롤 위치가 그대로다', async ({ page }) => {
    await page.setViewportSize({ width: 430, height: 1400 });
    await openApp(page, '/demo/anatomy');
    await page.getByTestId('grade-2').click();
    expect(await firstLineShown(page)).toBe(true);
    await page.waitForTimeout(400);
    expect(await scrollTop(page)).toBe(0);
    // 짧은 화면에서 첫 줄이 이미 보이게 내려 둔 뒤 다른 등급을 골라도 움직이지 않는다.
    await page.setViewportSize({ width: 360, height: 640 });
    await page.getByTestId('cut-actual').evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(100);
    const before = await scrollTop(page);
    expect(await firstLineShown(page)).toBe(true);
    await page.getByTestId('grade-1').click();
    await expect(page.getByTestId('cut-actual')).toHaveText('실제 78점 기준 10~14점 남았어요');
    await page.waitForTimeout(400);
    expect(await scrollTop(page)).toBe(before);
  });

  test('고른 직후 같은 자리를 이어 누른 것은 그 자리로 옮겨 온 다른 요소에 들어가지 않는다', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 360, height: 640 });
    await openApp(page, '/demo/anatomy');
    const chip = page.getByTestId('grade-2');
    await chipAtBottom(page, 'grade-2');
    const box = (await chip.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    // 초점을 옮기는 호출(focus())을 센다. 마우스로 누른 때 초점이 어디로 가는지는 브라우저마다 달라서(사파리 계열은 버튼에 주지 않음)
    // 초점의 자리가 아니라 이 화면의 코드가 초점을 옮기려 했는지를 본다.
    await page.evaluate(() => {
      const w = window as Window & { __focusCalls?: number };
      w.__focusCalls = 0;
      const original = HTMLElement.prototype.focus;
      HTMLElement.prototype.focus = function (this: HTMLElement, ...rest: Parameters<HTMLElement['focus']>) {
        w.__focusCalls! += 1;
        return original.apply(this, rest);
      };
    });
    const before = await scrollTop(page);
    await page.mouse.click(x, y);
    // 스크롤로 내용이 옮겨 가서 그 자리에 다른 요소가 왔다.
    expect(await scrollTop(page)).toBeGreaterThan(before);
    const moved = await page.evaluate(({ x, y }) => {
      const hit = document.elementFromPoint(x, y);
      const chip2 = document.querySelector('[data-testid="grade-2"]');
      return hit !== null && !(chip2 !== null && chip2.contains(hit));
    }, { x, y });
    expect(moved).toBe(true);
    await expect(page.locator('.tap-shield')).toHaveCount(1);
    // 기다리지 않고 같은 자리를 이어 누른다. 아무 데도 들어가지 않는다.
    const state = async () =>
      page.evaluate(() => ({
        hash: window.location.hash,
        checked: Array.from(document.querySelectorAll('[role="radio"][aria-checked="true"]')).map((el) => el.getAttribute('data-testid')),
        modal: document.querySelectorAll('[aria-modal="true"]').length,
        open: Array.from(document.querySelectorAll('details[open]')).length,
      }));
    // 스크롤할 때 초점은 옮기지 않는다: 이 화면의 코드는 focus() 를 부르지 않았고, 초점은 등급컷 상자 안으로 가지 않았다.
    expect(await page.evaluate(() => (window as Window & { __focusCalls?: number }).__focusCalls)).toBe(0);
    expect(await page.evaluate(() => document.activeElement?.closest('[data-testid="cutbox"] .mt3') === null || document.activeElement === null)).toBe(true);
    const s0 = await state();
    await page.mouse.click(x, y);
    await page.waitForTimeout(100);
    expect(await state()).toEqual(s0);
    expect(s0.checked).toEqual(['grade-2']);
  });
});

test.describe('3-5 보기 문제', () => {
  test('시험 설명은 쉼표로 나뉜 조각이 통째로 다음 줄로 내려가고 글자는 시험 파일 그대로다', async ({ page }) => {
    for (const width of [360, 375, 390, 402, 414, 430]) {
      await page.setViewportSize({ width, height: 900 });
      await openApp(page, '/exams');
      const notes = page.getByTestId('note-line');
      const count = await notes.count();
      expect(count).toBeGreaterThan(0);
      for (let i = 0; i < count; i += 1) {
        const info = await notes.nth(i).evaluate((el) => ({
          text: el.textContent,
          chunks: Array.from(el.querySelectorAll('[data-testid="note-chunk"]')).map((c) => {
            const range = document.createRange();
            range.selectNodeContents(c);
            const tops = new Set(Array.from(range.getClientRects()).map((r) => Math.round(r.top)));
            return { text: c.textContent, lines: tops.size, width: c.getBoundingClientRect().width };
          }),
          box: el.getBoundingClientRect().width,
        }));
        // 글자는 시험 파일의 note 그대로다.
        expect(['1~21번 5지선다, 22~30번 단답형', '1~15번 5지선다, 16~22번 단답형, 23~28번 5지선다, 29~30번 단답형']).toContain(info.text);
        // 한 줄에 들어가는 조각은 한 줄에 있다(조각 안에서 끊기지 않는다).
        for (const c of info.chunks) if (c.width < info.box - 1) expect(c.lines, `${width}px: ${c.text}`).toBe(1);
      }
    }
  });

  test('조각 하나가 한 줄보다 길면 그 안에서 평소대로 끊긴다', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await openApp(page, '/exams');
    const info = await page.getByTestId('note-chunk').first().evaluate((el) => {
      el.textContent = '아주 긴 조각 '.repeat(12).trim();
      const range = document.createRange();
      range.selectNodeContents(el);
      const tops = new Set(Array.from(range.getClientRects()).map((r) => Math.round(r.top)));
      const parent = el.parentElement!.getBoundingClientRect();
      const box = el.getBoundingClientRect();
      return { lines: tops.size, right: box.right, parentRight: parent.right, scroll: el.scrollWidth - el.clientWidth };
    });
    expect(info.lines).toBeGreaterThan(1);
    expect(info.right).toBeLessThanOrEqual(info.parentRight + 0.5);
    expect(info.scroll).toBeLessThanOrEqual(0);
  });

  for (const scheme of ['light', 'dark'] as const) {
    for (const dpr of [1, 2, 3]) {
      test.describe(`진행 막대(${scheme === 'light' ? '밝은' : '어두운'} 화면, ${dpr}배)`, () => {
        test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: dpr, colorScheme: scheme });
        test('진행 막대의 둥근 끝에 틈이 없다', async ({ page }) => {
          await openApp(page, '/');
          await seedStore(page, {
            version: 1,
            sessions: [{ id: 's1', examId: 'sample-a', createdAt: '2026-11-22T10:00:00.000Z', gradedBefore: 'not_yet', seenBefore: 'first', answers: correctAnswers(examA) }],
            currentId: 's1',
          });
          await page.reload();
          await openApp(page, '/input?input=keypad');
          const bar = page.locator('.progress');
          await expect(bar).toHaveAttribute('aria-valuenow', '30');
          // 채움은 막대 자신의 바탕으로 그린다(안에 다른 요소가 없다).
          expect(await bar.evaluate((el) => el.childElementCount)).toBe(0);
          await page.waitForTimeout(300);
          const box = (await bar.boundingBox())!;
          const png = await page.screenshot({ clip: { x: box.x, y: box.y, width: box.width, height: box.height } });
          // 다 찬 막대의 줄마다, 윤곽색인 첫 픽셀과 마지막 픽셀 사이는 모두 윤곽색이어야 한다.
          // 고치기 전에는 둥근 끝에서 테두리 안쪽 곡선과 채움 사이로 바탕색이 비쳐 그 사이에 밝은(어두운 화면에서는 어두운) 픽셀이 있었다.
          const result = await page.evaluate(async (b64) => {
            const img = new Image();
            img.src = `data:image/png;base64,${b64}`;
            await img.decode();
            const c = document.createElement('canvas');
            c.width = img.width;
            c.height = img.height;
            const g = c.getContext('2d')!;
            g.drawImage(img, 0, 0);
            const probe = document.createElement('span');
            probe.style.color = 'var(--outline)';
            document.body.appendChild(probe);
            const m = /(\d+), (\d+), (\d+)/.exec(getComputedStyle(probe).color)!;
            probe.remove();
            const outline = [Number(m[1]), Number(m[2]), Number(m[3])];
            const near = (d: Uint8ClampedArray, x: number) => Math.max(...[0, 1, 2].map((i) => Math.abs(d[x * 4 + i]! - outline[i]!))) <= 8;
            const bad: string[] = [];
            for (let y = 0; y < img.height; y += 1) {
              const d = g.getImageData(0, y, img.width, 1).data;
              let first = -1;
              let last = -1;
              for (let x = 0; x < img.width; x += 1) {
                if (near(d, x)) {
                  if (first < 0) first = x;
                  last = x;
                }
              }
              for (let x = first + 1; first >= 0 && x < last; x += 1) if (!near(d, x)) bad.push(`${x},${y}:${d[x * 4]},${d[x * 4 + 1]},${d[x * 4 + 2]}`);
            }
            return bad;
          }, png.toString('base64'));
          expect(result).toEqual([]);
        });
      });
    }
  }

  test('진행 막대: 채운 끝의 자리는 고치기 전과 같다(테두리 안쪽 폭에 비율을 곱한 자리)', async ({ page }) => {
    await openApp(page, '/');
    await seedStore(page, {
      version: 1,
      sessions: [
        {
          id: 's1',
          examId: 'sample-a',
          createdAt: '2026-11-22T10:00:00.000Z',
          gradedBefore: 'not_yet',
          seenBefore: 'first',
          answers: Object.fromEntries(examA.items.slice(0, 12).map((it) => [it.no, correctAnswers(examA)[it.no]!])),
        },
      ],
      currentId: 's1',
    });
    await page.reload();
    await openApp(page, '/input?input=keypad');
    await page.waitForTimeout(300);
    const { x: left, width } = (await page.locator(".progress").boundingBox())!;
    // 막대 안쪽(테두리 1px 안)의 40% 자리 바로 앞은 윤곽색, 바로 뒤는 바탕색이다.
    const end = left + 1 + (width - 2) * (12 / 30);
    const shot = await page.screenshot({ clip: { x: Math.floor(end) - 3, y: (await page.locator('.progress').boundingBox())!.y + 2, width: 6, height: 1 } });
    const px = await page.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d')!;
      g.drawImage(img, 0, 0);
      return Array.from(g.getImageData(0, 0, img.width, 1).data).filter((_, i) => i % 4 === 0);
    }, shot.toString('base64'));
    // 왼쪽 두 칸은 윤곽색(어두움), 오른쪽 두 칸은 바탕색(흰색)이다.
    expect(px[0]!).toBeLessThan(160);
    expect(px[1]!).toBeLessThan(160);
    expect(px[4]!).toBeGreaterThan(240);
    expect(px[5]!).toBeGreaterThan(240);
  });

  for (const scheme of ['light', 'dark'] as const) {
    test.describe(`표시 화면의 아래 단서(${scheme === 'light' ? '밝은' : '어두운'} 화면)`, () => {
      test.use({ viewport: { width: 390, height: 844 }, colorScheme: scheme });
      test('내용이 아래 띠 밑으로 더 이어질 때만 띠 위쪽에 옅은 그림자가 있다', async ({ page }) => {
        await openApp(page, '/');
        await seedStore(page, {
          version: 1,
          sessions: [{ id: 's1', examId: 'sample-a', createdAt: '2026-11-22T10:00:00.000Z', gradedBefore: 'not_yet', seenBefore: 'first', answers: correctAnswers(examA) }],
          currentId: 's1',
        });
        await page.reload();
        await openApp(page, '/marks');
        const dock = page.locator('.dock');
        // 맨 위: 단답형 칸이 띠 밑으로 이어지므로 그림자가 있다.
        await expect(dock).toHaveAttribute('data-more', 'true');
        const shade = await dock.evaluate((el) => {
          const cs = getComputedStyle(el, '::before');
          return { content: cs.content, height: cs.height, image: cs.backgroundImage, events: cs.pointerEvents };
        });
        expect(shade.content).not.toBe('none');
        expect(shade.height).toBe('12px');
        expect(shade.image).toContain('linear-gradient');
        expect(shade.events).toBe('none');
        // 글자나 화살표는 더하지 않는다.
        expect(await dock.evaluate((el) => getComputedStyle(el, '::before').content)).toBe('""');
        // 끝까지 내리면 없어진다.
        await page.locator('main.body').evaluate((el) => {
          el.scrollTop = el.scrollHeight;
        });
        await expect(dock).toHaveAttribute('data-more', 'false');
        expect(await dock.evaluate((el) => getComputedStyle(el, '::before').content)).toBe('none');
        // 다시 위로 올리면 다시 보인다.
        await page.locator('main.body').evaluate((el) => {
          el.scrollTop = 0;
        });
        await expect(dock).toHaveAttribute('data-more', 'true');
      });
    });
  }

  test('표시 화면: 내용이 다 들어오는 화면에서는 그림자가 없고, 다른 화면에는 이 단서를 붙이지 않는다', async ({ page }) => {
    await page.setViewportSize({ width: 430, height: 1600 });
    await openApp(page, '/');
    await seedStore(page, {
      version: 1,
      sessions: [{ id: 's1', examId: 'sample-a', createdAt: '2026-11-22T10:00:00.000Z', gradedBefore: 'not_yet', seenBefore: 'first', answers: correctAnswers(examA) }],
      currentId: 's1',
    });
    await page.reload();
    await openApp(page, '/marks');
    await expect(page.locator('.dock')).toHaveAttribute('data-more', 'false');
    await openApp(page, '/review');
    await expect(page.locator('.dock')).not.toHaveAttribute('data-more', /.*/);
  });

  test('표시 화면: 나중에 생긴 내용으로 띠 밑까지 이어지면 스크롤하지 않아도 그림자가 생기고, 그 내용이 빠지면 없어진다', async ({ page }) => {
    await page.setViewportSize({ width: 430, height: 1600 });
    await openApp(page, '/');
    await seedStore(page, {
      version: 1,
      sessions: [{ id: 's1', examId: 'sample-a', createdAt: '2026-11-22T10:00:00.000Z', gradedBefore: 'not_yet', seenBefore: 'first', answers: correctAnswers(examA) }],
      currentId: 's1',
    });
    await page.reload();
    await openApp(page, '/marks');
    const dock = page.locator('.dock');
    await expect(dock).toHaveAttribute('data-more', 'false');
    // 화면 안에 나중에 내용이 생긴 것(채점한 뒤의 안내 같은)을 흉내 낸다: 맨 아래 묶음 안에 높은 요소를 넣는다(별도 검토 F6).
    await page.evaluate(() => {
      const sections = document.querySelectorAll('main.body section');
      const last = sections[sections.length - 1]!;
      const tall = document.createElement('div');
      tall.dataset.testid = 'late-content';
      tall.style.height = '1200px';
      last.appendChild(tall);
    });
    await expect(dock).toHaveAttribute('data-more', 'true');
    expect(await page.locator('main.body').evaluate((el) => el.scrollTop)).toBe(0);
    await page.evaluate(() => document.querySelector('[data-testid="late-content"]')!.remove());
    await expect(dock).toHaveAttribute('data-more', 'false');
  });
});
