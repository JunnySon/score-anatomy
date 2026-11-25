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
// 빠진 누름 채우기(작업 지시서 3-1의 3-1, 규칙 이름 "손뗌 수"):
// 아이폰의 웹뷰는 손을 떼고 몇 ms 안에 같은 자리를 다시 누르면 첫 누름의 click(detail 1)을 보내지 않고
// 손뗌 두 번(touchend, pointerup) 뒤에 click(detail 2) 하나와 dblclick 만 보낸다. 0.4초 간격이면 click 이 두 번 다 온다.
// 그래서 detail 이 d(2 이상)인 click 이 오면, 마지막으로 받은 click 뒤의 손뗌 가운데 이 click 의 자리(가로세로 24px 안)에서
// 0.4초 안의 간격으로 이어진 손뗌을 센다. 손뗌은 click 마다 하나씩이라 손뗌이 click 보다 많으면 그만큼 click 이 빠진 것이다.
// 빠진 수(손뗌 수 - 1, 많아도 d-1)만큼의 click 을 같은 요소, 같은 좌표로 먼저 만들어 보낸 뒤에 지금 click 을 평소대로 처리한다.
// - 애매하면 채우지 않는다. 누름 하나가 빠지는 것보다 없는 누름이 들어가는 쪽이 더 나쁘다. 그래서 이어진 손뗌 가운데
//   끌기(누른 동안 16px 넘게 움직임, 돌아와서 떼도 같음), 취소, 길게 누름(0.4초 넘게, 또는 contextmenu 가 옴), 두 손가락이 겹친 누름,
//   스크롤이 움직이던 중에 시작한 누름(관성을 멈춘 누름은 click 이 없음), 누르기 시작을 못 본 손뗌, 다른 자리나 다른 요소의 손뗌이
//   하나라도 있으면 채우지 않고, pointer 와 touch 가 다르게 세면 적은 쪽을 쓴다.
// - detail 의 이어짐만으로 짐작하지 않는다. 안드로이드 크롬은 다른 키를 빠르게 이어 눌러도 detail 을 올리고,
//   윈도우의 Chromium 은 detail 을 3까지만 올려서, 그것만 보면 진짜 click 이 다 오는데도 누름을 더 넣게 된다(별도 검토 F1, F2).
//   click 마다 손뗌이 하나씩 오는 브라우저(마우스, 안드로이드, 보통 빠르기의 아이폰 누름)에서는 채우지 않는다.
// - 입력은 그대로 click 으로만 받는다. 손뗌과 누름의 움직임은 세기만 한다.
// - 만들어 보낸 click 도 진짜 click 과 똑같이 이 보호를 거친다(막고 있는 곳이면 버려진다). 보호를 볼 때의 시각은
//   그 누름의 손뗌 시각이고(진짜 click 이 왔을 시각, 별도 검토 F5), 그 시각에 걸려 있던 막기로 본다(막기 기록, 별도 검토 N3, N6).
// - 보호가 버린 click 도 "받은 것"으로 센다(손뗌 수를 거기서 다시 센다). 버려진 누름을 다시 채워 넣지 않는다.
// - 만들어 보낸 click 의 처리(화면 그리기와 그 뒤의 효과)는 지금 click 보다 먼저 끝낸다(flushSync).
//   그래야 지금 click 이 첫 누름이 바꾼 화면과 상태를 보고 처리된다. 진짜 click 이 차례로 다 온 것과 같다.
// - 누른 요소는 가장 가까운 누를 수 있는 요소(버튼 등)로 본다. 만들어 보낸 click 으로 그 요소가 화면에서 사라졌거나
//   쓸 수 없게 됐거나 그 자리를 다른 요소가 덮었으면 지금 click 은 (보호에 버려지지 않았더라도) 어디에도 들어가지 않게 한다.
//   바뀐 화면의 다른 요소가 대신 눌리지 않게 한다. 요소는 그대로인데 그 안의 글자 요소만 바뀌었으면(예: "자신 없음" 글자가 지워짐)
//   지금 click 을 그 자리의 지금 요소로 다시 보낸다(별도 검토 F3).
// - 키보드나 스크립트로 낸 click(detail 0)은 건드리지 않는다. 보호의 시간, 거리, 대상은 그대로다.
// - 측정 중이면 채운 누름을 센다(src/App.tsx, filled_taps).
// - 채운 뒤에는 그 자리의 장부를 연다(아래 "채운 곳의 장부"). 채운 누름의 진짜 click 이 늦게 오면 버린다(작업 지시서 4의 2부:
//   iOS 18.4 에서 click 2, 채움, dblclick 2 뒤에 첫 누름의 click 1 이 늦게 와 세 번 들어간 적이 있음).
//
// 누르는 동안 온 dblclick 으로 채우기(작업 지시서 4의 2-2, 규칙 이름 "누르는 동안 온 dblclick"):
// iOS 18.4 의 웹뷰는 0.29초 안팎 간격으로 같은 자리를 두 번 누르면 가끔 둘째 누름에서 손을 떼기도 전에 dblclick(detail 2)을 보내고
// 그 누름의 click 은 끝내 보내지 않는다(이벤트: 누름, 손뗌, click 1, 누름, dblclick 2, 손뗌). 위의 규칙은 detail 2 인 click 이
// 와야 움직여서 이 경우를 잡지 못한다. 보통의 두 번 누름에서는 dblclick 이 둘째 click 뒤, 곧 손을 뗀 뒤에 온다.
// - 입력은 그대로 click 으로만 받는다. dblclick 은 "이 누름의 click 이 오지 않을 수 있다"는 신호로만 쓴다.
// - 눌려 있는 누름에 같은 요소, 같은 자리(24px 안)로 dblclick 이 오면 그 누름에 표시를 해 둔다.
// - 표시된 누름의 손뗌이 셀 수 있는 손뗌이고(끌기, 취소, 길게 누름, 두 손가락, 스크롤 중의 누름이 아님), 마지막으로 받은 click 과
//   같은 요소, 같은 자리(24px 안)이고, 그 click 에서 0.4초(FILL_GAP_MS) 안이고, 그 click 과 이 손뗌 사이에 다른 손뗌이 없고,
//   dblclick 의 detail 이 그 click 의 detail 보다 하나 크면, 손뗌 뒤 HELD_WAIT_MS 동안 그 누름의 click 을 기다린다.
//   오지 않으면 그 누름의 click 하나(detail 은 dblclick 의 detail)를 손뗌 자리로 만들어 보낸다. pointer 와 touch 를 둘 다 받으면
//   둘 다 이 조건을 채워야 한다. 하나라도 어긋나면 채우지 않는다(애매하면 채우지 않는다).
// - 기다리는 동안 그 자리에 click 이 오고 그 사이 그 자리에서 새로 뗀 누름이 없으면 그 누름의 click 이 온 것이라 채우지 않는다.
//   다른 누름의 click(다른 자리이거나, 그 자리에서 새로 뗀 누름 뒤)이 먼저 오면 기다리던 누름을 먼저 채운 뒤 그 click 을 처리한다
//   (누른 차례를 지킨다).
// - 채운 뒤에는 그 자리의 장부를 연다(아래 "채운 곳의 장부", 별도 검토 logic-1).
// - 만들어 보낸 click 은 위의 규칙과 똑같이 보호를 거친다(그 손뗌 시각에 걸려 있던 막기로 본다). 누른 요소가 앞 click 으로
//   사라졌거나 쓸 수 없게 됐거나 덮였으면, 그 자리를 막고 있었을 때만 그 자리의 지금 요소로 보내 막기가 버리고 세게 하고
//   (진짜 click 이 왔어도 버려졌을 것), 막고 있지 않으면 채우지 않는다.
// - 기다리는 동안(그 손뗌 뒤) 새로 걸린 막기가 있으면 채우지 않는다. 진짜 click 은 그 막기보다 먼저 왔을 것이라, 지금 채우면
//   옮겨 간 내용(새 자료로 옮겨 간 문항 등)에 들어간다. 채운 click 은 그 손뗌 뒤에 걸린 막기를 풀지 않는다(별도 검토
//   regression-delayed-held-fill-clears-newer-guard, 손뗌 수 규칙의 채운 click 도 같다).
// - FILL_HELD_DBLCLICK 을 false 로 하면 이 규칙만 꺼진다(dblclick 을 보지 않음).
// - 측정 중이면 채운 누름(filled_taps)에 넣고, 이 규칙으로 채운 것은 filled_held_taps 에 따로 센다.
//
// 채운 곳의 장부(두 규칙이 함께 씀, 작업 지시서 4-1 의 2-1):
// 채운 click 은 진짜 click 이 오지 않을 것으로 보고 만든 것이라, 그 진짜 click 이 늦게 오면 한 누름이 두 번 들어간다
// (맥의 iOS 18.4: click 2, 손뗌 수 규칙이 채운 click 1, dblclick 2, 4ms 뒤 손가락 click 1). 그래서 채운 곳에서는
// 받아들인 입력 수(진짜 click 과 채운 click)가 거기서 뗀 누름 수를 넘지 않게 한다.
// - "거기"는 채운 자리(가로세로 24px 안)나 채운 요소(가장 가까운 누를 수 있는 요소) 가운데 하나만 맞아도 된다. click 은 그 click 의
//   자리와 요소로, 뗀 누름은 손뗌 자리와 누르기 시작한 때의 요소로 맞춘다. 두 번 눌러 확대가 시작되면 같은 누름 안에서도 이벤트마다
//   좌표가 달라져서(맥이 잰 pointerup 196,159 와 click 123,159) 자리만으로는 어긋난다.
// - 채울 때 장부를 연다. 먼저 "아직 click 을 받지 못한 손뗌 수"를 넣는다: 마지막으로 받은 click 뒤 거기서 뗀 누름 수(취소는 빼고,
//   길게 누름이나 끌기처럼 셀 수 없는 누름도 셈. pointer 와 touch 가운데 적은 쪽, 손뗌 목록을 비우기 전에 셈)에서 이번에 들어간 수
//   (채운 수와 지금 click 하나, 누르는 동안 온 dblclick 규칙은 채운 하나)를 뺀 것이고 0보다 작으면 0이다.
// - 그 뒤 FILL_LATE_MS 동안 거기서 새로 뗀 누름을 더하고(취소 빼고, 셀 수 없는 누름도), 거기로 온 click 이 그 수를 넘기면
//   채운 누름의 진짜 click 이 늦게 온 것으로 보고 버린다(알림과 버린 누름 셈 없음, 판단 기록 late-drop). 버리는 수는 채운 수까지이고
//   다 버리면 장부를 닫는다. 키보드나 스크립트의 click(detail 0)은 건드리지 않는다. 채운 적이 없는 곳에서는 아무것도 버리지 않는다.
// - 새로 채우면 장부를 새로 연다(앞 장부는 닫음). DROP_LATE_CLICKS 를 false 로 하면 이 버림만 꺼진다.

