// 같은 자리를 연달아 눌렀을 때, 그 사이에 바뀐 화면의 버튼까지 눌리는 일을 막는다.
//
// 화면이 바뀌면(다른 화면으로 넘어감, 바텀시트나 대화상자가 열리거나 닫힘, 아래 버튼이 바뀜, 쪽이나 묶음이 넘어감)
// 그 화면을 바꾼 누름의 자리(가로세로 48px)에 다시 온 누름을 0.5초 동안 받지 않는다.
// 받지 않은 누름이 있으면 그때부터 0.5초를 다시 센다(연타가 멈춘 뒤에야 그 자리가 눌린다).
// 다른 자리를 누르면 바로 푼다.
//
// - 화면을 요소로 가리지 않고 그 자리에 온 click 만 버린다. 그래서 그 자리에서 시작한 끌기(스크롤)는 그대로 된다.
// - 화면 전체를 막는 것은 두 경우다. 하나는 마지막 문항의 답을 넣어 저절로 입력 확인 화면으로 넘어갈 때다.
//   답을 넣던 박자로 더 누른 것이 새 화면의 버튼(다른 자리)에 닿아 확인과 표시를 건너뛰고 채점되는 일을 막는다.
//   다른 하나는 학생의 누름 없이 껍데기가 넘겨준 새 시험 자료로 화면 안 내용의 자리가 옮겨 갈 때다(markContentShifted).
//   옮겨 가기 전의 자리를 보고 누른 것이 그 자리에 온 다른 시험이나 다른 문항에 닿지 않게 한다(작업 지시서 3의 별도 검토 A3).
//   그 밖에는 다른 자리의 키를 화면이 바뀐 직후에 눌러도 들어간다.
// - 단답형 숫자 키(data-tap-safe)는 버리지 않는다. 숫자는 "다음"이나 "넣기"로 확정하기 전에는 저장되지 않고
//   큰 칸에 보여서, 잘못 들어가도 보고 지울 수 있다. 반대로 숫자를 버리면 누른 것과 다른 답(150 대신 50)이 저장될 수 있다.
//   화면 전체를 막는 동안 받은 숫자 키는 막기를 풀지 않는다. 숫자 하나로 막기가 풀려 이어 누른 다른 키(답 맞춰 보기 등)가
//   그대로 들어가는 일을 막는다(별도 검토 2차 P1).
// - 다만 넘겨받은 새 자료로 재풀이의 지금 문항이 다른 문항으로 옮겨 갔을 때는 그 0.5초 동안 숫자 키도 버린다(markContentShifted 의 strict).
//   그때 누른 숫자는 옮겨 가기 전 문항에 넣던 답의 나머지라서, 옮겨 온 문항의 칸에 들어가면 안 된다(별도 검토 2차 P1).
// - 키보드로 누른 것(Enter, Space)은 건드리지 않는다.
// - 버린 누름이 누를 수 있는 요소 위였으면 알림을 띄운다(src/tapNotice.ts). 측정 중이면 버린 누름을 센다(src/App.tsx).
//
// 빠진 누름 채우기(작업 지시서 3-1의 3-1):
// 아이폰의 웹뷰는 손을 떼고 몇 ms 안에 같은 자리를 다시 누르면 첫 누름의 click(detail 1)을 보내지 않고
// 손뗌 두 번(touchend, pointerup) 뒤에 click(detail 2) 하나와 dblclick 만 보낸다. 그래서 detail 이 d(2 이상)인 click 이 오면,
// 마지막으로 받은 click 뒤에 이 자리(가로세로 24px 안)에서 1초 안에 손을 뗀 횟수를 센다. 손뗌은 click 마다 하나씩이라
// 손뗌이 click 보다 많으면 그만큼 click 이 빠진 것이다. 빠진 수(손뗌 수 - 1, 많아도 d-1)만큼의 click 을
// 같은 요소, 같은 좌표로 먼저 만들어 보낸 뒤에 지금 click 을 평소대로 처리한다.
// - detail 의 이어짐만으로 짐작하지 않는다. 안드로이드 크롬은 다른 키를 빠르게 이어 눌러도 detail 을 올리고,
//   윈도우의 Chromium 은 detail 을 3까지만 올려서, 그것만 보면 진짜 click 이 다 오는데도 누름을 더 넣게 된다(별도 검토 F1, F2).
//   click 마다 손뗌이 하나씩 오는 브라우저(마우스, 안드로이드, 보통 빠르기의 아이폰 누름)에서는 채우지 않는다.
// - 입력은 그대로 click 으로만 받는다. 손뗌은 세기만 한다. 끌기와 스크롤(누른 자리에서 16px 넘게 움직인 손뗌, 취소된 누름)은 세지 않는다.
// - 만들어 보낸 click 도 진짜 click 과 똑같이 이 보호를 거친다(막고 있는 곳이면 버려진다). 보호를 볼 때의 시각은
//   그 누름의 손뗌 시각이다(진짜 click 이 왔을 시각, 별도 검토 F5).
// - 보호가 버린 click 도 "받은 것"으로 센다(손뗌 수를 거기서 다시 센다). 버려진 누름을 다시 채워 넣지 않는다.
// - 만들어 보낸 click 의 처리(화면 그리기와 그 뒤의 효과)는 지금 click 보다 먼저 끝낸다(flushSync).
//   그래야 지금 click 이 첫 누름이 바꾼 화면과 상태를 보고 처리된다. 진짜 click 이 차례로 다 온 것과 같다.
// - 누른 요소는 가장 가까운 누를 수 있는 요소(버튼 등)로 본다. 만들어 보낸 click 으로 그 요소가 화면에서 사라졌거나
//   쓸 수 없게 됐거나 그 자리를 다른 요소가 덮었으면 지금 click 은 (보호에 버려지지 않았더라도) 어디에도 들어가지 않게 한다.
//   바뀐 화면의 다른 요소가 대신 눌리지 않게 한다. 요소는 그대로인데 그 안의 글자 요소만 바뀌었으면(예: "찍음" 글자가 지워짐)
//   지금 click 을 그 자리의 지금 요소로 다시 보낸다(별도 검토 F3).
// - 키보드나 스크립트로 낸 click(detail 0)과 dblclick 은 건드리지 않는다. 보호의 시간, 거리, 대상은 그대로다.
// - 측정 중이면 채운 누름을 센다(src/App.tsx, filled_taps).

