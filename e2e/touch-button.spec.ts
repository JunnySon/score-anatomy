import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Locator, Page } from '@playwright/test';
import { ROOT, expect, expectHash, openApp, seedStore, test } from './helpers';
import { sessionRecord, storeOf } from './remoteData';

async function openScreen(page: Page, route: string) {
  const setup = route === '/anatomy' ? { targetGrade: null } : {
    gradedAt: null, firstGradedAt: null, marks: {}, ...(route === '/input' ? { answers: {} } : {}),
  };
  await openApp(page);
  await seedStore(page, JSON.parse(storeOf([sessionRecord('touch-test', 'sample-a', setup)])));
  await page.reload();
  await openApp(page, route === '/input' ? '/input?input=keypad' : route);
  await expectHash(page, route);
}

async function observe(target: Locator) {
  await target.evaluate(el => {
    const log = document.documentElement.dataset;
    delete log.downAtTarget;
    delete log.downAtWindow;
    el.addEventListener('mousedown', e => { log.downAtTarget = String(e.defaultPrevented); }, { once: true });
    window.addEventListener('mousedown', e => {
      if (e.composedPath().includes(el)) log.downAtWindow = String(e.defaultPrevented);
    }, { once: true });
  });
}

async function expectDown(page: Page, blocked: boolean) {
  await expect(page.locator('html')).toHaveAttribute('data-down-at-target', String(blocked));
  await expect(page.locator('html')).toHaveAttribute('data-down-at-window', String(blocked));
}

async function mimicTouch(target: Locator) {
  await target.evaluate(el => {
    const r = el.getBoundingClientRect();
    const coords = { clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 };
    const finger = new Touch({ identifier: 1, target: el, ...coords });
    for (const type of ['touchstart', 'touchend']) {
      const active = type === 'touchstart' ? [finger] : [];
      el.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, composed: true, changedTouches: [finger], touches: active, targetTouches: active }));
    }
    for (const type of ['mousedown', 'mouseup', 'click']) {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, detail: 1, ...coords }));
    }
  });
}

const screens = [
  { name: '표시 칸', route: '/marks', selector: '[data-mark-cell="3"]' },
  { name: '답 키', route: '/input', selector: '[data-key="3"]' },
  { name: '등급 선택', route: '/anatomy', selector: '[data-testid="grade-2"]' },
];
for (const screen of screens) {
  for (const native of [false, true]) {
    test(`${screen.name}의 ${native ? '실제 터치' : '터치 이벤트 열'}에서 mousedown은 전파되고 click은 한 번 들어간다`, async ({ page }) => {
      await openScreen(page, screen.route);
      const target = page.locator(screen.selector);
      await target.scrollIntoViewIfNeeded();
      await page.evaluate(selector => {
        const log = document.documentElement.dataset;
        log.buttonClicks = '0';
        window.addEventListener('click', e => {
          if (e.target instanceof Element && e.target.closest(selector)) log.buttonClicks = String(Number(log.buttonClicks) + 1);
        });
      }, screen.selector);
      await observe(target);
      if (native) await target.tap();
      else await mimicTouch(target);
      await expectDown(page, true);
      await expect(page.locator('html')).toHaveAttribute('data-button-clicks', '1');
      if (screen.route === '/marks') await expect(target).toHaveAttribute('data-mark', 'doubt');
      if (screen.route === '/input') await expect(page.getByTestId('now-no')).toHaveText('2번');
      if (screen.route === '/anatomy') await expect(target).toHaveAttribute('aria-checked', 'true');
    });
  }
}

async function release(target: Locator, pointerType = 'touch') {
  await target.evaluate((el, kind) => {
    for (const type of ['pointerdown', 'pointerup']) el.dispatchEvent(new PointerEvent(type, {
      bubbles: true, composed: true, pointerId: 7, pointerType: kind, isPrimary: true, button: 0,
    }));
  }, pointerType);
}

test('처음과 터치 직후에 실제 마우스로 누른 버튼이 포커스를 받는다', async ({ page }) => {
  await openScreen(page, '/marks');
  const button = page.locator('[data-mark-cell="3"]');
  const other = page.locator('[data-mark-cell="4"]');
  for (const afterTouch of [false, true]) {
    await other.focus();
    if (afterTouch) await release(button);
    await observe(button);
    await button.click();
    await expectDown(page, false);
    await expect(button).toBeFocused();
    await expect(button).toHaveAttribute('data-mark', afterTouch ? 'guess' : 'doubt');
  }
});

test('같은 버튼의 손뗌 신호만 쓰고 1초가 지나거나 다른 장치를 누르면 쓰지 않는다', async ({ page }) => {
  await openScreen(page, '/marks');
  const target = page.locator('[data-mark-cell="3"]');
  const neighbor = page.locator('[data-mark-cell="4"]');
  await page.clock.install();
  for (const mode of ['fresh', 'other', 'expired', 'pen', 'mouse', 'cancel']) {
    await release(mode === 'other' ? neighbor : target);
    if (mode === 'expired') await page.clock.fastForward(1001);
    if (mode === 'pen' || mode === 'mouse') await release(target, mode);
    if (mode === 'cancel') await target.dispatchEvent('pointercancel', { pointerType: 'touch', pointerId: 7 });
    await observe(target);
    await target.evaluate(el => el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: 1, clientY: 1 })));
    await expectDown(page, mode === 'fresh');
  }
});

