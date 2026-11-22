import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, expect, type Locator, type Page } from '@playwright/test';
import type { Answers, AnswerValue, Causes, Exam, Marks } from '../src/types';

// 화면 흐름 테스트 공통 도구.
// 모든 테스트는 실행 중 외부 요청이 0건인지 함께 검사한다.

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const OUT_DIR = resolve(ROOT, 'verify-out');
const METRICS = resolve(OUT_DIR, 'metrics.jsonl');

export function addMetric(record: Record<string, unknown>): void {
  mkdirSync(OUT_DIR, { recursive: true });
  appendFileSync(METRICS, JSON.stringify(record) + '\n');
}

export function loadExam(letter: 'a' | 'b' | 'c'): Exam {
  return JSON.parse(readFileSync(resolve(ROOT, `src/exams/sample-${letter}.json`), 'utf8')) as Exam;
}

function isLocal(url: string): boolean {
  return url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('about:');
}

/**
 * 연달아 누르기 보호(src/tapGuard.ts)는 화면이 바뀐 직후 0.5초 동안, 방금 누른 자리에 다시 온 누름을 버린다.
 * 막고 있는 자리에는 표시(.tap-shield)가 있다. 테스트는 사람보다 훨씬 빨리 눌러서, 다음에 누를 요소가 우연히
 * 그 자리에 있으면 누름이 버려지고 시각에 따라 결과가 달라진다.
 * 그래서 locator.click() 은 누를 자리가 막혀 있으면 풀릴 때까지 기다렸다가 누르게 한다(누르는 동작 자체는 그대로다).
 * 좌표로 직접 누르는 것(page.touchscreen.tap, page.mouse.click)은 기다리지 않는다. 보호 자체를 확인하는 테스트는 그쪽을 쓴다.
 */
function patchLocatorClick(page: Page): void {
  const proto = Object.getPrototypeOf(page.locator('html')) as { click: Locator['click']; __saGuardAware?: boolean };
  if (proto.__saGuardAware) return;
  const original = proto.click;
  proto.click = async function (this: Locator, options?: Parameters<Locator['click']>[0]) {
    const box = await this.boundingBox();
    if (box) {
      const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      await this.page().waitForFunction(({ x, y }) => {
        const mark = document.querySelector('.tap-shield');
        if (!mark) return true;
        const r = mark.getBoundingClientRect();
        return !(x >= r.left && x <= r.right && y >= r.top && y <= r.bottom);
      }, at);
    }
    return original.call(this, options);
  };
  proto.__saGuardAware = true;
}

export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    const all: string[] = [];
    const external: string[] = [];
    let origin: string | null = null;
    // 이 테스트의 브라우저 묶음(탭, 새 창, 워커 포함)에서 나가는 요청을 모두 기록한다.
    const context = page.context();
    context.on('request', (req) => {
      const url = req.url();
      if (isLocal(url)) return;
      all.push(url);
      const o = url.startsWith('file:') ? 'file:' : new URL(url).origin;
      if (origin === null) origin = o;
      if (o !== origin) external.push(url);
    });
    page.on('websocket', (ws) => external.push(ws.url()));
    // 알림 권한 요청 횟수를 센다(절대 원칙 1). 권한 값은 요청해도 바뀌지 않을 수 있어서 요청 함수 호출을 직접 센다.
    let permissionAsks = 0;
    await context.exposeBinding('__saPermissionAsked', () => {
      permissionAsks += 1;
    });
    await context.addInitScript(() => {
      if (!('Notification' in window)) return;
      const original = Notification.requestPermission.bind(Notification);
      Notification.requestPermission = ((...args: Parameters<typeof Notification.requestPermission>) => {
        (window as unknown as { __saPermissionAsked?: () => void }).__saPermissionAsked?.();
        return original(...args);
      }) as typeof Notification.requestPermission;
    });
    patchLocatorClick(page);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await use(page);
    const workers = context.serviceWorkers().length;
    addMetric({ kind: 'network', test: testInfo.titlePath.slice(1).join(' > '), total: all.length, external, serviceWorkers: workers, permissionAsks });
    expect(external, '자기 주소 밖으로 나간 요청').toEqual([]);
    expect(workers, '등록된 서비스 워커').toBe(0);
    expect(permissionAsks, '알림 권한을 요청한 횟수').toBe(0);
    expect(errors, '브라우저 콘솔 오류').toEqual([]);
  },
});

export { expect };

export async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

export async function openApp(page: Page, hash = '/'): Promise<void> {
  await page.goto(`./#${hash}`);
  await page.locator('.app').first().waitFor();
  await expect(page.locator('html')).toHaveAttribute('data-route', /.+/);
  await settle(page);
}

/** 주소가 바뀌고 그 화면이 실제로 그려질 때까지 기다린다. */
export async function expectHash(page: Page, hash: string): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.location.hash.split('?')[0])).toBe(`#${hash}`);
  await expect(page.locator('html')).toHaveAttribute('data-route', hash);
}