/** 화면이 바뀐 뒤, 그 화면을 바꾼 누름의 자리를 다시 누른 것을 받지 않는 시간(ms). */
export const TAP_GUARD_MS = 500;

/** 같은 자리로 보는 거리(px). 앞에 누른 자리에서 가로세로 이만큼 안쪽이다. */
export const TAP_GUARD_PX = 24;

/**
 * 빠진 누름 채우기: 한 묶음으로 세는 이어진 손뗌 사이(와 이 click 자신의 손뗌과 click 사이)의 가장 긴 간격(ms).
 * 아이폰 시뮬레이터에서 0.4초 간격으로 두 번 누르면 click 이 두 번 다 와서, 그보다 오래된 손뗌은 빠진 누름일 수 없다.
 */
export const FILL_GAP_MS = 400;

/** 빠진 누름 채우기: click 의 자리에서 가로세로 이만큼 안의 손뗌만 센다(px). 연달아 누르기 보호와 같은 거리다. */
export const FILL_SPOT_PX = TAP_GUARD_PX;

/** 빠진 누름 채우기: 누른 동안 누른 자리에서 이만큼 넘게 움직인 누름은 끌기나 스크롤로 보고 세지 않는다(px). */
export const FILL_MOVE_PX = 16;

/** 빠진 누름 채우기: 이보다 오래 누른 누름(길게 누름)은 세지 않는다(ms). */
export const FILL_PRESS_MS = 400;

/**
 * 누르는 동안 온 dblclick 으로 채우기(작업 지시서 4의 2-2)를 쓸지. false 면 dblclick 을 보지 않아 이 규칙만 꺼지고
 * 손뗌 수 규칙과 보호는 그대로다. iOS 18.4 에서 다시 재서 나쁘면 이 값만 false 로 바꾼다.
 */
export const FILL_HELD_DBLCLICK = true;

/**
 * 누르는 동안 dblclick 이 온 누름을 뗀 뒤 그 누름의 click 을 기다리는 시간(ms). 이 안에 오지 않으면 하나 채운다.
 * 아이폰 시뮬레이터(iOS 26.4)에서 잰, 손을 뗀 뒤 그 누름의 click 이 오기까지의 시간은 약 2ms 였다
 * (docs/ios_결정기록.md 2장, docs/ios_검증결과.md 의 firstClickAfterTouchEndMs). 그 50배를 두어 일이 몰린 순간에 늦는 click 도
 * 기다리고, 늦었다고 느끼기 시작하는 0.1초는 넘지 않게 했다. 더 늦게 오는 진짜 click 은 FILL_LATE_MS 동안 장부로 버린다.
 */