/** 화면이 바뀐 뒤, 그 화면을 바꾼 누름의 자리를 다시 누른 것을 받지 않는 시간(ms). */
export const TAP_GUARD_MS = 500;

/** 같은 자리로 보는 거리(px). 앞에 누른 자리에서 가로세로 이만큼 안쪽이다. */
export const TAP_GUARD_PX = 24;

/**
 * 빠진 누름 채우기: click 앞의 손뗌을 이 click 의 누름 묶음으로 세는 가장 긴 사이(ms). 아이폰에서 빠지는 첫 누름은
 * 손을 떼고 몇 ms 안에 다시 누른 것이라 넉넉하다. 오래전의 손뗌(끌기 끝 등)을 세지 않으려고 둔다.
 */
export const FILL_WINDOW_MS = 1000;

/** 빠진 누름 채우기: click 의 자리에서 가로세로 이만큼 안의 손뗌만 센다(px). 연달아 누르기 보호와 같은 거리다. */
export const FILL_SPOT_PX = TAP_GUARD_PX;

/** 빠진 누름 채우기: 누른 자리에서 이만큼 넘게 움직인 손뗌은 누름이 아니라 끌기나 스크롤로 보고 세지 않는다(px). */
export const FILL_MOVE_PX = 16;

interface Spot {
  x: number;
  y: number;
}