export async function chooseExam(
  page: Page,
  examId: string,
  graded: 'not_yet' | 'already' = 'not_yet',
  seen?: 'first' | 'partial' | 'solved',
): Promise<void> {
  await page.getByTestId(`exam-${examId}`).click();
  await page.getByTestId(`graded-${graded}`).click();
  if (seen) await page.getByTestId(`seen-${seen}`).click();
  await page.getByRole('button', { name: '답 넣기', exact: true }).click();
  await expectHash(page, '/input');
}

export async function tapKey(scope: Page | Locator, key: string | number): Promise<void> {
  await scope.locator(`[data-key="${key}"]`).click();
}

/** 키패드 방식으로 답을 차례로 넣는다. 마지막 문항을 넣으면 입력 확인으로 간다. */
export async function enterKeypad(page: Page, exam: Exam, answers: Answers, from = 1, to = exam.items.length): Promise<void> {
  for (const item of exam.items) {
    if (item.no < from || item.no > to) continue;
    await expect(page.getByTestId('now-no')).toHaveText(`${item.no}번`);
    const v = answers[item.no] as AnswerValue;
    if (v === 'skip') {
      await tapKey(page, 'skip');
    } else if (item.kind === 'mc') {
      await tapKey(page, v);
    } else {
      for (const d of String(v)) await tapKey(page, d);
      await expect(page.getByTestId('entry')).toContainText(String(v));
      await tapKey(page, 'go');
    }
  }
}

/** 5행 방식으로 답을 넣는다. 한 쪽에 5문항씩이고 자동으로 넘어가지 않는다. */
export async function enterRows(page: Page, exam: Exam, answers: Answers, onPage?: (pageIndex: number) => Promise<void>): Promise<void> {
  const pages = Math.ceil(exam.items.length / 5);
  for (let p = 0; p < pages; p += 1) {
    const items = exam.items.slice(p * 5, p * 5 + 5);
    await expect(page.locator(`[data-row="${items[0]!.no}"]`)).toBeVisible();
    for (const item of items) {
      const v = answers[item.no] as AnswerValue;
      const row = page.locator(`[data-row="${item.no}"]`);
      if (v === 'skip') {
        await row.locator('[data-row-no]').click();
        await page.locator('.sheet [data-menu="skip"]').click();
      } else if (item.kind === 'mc') {
        await row.locator(`[data-choice="${v}"]`).click();
        await expect(row.locator(`[data-choice="${v}"]`)).toHaveAttribute('aria-checked', 'true');
      } else {
        await row.locator('[data-short]').click();
        const sheet = page.locator('.sheet');
        for (const d of String(v)) await tapKey(sheet, d);
        await tapKey(sheet, 'go');
        await expect(sheet).toHaveCount(0);
        await expect(row.locator('[data-short]')).toContainText(String(v));
      }
    }
    if (onPage) await onPage(p);
    await page.getByTestId('rows-next').click();
  }
  await expectHash(page, '/review');
}

/** 표시 화면에서 표시를 붙인다. 한 번 누르면 고민, 두 번 누르면 찍음. */
export async function setMarks(page: Page, marks: Marks): Promise<void> {
  for (const [noText, mark] of Object.entries(marks)) {
    const no = Number(noText);
    if (mark === 'unsure') {
      await page.locator(`[data-short-mark="${no}"]`).click();
      await expect(page.locator(`[data-short-mark="${no}"]`)).toHaveAttribute('aria-pressed', 'true');
      continue;
    }
    const cell = page.locator(`[data-mark-cell="${no}"]`);
    await cell.click();
    await expect(cell).toHaveAttribute('data-mark', 'doubt');
    if (mark === 'guess') {
      await cell.click();
      await expect(cell).toHaveAttribute('data-mark', 'guess');
    }
  }
}

export async function chooseCauses(page: Page, causes: Causes): Promise<void> {
  for (const [noText, cause] of Object.entries(causes)) {
    const opt = page.getByTestId(`cause-${noText}-${cause}`);
    await opt.click();
    await expect(opt).toHaveAttribute('aria-checked', 'true');
  }
}

/** 재풀이 화면에서 답 하나를 넣고 맞춰 본다. */
export async function retryAnswer(page: Page, exam: Exam, no: number, value: number): Promise<void> {
  await expect(page.getByTestId('retry-no')).toHaveText(`${no}번`);
  const item = exam.items.find((it) => it.no === no)!;
  if (item.kind === 'mc') {
    await tapKey(page, value);
  } else {
    for (const d of String(value)) await tapKey(page, d);
  }
  await tapKey(page, 'go');
  await expect(page.getByTestId('retry-result')).toBeVisible();
}

export function correctAnswers(exam: Exam): Answers {
  const a: Answers = {};
  for (const it of exam.items) a[it.no] = it.answer as number;
  return a;
}

export function wrongValue(exam: Exam, no: number): number {
  const it = exam.items.find((x) => x.no === no)!;
  const ans = it.answer as number;
  return it.kind === 'mc' ? (ans % 5) + 1 : ans + 1;
}

/** 저장소에 기록을 직접 넣는다. 드문 상태(전부 정답 등)를 화면으로 만들 때만 쓴다. */
export async function seedStore(page: Page, data: unknown): Promise<void> {
  await page.evaluate((d) => window.localStorage.setItem('score-anatomy', JSON.stringify(d)), data);
}