export const HELD_WAIT_MS = 100;

/**
 * 채운 곳의 장부를 두는 시간(ms). 두 규칙이 함께 쓴다. 채운 누름의 진짜 click 이 이 안에 늦게 오면 버린다.
 * 맥의 iOS 18.4 시뮬레이터에서 늦게 온 click 은 채운 뒤 4ms 쯤에 왔다(작업 지시서 4의 2부). 넉넉히 1초를 둔다.
 */
export const FILL_LATE_MS = 1000;

/** 채운 곳의 장부로 늦게 온 진짜 click 을 버릴지(작업 지시서 4-1 의 2-1). false 면 이 버림만 꺼지고 채우기는 그대로다. */
export const DROP_LATE_CLICKS = true;

interface Spot {
  x: number;
  y: number;
}

/** 막는 넓이. spot 은 누른 자리만, screen 은 화면 전체. */
export type GuardArea = 'spot' | 'screen';

/** 채운 규칙. lifts 는 손뗌 수 규칙(작업 지시서 3-1), held 는 누르는 동안 온 dblclick 규칙(작업 지시서 4). */
export type FillRule = 'lifts' | 'held';

/** 막기 하나. since 부터 until 전까지 막는다. strict 면 단답형 숫자 키(data-tap-safe)도 버린다. */
interface GuardRecord extends Spot {
  area: GuardArea;
  since: number;
  until: number;
  strict: boolean;
}

/** 마지막으로 받아들인 누름. */
let lastClick: (Spot & { at: number }) | null = null;

/** 누르는 동안 온 dblclick. 그 누름의 click 이 오지 않을 수 있다는 신호다. */
interface Held extends Spot {
  detail: number;
  /** dblclick 이 온 요소(가장 가까운 누를 수 있는 요소). */
  control: Element;
  /** dblclick 의 target. 채울 때 그대로 있으면 이 요소로 보낸다. */
  target: Element;
}

/** 누름 하나(누르기 시작부터 뗄 때까지). 시각은 받은 때의 performance.now() 다(보호와 같은 시계). */
interface Press {
  x0: number;
  y0: number;
  t0: number;
  /** 누른 자리에서 FILL_MOVE_PX 넘게 움직인 적이 있는지(끌기, 스크롤). 돌아와서 떼도 그대로다. */
  moved: boolean;
  /** 다른 손가락과 겹친 누름인지. */
  multi: boolean;
  /** 셀 수 없는 누름인지: 길게 누름으로 알려졌거나(contextmenu), 스크롤이 움직이던 중에 눌렀다(관성을 멈춘 누름은 click 이 없다). */
  bad: boolean;
  /** 누른 요소(가장 가까운 누를 수 있는 요소). 빠진 누름은 지금 click 과 같은 요소를 누른 것이어야 한다. */
  control: Element | null;
  /** 누르는 동안 이 누름에 온 dblclick. */
  held: Held | null;
}
/** 손뗌. ok 가 false 면 빠진 누름으로 세지 않는 손뗌(끌기, 취소, 길게 누름, 두 손가락, 누르기 시작을 못 본 것)이다. */
interface Lift extends Spot {
  t: number;
  ok: boolean;
  control: Element | null;
  /** 누르는 동안 dblclick 이 온 누름의 손뗌이면 그 dblclick(pointer 와 touch 의 손뗌이 같은 것을 가리킨다). */
  held: Held | null;
  /** 취소된 누름(pointercancel, touchcancel)인지. 취소된 누름은 click 이 없다. */
  cancel?: boolean;
}
/** 마지막으로 받은 click(보호가 버린 것도 센다) 뒤의 손뗌. pointer 와 touch 를 따로 모은다. */
const lifts: { pointer: Lift[]; touch: Lift[] } = { pointer: [], touch: [] };
/** pointer 이벤트, touch 이벤트를 한 번이라도 받았는지. 받은 쪽만 견준다. */
let pointerSeen = false;
let touchSeen = false;
/** 지금 눌려 있는 누름(pointerId 와 touch identifier 별). */
const pointerPresses = new Map<number, Press>();
const touchPresses = new Map<number, Press>();
/** 빠진 누름을 만들어 보내는 중인지. 만들어 보낸 click 에서는 다시 채우지 않는다. */
let filling = false;
/** 만들어 보내는 click 의 보호를 볼 시각(그 누름의 손뗌 시각). 없으면 지금 시각. */
let fillClock: number | null = null;
/** 지금 click 을 그 자리의 지금 요소로 다시 보내는 중인지. 다시 보낸 click 에서는 채우지 않는다. */
let redispatching = false;
/** 만들어 보낸 click 을 처리할 때 감싸는 함수. 화면 그리기를 지금 끝내게 한다(src/main.tsx 가 React 의 flushSync 를 넣는다). */
let flushRunner: (fn: () => void) => void = (fn) => fn();
/**
 * 마지막으로 받은 진짜 click(손가락이나 마우스에서 온 것, 보호가 버린 것도)과, 누르는 동안 온 dblclick 으로 채운 click.
 * 누르는 동안 dblclick 이 온 누름은 이 click 과 같은 요소, 같은 자리여야 채운다.
 */
let lastReceived: (Spot & { at: number; detail: number; control: Element | null }) | null = null;
/** 누르는 동안 dblclick 이 온 누름을 떼고 그 누름의 click 을 기다리는 중이면 그 손뗌과 타이머. */
let pendingHeld: { lift: Lift; held: Held; timer: number } | null = null;
/**
 * 채운 곳의 장부(머리 주석의 "채운 곳의 장부"). 자리(x, y)나 요소(control) 가운데 하나만 맞아도 거기다.
 * base 는 장부를 열 때 아직 click 을 받지 못한 손뗌 수, added 는 연 뒤 거기서 뗀 누름 수(pointer 와 touch 따로),
 * used 는 연 뒤 거기로 받은 click 수, owed 는 버릴 수 있는 수(채운 수), rule 은 장부를 연 채우기 규칙이다.
 */
interface Ledger extends Spot {
  control: Element | null;
  until: number;
  base: number;
  added: { pointer: number; touch: number };
  used: number;
  owed: number;
  rule: FillRule;
}
let ledger: Ledger | null = null;
/** 지금 막고 있는 자리. strict 면 단답형 숫자 키(data-tap-safe)도 버린다. */
let guard: GuardRecord | null = null;
/**
 * 지금까지 건 막기의 기록(짧게 남김). 막기 타이머가 지금 막기(guard)를 지운 뒤에도, 채운 click 을 그 손뗌 시각에 걸려 있던
 * 막기로 판정하려고 둔다(별도 검토 N3, N6). 그 손뗌 뒤에 걸린 막기는 그 손뗌의 click 을 막지 않았을 것이므로 보지 않는다.
 */
