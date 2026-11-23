import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Page } from '@playwright/test';
import { ROOT } from './helpers';

// 앱용 묶음을 가짜 다리와 함께 여는 도구(e2e/app.spec.ts, e2e/webkit.spec.ts).
// 껍데기처럼 문서가 시작될 때 window.__SA_APP__ 와 window.webkit.messageHandlers 를 넣는다(docs/앱_다리_규격.md).

export type Bundle = 'app-test' | 'app-release';
export const BUNDLES: readonly Bundle[] = ['app-test', 'app-release'];
export const bundlePath = (b: Bundle) => resolve(ROOT, 'ios/ScoreAnatomy/Web', b, 'index.html');
export const bundleUrl = (b: Bundle) => pathToFileURL(bundlePath(b)).href;

/** saCopy 에 답하는 방식: ok(성공), fail(실패), silent(답하지 않음). 열린 뒤에는 window.__copyMode 로 바꾼다. */
export type CopyMode = 'ok' | 'fail' | 'silent';

export interface BridgeOptions {
  /** __SA_APP__.store. 글자나 null, 또는 껍데기가 잘못 넣은 값(객체, 숫자 등). */
  store?: unknown;
  fontScale?: number;
  /** __SA_APP__.bridge(다리 규격 번호). */
  bridge?: unknown;
  copy?: CopyMode;
  /** __SA_APP__ 를 넣는 방식: object(규격대로), string(글자로 잘못 넣음), none(넣지 않음). */
  app?: 'object' | 'string' | 'none';
  /** 다리(messageHandlers)를 넣을지. app 이 none 이고 이것도 false 면 브라우저에서 연 것과 같다. */
  handlers?: boolean;
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
    ({ store, fontScale, bridge, copy, app, handlers }) => {
      const log: [string, unknown][] = [];
      const w = window as unknown as Record<string, unknown>;
      w.__bridgeLog = log;
      w.__copyMode = copy;
      const handler = (name: string) => ({
        postMessage: (body: unknown) => {
          log.push([name, body]);
          if (name === 'saCopy' && w.__copyMode !== 'silent') {
            const ok = w.__copyMode === 'ok';
            setTimeout(() => (w.__saFromApp as ((m: unknown) => void) | undefined)?.({ type: 'copied', ok }), 10);
          }
        },
      });
      if (handlers) w.webkit = { messageHandlers: { saStore: handler('saStore'), saHaptic: handler('saHaptic'), saCopy: handler('saCopy') } };
      const value = { platform: 'ios', bridge, appVersion: '0.2.0', store, fontScale };
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