/** 막는 넓이. spot 은 누른 자리만, screen 은 화면 전체. */
export type GuardArea = 'spot' | 'screen';

/** 마지막으로 받아들인 누름. */
let lastClick: (Spot & { at: number }) | null = null;
/** 손을 뗀 자리와 시각(받은 때의 performance.now()). */
interface Release extends Spot {
  t: number;
}
/**
 * 마지막으로 받은 click(보호가 버린 것도 센다) 뒤의 손뗌. pointerup 과 touchend 를 따로 모아 많은 쪽을 쓴다
 * (한 번 뗀 것이 둘 다로 오므로 더하지 않는다. 둘 가운데 하나만 오는 브라우저도 센다).
 */
const releases: { pointer: Release[]; touch: Release[] } = { pointer: [], touch: [] };
/** 누르기 시작한 자리(pointerId 와 touch identifier 별). 손뗌이 끌기였는지 볼 때 쓴다. */
const pointerDowns = new Map<number, Spot>();
const touchDowns = new Map<number, Spot>();
/** 빠진 누름을 만들어 보내는 중인지. 만들어 보낸 click 에서는 다시 채우지 않는다. */
let filling = false;
/** 만들어 보내는 click 의 보호를 볼 시각(그 누름의 손뗌 시각). 없으면 지금 시각. */
let fillClock: number | null = null;
/** 지금 click 을 그 자리의 지금 요소로 다시 보내는 중인지. 다시 보낸 click 에서는 채우지 않는다. */
let redispatching = false;
/** 만들어 보낸 click 을 처리할 때 감싸는 함수. 화면 그리기를 지금 끝내게 한다(src/main.tsx 가 React 의 flushSync 를 넣는다). */
let flushRunner: (fn: () => void) => void = (fn) => fn();
/** 지금 막고 있는 자리. strict 면 단답형 숫자 키(data-tap-safe)도 버린다. */
let guard: (Spot & { area: GuardArea; until: number; strict: boolean }) | null = null;
/** 막고 있는 자리에 두는 표시. 누름을 받지 않는다. 화면 테스트와 화면 검사가 막는 시간이 끝났는지 볼 때 쓴다. */
let marker: HTMLDivElement | null = null;
let timer = 0;
let installed = false;
/** 보호 구간의 번호. 화면이 바뀌어 새로 막기 시작할 때마다 하나씩 늘린다. 버린 누름으로 다시 셀 때는 그대로다. */
let guardId = 0;

/** 누를 수 있는 요소. 버린 누름이 이 위였을 때만 알림을 띄운다. */
export const INTERACTIVE_SELECTOR =
  'button, a[href], input, select, textarea, summary, label, [role="button"], [role="radio"], [role="link"], [role="tab"], [tabindex]:not([tabindex="-1"])';

export interface DiscardInfo {
  /** 버린 누름이 누를 수 있는 요소 위였는지. 빈 바탕을 누른 것이면 false. */
  interactive: boolean;
  /** 보호 구간의 번호. 같은 구간에서는 알림을 한 번만 띄운다. */
  guardId: number;
}

const discardListeners = new Set<(info: DiscardInfo) => void>();
const acceptListeners = new Set<() => void>();
const fillListeners = new Set<() => void>();

/** 빠진 누름을 하나 채울 때마다 불린다(측정 중 filled_taps 를 센다). 되돌려 주는 함수로 듣기를 그만둔다. */
export function addFillListener(fn: () => void): () => void {
  fillListeners.add(fn);
  return () => {
    fillListeners.delete(fn);
  };
}

/** 만들어 보낸 click 을 처리할 때 감쌀 함수를 정한다. 화면 그리기를 지금 끝내는 함수(React 의 flushSync)를 넣는다. */
export function setFillFlush(fn: (run: () => void) => void): void {
  flushRunner = fn;
}