let guardLog: GuardRecord[] = [];
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
const fillListeners = new Set<(rule: FillRule) => void>();

/**
 * 판단 기록. 사용성 테스트 도구를 싣는 빌드(일반 웹, 앱 시험용 묶음)에서만 window.__saTapTrace 에 마지막 200개를 남긴다
 * (앱 배포용 묶음에는 없다). 아이폰 껍데기의 이벤트 기록(DEBUG 의 window.__saEventLog)과 시각(performance.now())으로 맞춰 본다.
 * 화면이나 입력에는 아무 영향이 없다.
 */
function trace(what: string, extra: Record<string, number | string | null> = {}): void {
  if (!__SA_TOOLS__ || typeof window === 'undefined') return;
  const w = window as Window & { __saTapTrace?: unknown[] };
  if (!Array.isArray(w.__saTapTrace)) w.__saTapTrace = [];
  const log = w.__saTapTrace;
  log.push({ at: Math.round(performance.now() * 10) / 10, what, ...extra });
  if (log.length > 200) log.splice(0, log.length - 200);
}

/**
 * 빠진 누름을 하나 채울 때마다 불린다(측정 중 filled_taps 와 filled_held_taps 를 센다). 어느 규칙으로 채웠는지 받는다.
 * 되돌려 주는 함수로 듣기를 그만둔다.
 */