test('터치 뒤 Tab, Enter와 Space로 표시를 바꾼다', async ({ page }) => {
  await openScreen(page, '/marks');
  const button = page.locator('[data-mark-cell="3"]');
  await release(button);
  await page.locator('[data-mark-cell="2"]').focus();
  await page.keyboard.press('Tab');
  await expect(button).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(button).toHaveAttribute('data-mark', 'doubt');
  await page.keyboard.press('Space');
  await expect(button).toHaveAttribute('data-mark', 'guess');
});

test('진행자 화면의 참가자 코드를 손가락으로 눌러 입력한다', async ({ page }) => {
  await openApp(page, '/test');
  const field = page.getByLabel('참가자 코드');
  await observe(field);
  await field.tap();
  await expectDown(page, false);
  await expect(field).toBeFocused();
  await page.keyboard.type('p07');
  await expect(field).toHaveValue('P07');
});

test('버튼 계열의 자식만 처리하고 편집 요소, 링크, 레이블과 다른 역할은 보존한다', async ({ page }) => {
  await openApp(page, '/test');
  const probes: [string, boolean][] = [
    ['<button><span data-at></span></button>', true],
    ...['button', 'radio', 'tab'].map((role): [string, boolean] => [`<div role="${role}"><span data-at></span></div>`, true]),
    ['<div role="button"><input data-at></div>', false],
    ['<div role="button"><textarea data-at></textarea></div>', false],
    ['<div role="button"><select data-at></select></div>', false],
    ['<div role="button"><a href="#probe"><span data-at></span></a></div>', false],
    ['<label><span role="button" data-at></span></label>', false],
    ['<details open><summary><span role="button" data-at></span></summary></details>', false],
    ['<div contenteditable><button data-at></button></div>', false],
    ['<div role="button"><span contenteditable data-at></span></div>', false],
    ['<div role="checkbox" tabindex="0"><span data-at></span></div>', false],
  ];
  for (const [markup, blocked] of probes) {
    const value = await page.evaluate(html => {
      const scope = document.createElement('div');
      scope.innerHTML = html;
      document.body.append(scope);
      const el = scope.querySelector('[data-at]')!;
      for (const type of ['pointerdown', 'pointerup']) el.dispatchEvent(new PointerEvent(type, {
        bubbles: true, composed: true, pointerType: 'touch', pointerId: 7, isPrimary: true,
      }));
      const event = new MouseEvent('mousedown', { bubbles: true, composed: true, cancelable: true });
      let bubbled = false;
      scope.addEventListener('mousedown', () => { bubbled = true; }, { once: true });
      el.dispatchEvent(event);
      scope.remove();
      return { prevented: event.defaultPrevented, bubbled };
    }, markup);
    expect(value, markup).toEqual({ prevented: blocked, bubbled: true });
  }
});

test('끄는 값이 0인 별도 빌드는 어느 버튼의 mousedown도 막지 않는다', async ({ page }, testInfo) => {
  const dir = testInfo.outputPath('touch-off');
  execFileSync(process.execPath, [resolve(ROOT, 'node_modules/vite/bin/vite.js'), 'build', '--mode', 'single', '--outDir', dir], {
    cwd: ROOT, env: { ...process.env, VITE_TOUCH_BUTTON_MOUSEDOWN: '0' }, stdio: 'pipe',
  });
  const { inlineDir } = await import(pathToFileURL(resolve(ROOT, 'scripts/inline.mjs')).href);
  await page.route('**/touch-off.html', route => route.fulfill({ contentType: 'text/html', body: inlineDir(dir) }));
  await page.goto('./touch-off.html#/demo/anatomy');
  const grade = page.getByTestId('grade-2');
  await observe(grade);
  await grade.tap();
  await expectDown(page, false);
  await expect(grade).toHaveAttribute('aria-checked', 'true');
  await page.evaluate(() => {
    const panel = document.createElement('div');
    panel.id = 'off-controls';
    panel.innerHTML = '<button>확인</button><div role="button">선택</div><div role="radio">항목</div><div role="tab">탭</div>';
    document.body.append(panel);
  });
  for (const control of await page.locator('#off-controls > *').all()) {
    await observe(control);
    await mimicTouch(control);
    await expectDown(page, false);
  }
});

test('펜과 터치 취소가 다른 이벤트 소스의 손뗌보다 먼저 와도 차단 단서가 되살아나지 않는다', async ({ page }) => {
  await openScreen(page, '/marks');
  const target = page.locator('[data-mark-cell="3"]');
  for (const order of ['pointercancel', 'touchcancel', 'pen-first', 'pen-second']) {
    await observe(target);
    await target.evaluate((el, order) => {
      const pen = order.startsWith('pen');
      const pointer = (type: string) => el.dispatchEvent(new PointerEvent(type, {
        bubbles: true, composed: true, pointerId: 2, pointerType: pen ? 'pen' : 'touch', isPrimary: true,
      }));
      const finger = new Touch({ identifier: 2, target: el });
      const touch = (type: string) => el.dispatchEvent(new TouchEvent(type, {
        bubbles: true, composed: true, changedTouches: [finger], touches: type === 'touchstart' ? [finger] : [],
      }));
      if (order === 'pen-second') touch('touchstart');
      pointer('pointerdown');
      if (order !== 'pen-second') touch('touchstart');
      if (order === 'touchcancel') touch('touchcancel');
      pointer(order === 'pointercancel' ? 'pointercancel' : 'pointerup');
      if (order !== 'touchcancel') touch('touchend');
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    }, order);
    await expectDown(page, false);
  }
});