/** 보호가 누름을 버릴 때마다 불린다. 되돌려 주는 함수로 듣기를 그만둔다. */
export function addDiscardListener(fn: (info: DiscardInfo) => void): () => void {
  discardListeners.add(fn);
  return () => {
    discardListeners.delete(fn);
  };
}

/** 누름을 받아들일 때마다 불린다(알림을 바로 닫는 데 쓴다). */
export function addAcceptListener(fn: () => void): () => void {
  acceptListeners.add(fn);
  return () => {
    acceptListeners.delete(fn);
  };
}

function clearGuard(): void {
  window.clearTimeout(timer);
  timer = 0;
  guard = null;
  if (marker) {
    marker.remove();
    marker = null;
  }
}

function holdGuard(spot: Spot, area: GuardArea, ms: number, strict = false): void {
  guard = { x: spot.x, y: spot.y, area, until: performance.now() + ms, strict };
  if (!marker) {
    marker = document.createElement('div');
    marker.className = 'tap-shield';
    marker.setAttribute('aria-hidden', 'true');
    document.body.appendChild(marker);
  }
  marker.dataset.area = area;
  if (area === 'screen') {
    marker.style.left = '0';
    marker.style.top = '0';
    marker.style.width = '100%';
    marker.style.height = '100%';
  } else {
    marker.style.left = `${spot.x - TAP_GUARD_PX}px`;
    marker.style.top = `${spot.y - TAP_GUARD_PX}px`;
    marker.style.width = `${TAP_GUARD_PX * 2}px`;
    marker.style.height = `${TAP_GUARD_PX * 2}px`;
  }
  window.clearTimeout(timer);
  timer = window.setTimeout(clearGuard, ms);
}

/** 그 누름이 지금 막고 있는 곳에 왔는지. */
function isGuarded(e: MouseEvent, now: number): boolean {
  if (!guard || now >= guard.until) return false;
  if (guard.area === 'screen') return true;
  return Math.abs(e.clientX - guard.x) <= TAP_GUARD_PX && Math.abs(e.clientY - guard.y) <= TAP_GUARD_PX;
}

/** 누른 요소(가장 가까운 누를 수 있는 요소, 없으면 누른 요소 자체). */
function controlOf(target: Element): Element {
  return target.closest(INTERACTIVE_SELECTOR) ?? target;
}

/** 손뗌을 모은다. 오래된 것은 버리고 많아도 8개만 둔다. */
function remember(list: Release[], r: Release): void {
  list.push(r);
  while (list.length > 0 && r.t - list[0]!.t > FILL_WINDOW_MS) list.shift();
  if (list.length > 8) list.splice(0, list.length - 8);
}

function moved(from: Spot | undefined, x: number, y: number): boolean {
  return from !== undefined && Math.hypot(x - from.x, y - from.y) > FILL_MOVE_PX;
}

function onPointerDown(e: PointerEvent): void {
  if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
  pointerDowns.set(e.pointerId, { x: e.clientX, y: e.clientY });
}

function onPointerUp(e: PointerEvent): void {
  if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
  const from = pointerDowns.get(e.pointerId);
  pointerDowns.delete(e.pointerId);
  if (moved(from, e.clientX, e.clientY)) return;
  remember(releases.pointer, { x: e.clientX, y: e.clientY, t: performance.now() });
}

function onPointerCancel(e: PointerEvent): void {
  pointerDowns.delete(e.pointerId);
}

function onTouchStart(e: TouchEvent): void {
  for (const t of Array.from(e.changedTouches)) touchDowns.set(t.identifier, { x: t.clientX, y: t.clientY });
}

function onTouchEnd(e: TouchEvent): void {
  const now = performance.now();
  for (const t of Array.from(e.changedTouches)) {
    const from = touchDowns.get(t.identifier);
    touchDowns.delete(t.identifier);
    if (moved(from, t.clientX, t.clientY)) continue;
    remember(releases.touch, { x: t.clientX, y: t.clientY, t: now });
  }
}

