import { S_APP } from '../strings';
import './app.css';
import { browserCopy, browserStorage, noListen } from './common';
import type { Platform, StorageBackend } from './types';

// 앱용 묶음(아이폰 앱 껍데기에 싣는 단일 HTML)의 플랫폼. 껍데기와의 약속은 docs/앱_다리_규격.md 에 있다.
//
// - 껍데기는 문서가 시작될 때 window.__SA_APP__ 를 넣어 준다: platform, bridge, appVersion, store, fontScale.
// - 웹은 window.webkit.messageHandlers 의 saStore, saHaptic, saCopy 로 껍데기에 보낸다.
// - 껍데기는 window.__saFromApp({ type: 'storeFailed' | 'fontScale' | 'copied', ... })로 웹에 알린다.
// - window.__SA_APP__ 도 다리(saStore)도 없으면(브라우저에서 열면) 브라우저 방식(localStorage, 브라우저 복사)으로 동작한다.
// - 껍데기 안인데 다리를 쓸 수 없으면(__SA_APP__ 가 객체가 아님, 규격 번호가 다름) 다리로 아무것도 보내지 않고
//   기록을 읽지도 저장하지도 않는다. 앱 전용 파일을 건드리지 않고, 껍데기가 지우는 웹 저장소(localStorage)에도 쓰지 않는다.

/** 다리 규격 번호. 웹과 껍데기가 같은 번호여야 한다. scripts/app-bundles.mjs 가 이 줄을 읽어 manifest.json 에 적는다. */
export const BRIDGE_VERSION = 1;

/** 복사 결과(copied)를 기다리는 시간. 껍데기가 답하지 않으면 실패로 본다. */
const COPY_TIMEOUT_MS = 3000;

interface SaApp {
  platform?: unknown;
  bridge?: unknown;
  appVersion?: unknown;
  store?: unknown;
  fontScale?: unknown;
}

interface Handler {
  postMessage(body: unknown): void;
}

type BridgeWindow = Window & {
  __SA_APP__?: SaApp;
  webkit?: { messageHandlers?: Record<string, Handler | undefined> };
  __saFromApp?: (msg: unknown) => void;
};

const w = (typeof window !== 'undefined' ? window : undefined) as BridgeWindow | undefined;
const app: SaApp | null = w && typeof w.__SA_APP__ === 'object' && w.__SA_APP__ !== null ? w.__SA_APP__ : null;
/** 껍데기 안인지: __SA_APP__ 가 객체로 들어왔거나, 다리(saStore)가 있다. */
const inApp = app !== null || typeof w?.webkit?.messageHandlers?.saStore?.postMessage === 'function';
/** 다리를 쓸 수 있는지: __SA_APP__ 가 객체이고 규격 번호가 같다. */
const bridgeOk = app !== null && app.bridge === BRIDGE_VERSION;

/** 껍데기에 보낸다. 다리를 쓸 수 없거나 받을 곳이 없으면 false. */
function post(name: 'saStore' | 'saHaptic' | 'saCopy', body: unknown): boolean {
  if (!bridgeOk) return false;
  const h = w?.webkit?.messageHandlers?.[name];
  if (!h || typeof h.postMessage !== 'function') return false;
  try {
    h.postMessage(body);
    return true;
  } catch {
    return false;
  }
}

/** 글자 크기 배율. 1보다 작으면 1, 2보다 크면 2로 본다(무한대도). 숫자가 아니면(NaN 포함) 1이다. */
export function clampFontScale(v: unknown): number {
  if (typeof v !== 'number' || Number.isNaN(v)) return 1;
  return Math.min(2, Math.max(1, v));
}

function applyFontScale(v: unknown): void {
  document.documentElement.style.fontSize = `${16 * clampFontScale(v)}px`;
}

const storeFailedListeners = new Set<() => void>();

interface CopyWaiter {
  resolve: (ok: boolean) => void;
  timer: number;
}
const copyWaiters: CopyWaiter[] = [];
/**
 * 기다리다 실패로 끝낸 복사 요청 수. 껍데기는 saCopy 하나에 copied 하나를 차례대로 보내므로(docs/앱_다리_규격.md),
 * 늦게 온 답은 그 수만큼 건너뛰어 다음 요청의 결과로 쓰지 않는다.
 */
let lateCopies = 0;

function finishCopy(waiter: CopyWaiter, ok: boolean): void {
  const i = copyWaiters.indexOf(waiter);
  if (i >= 0) copyWaiters.splice(i, 1);
  window.clearTimeout(waiter.timer);
  waiter.resolve(ok);
}

if (inApp && w) {
  document.documentElement.classList.add('sa-app');
  if (app) applyFontScale(app.fontScale);
  w.__saFromApp = (msg: unknown) => {
    if (typeof msg !== 'object' || msg === null) return;
    const m = msg as { type?: unknown; value?: unknown; ok?: unknown };
    if (m.type === 'storeFailed') {
      for (const l of storeFailedListeners) l();
    } else if (m.type === 'fontScale') {
      applyFontScale(m.value);
    } else if (m.type === 'copied') {
      // 복사 요청은 보낸 차례대로 답이 온다. 기다리다 실패로 끝낸 요청의 늦은 답은 건너뛴다.
      if (lateCopies > 0) {
        lateCopies -= 1;
        return;
      }
      const first = copyWaiters[0];
      if (first) finishCopy(first, m.ok === true);
    }
  };
}

/** 앱의 기록 저장소: 껍데기가 넣어 준 store 를 읽고, 저장할 때마다 saStore 로 보낸다. localStorage 는 쓰지 않는다. */
const appStorage: StorageBackend = {
  getItem: () => {
    const s = app?.store;
    // null(과 빠진 값)만 "저장된 기록 없음"이다.
    if (s === null || s === undefined) return null;
    // 글자가 아닌 값은 읽을 수 없는 것으로 본다. 빈 글자를 돌려주면 Store 가 덮어쓰지 않고 보관을 먼저 요청한다.
    return typeof s === 'string' ? s : '';
  },
  setItem: (_key: string, value: string) => {
    if (!post('saStore', { op: 'save', json: value })) throw new Error('saStore 를 받을 곳이 없어요.');
  },
  archive: () => post('saStore', { op: 'archive' }),
};

function appCopy(text: string): Promise<boolean> {
  return new Promise((resolve) => {
    const waiter: CopyWaiter = { resolve, timer: 0 };
    waiter.timer = window.setTimeout(() => {
      lateCopies += 1;
      finishCopy(waiter, false);
    }, COPY_TIMEOUT_MS);
    copyWaiters.push(waiter);
    if (!post('saCopy', text)) finishCopy(waiter, false);
  });
}

export const platform: Platform = inApp
  ? {
      isApp: true,
      // 다리를 쓸 수 없으면 기록을 읽지도 저장하지도 않는다(기록 화면에 저장하지 못했다는 안내가 뜬다).
      storage: () => (bridgeOk ? appStorage : null),
      copy: (text) => (bridgeOk ? appCopy(text) : browserCopy(text)),
      haptic: () => {
        post('saHaptic', 'key');
      },
      appText: S_APP,
      canSaveFile: false,
      onStoreFailed: (fn) => {
        storeFailedListeners.add(fn);
        return () => {
          storeFailedListeners.delete(fn);
        };
      },
    }
  : {
      isApp: false,
      storage: browserStorage,
      copy: browserCopy,
      haptic: () => undefined,
      appText: null,
      canSaveFile: true,
      onStoreFailed: noListen,
    };
