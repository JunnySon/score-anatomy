import { S } from './strings';
import { addAcceptListener, addDiscardListener, INTERACTIVE_SELECTOR, type DiscardInfo } from './tapGuard';

// 연달아 누르기 보호(src/tapGuard.ts)가 누름을 버렸을 때 띄우는 알림.
//
// - 버린 누름이 누를 수 있는 요소(버튼, 링크, 키 등) 위였을 때만 띄운다. 빈 바탕을 누른 것에는 띄우지 않는다.
// - 2초 뒤 사라지고, 받아들인 누름이 오면 바로 닫는다.
// - 같은 보호 구간에서는 한 번만 띄우고 화면 낭독기에도 한 번만 전한다. 겹쳐 뜨지 않는다(늘 하나만 둔다).
// - 화면 구성을 밀지 않게 고정 위치에 띄우고, 누를 수 있는 요소를 가리지 않는 자리를 찾아 놓는다.
//   알림 자체는 누름을 받지 않는다(pointer-events: none).
// - 보이는 알림은 화면 낭독기에서 숨기고, 낭독은 따로 둔 알림 영역(role=status)으로 한다. 바텀시트나 대화상자가
//   열려 있으면 그 안에 알림 영역을 두어, 대화상자 밖을 읽지 않는 화면 낭독기에도 전해지게 한다.
// - 뜨고 사라지는 것은 "화면이 바뀜"으로 세지 않는다(보호를 다시 걸지 않는다).

export const TAP_NOTICE_MS = 2000;

let box: HTMLDivElement | null = null;
let live: HTMLDivElement | null = null;
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

/** 화면 낭독기 알림 영역을 둘 곳. 열린 대화상자가 있으면 그 안, 없으면 문서 끝. */
function liveHost(): Element {
  const modals = document.querySelectorAll('[aria-modal="true"]');
  return modals.length > 0 ? modals[modals.length - 1]! : document.body;
}

export function hideTapNotice(): void {
  window.clearTimeout(timer);
  window.cancelAnimationFrame(frame);
  timer = 0;
  frame = 0;
  box?.remove();
  live?.remove();
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
  // 알림 영역을 먼저 비워 둔 채로 붙이고, 다음 그림 차례에 글자를 넣어야 화면 낭독기가 바뀐 것으로 읽는다.
  live = document.createElement('div');
  live.className = 'sr-only';
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');
  live.dataset.testid = 'tap-notice-live';
  liveHost().appendChild(live);
  const target = live;
  frame = window.requestAnimationFrame(() => {
    target.textContent = S.common.tapDiscarded;
  });
  timer = window.setTimeout(hideTapNotice, TAP_NOTICE_MS);
}

/** 앱이 시작될 때 한 번 부른다. */
export function installTapNotice(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  addDiscardListener(showTapNotice);
  addAcceptListener(hideTapNotice);
}