export function addFillListener(fn: (rule: FillRule) => void): () => void {
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
  const now = performance.now();
  // 채우는 동안 건 막기는 그 채움의 손뗌 시각(진짜 click 이 왔을 시각)부터 걸린 것으로 적는다. 그래야 같은 묶음의 다음 손뗌이
  // 진짜 누름처럼 그 막기에 걸린다. 끝은 지금부터 센다(조금 더 오래 막는다).
  const since = filling && fillClock !== null ? Math.min(fillClock, now) : now;
  guard = { x: spot.x, y: spot.y, area, since, until: now + ms, strict };
  guardLog = guardLog.filter((g) => now - g.until < FILL_GAP_MS * 4);
  guardLog.push(guard);
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

/** 좌표 (x, y)의 누름이 그 시각 t 에 막기 g 가 막는 곳에 왔는지. g 를 건 때(since)보다 앞이거나 끝난 뒤(until)면 막지 않는다. */
function coveredBy(g: GuardRecord | null, x: number, y: number, t: number): boolean {
  if (!g || t < g.since || t >= g.until) return false;
  if (g.area === 'screen') return true;
  return Math.abs(x - g.x) <= TAP_GUARD_PX && Math.abs(y - g.y) <= TAP_GUARD_PX;
}

/** 그 시각 t 에 걸려 있던 막기(가장 늦게 건 것). 채운 click 을 그 손뗌 시각으로 판정할 때 쓴다. */
function guardAt(t: number): GuardRecord | null {
  for (let i = guardLog.length - 1; i >= 0; i -= 1) {
    const g = guardLog[i]!;
    if (g.since <= t && t < g.until) return g;
  }
  return null;
}

/** 누른 요소(가장 가까운 누를 수 있는 요소, 없으면 누른 요소 자체). */
function controlOf(target: Element): Element {
  return target.closest(INTERACTIVE_SELECTOR) ?? target;
}

/** 두 자리가 가로세로 FILL_SPOT_PX 안인지. */
function sameSpot(a: Spot, b: Spot): boolean {
  return Math.abs(a.x - b.x) <= FILL_SPOT_PX && Math.abs(a.y - b.y) <= FILL_SPOT_PX;
}

/** 손뗌을 모은다. 이어진 묶음만 보면 되므로 오래된 것과 너무 많은 것은 버린다. */
function remember(list: Lift[], lift: Lift): void {
  list.push(lift);
  while (list.length > 0 && lift.t - list[0]!.t > FILL_GAP_MS * 8) list.shift();
  if (list.length > 16) list.splice(0, list.length - 16);
}

function farFrom(p: Press, x: number, y: number): boolean {
  return Math.hypot(x - p.x0, y - p.y0) > FILL_MOVE_PX;
}

/** 누름이 끝났을 때 빠진 누름으로 셀 수 있는 손뗌인지. 누르기 시작을 못 본 손뗌도 세지 않는다. */
function liftOk(p: Press | undefined, x: number, y: number, now: number): boolean {
  return p !== undefined && !p.moved && !p.multi && !p.bad && !farFrom(p, x, y) && now - p.t0 <= FILL_PRESS_MS;
}

/** 마지막으로 스크롤이 움직인 시각. 스크롤이 움직이던 중에 시작한 누름은 세지 않는다(별도 검토 N2). */
let lastScrollAt = -Infinity;

function onScroll(): void {
  lastScrollAt = performance.now();
}

/** 길게 누름이 알려지면(contextmenu) 지금 눌려 있는 누름은 모두 세지 않는다(별도 검토 N1). */
function onContextMenu(): void {
  for (const p of pointerPresses.values()) p.bad = true;
  for (const p of touchPresses.values()) p.bad = true;
}

/**
 * dblclick 은 입력으로 받지 않는다. 눌려 있는 누름에 같은 요소, 같은 자리로 온 dblclick 이면 그 누름에 표시만 한다
 * (그 누름의 click 이 오지 않을 수 있다는 신호, 작업 지시서 4의 2-2). 보통의 두 번 누름에서는 손을 뗀 뒤에 와서 표시할 누름이 없다.
 */
function onDblClick(e: MouseEvent): void {
  if (!FILL_HELD_DBLCLICK || e.detail < 2 || !(e.target instanceof Element)) return;
  const held: Held = { detail: e.detail, x: e.clientX, y: e.clientY, control: controlOf(e.target), target: e.target };
  let marked = 0;
  const mark = (p: Press) => {
    if (p.control === held.control && sameSpot({ x: p.x0, y: p.y0 }, held)) {
      p.held = held;
      marked += 1;
    }
  };
  for (const p of pointerPresses.values()) mark(p);
  for (const p of touchPresses.values()) mark(p);
  if (marked > 0) trace('held-mark', { detail: e.detail, x: Math.round(e.clientX), y: Math.round(e.clientY) });
}

/** 새 누름. 스크롤이 움직이던 중(0.1초 안)이면 셀 수 없는 누름이다. */
function newPress(x: number, y: number, now: number, target: EventTarget | null, multi: boolean): Press {
  return {
    x0: x,
    y0: y,
    t0: now,
    moved: false,
    multi,
    bad: now - lastScrollAt < 100,
    control: target instanceof Element ? controlOf(target) : null,
    held: null,
  };
}

/** 오래 남은 누름(손뗌을 받지 못한 것)은 버린다. 남아 있으면 다음 누름이 두 손가락으로 잘못 세진다. */
function dropStale(presses: Map<number, Press>, now: number): void {
  for (const [id, p] of presses) if (now - p.t0 > 10_000) presses.delete(id);
}

function onPointerDown(e: PointerEvent): void {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  pointerSeen = true;
  const now = performance.now();
  dropStale(pointerPresses, now);
  const press = newPress(e.clientX, e.clientY, now, e.target, !e.isPrimary);
  if (e.pointerType !== 'mouse' && pointerPresses.size > 0) {
    // 다른 손가락이 눌려 있는 동안 또 눌렀다. 겹친 누름은 모두 세지 않는다.
    press.multi = true;
    for (const other of pointerPresses.values()) other.multi = true;
  }
  pointerPresses.set(e.pointerId, press);
}

function onPointerMove(e: PointerEvent): void {
  const press = pointerPresses.get(e.pointerId);
  if (press && !press.moved && farFrom(press, e.clientX, e.clientY)) press.moved = true;
}

function onPointerUp(e: PointerEvent): void {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  pointerSeen = true;
  const press = pointerPresses.get(e.pointerId);
  pointerPresses.delete(e.pointerId);
  const now = performance.now();
  const lift: Lift = {
    x: e.clientX,
    y: e.clientY,
    t: now,
    ok: e.isPrimary && liftOk(press, e.clientX, e.clientY, now),
    control: press?.control ?? null,
    held: press?.held ?? null,
  };
  remember(lifts.pointer, lift);
  countOwedLift('pointer', lift);
  armHeld(lift);
}

function onPointerCancel(e: PointerEvent): void {
  const press = pointerPresses.get(e.pointerId);
  pointerPresses.delete(e.pointerId);
  remember(lifts.pointer, { x: press?.x0 ?? e.clientX, y: press?.y0 ?? e.clientY, t: performance.now(), ok: false, control: null, held: null, cancel: true });
}

function onTouchStart(e: TouchEvent): void {
  touchSeen = true;
  const now = performance.now();
  dropStale(touchPresses, now);
  for (const t of Array.from(e.changedTouches)) touchPresses.set(t.identifier, newPress(t.clientX, t.clientY, now, t.target, false));
  // 손가락이 둘 이상 눌려 있다. 겹친 누름은 모두 세지 않는다.
  if (e.touches.length > 1 || touchPresses.size > 1) for (const p of touchPresses.values()) p.multi = true;
}

function onTouchMove(e: TouchEvent): void {
  for (const t of Array.from(e.changedTouches)) {
    const press = touchPresses.get(t.identifier);
    if (press && !press.moved && farFrom(press, t.clientX, t.clientY)) press.moved = true;
  }
}

function onTouchEnd(e: TouchEvent): void {
  touchSeen = true;
  const now = performance.now();
  for (const t of Array.from(e.changedTouches)) {
    const press = touchPresses.get(t.identifier);
    touchPresses.delete(t.identifier);
    const lift: Lift = {
      x: t.clientX,
      y: t.clientY,
      t: now,
      ok: liftOk(press, t.clientX, t.clientY, now),
      control: press?.control ?? null,
      held: press?.held ?? null,
    };
    remember(lifts.touch, lift);
    countOwedLift('touch', lift);
    armHeld(lift);
  }
}

function onTouchCancel(e: TouchEvent): void {
  const now = performance.now();
  for (const t of Array.from(e.changedTouches)) {
    touchPresses.delete(t.identifier);
    remember(lifts.touch, { x: t.clientX, y: t.clientY, t: now, ok: false, control: null, held: null, cancel: true });
  }
}

/** 자리(24px 안)나 요소 가운데 하나만 맞아도 같은 곳이다. 요소는 둘 다 있을 때만 견준다. */
function samePlace(a: Spot, aControl: Element | null, b: Spot, bControl: Element | null): boolean {
  return sameSpot(a, b) || (aControl !== null && bControl !== null && aControl === bControl);
}

/** 받은 쪽(pointer, touch)마다 센 수 가운데 적은 쪽(받은 쪽이 없으면 0). */
function fewerSeen(counts: { pointer: number; touch: number }): number {
  const seen: number[] = [];
  if (pointerSeen) seen.push(counts.pointer);
  if (touchSeen) seen.push(counts.touch);
  return seen.length === 0 ? 0 : Math.min(...seen);
}

/** 마지막으로 받은 click 뒤 그곳(자리나 요소)에서 뗀 누름 수. 취소는 빼고 셀 수 없는 누름도 센다(받은 쪽 가운데 적은 쪽). */
function liftsAt(spot: Spot, control: Element | null): number {
  const count = (list: Lift[]) => list.filter((l) => !l.cancel && samePlace(l, l.control, spot, control)).length;
  return fewerSeen({ pointer: count(lifts.pointer), touch: count(lifts.touch) });
}

/** 장부가 열려 있으면(채운 뒤 FILL_LATE_MS 안) 거기서 뗀 누름을 센다. 셀 수 없는 누름도 센다(그 누름도 click 을 낼 수 있다). */
function countOwedLift(kind: 'pointer' | 'touch', lift: Lift): void {
  const l = ledger;
  if (!l) return;
  if (performance.now() > l.until) {
    ledger = null;
    return;
  }
  if (samePlace(lift, lift.control, l, l.control)) l.added[kind] += 1;
}

/**
 * 장부를 새로 연다(앞 장부는 닫음). lifted 는 손뗌 목록을 비우기 전에 센 그곳의 손뗌 수(liftsAt), entered 는 이번에 들어간 수
 * (채운 수와 지금 click), owed 는 버릴 수 있는 수(채운 수)다. DROP_LATE_CLICKS 가 false 면 열지 않는다.
 */
function openLedger(spot: Spot, control: Element | null, lifted: number, entered: number, owed: number, rule: FillRule): void {
  if (!DROP_LATE_CLICKS || owed <= 0) return;
  ledger = {
    x: spot.x,
    y: spot.y,
    control,
    until: performance.now() + FILL_LATE_MS,
    base: Math.max(0, lifted - entered),
    added: { pointer: 0, touch: 0 },
    used: 0,
    owed,
    rule,
  };
  trace('ledger', { rule, base: ledger.base, owed, x: Math.round(spot.x), y: Math.round(spot.y) });
}

/**
 * 장부로 늦게 온 진짜 click 인지 본다. 그렇다면 버리고 true. 아니면 그곳의 click 이면 장부에 센다.
 * 받아들인 수가 그곳에서 뗀 누름 수(base 와 연 뒤 뗀 누름)를 넘기는 click 만 버리고, 버릴 수 있는 수(owed)를 다 쓰면 장부를 닫는다.
 */
function dropLateClick(e: MouseEvent): boolean {
  const l = ledger;
  if (!l) return false;
  if (performance.now() > l.until) {
    ledger = null;
    return false;
  }
  const control = e.target instanceof Element ? controlOf(e.target) : null;
  if (!samePlace({ x: e.clientX, y: e.clientY }, control, l, l.control)) return false;
  if (l.used + 1 > l.base + fewerSeen(l.added)) {
    l.owed -= 1;
    if (l.owed <= 0) ledger = null;
    e.preventDefault();
    e.stopImmediatePropagation();
    trace('late-drop', { rule: l.rule, detail: e.detail, x: Math.round(e.clientX), y: Math.round(e.clientY) });
    return true;
  }
  l.used += 1;
  return false;
}

/**
 * 누르는 동안 dblclick 이 온 누름을 뗐으면 그 누름의 click 을 HELD_WAIT_MS 동안 기다리기 시작한다.
 * 한 번 뗀 것이 pointer 와 touch 로 두 번 오므로 같은 누름(같은 dblclick)이면 한 번만 기다린다.
 * 다른 누름을 기다리던 중이면 그 누름을 먼저 마무리한다(누른 차례).
 */
function armHeld(lift: Lift): void {
  if (!lift.held || !lift.ok) return;
  if (pendingHeld) {
    if (pendingHeld.held === lift.held) return;
    settleHeld('next');
  }
  const held = lift.held;
  pendingHeld = { lift, held, timer: window.setTimeout(() => settleHeld('timer'), HELD_WAIT_MS) };
  trace('held-wait', { detail: held.detail, x: Math.round(lift.x), y: Math.round(lift.y) });
}

/** 목록에서 그 dblclick 이 온 누름의 손뗌 뒤에, 그 자리에서 뗀 셀 수 있는 손뗌의 수. 그 손뗌이 목록에 없으면 목록 전체를 센다. */
function okLiftsAfter(list: Lift[], held: Held | null, spot: Spot): number {
  const i = held === null ? -1 : list.findIndex((l) => l.held === held);
  return list.slice(i + 1).filter((l) => l.ok && sameSpot(l, spot)).length;
}

/** pointer 와 touch 가운데 받은 쪽마다 okLiftsAfter 를 세서 적은 쪽(받은 쪽이 없으면 0). */
function newerOkLifts(held: Held | null, spot: Spot): number {
  const counts: number[] = [];
  if (pointerSeen) counts.push(okLiftsAfter(lifts.pointer, held, spot));
  if (touchSeen) counts.push(okLiftsAfter(lifts.touch, held, spot));
  return counts.length === 0 ? 0 : Math.min(...counts);
}

/**
 * 기다리던 누름을 채워도 되는지 본다. 애매하면 null 이다(채우지 않는다).
 * - pointer 와 touch 가운데 받은 쪽마다, 마지막으로 받은 click 뒤의 첫 손뗌이 그 누름의 손뗌이어야 한다(그 사이에 다른 손뗌이 없음).
 * - 그 손뗌은 셀 수 있는 손뗌이고, 마지막으로 받은 click 과 같은 요소, 같은 자리(24px 안)이고, 그 click 에서 FILL_GAP_MS 안이다.
 * - dblclick 은 그 누름과 같은 요소에 왔고(표시할 때 봄), detail 은 마지막으로 받은 click 의 detail 보다 하나 크다.
 */
function heldCandidate(held: Held): Lift | null {
  const prev = lastReceived;
  if (!prev || prev.control === null || held.detail !== prev.detail + 1 || held.control !== prev.control) return null;
  const check = (list: Lift[]): Lift | null => {
    const l = list[0];
    if (!l || l.held !== held || !l.ok || l.control !== prev.control) return null;
    if (!sameSpot(l, prev) || !sameSpot(l, held)) return null;
    if (l.t < prev.at || l.t - prev.at > FILL_GAP_MS) return null;
    return l;
  };
  const picked: (Lift | null)[] = [];
  if (pointerSeen) picked.push(check(lifts.pointer));
  if (touchSeen) picked.push(check(lifts.touch));
  if (picked.length === 0 || picked.some((l) => l === null)) return null;
  return picked[0]!;
}

/** 기다리던 누름의 click 이 오지 않았다(시간이 다 됨, 다른 누름의 click 이 먼저 옴). 채울 수 있으면 하나 채운다. */
function settleHeld(why: string): void {
  const pending = pendingHeld;
  if (!pending) return;
  pendingHeld = null;
  window.clearTimeout(pending.timer);
  const lift = heldCandidate(pending.held);
  if (!lift) {
    trace('held-skip', { why, reason: 'candidate' });
    return;
  }
  fillHeld(lift, pending.held, why);
}

/** 각 목록에서 그 누름의 손뗌까지 지운다(그 누름의 click 을 받은 것으로 친다). 뒤 누름의 손뗌은 남긴다. */
function consumeThrough(held: Held): void {
  for (const key of ['pointer', 'touch'] as const) {
    const i = lifts[key].findIndex((l) => l.held === held);
    if (i >= 0) lifts[key] = lifts[key].slice(i + 1);
  }
}

/** 누르는 동안 dblclick 이 온 누름의 click 을 하나 만들어 보낸다. 보호는 진짜 click 과 똑같이 그 손뗌 시각으로 거친다. */
function fillHeld(lift: Lift, held: Held, why: string): void {
  // 기다리는 동안 새로 걸린 막기가 있다(새 자료로 내용이 옮겨 감, 화면이 바뀜). 진짜 click 은 그 전에 왔을 것이라 지금 채우면
  // 옮겨 간 내용에 들어간다. 애매하므로 채우지 않는다(별도 검토 regression-delayed-held-fill-clears-newer-guard).
  if (guardLog.some((g) => g.since > lift.t)) {
    trace('held-skip', { why, reason: 'guard-after-lift' });
    return;
  }
  const control = held.control;
  const now = usableOf(control, lift.x, lift.y);
  let to: Element | null = null;
  if (now.connected && now.enabled && now.onTop) {
    if (held.target.isConnected && control.contains(held.target)) to = held.target;
    else if (now.hit !== null && control.contains(now.hit)) to = now.hit;
  } else if (coveredBy(guardAt(lift.t), lift.x, lift.y, lift.t)) {
    // 앞 click 으로 그 요소를 누를 수 없게 됐지만 그 자리를 막고 있었다. 진짜 click 이 왔어도 막기가 버렸을 것이라
    // 그 자리의 지금 요소로 보내 막기가 버리고 세게 한다(손뗌 수 규칙과 같다).
    to = now.hit;
  }
  if (!to) {
    trace('held-skip', { why, reason: 'unusable' });
    return;
  }
  const dest = to;
  const ev = new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    detail: held.detail,
    clientX: lift.x,
    clientY: lift.y,
    button: 0,
  });
  // 장부에 넣을 그곳의 손뗌 수(채운 누름과 기다리는 동안 뗀 누름)를 손뗌 목록에서 지우기 전에 센다.
  const lifted = liftsAt(lift, control);
  consumeThrough(held);
  lastReceived = { x: lift.x, y: lift.y, at: lift.t, detail: held.detail, control };
  openLedger(lift, control, lifted, 1, 1, 'held');
  trace('held-fill', { why, detail: held.detail, x: Math.round(lift.x), y: Math.round(lift.y) });
  for (const l of fillListeners) l('held');
  filling = true;
  fillClock = lift.t;
  try {
    flushRunner(() => {
      dest.dispatchEvent(ev);
    });
  } finally {
    filling = false;
    fillClock = null;
  }
}

