import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Platform, RemoteMessage } from './types';

// 앱용 플랫폼(src/platform/app.ts)이 다리 규격 번호에 따라 하는 일을 껍데기 흉내로 본다(작업 지시서 3의 5-1, docs/앱_다리_규격.md 7장).
// app.ts 는 읽힐 때 window.__SA_APP__ 를 한 번 읽으므로, 경우마다 가짜 window 와 document 를 넣고 모듈을 새로 읽는다.
// 앱용 묶음을 화면에서 여는 확인은 화면 테스트(e2e)가 한다.

/** 테스트 전용 넘겨받은 자료. 플랫폼은 모양을 보지 않고 넘기므로 시험 내용은 넣지 않는다. 날짜와 시각은 지시서의 형식 예시다. */
const REMOTE = { seq: 1, issuedAt: '2030-01-02T17:10', exams: [], locks: [] };
const NEWER = { seq: 2, issuedAt: '2030-01-02T20:10', exams: [], locks: [] };

interface Shell {
  platform: Platform;
  /** 다리로 온 메시지(이름, 값). */
  log: [string, unknown][];
  /** 껍데기가 웹에 알리는 것처럼 window.__saFromApp 를 부른다. */
  send: (msg: unknown) => void;
  fontSize: () => string | undefined;
  classes: string[];
}

/**
 * 껍데기처럼 __SA_APP__ 와 다리(messageHandlers)를 넣고 app.ts 를 새로 읽는다. sa 가 undefined 면 __SA_APP__ 를 넣지 않는다.
 * 다리에는 saRemote 받을 곳도 늘 넣어서, 웹이 보내면 안 되는 경우에 보냈는지 잡는다.
 */
async function openShell(sa: unknown, handlers = true): Promise<Shell> {
  const log: [string, unknown][] = [];
  const handler = (name: string) => ({ postMessage: (body: unknown) => log.push([name, body]) });
  const win: Record<string, unknown> = { setTimeout, clearTimeout };
  if (sa !== undefined) win.__SA_APP__ = sa;
  if (handlers) {
    win.webkit = { messageHandlers: { saStore: handler('saStore'), saHaptic: handler('saHaptic'), saCopy: handler('saCopy'), saRemote: handler('saRemote') } };
  }
  const style: { fontSize?: string } = {};
  const classes: string[] = [];
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', { documentElement: { classList: { add: (c: string) => classes.push(c) }, style } });
  vi.resetModules();
  const { platform } = await import('./app');
  return {
    platform,
    log,
    send: (msg) => (win.__saFromApp as ((m: unknown) => void) | undefined)?.(msg),
    fontSize: () => style.fontSize,
    classes,
  };
}

