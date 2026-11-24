import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Page } from '@playwright/test';
import { ROOT } from './helpers';

// 앱용 묶음을 가짜 다리와 함께 여는 도구(e2e/app.spec.ts, e2e/appRemote.spec.ts, e2e/webkit.spec.ts).
// 껍데기처럼 문서가 시작될 때 window.__SA_APP__ 와 window.webkit.messageHandlers 를 넣는다(docs/앱_다리_규격.md).
// 다리 규격 2 이상(bridge 가 2 이상의 숫자)이면 껍데기처럼 saRemote 도 받고, 시험 자료(remote)를 넘겨줄 수 있다(같은 문서 7장).

export type Bundle = 'app-test' | 'app-release';
export const BUNDLES: readonly Bundle[] = ['app-test', 'app-release'];
export const bundlePath = (b: Bundle) => resolve(ROOT, 'ios/ScoreAnatomy/Web', b, 'index.html');
export const bundleUrl = (b: Bundle) => pathToFileURL(bundlePath(b)).href;

/** saCopy 에 답하는 방식: ok(성공), fail(실패), silent(답하지 않음). 열린 뒤에는 window.__copyMode 로 바꾼다. */
export type CopyMode = 'ok' | 'fail' | 'silent';

/**
 * saRemote({ op: 'refresh' })에 답하는 방식(다리 규격 2 이상). 열린 뒤에는 window.__remoteMode 로 바꾼다(setRemoteMode).
 * - same: 껍데기가 가진 자료를 seq 그대로 remote 로 보낸다(새 자료가 없을 때. 가진 자료가 없으면 remote 가 null 이다).
 * - new: 새 자료(window.__remoteNext, setRemoteNext)를 받아들인 것으로 하고 그 자료를 remote 로 보낸다.
 * - failed: remoteFailed 를 보낸다.
 * - silent: 답하지 않는다(응답 없음).
 */
export type RemoteMode = 'same' | 'new' | 'failed' | 'silent';

export interface BridgeOptions {
  /** __SA_APP__.store. 글자나 null, 또는 껍데기가 잘못 넣은 값(객체, 숫자 등). */
  store?: unknown;
  fontScale?: number;
  /** __SA_APP__.bridge(다리 규격 번호). 2 이상의 숫자면 다리에 saRemote 도 넣는다. */
  bridge?: unknown;
  copy?: CopyMode;
  /** __SA_APP__ 를 넣는 방식: object(규격대로), string(글자로 잘못 넣음), none(넣지 않음). */
  app?: 'object' | 'string' | 'none';
  /** 다리(messageHandlers)를 넣을지. app 이 none 이고 이것도 false 면 브라우저에서 연 것과 같다. */
  handlers?: boolean;
  /**
   * __SA_APP__.remote(껍데기가 넘겨주는 시험 자료). 주지 않으면 칸을 넣지 않는다. null 이나 틀린 모양도 준 그대로 넣는다.
   * 이 값이 껍데기가 처음 가진 자료가 된다(remoteMode 의 same 이 보내는 자료).
   */
  remote?: unknown;
  /** saRemote 에 답하는 방식. 기본은 same. */
  remoteMode?: RemoteMode;
  /** remoteMode 가 new 일 때 보낼 새 자료. 기본은 null. */
  remoteNext?: unknown;
}

export type LogEntry = [string, unknown];

/** 묶음 파일 자신 말고 읽으려 한 주소(옆 파일도 밖으로 센다). */
const otherRequests = new WeakMap<Page, string[]>();