/**
 * 손가락이나 마우스에서 click 이 왔을 때, 기다리던 누름(누르는 동안 온 dblclick)이 있으면 먼저 마무리한다.
 * 그 자리이고 그 뒤 그 자리에서 새로 뗀 누름이 없으면 그 누름의 click 이라 기다림만 그만두고,
 * 아니면(다른 누름의 click) 기다리던 누름을 먼저 채운다(그때 그 자리의 장부를 연다). 장부 확인은 그 뒤에 한다(onClick).
 */
function settleHeldBefore(e: MouseEvent): void {
  const pending = pendingHeld;
  if (!pending) return;
  if (sameSpot({ x: e.clientX, y: e.clientY }, pending.lift) && newerOkLifts(pending.held, pending.lift) === 0) {
    pendingHeld = null;
    window.clearTimeout(pending.timer);
    trace('held-cancel', { detail: e.detail });
  } else {
    settleHeld('click');
  }
}

/**
 * 이 click 앞에 빠진 누름의 손뗌 시각들(오래된 것부터). detail 이 d(2 이상)일 때만 본다. 애매하면 빈 목록이다(채우지 않는다).
 * - 가장 늦은 손뗌이 이 click 자신의 것이어야 한다: 셀 수 있는 손뗌이고, 이 click 의 자리(24px 안)이고, FILL_GAP_MS 안이다.
 * - 거기서 거꾸로, 앞 손뗌과의 사이가 FILL_GAP_MS 안인 손뗌을 한 묶음으로 센다. 사이가 그보다 길면 묶음은 거기서 끝난다
 *   (아이폰도 0.4초 간격이면 click 이 두 번 다 오므로, 그보다 오래된 손뗌은 빠진 누름일 수 없다).
 * - 묶음 안에 셀 수 없는 손뗌(끌기, 취소, 길게 누름, 두 손가락, 스크롤 중의 누름, 누르기 시작을 못 본 것)이나
 *   다른 자리, 다른 요소의 손뗌이 있으면 채우지 않는다.
 * - pointer 와 touch 를 둘 다 받는 브라우저에서는 둘 가운데 적게 센 쪽을 쓴다. 많아도 d-1 개다.
 */
