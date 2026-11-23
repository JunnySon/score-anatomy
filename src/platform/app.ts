import { S_APP } from '../strings';
import './app.css';
import { browserCopy, browserStorage, noListen } from './common';
import type { Platform, StorageBackend } from './types';

// 앱용 묶음(아이폰 앱 껍데기에 싣는 단일 HTML)의 플랫폼. 껍데기와의 약속은 docs/앱_다리_규격.md 에 있다.
//
// - 껍데기는 문서가 시작될 때 window.__SA_APP__ 를 넣어 준다: platform, bridge, appVersion, store, fontScale.
// - 웹은 window.webkit.messageHandlers 의 saStore, saHaptic, saCopy 로 껍데기에 보낸다.
// - 껍데기는 window.__saFromApp({ type: 'storeFailed' | 'fontScale' | 'copied', ... })로 웹에 알린다.
// - window.__SA_APP__ 가 없으면(브라우저에서 열면) 일반 웹 빌드와 똑같이 동작한다.

/** 다리 규격 번호. 웹과 껍데기가 같은 번호여야 한다. */
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

/** 껍데기에 보낸다. 받을 곳이 없으면 false. */
function post(name: 'saStore' | 'saHaptic' | 'saCopy', body: unknown): boolean {
  const h = w?.webkit?.messageHandlers?.[name];
  if (!h || typeof h.postMessage !== 'function') return false;
  try {
    h.postMessage(body);
    return true;
  } catch {
    return false;
  }
}

/** 글자 크기 배율. 1보다 작으면 1, 2보다 크면 2로 본다. 숫자가 아니면 1이다. */
export function clampFontScale(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 1;
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

function finishCopy(waiter: CopyWaiter, ok: boolean): void {
  const i = copyWaiters.indexOf(waiter);
  if (i >= 0) copyWaiters.splice(i, 1);
  window.clearTimeout(waiter.timer);
  waiter.resolve(ok);
}

if (app && w) {
  document.documentElement.classList.add('sa-app');
  applyFontScale(app.fontScale);
  w.__saFromApp = (msg: unknown) => {
    if (typeof msg !== 'object' || msg === null) return;
    const m = msg as { type?: unknown; value?: unknown; ok?: unknown };
    if (m.type === 'storeFailed') {
      for (const l of storeFailedListeners) l();
    } else if (m.type === 'fontScale') {
      applyFontScale(m.value);
    } else if (m.type === 'copied') {
      // 복사 요청은 보낸 차례대로 답이 온다.
      const first = copyWaiters[0];
      if (first) finishCopy(first, m.ok === true);
    }
  };
}

/** 앱의 기록 저장소: 껍데기가 넣어 준 store 를 읽고, 저장할 때마다 saStore 로 보낸다. localStorage 는 쓰지 않는다. */
const appStorage: StorageBackend = {
  getItem: () => (app && typeof app.store === 'string' ? app.store : null),
  setItem: (_key: string, value: string) => {
    if (!post('saStore', { op: 'save', json: value })) throw new Error('saStore 를 받을 곳이 없어요.');
  },
  archive: () => {
    post('saStore', { op: 'archive' });
  },
};

function appCopy(text: string): Promise<boolean> {
  return new Promise((resolve) => {
    const waiter: CopyWaiter = { resolve, timer: 0 };
    waiter.timer = window.setTimeout(() => finishCopy(waiter, false), COPY_TIMEOUT_MS);
    copyWaiters.push(waiter);
    if (!post('saCopy', text)) finishCopy(waiter, false);
  });
}

export const platform: Platform = app
  ? {
      isApp: true,
      storage: () => appStorage,
      copy: appCopy,
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
