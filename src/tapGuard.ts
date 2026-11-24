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
// click(detail 2) 하나와 dblclick 만 보낸다. 그래서 click 의 detail 을 "이 자리에서 이어서 누른 횟수"로 보고,
// detail 이 d(2 이상)인 click 이 왔는데 바로 앞에 받은 click 이 이 누름 묶음의 d-1 번째가 아니면
// 모자란 click 을 같은 요소, 같은 좌표로 먼저 만들어 보낸 뒤에 지금 click 을 평소대로 처리한다.
// - 만들어 보낸 click 도 진짜 click 과 똑같이 이 보호를 거친다(막고 있는 곳이면 버려진다).
// - 보호가 버린 click 도 "받은 것"으로 센다. 버려진 누름을 다시 채워 넣지 않는다.
// - 만들어 보낸 click 의 처리(화면 그리기와 그 뒤의 효과)는 지금 click 보다 먼저 끝낸다(flushSync).
//   그래야 지금 click 이 첫 누름이 바꾼 화면과 상태를 보고 처리된다. 진짜 click 이 차례로 다 온 것과 같다.
// - 만들어 보낸 click 으로 원래 요소가 화면에서 사라졌거나 쓸 수 없게 됐거나 그 자리를 다른 요소가 덮었으면
//   지금 click 은 (보호에 버려지지 않았더라도) 어디에도 들어가지 않게 한다. 바뀐 화면의 다른 요소가 대신 눌리지 않게 한다.
// - 키보드나 스크립트로 낸 click(detail 0)과 dblclick 은 건드리지 않는다. 보호의 시간, 거리, 대상은 그대로다.
// - 측정 중이면 채운 누름을 센다(src/App.tsx, filled_taps).

/** 화면이 바뀐 뒤, 그 화면을 바꾼 누름의 자리를 다시 누른 것을 받지 않는 시간(ms). */
export const TAP_GUARD_MS = 500;

/** 같은 자리로 보는 거리(px). 앞에 누른 자리에서 가로세로 이만큼 안쪽이다. */
export const TAP_GUARD_PX = 24;

/**
 * 빠진 누름 채우기: 바로 앞에 받은 click 을 이 누름 묶음의 앞 누름으로 보는 가장 긴 사이(ms).
 * 브라우저가 이어 누름으로 세는 시간(윈도우 기본 0.5초, 설정의 가장 긴 값 0.9초, 안드로이드 0.3초)보다 넉넉하게 잡는다.
 * 짧게 잡으면 진짜 click 이 다 오는 브라우저에서 앞 click 을 놓친 것으로 잘못 보고 누름을 한 번 더 넣게 된다.
 * 길게 잡아서 생기는 잘못은 채우지 못하는 것(고치기 전과 같음)뿐이다. 결정기록 7장.
 */
export const FILL_CHAIN_MS = 1000;

/**
 * 빠진 누름 채우기: 바로 앞에 받은 click 을 같은 누름 묶음으로 보는 거리(px, 가로세로). 같은 요소를 누른 것이면 거리를 보지 않는다
 * (안드로이드는 두 번 누름의 허용 거리가 넓다). 요소가 다시 그려져 바뀐 경우를 위해 연달아 누르기 보호와 같은 거리를 쓴다.
 */
export const FILL_CHAIN_PX = TAP_GUARD_PX;

interface Spot {
  x: number;
  y: number;
}

/** 막는 넓이. spot 은 누른 자리만, screen 은 화면 전체. */
export type GuardArea = 'spot' | 'screen';

/** 마지막으로 받아들인 누름. */
let lastClick: (Spot & { at: number }) | null = null;
/** 마지막으로 받은 누름(보호가 버린 것도 센다). 빠진 누름 채우기가 앞 누름을 볼 때 쓴다. */
let lastReceived: (Spot & { at: number; detail: number; target: EventTarget | null }) | null = null;
/** 빠진 누름을 만들어 보내는 중인지. 만들어 보낸 click 에서는 다시 채우지 않는다. */
let filling = false;
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