function missingLifts(e: MouseEvent): number[] {
  const d = e.detail;
  if (d < 2) return [];
  const now = performance.now();
  // 같은 자리(24px 안)이고 같은 요소를 누른 손뗌만 이 click 의 누름 묶음이다(옆 키 가장자리의 손뗌은 다른 누름이다, 별도 검토 N4).
  const control = e.target instanceof Element ? controlOf(e.target) : null;
  const near = (l: Lift) => control !== null && l.control === control && sameSpot(l, { x: e.clientX, y: e.clientY });
  const lostIn = (list: Lift[]): number[] => {
    const own = list[list.length - 1];
    if (!own || !own.ok || !near(own) || now - own.t > FILL_GAP_MS) return [];
    const lost: number[] = [];
    let after = own;
    for (let i = list.length - 2; i >= 0; i -= 1) {
      const lift = list[i]!;
      if (after.t - lift.t > FILL_GAP_MS) break;
      if (!lift.ok || !near(lift)) return [];
      lost.unshift(lift.t);
      after = lift;
    }
    return lost;
  };
  const sources: number[][] = [];
  if (pointerSeen) sources.push(lostIn(lifts.pointer));
  if (touchSeen) sources.push(lostIn(lifts.touch));
  if (sources.length === 0) return [];
  const count = Math.min(d - 1, ...sources.map((s) => s.length));
  if (count <= 0) return [];
  const base = sources[0]!;
  return base.slice(base.length - count);
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
 * 누른 글자 요소가 앞 click 으로 바뀌었으면 같은 요소 안의 그 자리의 지금 요소로 보낸다.
 * 둘째 것부터는 앞 것이 바꾼 화면을 본다(별도 검토 C6). 누른 요소가 사라졌거나 쓸 수 없게 됐거나 덮였으면,
 * 그 자리를 보호가 막고 있을 때만 보낸다(진짜 누름처럼 보호가 버리고 센다). 막고 있지 않으면 거기서 멈춘다(다른 요소가 눌리지 않게).
 */
function fillMissing(e: MouseEvent, target: Element, control: Element, times: number[], before: Usable): number {
  const first = e.detail - times.length;
  let sent = 0;
  for (let i = 0; i < times.length; i += 1) {
    let to: Element | null = null;
    const now = usableOf(control, e.clientX, e.clientY);
    if (becameUnusable(before, now)) {
      const at = Math.min(times[i]!, performance.now());
      if (!coveredBy(guardAt(at), e.clientX, e.clientY, at)) return sent;
      to = now.hit ?? (target.isConnected ? target : null);
    } else if (target.isConnected) {
      to = target;
    } else if (now.hit && control.contains(now.hit)) {
      to = now.hit;
    }
    if (!to) return sent;
    const dest = to;
    const ev = cloneClick(e, first + i);
    sent += 1;
    trace('fill', { rule: 'lifts', detail: first + i, x: Math.round(e.clientX), y: Math.round(e.clientY) });
    for (const l of fillListeners) l('lifts');
    filling = true;
    fillClock = times[i]!;
    try {
      flushRunner(() => {
        dest.dispatchEvent(ev);
      });
    } finally {
      filling = false;
      fillClock = null;
    }
  }
  return sent;
}

function onClick(e: MouseEvent): void {
  // 키보드나 스크립트로 낸 click(detail 0)은 누른 자리가 없으므로 채우거나 막지 않는다. 다만 받은 click 이므로 손뗌은 다시 센다
  // (VoiceOver 의 누르기는 흉내 touch 이벤트 뒤에 detail 0 click 을 보낸다. 그 손뗌이 남아 다음 묶음에 섞이지 않게 한다).
  if (e.detail === 0) {
    if (!filling && !redispatching) {
      lifts.pointer = [];
      lifts.touch = [];
    }
    return;
  }
  if (!filling && !redispatching) {
    // 누르는 동안 온 dblclick 규칙: 기다리던 누름을 먼저 채우거나(장부를 엶) 기다림을 그만둔다.
    settleHeldBefore(e);
    // 채운 곳의 장부: 채운 누름의 진짜 click 이 늦게 온 것이면 버린다.
    if (dropLateClick(e)) return;
    // 이 click 이 누르는 동안 온 dblclick 규칙의 "앞 click"이 된다. 눌려 있는 누름의 dblclick 표시는 이 click 앞의 것이라 지운다.
    lastReceived = { x: e.clientX, y: e.clientY, at: performance.now(), detail: e.detail, control: e.target instanceof Element ? controlOf(e.target) : null };
    for (const p of pointerPresses.values()) p.held = null;
    for (const p of touchPresses.values()) p.held = null;
  }
  // 빠진 누름 채우기. 만들어 보낸 click 은 이 함수를 다시 지나며(filling) 아래의 보호를 그대로 거친다.
  let lost = false;
  // 지금 click 이 실제로 닿는 요소. 채운 누름으로 화면이 바뀌었으면 진짜 click 이 차례로 다 왔을 때 이 click 이 닿았을 요소
  // (그 좌표의 지금 맨 위 요소)로 본다. 보호가 버릴 때의 알림 여부와 숫자 키 여부를 이것으로 정한다.
  let hitTarget: EventTarget | null = e.target;
  if (filling && typeof document.elementFromPoint === 'function') {
    // 만들어 보낸 click 은 진짜 누름이었다면 지금 그 자리의 맨 위 요소에 닿았을 것이다. 알림과 숫자 키 여부를 그것으로 정한다.
    hitTarget = document.elementFromPoint(e.clientX, e.clientY) ?? e.target;
  }
  if (!filling && !redispatching) {
    const times = e.target instanceof Element ? missingLifts(e) : [];
    // 채우면 열 장부에 넣을 그곳(이 click 의 자리나 요소)의 손뗌 수는 손뗌 목록을 비우기 전에 센다.
    const lifted = times.length > 0 && e.target instanceof Element ? liftsAt({ x: e.clientX, y: e.clientY }, controlOf(e.target)) : 0;
    // 받은 click 이므로 손뗌은 여기서 다시 센다(보호가 버리는 click 도 같다).
    lifts.pointer = [];
    lifts.touch = [];
    if (times.length > 0 && e.target instanceof Element) {
      const target = e.target;
      const control = controlOf(target);
      const before = usableOf(control, e.clientX, e.clientY);
      const sent = fillMissing(e, target, control, times, before);
      // 채웠으면 그곳의 장부를 연다. 이번에 들어간 수는 채운 수와 이 click 하나다.
      if (sent > 0) openLedger({ x: e.clientX, y: e.clientY }, control, lifted, sent + 1, sent, 'lifts');
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
  // 채운 click 은 그 손뗌 시각에 걸려 있던 막기로 판정한다(막기 타이머가 지금 막기를 지웠어도, 그 뒤에 새로 걸린 막기는 보지 않음).
  const active = filling && fillClock !== null ? guardAt(now) : guard;
  if (active && coveredBy(active, e.clientX, e.clientY, now)) {
    const safe = !active.strict && hitTarget instanceof Element && hitTarget.closest('[data-tap-safe]') !== null;
    if (!safe) {
      // 막고 있는 곳에 온 누름은 버리고, 그때부터 다시 센다.
      e.preventDefault();
      e.stopImmediatePropagation();
      holdGuard(active, active.area, TAP_GUARD_MS, active.strict);
      const interactive = hitTarget instanceof Element && hitTarget.closest(INTERACTIVE_SELECTOR) !== null;
      trace('discard', { detail: e.detail, filled: filling ? 1 : 0 });
      for (const l of discardListeners) l({ interactive, guardId });
      return;
    }
  }
  if (lost) {
    // 채운 누름으로 원래 요소가 사라졌거나 쓸 수 없게 됐다. 지금 click 은 어디에도 들어가지 않게 한다.
    // 보호가 버린 것이 아니므로 알림을 띄우거나 세지 않고, 받아들인 누름으로도 치지 않는다.
    e.preventDefault();
    e.stopImmediatePropagation();
    trace('lost', { detail: e.detail });
    return;
  }
  if (active && coveredBy(active, e.clientX, e.clientY, now)) {
    if (active.area === 'screen') {
      // 화면 전체를 막는 동안 받은 숫자 키는 막기를 풀지 않는다(별도 검토 2차 P1). 남은 시간 동안 다른 키는 그대로 버린다.
      // 버린 누름 알림도 닫지 않는다. 닫으면 같은 보호 구간에서 이어 버린 누름이 알림 없이 사라진다(별도 검토 2차 뒤 확인 X3).
      lastClick = { x: e.clientX, y: e.clientY, at: now };
      return;
    }
  }
  // 채운 click 은 그 누름의 손뗌 시각에 받은 것으로 본다. 그 손뗌 뒤에 걸린 막기(새 자료로 내용이 옮겨 감 등)는 진짜 click 이 왔을 때
  // 아직 없었으므로 풀지 않는다(별도 검토 regression-delayed-held-fill-clears-newer-guard).
  if (!(filling && fillClock !== null && guard !== null && guard.since > fillClock)) clearGuard();
  lastClick = { x: e.clientX, y: e.clientY, at: now };
  for (const l of acceptListeners) l();
}

/** 앱이 시작될 때 한 번 부른다. 모든 누름(click)을 화면의 다른 처리보다 먼저 본다. */
export function installTapGuard(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('click', onClick, true);
  // 빠진 누름 채우기가 누름과 손뗌을 센다. 누름을 받거나 막지 않고 세기만 한다.
  window.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true });
  window.addEventListener('pointermove', onPointerMove, { capture: true, passive: true });
  window.addEventListener('pointerup', onPointerUp, { capture: true, passive: true });
  window.addEventListener('pointercancel', onPointerCancel, { capture: true, passive: true });
  window.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
  window.addEventListener('touchmove', onTouchMove, { capture: true, passive: true });
  window.addEventListener('touchend', onTouchEnd, { capture: true, passive: true });
  window.addEventListener('touchcancel', onTouchCancel, { capture: true, passive: true });
  window.addEventListener('scroll', onScroll, { capture: true, passive: true });
  window.addEventListener('contextmenu', onContextMenu, { capture: true, passive: true });
  // 누르는 동안 온 dblclick 은 입력으로 받지 않고 그 누름에 표시만 한다(작업 지시서 4의 2-2).
  if (FILL_HELD_DBLCLICK) window.addEventListener('dblclick', onDblClick, { capture: true, passive: true });
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
