import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Page } from '@playwright/test';
import { ROOT } from './helpers';

// 앱용 묶음을 가짜 다리와 함께 여는 도구(e2e/app.spec.ts, e2e/webkit.spec.ts).
// 껍데기처럼 문서가 시작될 때 window.__SA_APP__ 와 window.webkit.messageHandlers 를 넣는다(docs/앱_다리_규격.md).

export type Bundle = 'app-test' | 'app-release';
export const bundlePath = (b: Bundle) => resolve(ROOT, 'ios/ScoreAnatomy/Web', b, 'index.html');
export const bundleUrl = (b: Bundle) => pathToFileURL(bundlePath(b)).href;

export interface BridgeOptions {
  store?: string | null;
  fontScale?: number;
  /** saCopy 에 답할 결과. */
  copyOk?: boolean;
}

export type LogEntry = [string, unknown];

/** 가짜 다리를 넣고 묶음을 연다. 다리로 온 메시지는 window.__bridgeLog 에 쌓인다. */
export async function openBundle(page: Page, bundle: Bundle, opts: BridgeOptions = {}, hash = '/'): Promise<void> {
  await page.addInitScript(
    ({ store, fontScale, copyOk }) => {
      const log: [string, unknown][] = [];
      const w = window as unknown as Record<string, unknown>;
      w.__bridgeLog = log;
      const handler = (name: string) => ({
        postMessage: (body: unknown) => {
          log.push([name, body]);
          if (name === 'saCopy') {
            setTimeout(() => (w.__saFromApp as ((m: unknown) => void) | undefined)?.({ type: 'copied', ok: copyOk }), 10);
          }
        },
      });
      w.webkit = { messageHandlers: { saStore: handler('saStore'), saHaptic: handler('saHaptic'), saCopy: handler('saCopy') } };
      w.__SA_APP__ = { platform: 'ios', bridge: 1, appVersion: '0.2.0', store, fontScale };
    },
    { store: opts.store ?? null, fontScale: opts.fontScale ?? 1, copyOk: opts.copyOk ?? true },
  );
  await page.goto(`${bundleUrl(bundle)}#${hash}`);
  await page.locator('.app').first().waitFor();
}

export const bridgeLog = (page: Page): Promise<LogEntry[]> =>
  page.evaluate(() => (window as unknown as { __bridgeLog: [string, unknown][] }).__bridgeLog.slice());

export const storeMessages = async (page: Page) =>
  (await bridgeLog(page)).filter(([n]) => n === 'saStore').map(([, b]) => b as { op: string; json?: string });

export const hapticCount = async (page: Page) => (await bridgeLog(page)).filter(([n, b]) => n === 'saHaptic' && b === 'key').length;