function onTouchCancel(e: TouchEvent): void {
  for (const t of Array.from(e.changedTouches)) touchDowns.delete(t.identifier);
}

/**
 * 이 click 앞에 빠진 누름의 손뗌 시각들(오래된 것부터). detail 이 d(2 이상)이면, 마지막으로 받은 click 뒤에
 * 이 click 의 자리에서 FILL_WINDOW_MS 안에 뗀 손뗌 가운데 이 click 자신의 것(가장 늦은 것)을 뺀 나머지가 빠진 누름이다.
 * 많아도 d-1 개다. 손뗌이 click 마다 하나씩이면 빈 목록이다.
 */
function missingReleases(e: MouseEvent): number[] {
  const d = e.detail;
  if (d < 2) return [];
  // 시각은 이벤트의 timeStamp 가 아니라 받은 때의 performance.now() 로 견준다. timeStamp 의 기준점이 엔진과 이벤트 종류마다
  // 다를 수 있어서다(보호를 볼 때도 같은 시계를 쓴다).
  const now = performance.now();
  const near = (r: Release) =>
    Math.abs(r.x - e.clientX) <= FILL_SPOT_PX && Math.abs(r.y - e.clientY) <= FILL_SPOT_PX && now - r.t <= FILL_WINDOW_MS;
  const fromPointer = releases.pointer.filter(near);
  const fromTouch = releases.touch.filter(near);
  const list = fromPointer.length >= fromTouch.length ? fromPointer : fromTouch;
  const count = Math.min(list.length - 1, d - 1);
  if (count <= 0) return [];
  return list.slice(list.length - 1 - count, list.length - 1).map((r) => r.t);
}

/** 누른 요소를 지금 그 자리에서 누를 수 있는지를 몇 가지로 나눠 본다. 채우기 전과 뒤를 견준다. */
interface Usable {
  connected: boolean;
  enabled: boolean;
  onTop: boolean;
  /** 그 좌표의 맨 위 요소. */
  hit: Element | null;
}

function usableOf(control: Element, x: number, y: number): Usable {
  const connected = control.isConnected && control.closest('[inert]') === null;
  const enabled = !control.matches(':disabled') && control.getAttribute('aria-disabled') !== 'true';
  let onTop = true;
  let hit: Element | null = null;
  if (typeof document.elementFromPoint === 'function') {
    hit = document.elementFromPoint(x, y);
    onTop = hit !== null && (hit === control || control.contains(hit));
  }
  return { connected, enabled, onTop, hit };
}

/** 채우기 전에는 누를 수 있었는데 채운 뒤에 사라졌거나 쓸 수 없게 됐거나 다른 요소에 덮였는지. */
function becameUnusable(before: Usable, after: Usable): boolean {
  return (before.connected && !after.connected) || (before.enabled && !after.enabled) || (before.onTop && !after.onTop);
}

/** e 와 같은 click 을 detail 만 정해 새로 만든다. */
function cloneClick(e: MouseEvent, detail: number): MouseEvent {
  return new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    detail,
    clientX: e.clientX,
    clientY: e.clientY,
    screenX: e.screenX,
    screenY: e.screenY,
    button: e.button,
    ctrlKey: e.ctrlKey,
    shiftKey: e.shiftKey,
    altKey: e.altKey,
    metaKey: e.metaKey,
  });
}

/**
 * 빠진 click 을 같은 요소, 같은 좌표로 만들어 보낸다. 하나씩 보내고 그 처리(화면 그리기)를 끝낸 뒤 다음 것을 보낸다.
 * 누른 글자 요소가 앞 click 으로 바뀌었으면 같은 요소 안의 그 자리의 지금 요소로 보낸다. 그것도 없으면 멈춘다.
 */
