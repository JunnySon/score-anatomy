// 같은 자리를 연달아 눌렀을 때, 그 사이에 바뀐 화면의 버튼까지 눌리는 일을 막는다.
//
// 화면이 바뀌면(다른 화면으로 넘어감, 바텀시트나 대화상자가 열리거나 닫힘, 아래 버튼이 바뀜, 쪽이나 묶음이 넘어감)
// 그 화면을 바꾼 누름의 자리(가로세로 48px)에 다시 온 누름을 0.5초 동안 받지 않는다.
// 받지 않은 누름이 있으면 그때부터 0.5초를 다시 센다(연타가 멈춘 뒤에야 그 자리가 눌린다).
// 다른 자리를 누르면 바로 푼다.
//
// - 화면을 요소로 가리지 않고 그 자리에 온 click 만 버린다. 그래서 그 자리에서 시작한 끌기(스크롤)는 그대로 된다.
// - 화면 전체를 막는 것은 한 군데뿐이다. 마지막 문항의 답을 넣어 저절로 입력 확인 화면으로 넘어갈 때다.
//   답을 넣던 박자로 더 누른 것이 새 화면의 버튼(다른 자리)에 닿아 확인과 표시를 건너뛰고 채점되는 일을 막는다.
//   그 밖에는 다른 자리의 키를 화면이 바뀐 직후에 눌러도 들어간다.
// - 단답형 숫자 키(data-tap-safe)는 버리지 않는다. 숫자는 "다음"이나 "넣기"로 확정하기 전에는 저장되지 않고
//   큰 칸에 보여서, 잘못 들어가도 보고 지울 수 있다. 반대로 숫자를 버리면 누른 것과 다른 답(150 대신 50)이 저장될 수 있다.
// - 키보드로 누른 것(Enter, Space)은 건드리지 않는다.

/** 화면이 바뀐 뒤, 그 화면을 바꾼 누름의 자리를 다시 누른 것을 받지 않는 시간(ms). */
export const TAP_GUARD_MS = 500;

/** 같은 자리로 보는 거리(px). 앞에 누른 자리에서 가로세로 이만큼 안쪽이다. */
export const TAP_GUARD_PX = 24;

interface Spot {
  x: number;
  y: number;
}

/** 막는 넓이. spot 은 누른 자리만, screen 은 화면 전체. */
export type GuardArea = 'spot' | 'screen';

/** 마지막으로 받아들인 누름. */
let lastClick: (Spot & { at: number }) | null = null;
/** 지금 막고 있는 자리. */
let guard: (Spot & { area: GuardArea; until: number }) | null = null;
/** 막고 있는 자리에 두는 표시. 누름을 받지 않는다. 화면 테스트와 화면 검사가 막는 시간이 끝났는지 볼 때 쓴다. */
let marker: HTMLDivElement | null = null;
let timer = 0;
let installed = false;

function clearGuard(): void {
  window.clearTimeout(timer);
  timer = 0;
  guard = null;
  if (marker) {
    marker.remove();
    marker = null;
  }
}

function holdGuard(spot: Spot, area: GuardArea, ms: number): void {
  guard = { x: spot.x, y: spot.y, area, until: performance.now() + ms };
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

function onClick(e: MouseEvent): void {
  // 키보드나 스크립트로 낸 click(detail 0)은 누른 자리가 없으므로 건드리지 않는다.
  if (e.detail === 0) return;
  const now = performance.now();
  if (guard && isGuarded(e, now)) {
    const safe = e.target instanceof Element && e.target.closest('[data-tap-safe]') !== null;
    if (!safe) {
      // 막고 있는 곳에 온 누름은 버리고, 그때부터 다시 센다.
      e.preventDefault();
      e.stopImmediatePropagation();
      holdGuard(guard, guard.area, TAP_GUARD_MS);
      return;
    }
  }
  clearGuard();
  lastClick = { x: e.clientX, y: e.clientY, at: now };
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
  holdGuard(lastClick, area === 'screen' || keepScreen ? 'screen' : 'spot', TAP_GUARD_MS);
}
