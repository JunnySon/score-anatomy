import { useSyncExternalStore } from 'react';

// 해시 라우팅. 어떤 정적 호스팅이나 파일 하나로도 열리게 주소의 # 뒤만 쓴다.
//
// 화면이 어디인지는 이 모듈이 기억하는 값이 기준이고, 주소의 #은 그 값을 따라간다.
// 주소를 바꿀 수 없는 환경(주소 해시를 마음대로 쓸 수 없는 뷰어 안)에서는
// window.__SA_MEMORY_ROUTER__ 를 true로 두면 주소를 건드리지 않고 메모리에서만 이동한다.

export type RouteName =
  | 'start'
  | 'exams'
  | 'input'
  | 'review'
  | 'marks'
  | 'score'
  | 'causes'
  | 'anatomy'
  | 'steps'
  | 'retry'
  | 'history'
  | 'test'
  | 'unknown';

export interface Route {
  /** 예시 결과 안의 화면인지(#/demo/...). */
  demo: boolean;
  name: RouteName;
  param: string | null;
  query: URLSearchParams;
  /** # 뒤의 전체 문자열. */
  raw: string;
}

const NAMES: RouteName[] = ['exams', 'input', 'review', 'marks', 'score', 'causes', 'anatomy', 'steps', 'retry', 'history', 'test'];

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, '');
  const [pathPart = '', queryPart = ''] = raw.split('?');
  const parts = pathPart.split('/').filter((p) => p !== '');
  const demo = parts[0] === 'demo';
  if (demo) parts.shift();
  const first = parts[0];
  let name: RouteName;
  if (first === undefined) name = demo ? 'anatomy' : 'start';
  else if ((NAMES as string[]).includes(first)) name = first as RouteName;
  else name = 'unknown';
  let param: string | null = null;
  if (parts[1] !== undefined) {
    try {
      param = decodeURIComponent(parts[1]);
    } catch {
      param = parts[1];
    }
  }
  return { demo, name, param, query: new URLSearchParams(queryPart), raw };
}

const hasWindow = typeof window !== 'undefined';

/** 주소를 건드리지 않고 메모리에서만 이동하는 방식인지. 주소를 바꾸지 못하는 환경이면 실행 중에 이 방식으로 바뀐다. */
let memory = hasWindow && (window as unknown as { __SA_MEMORY_ROUTER__?: boolean }).__SA_MEMORY_ROUTER__ === true;

function readHash(): string {
  if (!hasWindow || memory) return '';
  try {
    return window.location.hash;
  } catch {
    return '';
  }
}

let currentHash = readHash();
let currentRoute: Route = parseHash(currentHash);
const listeners = new Set<() => void>();

function setCurrent(hash: string): void {
  if (hash === currentHash) return;
  currentHash = hash;
  currentRoute = parseHash(hash);
  for (const l of listeners) l();
}

function onHashChange(): void {
  if (!memory) setCurrent(readHash());
}

/** 앱 안의 링크(#/...)는 직접 처리한다. 주소를 바꿀 수 없는 환경에서도 링크가 그대로 동작한다. */
function onClick(e: MouseEvent): void {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const target = e.target instanceof Element ? e.target.closest('a[href^="#/"]') : null;
  if (!target) return;
  e.preventDefault();
  navigate((target.getAttribute('href') ?? '#/').slice(1));
}

// 주소 변화는 앱이 뜨는 순간부터 듣는다. 화면이 그려지기 전에 주소가 바뀌어도 놓치지 않는다.
if (hasWindow) {
  window.addEventListener('hashchange', onHashChange);
  document.addEventListener('click', onClick);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getRoute(): Route {
  // 듣기 전에 바뀐 주소가 있으면 여기서 맞춘다.
  if (!memory) {
    const h = readHash();
    if (h !== currentHash) {
      currentHash = h;
      currentRoute = parseHash(h);
    }
  }
  return currentRoute;
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, getRoute, getRoute);
}

export function href(path: string): string {
  return `#${path}`;
}

export function navigate(path: string, opts: { replace?: boolean } = {}): void {
  const target = href(path);
  if (target === currentHash) return;
  if (!memory) {
    try {
      if (opts.replace) window.history.replaceState(null, '', target);
      else window.location.hash = target;
      // 주소가 실제로 바뀌지 않는 환경이면 그때부터는 메모리에서만 이동한다.
      if (window.location.hash !== target) memory = true;
    } catch {
      // 주소를 바꾸지 못해도 화면은 바꾼다.
      memory = true;
    }
  }
  // 브라우저의 hashchange 알림을 기다리지 않고 바로 화면을 바꾼다.
  setCurrent(target);
}

/** 주소의 input 값(keypad, rows). 해시 안이나 주소 뒤 어느 쪽에 적어도 읽는다. */
export function inputModeFromUrl(route: Route): 'keypad' | 'rows' | null {
  const fromHash = route.query.get('input');
  let fromSearch: string | null = null;
  try {
    fromSearch = hasWindow ? new URLSearchParams(window.location.search).get('input') : null;
  } catch {
    fromSearch = null;
  }
  const v = fromHash ?? fromSearch;
  return v === 'keypad' || v === 'rows' ? v : null;
}