function fillMissing(e: MouseEvent, target: Element, control: Element, times: number[]): void {
  const first = e.detail - times.length;
  for (let i = 0; i < times.length; i += 1) {
    let to: Element | null = target.isConnected ? target : null;
    if (!to && control.isConnected && typeof document.elementFromPoint === 'function') {
      const hit = document.elementFromPoint(e.clientX, e.clientY);
      if (hit && control.contains(hit)) to = hit;
    }
    if (!to) return;
    const at = to;
    const ev = cloneClick(e, first + i);
    for (const l of fillListeners) l();
    filling = true;
    fillClock = times[i]!;
    try {
      flushRunner(() => {
        at.dispatchEvent(ev);
      });
    } finally {
      filling = false;
      fillClock = null;
    }
  }
}

function onClick(e: MouseEvent): void {
  // 키보드나 스크립트로 낸 click(detail 0)은 누른 자리가 없으므로 건드리지 않는다.
  if (e.detail === 0) return;
  // 빠진 누름 채우기. 만들어 보낸 click 은 이 함수를 다시 지나며(filling) 아래의 보호를 그대로 거친다.
  let lost = false;
  // 지금 click 이 실제로 닿는 요소. 채운 누름으로 화면이 바뀌었으면 진짜 click 이 차례로 다 왔을 때 이 click 이 닿았을 요소
  // (그 좌표의 지금 맨 위 요소)로 본다. 보호가 버릴 때의 알림 여부와 숫자 키 여부를 이것으로 정한다.
  let hitTarget: EventTarget | null = e.target;
  if (!filling && !redispatching) {
    const times = e.target instanceof Element ? missingReleases(e) : [];
    // 받은 click 이므로 손뗌은 여기서 다시 센다(보호가 버리는 click 도 같다).
    releases.pointer = [];
    releases.touch = [];
    if (times.length > 0 && e.target instanceof Element) {
      const target = e.target;
      const control = controlOf(target);
      const before = usableOf(control, e.clientX, e.clientY);
      fillMissing(e, target, control, times);
      const after = usableOf(control, e.clientX, e.clientY);
      lost = becameUnusable(before, after);
      if (!lost && !target.isConnected && after.hit !== null && control.contains(after.hit)) {
        // 누른 요소는 그대로인데 그 안의 글자 요소가 바뀌었다. 이 click 은 떨어져 나간 요소로는 처리되지 않으므로
        // 그 자리의 지금 요소로 다시 보내고, 다시 보낸 click 이 아래의 보호를 거친다.
        e.preventDefault();
        e.stopImmediatePropagation();
        redispatching = true;
        try {
          after.hit.dispatchEvent(cloneClick(e, e.detail));
        } finally {
          redispatching = false;
        }
        return;
      }
      if (before.onTop && after.hit !== null) hitTarget = after.hit;
    }
  }
  // 만들어 보낸 click 은 그 누름의 손뗌 시각으로 보호를 본다(진짜 click 이 왔을 시각, 별도 검토 F5).
  const now = filling && fillClock !== null ? Math.min(fillClock, performance.now()) : performance.now();
  if (guard && isGuarded(e, now)) {
    const safe = !guard.strict && hitTarget instanceof Element && hitTarget.closest('[data-tap-safe]') !== null;
    if (!safe) {
      // 막고 있는 곳에 온 누름은 버리고, 그때부터 다시 센다.
      e.preventDefault();
      e.stopImmediatePropagation();
      holdGuard(guard, guard.area, TAP_GUARD_MS, guard.strict);
      const interactive = hitTarget instanceof Element && hitTarget.closest(INTERACTIVE_SELECTOR) !== null;
      for (const l of discardListeners) l({ interactive, guardId });
      return;
    }
  }
  if (lost) {
    // 채운 누름으로 원래 요소가 사라졌거나 쓸 수 없게 됐다. 지금 click 은 어디에도 들어가지 않게 한다.
    // 보호가 버린 것이 아니므로 알림을 띄우거나 세지 않고, 받아들인 누름으로도 치지 않는다.
    e.preventDefault();
    e.stopImmediatePropagation();
    return;
  }
  if (guard && isGuarded(e, now)) {
    if (guard.area === 'screen') {
      // 화면 전체를 막는 동안 받은 숫자 키는 막기를 풀지 않는다(별도 검토 2차 P1). 남은 시간 동안 다른 키는 그대로 버린다.
      // 버린 누름 알림도 닫지 않는다. 닫으면 같은 보호 구간에서 이어 버린 누름이 알림 없이 사라진다(별도 검토 2차 뒤 확인 X3).
      lastClick = { x: e.clientX, y: e.clientY, at: now };
      return;
    }
  }
  clearGuard();
  lastClick = { x: e.clientX, y: e.clientY, at: now };
  for (const l of acceptListeners) l();
}

