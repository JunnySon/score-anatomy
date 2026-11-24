import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RemoteNotice, RemoteRefresh } from '../components/RemoteNotice';
import { BUNDLED_EXAMS, catalog, CatalogStore, REMOTE_TIMEOUT_MS } from '../exams';
import type { RemoteMessage } from '../platform/types';
import { S_APP } from '../strings';
import { ExamSelect } from './ExamSelect';

// 시험 선택 화면의 받은 시험 자료 안내와 "새로 확인"(작업 지시서 3의 5-4)을 글자로 그려서(서버 렌더링) 확인한다.
// 화면이 읽는 플랫폼(#platform)의 두 칸(remoteBridge, appText)만 테스트가 껍데기에 맞게 바꾸고, 나머지는 브라우저용 그대로 둔다.
// 누르고 기다리는 흐름은 버튼 상태(RemoteRefresh)를 가짜 껍데기를 붙인 시험 목록 저장소에 이어 두고, 누를 때마다 다시 그려 본다.
// 결과가 나올 때의 스크롤과 연달아 누르기 보호, 실제로 눌러 보는 확인은 브라우저 화면 테스트가 한다.
// 넘겨받는 자료는 시험 없이 seq 와 issuedAt 만 바꾼 테스트 전용 자료다. 날짜와 시각은 지시서의 형식 예시(2030-01-02, 08:40, 17:10, 20:10)만 쓴다.

const shell = vi.hoisted(() => ({ remoteBridge: false, appText: null as unknown }));

vi.mock('#platform', async (importOriginal) => {
  const real = await importOriginal<typeof import('../platform/web')>();
  return {
    platform: {
      ...real.platform,
      get remoteBridge() {
        return shell.remoteBridge;
      },
      get appText() {
        return shell.appText;
      },
    },
  };
});

/** 화면을 여는 곳: 브라우저, 다리 규격 1 껍데기(앱 문구는 쓰지만 시험 자료를 넘겨받지 않는다), 다리 규격 2 껍데기. */
function openIn(where: 'browser' | 'bridge1' | 'bridge2'): void {
  shell.remoteBridge = where === 'bridge2';
  shell.appText = where === 'browser' ? null : S_APP;
}

/** 넘겨받은 자료(테스트 전용). 시험과 잠금 항목은 넣지 않는다. */
const remote = (seq: number, issuedAt = '2030-01-02T17:10') => ({ seq, issuedAt, exams: [], locks: [] });

/** 이 파일의 앱 시험 목록(catalog)에 넣는 자료의 seq. 저장소는 seq 가 커질 때만 받으므로 늘 앞보다 크게 한다. */
let appSeq = 0;
function arriveInApp(): void {
  appSeq += 1;
  catalog.receive({ type: 'remote', remote: remote(appSeq) });
  expect(catalog.get().remote?.seq).toBe(appSeq);
}

const NEW = '시험 자료를 새로 받았어요.';
const SAME = '이미 가장 새 자료예요.';
const FAILED = '새 시험 자료를 받지 못했어요. 지금 있는 자료로 쓸 수 있어요.';
const BUTTON = `<button type="button" class="btn btn--text btn--left" data-testid="remote-refresh">${S_APP.remoteRefresh}</button>`;
const BUTTON_WAITING = `<button type="button" class="btn btn--text btn--left" data-testid="remote-refresh" aria-disabled="true">${S_APP.remoteRefresh}</button>`;

/** 화면 부품을 그린 요소 나무(훅을 쓰는 부품도 부를 수 있게 그리는 중에 부른다). */
function treeOf(render: () => ReactNode): ReactNode {
  let out: ReactNode = null;
  function Probe() {
    out = render();
    return null;
  }
  renderToStaticMarkup(<Probe />);
  return out;
}

/** 요소 나무에서 조건에 맞는 첫 요소. */
function findEl(node: ReactNode, match: (el: ReactElement<Record<string, unknown>>) => boolean): ReactElement<Record<string, unknown>> | null {
  if (Array.isArray(node)) {
    for (const c of node) {
      const found = findEl(c as ReactNode, match);
      if (found) return found;
    }
    return null;
  }
  if (!node || typeof node !== 'object' || !('props' in node)) return null;
  const el = node as ReactElement<Record<string, unknown>>;
  if (match(el)) return el;
  return findEl(el.props.children as ReactNode, match);
}

