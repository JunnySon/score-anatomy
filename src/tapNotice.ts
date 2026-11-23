import { S } from './strings';
import { addAcceptListener, addDiscardListener, INTERACTIVE_SELECTOR, type DiscardInfo } from './tapGuard';

// 연달아 누르기 보호(src/tapGuard.ts)가 누름을 버렸을 때 띄우는 알림.
//
// - 버린 누름이 누를 수 있는 요소(버튼, 링크, 키 등) 위였을 때만 띄운다. 빈 바탕을 누른 것에는 띄우지 않는다.
// - 2초 뒤 사라지고, 받아들인 누름이 오면 바로 닫는다.
// - 같은 보호 구간에서는 한 번만 띄우고 화면 낭독기에도 한 번만 전한다. 겹쳐 뜨지 않는다(늘 하나만 둔다).
// - 화면 구성을 밀지 않게 고정 위치에 띄우고, 누를 수 있는 요소를 가리지 않는 자리를 찾아 놓는다.
//   알림 자체는 누름을 받지 않는다(pointer-events: none).
// - 보이는 알림은 화면 낭독기에서 숨기고, 낭독은 미리 붙여 둔 알림 영역(aria-live=polite)에 글자를 넣어 한다.
//   앱이 시작할 때 문서 끝에 하나를 만들어 두고, 바텀시트와 대화상자는 열릴 때부터 자기 안에 하나씩 둔다(data-tap-live).
//   대화상자가 열려 있으면 그 안의 영역을 써서, 대화상자 밖을 읽지 않는 화면 낭독기에도 전해지게 한다.
//   글자를 담은 채 새로 붙은 알림 영역은 화면 낭독기가 읽지 않는 경우가 많아서 영역을 미리 붙여 둔다.
// - 뜨고 사라지는 것은 "화면이 바뀜"으로 세지 않는다(보호를 다시 걸지 않는다).

export const TAP_NOTICE_MS = 2000;

let box: HTMLDivElement | null = null;
/** 앱이 시작할 때 문서 끝에 붙여 두는 알림 영역. */
let bodyLive: HTMLDivElement | null = null;
/** 지금 알림 글자를 넣어 둔 영역. */
let live: Element | null = null;
let timer = 0;
let frame = 0;
/** 알림을 띄운 보호 구간의 번호. 같은 구간에서는 다시 띄우지 않는다. */
let shownFor = -1;
let installed = false;

/** 기기의 위쪽 안전 영역 높이(px). 상태 표시줄 아래부터 놓으려고 잰다. */
function safeTop(): number {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;padding-top:env(safe-area-inset-top);visibility:hidden;pointer-events:none';
  document.body.appendChild(probe);
  const h = probe.getBoundingClientRect().height;
  probe.remove();
  return Number.isFinite(h) ? h : 0;
}

/** 지금 눌러질 수 있는 요소의 자리. 뒤 화면(inert)이나 보이지 않는 요소는 뺀다. */
function targetRects(): DOMRect[] {
  const out: DOMRect[] = [];
  for (const el of Array.from(document.querySelectorAll(INTERACTIVE_SELECTOR))) {
    if (box && box.contains(el)) continue;
    if (el.closest('[inert]') || el.closest('[aria-hidden="true"]')) continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0 || r.bottom <= 0 || r.top >= window.innerHeight) continue;
    if (getComputedStyle(el).visibility === 'hidden') continue;
    out.push(r);
  }
  return out;
}

/** 알림을 놓는다. 위에서부터 누를 수 있는 요소와 겹치지 않는 첫 자리를 찾는다. 없으면 맨 위(누름은 받지 않는다). */
function place(el: HTMLDivElement): void {
  const app = document.querySelector('.app');
  const col = app ? app.getBoundingClientRect() : { left: 0, width: window.innerWidth };
  const gutter = 16;
  const left = col.left + gutter;
  const width = Math.max(0, col.width - gutter * 2);
  el.style.left = `${left}px`;
  el.style.width = `${width}px`;
  el.style.top = '0px';
  const h = el.getBoundingClientRect().height;
  const top0 = safeTop();
  const rects = targetRects().filter((r) => r.right > left && r.left < left + width);
  const tops = [top0, ...rects.map((r) => r.bottom + 4)].filter((y) => y >= top0).sort((a, b) => a - b);
  for (const y of tops) {
    if (y + h > window.innerHeight) continue;
    if (rects.every((r) => r.bottom <= y || r.top >= y + h)) {
      el.style.top = `${y}px`;
      return;
    }
  }
  el.style.top = `${top0}px`;
}

/** 알림을 전할 영역. 열린 대화상자 안에 미리 둔 영역이 있으면 그것, 없으면 문서 끝의 영역. */
function liveRegion(): Element | null {
  const modals = document.querySelectorAll('[aria-modal="true"]');
  const modal = modals.length > 0 ? modals[modals.length - 1]! : null;
  return modal?.querySelector('[data-tap-live]') ?? bodyLive;
}

export function hideTapNotice(): void {
  window.clearTimeout(timer);
  window.cancelAnimationFrame(frame);
  timer = 0;
  frame = 0;
  box?.remove();
  if (live) live.textContent = '';
  box = null;
  live = null;
}

export function showTapNotice(info: DiscardInfo): void {
  if (!info.interactive || info.guardId === shownFor) return;
  shownFor = info.guardId;
  hideTapNotice();
  box = document.createElement('div');
  box.className = 'tap-notice';
  box.dataset.testid = 'tap-notice';
  box.setAttribute('aria-hidden', 'true');
  box.textContent = S.common.tapDiscarded;
  document.body.appendChild(box);
  place(box);
  // 미리 붙여 둔 알림 영역을 비운 뒤, 다음 그림 차례에 글자를 넣어야 화면 낭독기가 바뀐 것으로 읽는다.
  const target = liveRegion();
  live = target;
  if (target) {
    target.textContent = '';
    frame = window.requestAnimationFrame(() => {
      target.textContent = S.common.tapDiscarded;
    });
  }
  timer = window.setTimeout(hideTapNotice, TAP_NOTICE_MS);
}

/** 앱이 시작될 때 한 번 부른다. */
export function installTapNotice(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  bodyLive = document.createElement('div');
  bodyLive.className = 'sr-only';
  bodyLive.setAttribute('aria-live', 'polite');
  bodyLive.setAttribute('aria-atomic', 'true');
  bodyLive.dataset.tapLive = 'body';
  document.body.appendChild(bodyLive);
  addDiscardListener(showTapNotice);
  addAcceptListener(hideTapNotice);
}