/** 가짜 다리를 넣고 묶음을 연다. 다리로 온 메시지는 window.__bridgeLog 에 쌓인다. */
export async function openBundle(page: Page, bundle: Bundle, opts: BridgeOptions = {}, hash = '/'): Promise<void> {
  const own = bundleUrl(bundle);
  if (!otherRequests.has(page)) {
    const list: string[] = [];
    otherRequests.set(page, list);
    page.on('request', (r) => {
      const u = r.url();
      const base = u.split('#')[0]!.split('?')[0]!;
      if (!u.startsWith('data:') && !u.startsWith('blob:') && !base.endsWith('/ios/ScoreAnatomy/Web/app-test/index.html') && !base.endsWith('/ios/ScoreAnatomy/Web/app-release/index.html')) list.push(u);
    });
  }
  await page.addInitScript(
    ({ store, fontScale, bridge, copy, app, handlers, hasRemote, remote, remoteMode, remoteNext }) => {
      const log: [string, unknown][] = [];
      const w = window as unknown as Record<string, unknown>;
      w.__bridgeLog = log;
      w.__copyMode = copy;
      // 껍데기가 가진 시험 자료와 saRemote 에 답하는 방식(다리 규격 2 이상).
      w.__remoteCurrent = hasRemote ? remote : null;
      w.__remoteMode = remoteMode;
      w.__remoteNext = remoteNext;
      const toWeb = (m: unknown) => setTimeout(() => (w.__saFromApp as ((m: unknown) => void) | undefined)?.(m), 10);
      const handler = (name: string) => ({
        postMessage: (body: unknown) => {
          log.push([name, body]);
          if (name === 'saCopy' && w.__copyMode !== 'silent') {
            const ok = w.__copyMode === 'ok';
            toWeb({ type: 'copied', ok });
          }
          if (name === 'saRemote') {
            // 껍데기는 새로 확인 하나에 remote 나 remoteFailed 를 하나 보낸다(docs/앱_다리_규격.md 7-3). silent 면 답하지 않는다.
            if (w.__remoteMode === 'same') toWeb({ type: 'remote', remote: w.__remoteCurrent });
            else if (w.__remoteMode === 'new') {
              w.__remoteCurrent = w.__remoteNext;
              toWeb({ type: 'remote', remote: w.__remoteCurrent });
            } else if (w.__remoteMode === 'failed') toWeb({ type: 'remoteFailed' });
          }
        },
      });
      // saRemote 는 다리 규격 2 이상의 껍데기에만 있다.
      const remoteBridge = typeof bridge === 'number' && bridge >= 2;
      const names = ['saStore', 'saHaptic', 'saCopy', ...(remoteBridge ? ['saRemote'] : [])];
      if (handlers) w.webkit = { messageHandlers: Object.fromEntries(names.map((n) => [n, handler(n)])) };
      const value: Record<string, unknown> = { platform: 'ios', bridge, appVersion: '0.2.0', store, fontScale };
      if (hasRemote) value.remote = remote;
      if (app === 'object') w.__SA_APP__ = value;
      else if (app === 'string') w.__SA_APP__ = JSON.stringify(value);
    },
    {
      store: opts.store === undefined ? null : opts.store,
      fontScale: opts.fontScale ?? 1,
      bridge: opts.bridge === undefined ? 1 : opts.bridge,
      copy: opts.copy ?? 'ok',
      app: opts.app ?? 'object',
      handlers: opts.handlers ?? true,
      hasRemote: opts.remote !== undefined,
      remote: opts.remote === undefined ? null : opts.remote,
      remoteMode: opts.remoteMode ?? 'same',
      remoteNext: opts.remoteNext === undefined ? null : opts.remoteNext,
    },
  );
  await page.goto(`${own}#${hash}`);
  await page.locator('.app').first().waitFor();
}

/** 묶음 파일 자신 말고 읽으려 한 주소. */
export const otherRequestsOf = (page: Page): string[] => (otherRequests.get(page) ?? []).slice();

export const bridgeLog = (page: Page): Promise<LogEntry[]> =>
  page.evaluate(() => ((window as unknown as { __bridgeLog?: [string, unknown][] }).__bridgeLog ?? []).slice());

export const storeMessages = async (page: Page) =>
  (await bridgeLog(page)).filter(([n]) => n === 'saStore').map(([, b]) => b as { op: string; json?: string });

export const hapticCount = async (page: Page) => (await bridgeLog(page)).filter(([n, b]) => n === 'saHaptic' && b === 'key').length;

/** 껍데기가 웹에 알리는 것처럼 window.__saFromApp 를 부른다. */
export const sendFromApp = (page: Page, msg: unknown) =>
  page.evaluate((m) => (window as unknown as { __saFromApp: (x: unknown) => void }).__saFromApp(m), msg);

export const setCopyMode = (page: Page, mode: CopyMode) =>
  page.evaluate((m) => {
    (window as unknown as { __copyMode: string }).__copyMode = m;
  }, mode);

/** 마지막으로 saStore 의 save 로 보낸 기록 글자. 보낸 적이 없으면 null. */
export const lastSavedJson = async (page: Page): Promise<string | null> => {
  const saves = (await storeMessages(page)).filter((m) => m.op === 'save');
  return saves.length > 0 ? (saves[saves.length - 1]!.json ?? null) : null;
};

/** 웹이 saRemote 로 보낸 것(다리 규격 2 이상의 껍데기에만 받는 곳이 있다). */
export const remoteRequests = async (page: Page): Promise<unknown[]> =>
  (await bridgeLog(page)).filter(([n]) => n === 'saRemote').map(([, b]) => b);

/**
 * 껍데기가 새 시험 자료를 받아들여 웹에 알린다({ type: 'remote', remote }). 그 자료가 껍데기가 가진 자료가 된다
 * (새로 확인에 same 으로 답할 때 보내는 자료).
 */
export const sendRemote = (page: Page, remote: unknown) =>
  page.evaluate((r) => {
    const w = window as unknown as { __remoteCurrent: unknown; __saFromApp: (m: unknown) => void };
    w.__remoteCurrent = r;
    w.__saFromApp({ type: 'remote', remote: r });
  }, remote);

/** 껍데기가 새 시험 자료를 받지 못했다고 알린다({ type: 'remoteFailed' }). */
export const sendRemoteFailed = (page: Page) => sendFromApp(page, { type: 'remoteFailed' });

/** saRemote 에 답하는 방식을 바꾼다. */
export const setRemoteMode = (page: Page, mode: RemoteMode) =>
  page.evaluate((m) => {
    (window as unknown as { __remoteMode: string }).__remoteMode = m;
  }, mode);

/** remoteMode 가 new 일 때 보낼 새 자료를 정한다. */
export const setRemoteNext = (page: Page, remote: unknown) =>
  page.evaluate((r) => {
    (window as unknown as { __remoteNext: unknown }).__remoteNext = r;
  }, remote);