/** 화면 낭독기에 전하는 알림 영역의 글자와 보이는 결과 문구(없으면 null). 알림 영역은 결과가 없어도 늘 붙어 있다. */
function resultOf(html: string): { live: string; shown: string | null } {
  const live = /<p class="sr-only" role="status" aria-live="polite" data-testid="remote-live">([^<]*)<\/p>/.exec(html);
  const shown = /<div class="mt2"><p class="msg msg--plain" data-testid="remote-result" aria-hidden="true">([^<]*)<\/p><\/div>/.exec(html);
  expect(live, '알림 영역').not.toBeNull();
  return { live: live![1]!, shown: shown ? shown[1]! : null };
}

/** 가짜 껍데기를 붙인 시험 목록 저장소와, 그 위에서 시험 선택 화면을 한 번 연 동안의 버튼 상태. */
function setup(start = remote(1)) {
  let listener: ((msg: RemoteMessage) => void) | null = null;
  const log = { sent: 0 };
  const store = new CatalogStore({
    exams: BUNDLED_EXAMS,
    locks: [],
    remoteAtStart: start,
    onRemote: (fn) => {
      listener = fn;
      return () => {
        listener = null;
      };
    },
    refreshRemote: () => {
      log.sent += 1;
      return true;
    },
  });
  const refresh = new RemoteRefresh(store);
  const props = () => ({ text: S_APP, remote: store.get().remote!, refresh });
  return {
    store,
    refresh,
    log,
    /** 껍데기가 웹에 알린다. */
    push: (msg: RemoteMessage) => {
      expect(listener).not.toBeNull();
      listener!(msg);
    },
    /** 지금 상태로 안내를 그린 글자. */
    html: () => renderToStaticMarkup(<RemoteNotice {...props()} />),
    /** 그린 안내의 "새로 확인" 버튼을 누른다(버튼의 onClick). 결과를 적고 나면 끝나는 Promise 를 돌려준다. */
    click: (): Promise<void> => {
      const button = findEl(
        treeOf(() => RemoteNotice(props())),
        (el) => el.props['data-testid'] === 'remote-refresh',
      );
      expect(button).not.toBeNull();
      return (button!.props.onClick as () => Promise<void>)();
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  openIn('browser');
});

describe('시험 선택 화면의 받은 시험 자료 안내(작업 지시서 3의 5-4)', () => {
  it('앱에서 다리 규격 2 이상이고 넘겨받은 자료가 있을 때만 본문 끝에 안내 둘과 "새로 확인" 버튼을 두고, 규격 1 껍데기, 브라우저, 넘겨받은 자료가 없을 때는 지금 화면과 같다', () => {
    // 이 파일의 앱 시험 목록은 넘겨받은 자료 없이 시작한다(브라우저용 플랫폼의 처음 값). 넘겨받은 자료는 생기면 없어지지 않으므로 이 경우를 맨 먼저 본다.
    expect(catalog.get().remote).toBeNull();
    openIn('browser');
    const now = renderToStaticMarkup(<ExamSelect />);
    expect(now).not.toContain('remote-');
    expect(now).not.toContain(S_APP.remoteRefresh);
    // 넘겨받은 자료가 없으면 규격 2 껍데기여도, 규격 1 껍데기여도 지금 화면 그대로다.
    for (const where of ['bridge2', 'bridge1'] as const) {
      openIn(where);
      expect(renderToStaticMarkup(<ExamSelect />), where).toBe(now);
    }
    // 껍데기가 자료를 넘겨주면 규격 2 껍데기에서만 본문 끝(시험 목록 아래)에 안내 둘과 버튼을 둔다. 결과 문구는 없고 알림 영역은 비어 있다.
    arriveInApp();
    openIn('bridge2');
    const html = renderToStaticMarkup(<ExamSelect />);
    const notice =
      '<div class="mt6" data-testid="remote-notice"><div class="msg msg--plain remote-notice">' +
      `<p>${S_APP.remoteSource}</p><p class="mt2" data-testid="remote-issued">받은 자료 기준: 2030년 1월 2일 오후 5시 10분</p>${BUTTON}</div>` +
      '<p class="sr-only" role="status" aria-live="polite" data-testid="remote-live"></p></div>';
    expect(html).toContain(`${notice}</main>`);
    expect(html.match(/data-testid="remote-notice"/g)).toHaveLength(1);
    // 안내 말고는 지금 화면과 같다(시험 목록, 아래 버튼, 탭).
    expect(html.replace(notice, '')).toBe(now);
    // 규격 1 껍데기와 브라우저에서는 자료가 있어도 그리지 않는다(규격 1 껍데기는 자료를 넘겨받지도 않는다).
    for (const where of ['bridge1', 'browser'] as const) {
      openIn(where);
      expect(renderToStaticMarkup(<ExamSelect />), where).toBe(now);
    }
  });

  it('받은 자료 기준은 issuedAt 을 잘라 한국 시간 그대로 적고, 기기의 시간대와 상관없다', () => {
    const tz = process.env.TZ;
    try {
      for (const zone of ['Asia/Seoul', 'UTC', 'America/Los_Angeles']) {
        process.env.TZ = zone;
        for (const [issuedAt, line] of [
          ['2030-01-02T17:10', '받은 자료 기준: 2030년 1월 2일 오후 5시 10분'],
          ['2030-01-02T08:40', '받은 자료 기준: 2030년 1월 2일 오전 8시 40분'],
          ['2030-01-02T20:10', '받은 자료 기준: 2030년 1월 2일 오후 8시 10분'],
        ] as const) {
          expect(setup(remote(1, issuedAt)).html(), `${zone} ${issuedAt}`).toContain(`<p class="mt2" data-testid="remote-issued">${line}</p>`);
        }
      }
    } finally {
      if (tz === undefined) delete process.env.TZ;
      else process.env.TZ = tz;
    }
  });

  it('"새로 확인"을 누르면 새로 확인을 한 번 보내고, 응답이 올 때까지 버튼을 쓸 수 없다(그동안 눌러도 또 보내지 않는다)', async () => {
    const s = setup();
    expect(s.html()).toContain(BUTTON);
    const done = s.click();
    expect(s.log.sent).toBe(1);
    expect(s.html()).toContain(BUTTON_WAITING);
    expect(resultOf(s.html())).toEqual({ live: '', shown: null });
    // 기다리는 동안 다시 눌러도 또 보내지 않고 같은 응답을 기다린다.
    expect(s.click()).toBe(done);
    expect(s.log.sent).toBe(1);
    expect(s.html()).toContain(BUTTON_WAITING);
    s.push({ type: 'remote', remote: remote(1) });
    await done;
    expect(s.html()).toContain(BUTTON);
    expect(s.html()).not.toContain('aria-disabled');
    // 응답이 온 뒤에 누르면 다시 보낸다.
    void s.click();
    expect(s.log.sent).toBe(2);
  });

  it('더 새로운 자료가 오면 "시험 자료를 새로 받았어요."를 보여 주고 화면 낭독기에 전한다. 받은 자료 기준도 새 자료의 시각이 된다', async () => {
    const s = setup();
    const done = s.click();
    s.push({ type: 'remote', remote: remote(2, '2030-01-02T20:10') });
    await done;
    const html = s.html();
    expect(S_APP.remoteResult.new).toBe(NEW);
    expect(resultOf(html)).toEqual({ live: NEW, shown: NEW });
    expect(html).toContain('<p class="mt2" data-testid="remote-issued">받은 자료 기준: 2030년 1월 2일 오후 8시 10분</p>');
    expect(html).toContain(BUTTON);
  });

  it('seq 가 같은 자료가 오면 "이미 가장 새 자료예요."를 보여 주고 화면 낭독기에 전한다. 다시 누르면 앞 결과를 지우고 기다려서 같은 결과도 다시 전한다', async () => {
    const s = setup();
    let done = s.click();
    s.push({ type: 'remote', remote: remote(1) });
    await done;
    expect(S_APP.remoteResult.same).toBe(SAME);
    expect(resultOf(s.html())).toEqual({ live: SAME, shown: SAME });
    expect(s.html()).toContain('받은 자료 기준: 2030년 1월 2일 오후 5시 10분');
    done = s.click();
    expect(resultOf(s.html())).toEqual({ live: '', shown: null });
    s.push({ type: 'remote', remote: remote(1) });
    await done;
    expect(resultOf(s.html())).toEqual({ live: SAME, shown: SAME });
  });

  it('remoteFailed 가 오면 "새 시험 자료를 받지 못했어요. 지금 있는 자료로 쓸 수 있어요."를 보여 주고 화면 낭독기에 전한다', async () => {
    const s = setup();
    const done = s.click();
    s.push({ type: 'remoteFailed' });
    await done;
    expect(S_APP.remoteResult.failed).toBe(FAILED);
    expect(resultOf(s.html())).toEqual({ live: FAILED, shown: FAILED });
    // 가진 자료를 그대로 쓴다.
    expect(s.store.get().remote).toEqual({ seq: 1, issuedAt: '2030-01-02T17:10' });
    expect(s.html()).toContain(BUTTON);
  });

  it('10초 동안 아무 응답이 없으면 remoteFailed 와 같은 문구를 보여 준다. 그 전까지는 버튼을 쓸 수 없다', async () => {
    vi.useFakeTimers();
    const s = setup();
    const done = s.click();
    expect(REMOTE_TIMEOUT_MS).toBe(10_000);
    await vi.advanceTimersByTimeAsync(REMOTE_TIMEOUT_MS - 1);
    expect(s.html()).toContain(BUTTON_WAITING);
    expect(resultOf(s.html())).toEqual({ live: '', shown: null });
    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(resultOf(s.html())).toEqual({ live: FAILED, shown: FAILED });
    expect(s.html()).toContain(BUTTON);
  });

  it('새로 확인을 부르다 던지거나 실패로 끝나도 버튼이 막힌 채로 남지 않고 받지 못했다는 문구를 보여 준다', async () => {
    const { store } = setup();
    for (const refresh of [
      (): Promise<'new'> => {
        throw new Error('테스트 전용 오류');
      },
      () => Promise.reject(new Error('테스트 전용 오류')),
    ]) {
      const button = new RemoteRefresh({ get: store.get, refresh });
      await button.press();
      expect(button.get()).toEqual({ waiting: false, result: { kind: 'failed', seq: 1 } });
      expect(resultOf(renderToStaticMarkup(<RemoteNotice text={S_APP} remote={store.get().remote!} refresh={button} />))).toEqual({ live: FAILED, shown: FAILED });
    }
  });

  it('결과 문구는 그때의 자료에 대한 것이라, 그 뒤에 자료가 바뀌면(10초가 지나 받지 못한 것으로 끝낸 뒤 늦게 온 자료) 보여 주지 않는다', async () => {
    vi.useFakeTimers();
    const s = setup();
    const done = s.click();
    await vi.advanceTimersByTimeAsync(REMOTE_TIMEOUT_MS);
    await done;
    expect(resultOf(s.html()).shown).toBe(FAILED);
    // 늦게 온 자료도 목록에는 받는다(seq 규칙대로). 받지 못했다는 문구는 더는 맞지 않아 지우고, 받은 자료 기준은 새 시각이 된다.
    s.push({ type: 'remote', remote: remote(2, '2030-01-02T20:10') });
    expect(s.store.get().remote).toEqual({ seq: 2, issuedAt: '2030-01-02T20:10' });
    const html = s.html();
    expect(resultOf(html)).toEqual({ live: '', shown: null });
    expect(html).toContain('받은 자료 기준: 2030년 1월 2일 오후 8시 10분');
    expect(html).toContain(BUTTON);
  });

  it('화면을 떠났다 오면 결과 문구가 없다(버튼 상태는 시험 선택 화면을 열 때마다 새로 만든다)', async () => {
    openIn('bridge2');
    arriveInApp();
    const refreshIn = () => findEl(treeOf(() => ExamSelect()), (el) => el.type === RemoteNotice)?.props.refresh as RemoteRefresh | undefined;
    const first = refreshIn();
    expect(first).toBeInstanceOf(RemoteRefresh);
    // 이 파일의 앱 시험 목록은 브라우저용 플랫폼으로 만들어져 새로 확인을 보내지 못하므로, 누르면 곧바로 받지 못한 것으로 끝난다.
    await first!.press();
    expect(first!.get()).toEqual({ waiting: false, result: { kind: 'failed', seq: appSeq } });
    // 그 화면(같은 버튼 상태)에서는 결과 문구가 보인다.
    expect(resultOf(renderToStaticMarkup(<RemoteNotice text={S_APP} remote={catalog.get().remote!} refresh={first!} />)).shown).toBe(FAILED);
    // 화면을 다시 열면 버튼 상태를 새로 만들어서 결과 문구가 없다.
    const again = refreshIn();
    expect(again).toBeInstanceOf(RemoteRefresh);
    expect(again).not.toBe(first);
    expect(again!.get()).toEqual({ waiting: false, result: null });
    expect(resultOf(renderToStaticMarkup(<ExamSelect />))).toEqual({ live: '', shown: null });
  });
});
