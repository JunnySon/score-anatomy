// 같은 자리를 연달아 눌렀을 때, 그 사이에 바뀐 화면의 버튼까지 눌리는 일을 막는다.
//
// 화면이 바뀌면(다른 화면으로 넘어감, 바텀시트나 대화상자가 열리거나 닫힘, 아래 버튼이 바뀜)
// 바로 앞에 누른 자리에 보이지 않는 작은 가림막을 잠깐 둔다. 가림막은 누름을 받아서 버린다.
// 가림막을 또 누르면 시간을 다시 센다(연타가 멈춘 뒤에야 그 자리가 눌린다).
// 다른 자리를 누르면 가림막을 바로 치운다.
//
// 화면 전체를 막지 않는다. 그래서 화면이 바뀐 직후에 다른 자리의 키를 빨리 눌러도 버려지지 않는다.

/** 화면이 바뀐 뒤, 바로 앞에 누른 자리를 다시 누른 것을 받지 않는 시간(ms). 앞 누름부터 잰다. */
export const TAP_GUARD_MS = 500;

/** 같은 자리로 보는 거리(px). 앞에 누른 자리에서 가로세로 이만큼 안쪽이다. */
export const TAP_GUARD_PX = 24;

interface Tap {
  x: number;
  y: number;
  at: number;
}

let lastTap: Tap | null = null;
let shield: HTMLDivElement | null = null;
let timer = 0;
let installed = false;

function removeShield(): void {
  window.clearTimeout(timer);
  timer = 0;
  if (shield) {
    shield.remove();
    shield = null;
  }
}

function holdShield(ms: number): void {
  window.clearTimeout(timer);
  timer = window.setTimeout(removeShield, ms);
}

function onPointerDown(e: PointerEvent): void {
  const now = performance.now();
  if (shield && lastTap && e.target === shield) {
    // 가림막을 또 눌렀다. 자리는 그대로 두고 시간만 다시 센다.
    lastTap = { ...lastTap, at: now };
    holdShield(TAP_GUARD_MS);
    return;
  }
  removeShield();
  lastTap = { x: e.clientX, y: e.clientY, at: now };
}

/** 앱이 시작될 때 한 번 부른다. 누른 자리와 시각을 적어 둔다. */
export function installTapGuard(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  document.addEventListener('pointerdown', onPointerDown, true);
}

/**
 * 화면이 바뀌었다고 알린다. 바로 앞 누름이 TAP_GUARD_MS 안쪽이면 그 자리를 남은 시간만큼 막는다.
 * 누른 적이 없거나 시간이 지났으면 아무것도 하지 않는다.
 */
export function markUiChanged(): void {
  if (typeof document === 'undefined' || !lastTap) return;
  const left = TAP_GUARD_MS - (performance.now() - lastTap.at);
  if (left <= 0) return;
  if (!shield) {
    shield = document.createElement('div');
    shield.className = 'tap-shield';
    shield.setAttribute('aria-hidden', 'true');
    shield.style.width = `${TAP_GUARD_PX * 2}px`;
    shield.style.height = `${TAP_GUARD_PX * 2}px`;
    // 가림막을 눌러도 초점이 옮겨 가지 않게 한다.
    shield.addEventListener('mousedown', (ev) => ev.preventDefault());
    document.body.appendChild(shield);
  }
  shield.style.left = `${lastTap.x - TAP_GUARD_PX}px`;
  shield.style.top = `${lastTap.y - TAP_GUARD_PX}px`;
  holdShield(left);
}