/** 껍데기가 넣어 주는 __SA_APP__ 값. */
const appValue = (bridge: unknown, extra: Record<string, unknown> = {}) => ({ platform: 'ios', bridge, appVersion: '0.2.0', store: null, fontScale: 1, ...extra });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('다리 규격 2: 앱용 플랫폼(src/platform/app.ts)', () => {
  it.each([1, 2])('규격 %s 껍데기와도 규격 1의 일(저장, 보관, 햅틱, 복사, 저장 실패 알림, 글자 크기)을 똑같이 한다', async (bridge) => {
    const s = await openShell(appValue(bridge, { fontScale: 1.25 }));
    expect(s.platform.isApp).toBe(true);
    expect(s.classes).toEqual(['sa-app']);
    expect(s.fontSize()).toBe('20px');
    const storage = s.platform.storage();
    expect(storage).not.toBeNull();
    expect(storage!.getItem('score-anatomy')).toBeNull();
    storage!.setItem('score-anatomy', '{"version":1}');
    expect(storage!.archive?.()).toBe(true);
    s.platform.haptic();
    const copied = s.platform.copy('좌표');
    s.send({ type: 'copied', ok: true });
    await expect(copied).resolves.toBe(true);
    const failed = vi.fn();
    s.platform.onStoreFailed(failed);
    s.send({ type: 'storeFailed' });
    s.send({ type: 'fontScale', value: 2 });
    expect(failed).toHaveBeenCalledTimes(1);
    expect(s.fontSize()).toBe('32px');
    expect(s.log).toEqual([
      ['saStore', { op: 'save', json: '{"version":1}' }],
      ['saStore', { op: 'archive' }],
      ['saHaptic', 'key'],
      ['saCopy', '좌표'],
    ]);
  });

  it('규격 2 껍데기: 처음 remote 를 그대로 넘기고, 새로 확인을 saRemote 로 보낸다', async () => {
    const s = await openShell(appValue(2, { remote: REMOTE }));
    expect(s.platform.remoteBridge).toBe(true);
    expect(s.platform.remoteAtStart).toBe(REMOTE);
    expect(s.platform.refreshRemote()).toBe(true);
    expect(s.log).toEqual([['saRemote', { op: 'refresh' }]]);
  });

  it('규격 2 껍데기: remote 칸이 없거나 null 이면 처음 값은 null 이다', async () => {
    const missing = await openShell(appValue(2));
    expect(missing.platform.remoteBridge).toBe(true);
    expect(missing.platform.remoteAtStart).toBeNull();
    const empty = await openShell(appValue(2, { remote: null }));
    expect(empty.platform.remoteBridge).toBe(true);
    expect(empty.platform.remoteAtStart).toBeNull();
  });

  it('규격 2 껍데기: remote 와 remoteFailed 알림을 듣는 쪽에 그대로 전하고, 듣기를 그만두면 전하지 않는다', async () => {
    const s = await openShell(appValue(2, { remote: REMOTE }));
    const got: RemoteMessage[] = [];
    const stop = s.platform.onRemote((m) => got.push(m));
    s.send({ type: 'remote', remote: NEWER });
    s.send({ type: 'remoteFailed' });
    // remote 칸이 빠진 알림은 null 로 전한다. 모양 검사는 듣는 쪽(시험 목록)이 한다.
    s.send({ type: 'remote' });
    s.send({ type: 'remote', remote: 'seq' });
    stop();
    s.send({ type: 'remote', remote: NEWER });
    s.send({ type: 'remoteFailed' });
    expect(got).toEqual([{ type: 'remote', remote: NEWER }, { type: 'remoteFailed' }, { type: 'remote', remote: null }, { type: 'remote', remote: 'seq' }]);
    expect((got[0] as { remote: unknown }).remote).toBe(NEWER);
    // 알림은 껍데기에 아무것도 보내지 않는다.
    expect(s.log).toEqual([]);
  });

  it('규격 1 껍데기: remote 칸과 remote, remoteFailed 알림을 보지 않고 saRemote 를 보내지 않는다', async () => {
    const s = await openShell(appValue(1, { remote: REMOTE }));
    expect(s.platform.remoteBridge).toBe(false);
    expect(s.platform.remoteAtStart).toBeNull();
    const got: RemoteMessage[] = [];
    s.platform.onRemote((m) => got.push(m));
    s.send({ type: 'remote', remote: NEWER });
    s.send({ type: 'remoteFailed' });
    expect(s.platform.refreshRemote()).toBe(false);
    expect(got).toEqual([]);
    expect(s.log).toEqual([]);
    // 규격 1의 일은 그대로 한다.
    expect(s.platform.storage()).not.toBeNull();
  });

  it.each([
    { label: '0', bridge: 0 },
    { label: '3', bridge: 3 },
    { label: '1.5', bridge: 1.5 },
    { label: '글자 "2"', bridge: '2' },
    { label: 'NaN', bridge: Number.NaN },
    { label: 'null', bridge: null },
    { label: '칸 없음', bridge: undefined },
  ])('웹이 받지 않는 규격 번호($label)면 다리로 아무것도 보내지 않고 기록을 읽지도 않으며 시험 자료도 넘겨받지 않는다', async ({ bridge }) => {
    const s = await openShell(appValue(bridge, { remote: REMOTE }));
    expect(s.platform.isApp).toBe(true);
    expect(s.platform.storage()).toBeNull();
    expect(s.platform.remoteBridge).toBe(false);
    expect(s.platform.remoteAtStart).toBeNull();
    const got: RemoteMessage[] = [];
    s.platform.onRemote((m) => got.push(m));
    s.send({ type: 'remote', remote: NEWER });
    s.send({ type: 'remoteFailed' });
    s.platform.haptic();
    expect(s.platform.refreshRemote()).toBe(false);
    expect(got).toEqual([]);
    expect(s.log).toEqual([]);
  });

  it('브라우저에서 열면(__SA_APP__ 도 다리도 없으면) 시험 자료를 넘겨받지 않는다', async () => {
    const s = await openShell(undefined, false);
    expect(s.platform.isApp).toBe(false);
    expect(s.classes).toEqual([]);
    expect(s.platform.remoteBridge).toBe(false);
    expect(s.platform.remoteAtStart).toBeNull();
    expect(s.platform.refreshRemote()).toBe(false);
    const got: RemoteMessage[] = [];
    s.platform.onRemote((m) => got.push(m));
    s.send({ type: 'remote', remote: NEWER });
    expect(got).toEqual([]);
    expect(s.log).toEqual([]);
  });
});
