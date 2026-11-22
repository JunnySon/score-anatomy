import { useSyncExternalStore } from 'react';

// 해시 라우팅. 어떤 정적 호스팅이나 파일 하나로도 열리게 주소의 # 뒤만 쓴다.

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

function currentHash(): string {
  return typeof window === 'undefined' ? '' : window.location.hash;
}

const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener('hashchange', notify);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener('hashchange', notify);
  };
}

let cachedHash = '';
let cachedRoute: Route = parseHash('');

function getRoute(): Route {
  const h = currentHash();
  if (h !== cachedHash) {
    cachedHash = h;
    cachedRoute = parseHash(h);
  }
  return cachedRoute;
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, getRoute, getRoute);
}

export function href(path: string): string {
  return `#${path}`;
}

export function navigate(path: string, opts: { replace?: boolean } = {}): void {
  const target = href(path);
  if (window.location.hash === target) return;
  if (opts.replace) {
    const url = `${window.location.pathname}${window.location.search}${target}`;
    window.history.replaceState(null, '', url);
  } else {
    window.location.hash = target;
  }
  // 브라우저의 hashchange 알림을 기다리지 않고 바로 화면을 바꾼다.
  notify();
}

/** 주소의 input 값(keypad, rows). 해시 안이나 주소 뒤 어느 쪽에 적어도 읽는다. */
export function inputModeFromUrl(route: Route): 'keypad' | 'rows' | null {
  const fromHash = route.query.get('input');
  const fromSearch = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('input');
  const v = fromHash ?? fromSearch;
  return v === 'keypad' || v === 'rows' ? v : null;
}