/** 앱이 시작될 때 한 번 부른다. 모든 누름(click)을 화면의 다른 처리보다 먼저 본다. */
export function installTapGuard(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('click', onClick, true);
  // 빠진 누름 채우기가 손뗌을 센다. 누름을 받거나 막지 않고 세기만 한다.
  window.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true });
  window.addEventListener('pointerup', onPointerUp, { capture: true, passive: true });
  window.addEventListener('pointercancel', onPointerCancel, { capture: true, passive: true });
  window.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
  window.addEventListener('touchend', onTouchEnd, { capture: true, passive: true });
  window.addEventListener('touchcancel', onTouchCancel, { capture: true, passive: true });
}

/**
 * 화면이 바뀌었다고 알린다. 방금(0.5초 안에) 받아들인 누름이 있으면 그 자리를 이때부터 0.5초 막는다.
 * 누른 적이 없거나 시간이 지났으면 아무것도 하지 않는다.
 * area 가 screen 이면 그 자리만이 아니라 화면 전체를 막는다(답을 넣다가 저절로 다음 화면으로 넘어갈 때만 쓴다).
 * 화면 전체를 막고 있는 동안 다시 불리면(넘어간 화면이 그려지면서 부른다) 넓이를 좁히지 않는다.
 */
export function markUiChanged(area: GuardArea = 'spot'): void {
  if (typeof document === 'undefined' || !lastClick) return;
  const now = performance.now();
  if (now - lastClick.at >= TAP_GUARD_MS) return;
  const keepScreen = guard !== null && guard.area === 'screen' && now < guard.until;
  // 숫자 키까지 막는 화면 전체 막기(markContentShifted 의 strict)가 남아 있으면 그것도 줄이지 않는다.
  const keepStrict = keepScreen && guard !== null && guard.strict;
  guardId += 1;
  holdGuard(lastClick, area === 'screen' || keepScreen ? 'screen' : 'spot', TAP_GUARD_MS, keepStrict);
}

/**
 * 학생의 누름 없이(껍데기가 넘겨준 새 시험 자료로) 화면 안 내용의 자리가 옮겨 갔다고 알린다(작업 지시서 3의 별도 검토 A3).
 * markUiChanged 와 달리 마지막 누름과 상관없이 화면 전체를 이때부터 0.5초 막는다. 누른 적이 없으면 어느 자리를 막을지 알 수 없고,
 * 목록이 한 칸씩 밀리면 어느 자리에든 다른 선택지가 올 수 있어서다. 받지 않은 누름이 있으면 지금처럼 그때부터 다시 센다.
 * 키보드로 누른 것은 건드리지 않는다. 단답형 숫자 키(data-tap-safe)는 받되 막기를 풀지 않고, strict 면 숫자 키도 버린다
 * (재풀이의 지금 문항이 다른 문항으로 옮겨 갔을 때, 별도 검토 2차 P1).
 */
export function markContentShifted(strict = false): void {
  if (typeof document === 'undefined') return;
  guardId += 1;
  holdGuard(lastClick ?? { x: 0, y: 0 }, 'screen', TAP_GUARD_MS, strict);
}