/** 누른 요소(가장 가까운 누를 수 있는 요소, 없으면 누른 요소 자체). 같은 누름 묶음인지 볼 때 쓴다. */
function controlOf(target: EventTarget | null): EventTarget | null {
  return target instanceof Element ? (target.closest(INTERACTIVE_SELECTOR) ?? target) : target;
}

/**
 * 이 click 앞에 빠진 누름의 수. detail 이 d 인데 바로 앞에 받은 click 이 이 누름 묶음의 앞 누름(detail 이 d 보다 작고,
 * FILL_CHAIN_MS 안이고, 같은 요소이거나 FILL_CHAIN_PX 안)이면 그 사이에 모자란 수, 아니면 d-1 이다.
 */
function missingBefore(e: MouseEvent, now: number): number {
  const d = e.detail;
  if (d < 2) return 0;
  const prev = lastReceived;
  const chained =
    prev !== null &&
    prev.detail >= 1 &&
    prev.detail < d &&
    now - prev.at <= FILL_CHAIN_MS &&
    (controlOf(prev.target) === controlOf(e.target) || (Math.abs(e.clientX - prev.x) <= FILL_CHAIN_PX && Math.abs(e.clientY - prev.y) <= FILL_CHAIN_PX));
  return chained ? d - 1 - prev.detail : d - 1;
}

/** 누른 요소를 지금 그 자리에서 누를 수 있는지를 몇 가지로 나눠 본다. 채우기 전과 뒤를 견준다. */
interface Usable {
  connected: boolean;
  enabled: boolean;
  onTop: boolean;
  /** 그 좌표의 맨 위 요소. */
  hit: Element | null;
}

function usableOf(target: Element, x: number, y: number): Usable {
  const connected = target.isConnected && target.closest('[inert]') === null;
  const control = target.closest(INTERACTIVE_SELECTOR);
  const enabled = control === null || (!control.matches(':disabled') && control.getAttribute('aria-disabled') !== 'true');
  let onTop = true;
  let hit: Element | null = null;
  if (typeof document.elementFromPoint === 'function') {
    hit = document.elementFromPoint(x, y);
    onTop = hit !== null && (hit === target || target.contains(hit));
  }
  return { connected, enabled, onTop, hit };
}

/** 채우기 전에는 누를 수 있었는데 채운 뒤에 사라졌거나 쓸 수 없게 됐거나 다른 요소에 덮였는지. */
function becameUnusable(before: Usable, after: Usable): boolean {
  return (before.connected && !after.connected) || (before.enabled && !after.enabled) || (before.onTop && !after.onTop);
}

/** 빠진 click 을 같은 요소, 같은 좌표로 만들어 보낸다. 하나씩 보내고 그 처리(화면 그리기)를 끝낸 뒤 다음 것을 보낸다. */
function fillMissing(e: MouseEvent, target: Element, count: number): void {
  const first = e.detail - count;
  for (let i = 0; i < count; i += 1) {
    if (!target.isConnected) return;
    const ev = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      detail: first + i,
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
    for (const l of fillListeners) l();
    filling = true;
    try {
      flushRunner(() => {
        target.dispatchEvent(ev);
      });
    } finally {
      filling = false;
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
  if (!filling && e.target instanceof Element) {
    const missing = missingBefore(e, performance.now());
    if (missing > 0) {
      const target = e.target;
      const before = usableOf(target, e.clientX, e.clientY);
      fillMissing(e, target, missing);
      const after = usableOf(target, e.clientX, e.clientY);
      lost = becameUnusable(before, after);
      if (before.onTop && after.hit !== null) hitTarget = after.hit;
    }
  }
  const now = performance.now();
  // 보호가 버리는 누름도 받은 것으로 센다(버린 누름을 다음 click 에서 다시 채우지 않게).
  lastReceived = { x: e.clientX, y: e.clientY, at: now, detail: e.detail, target: e.target };
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
