import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RemoteMessage } from '../platform/types';
import type { Exam, LockEntry } from '../types';
import { BUNDLED_EXAMS, CatalogStore, findBundledExam, REMOTE_TIMEOUT_MS, type CatalogSource, type RefreshResult } from '.';
import { validateExam } from './validate';

// 시험 목록 저장소(작업 지시서 3의 5-2, 5-3, 5-4): 넘겨받은 자료의 seq 규칙, 새로 확인의 결과와 응답 없음, 달력 합치기, 구독 알림.
// 껍데기(듣기와 보내기)는 테스트가 바꿔 끼운다. 넘겨받는 시험은 예시 시험 A의 사본으로 지은 테스트 전용 자료다(id 는 test-...).
// 날짜와 시각은 지시서의 형식 예시(2030-01-02, 08:40, 17:10, 17:45, 20:10)만 쓴다. 실제 시험의 값이 아니다.

const examA = findBundledExam('sample-a') as Exam;

/** 예시 시험 A의 사본으로 지은 테스트 전용 시험. */
function testExam(id: string, title: string, more: Partial<Exam> = {}): Exam {
  const exam: Exam = { ...examA, id, title, note: '테스트 전용으로 지은 시험이에요.', isSample: true, ...more };
  expect(validateExam(exam)).toEqual([]);
  return exam;
}

const remoteA = testExam('test-remote-a', '테스트 전용 시험 A');
const remoteB = testExam('test-remote-b', '테스트 전용 시험 B');

/** 테스트 전용 잠금 항목(지시서의 형식 예시). */
function lock(id: string, start = '2030-01-02T08:40', end = '2030-01-02T17:45'): LockEntry {
  return { id, label: '테스트 전용 잠금 항목', start, end };
}

/** 넘겨받은 자료. issuedAt 은 형식 예시 시각이다. */
function remote(seq: number, exams: unknown[] = [], locks: unknown[] = [], issuedAt = '2030-01-02T17:10') {
  return { seq, issuedAt, exams, locks };
}

/** 가짜 껍데기를 붙인 목록 저장소. push 는 껍데기가 알리는 것처럼 소식을 보낸다. */
function setup(more: Partial<CatalogSource> = {}) {
  let listener: ((msg: RemoteMessage) => void) | null = null;
  const shell = { sent: 0, accept: true, warned: [] as string[], onSend: null as null | (() => void) };
  const source: CatalogSource = {
    exams: BUNDLED_EXAMS,
    locks: [],
    remoteAtStart: null,
    onRemote: (fn) => {
      listener = fn;
      return () => {
        listener = null;
      };
    },
    refreshRemote: () => {
      shell.sent += 1;
      shell.onSend?.();
      return shell.accept;
    },
    warn: (message) => {
      shell.warned.push(message);
    },
    ...more,
  };
  const store = new CatalogStore(source);
  const push = (msg: RemoteMessage) => {
    expect(listener).not.toBeNull();
    listener!(msg);
  };
  return { store, push, shell };
}

/** 새로 확인을 시작하고, 끝나면 결과를 담는 상자를 돌려준다. */
function start(store: CatalogStore): { result: RefreshResult | null } {
  const box: { result: RefreshResult | null } = { result: null };
  void store.refresh().then((r) => {
    box.result = r;
  });
  return box;
}

const ids = (store: CatalogStore) => store.get().exams.map((e) => e.id);
const BUNDLED_IDS = ['sample-a', 'sample-b', 'sample-c'];

afterEach(() => {
  vi.useRealTimers();
});

describe('시험 목록 저장소(작업 지시서 3의 5-2, 5-3)', () => {
  it('넘겨받은 자료가 없으면 묶음 안 시험과 묶음 안 달력을 쓰고 remote 는 null 이다', () => {
    const { store } = setup({ locks: [lock('test-lock-a')] });
    expect(store.get()).toEqual({ exams: BUNDLED_EXAMS, locks: [lock('test-lock-a')], remote: null });
    expect(ids(store)).toEqual(BUNDLED_IDS);
  });

  it('시작할 때 넘겨받은 자료를 합치고 seq 와 issuedAt 을 적는다', () => {
    const { store } = setup({ remoteAtStart: remote(4, [remoteA], [lock('test-lock-r')], '2030-01-02T20:10') });
    expect(ids(store)).toEqual(['test-remote-a', ...BUNDLED_IDS]);
    expect(store.get().exams[0]).toBe(remoteA);
    expect(store.get().locks).toEqual([lock('test-lock-r')]);
    expect(store.get().remote).toEqual({ seq: 4, issuedAt: '2030-01-02T20:10' });
  });

  it('seq 가 더 큰 자료가 오면 목록을 바꾸고 구독자에게 알린다. 받아들일 때마다 묶음 안 자료와 새로 합친다', () => {
    const { store, push } = setup({ remoteAtStart: remote(1, [remoteA]) });
    let calls = 0;
    const stop = store.subscribe(() => {
      calls += 1;
    });
    const before = store.get();
    push({ type: 'remote', remote: remote(2, [remoteB]) });
    expect(calls).toBe(1);
    expect(store.get()).not.toBe(before);
    // 앞서 넘겨받은 자료(test-remote-a)와 합치지 않고 묶음 안 자료와 합친다.
    expect(ids(store)).toEqual(['test-remote-b', ...BUNDLED_IDS]);
    expect(store.get().remote).toEqual({ seq: 2, issuedAt: '2030-01-02T17:10' });
    // 구독을 그만두면 알리지 않는다.
    stop();
    push({ type: 'remote', remote: remote(3, [remoteA]) });
    expect(calls).toBe(1);
    expect(ids(store)).toEqual(['test-remote-a', ...BUNDLED_IDS]);
  });

  it('seq 가 같거나 작은 자료는 목록을 바꾸지 않고 알리지도 않는다. 스냅샷은 같은 객체다', () => {
    const { store, push } = setup({ remoteAtStart: remote(5, [remoteA]) });
    let calls = 0;
    store.subscribe(() => {
      calls += 1;
    });
    const before = store.get();
    push({ type: 'remote', remote: remote(5, [remoteB]) });
    push({ type: 'remote', remote: remote(4, [remoteB], [], '2030-01-02T20:10') });
    push({ type: 'remote', remote: remote(0) });
    expect(store.get()).toBe(before);
    expect(store.get().exams).toBe(before.exams);
    expect(calls).toBe(0);
    expect(ids(store)).toEqual(['test-remote-a', ...BUNDLED_IDS]);
  });

  it('넘겨받은 자료가 아직 없으면 seq 가 0 이어도 받는다', () => {
    const { store, push } = setup();
    push({ type: 'remote', remote: remote(0, [remoteA]) });
    expect(store.get().remote).toEqual({ seq: 0, issuedAt: '2030-01-02T17:10' });
    expect(ids(store)).toEqual(['test-remote-a', ...BUNDLED_IDS]);
  });

  it('remoteFailed 와 쓸 수 없는 모양의 remote(null 포함)는 목록을 바꾸지 않는다. 틀린 모양은 경고로 남긴다', () => {
    const { store, push, shell } = setup({ remoteAtStart: remote(1, [remoteA]) });
    const before = store.get();
    push({ type: 'remoteFailed' });
    push({ type: 'remote', remote: null });
    push({ type: 'remote', remote: { ...remote(9, [remoteB]), seq: -1 } });
    push({ type: 'remote', remote: { ...remote(9, [remoteB]), issuedAt: '2030-01-02T24:00' } });
    push({ type: 'remote', remote: { ...remote(9, [remoteB]), exams: 'test-remote-b' } });
    push({ type: 'remote', remote: '{"seq":9}' });
    expect(store.get()).toBe(before);
    expect(shell.warned).toEqual(Array(4).fill('넘겨받은 시험 자료를 쓰지 않았어요.'));
    // 처음 넘겨받은 자료가 틀린 모양이어도 묶음 안 자료로 시작한다.
    const second = setup({ remoteAtStart: { seq: 1 } });
    expect(second.store.get()).toEqual({ exams: BUNDLED_EXAMS, locks: [], remote: null });
    expect(second.shell.warned).toEqual(['넘겨받은 시험 자료를 쓰지 않았어요.']);
  });

  it('검사를 통과하지 못한 넘겨받은 시험은 목록에 없고 나머지는 있다', () => {
    const broken = { ...remoteB, items: remoteB.items.map((it) => (it.no === 1 ? { ...it, answer: undefined } : it)) };
    const { store, shell } = setup({ remoteAtStart: remote(1, [broken, remoteA]) });
    expect(ids(store)).toEqual(['test-remote-a', ...BUNDLED_IDS]);
    expect(shell.warned).toEqual(['넘겨받은 1번째 시험(id: test-remote-b)을 쓰지 않았어요.']);
  });

  it('넘겨받은 달력과 묶음 안 달력을 합친다: 같은 id 는 넘겨받은 항목을 쓰고, 형식이 틀린 항목은 버린다', () => {
    const bundled = [lock('test-lock-a'), lock('test-lock-b', '2030-01-02T08:40', '2030-01-02T17:10')];
    const theirs = [lock('test-lock-b', '2030-01-02T08:40', '2030-01-02T20:10'), lock('test-lock-c', '2030-01-02T17:45', '2030-01-02T17:10'), lock('test-lock-d')];
    const { store, push, shell } = setup({ locks: bundled });
    push({ type: 'remote', remote: remote(1, [], theirs) });
    expect(store.get().locks).toEqual([lock('test-lock-a'), lock('test-lock-b', '2030-01-02T08:40', '2030-01-02T20:10'), lock('test-lock-d')]);
    expect(shell.warned).toEqual(['넘겨받은 잠금 달력에서 형식이 틀린 항목을 버렸어요.']);
    // 다음 자료에 달력이 비어 있으면 묶음 안 달력만 남는다.
    push({ type: 'remote', remote: remote(2) });
    expect(store.get().locks).toEqual(bundled);
  });

  it('넘겨받은 자료로 묶음 안 시험(BUNDLED_EXAMS)은 바뀌지 않는다', () => {
    const override = testExam('sample-a', '테스트 전용 시험 A', { rev: 2 });
    const { store } = setup({ remoteAtStart: remote(1, [override]) });
    expect(store.get().exams[0]).toBe(override);
    expect(BUNDLED_EXAMS.map((e) => e.id)).toEqual(BUNDLED_IDS);
    expect(findBundledExam('sample-a')).toBe(examA);
    expect(examA.title).toBe('예시 시험 A');
  });
});

describe('새로 확인(작업 지시서 3의 5-4)', () => {
  it('응답을 기다리는 시간은 10초다', () => {
    expect(REMOTE_TIMEOUT_MS).toBe(10_000);
  });

  it('보내고 기다리다 더 새로운 자료가 오면 new, seq 가 같은 자료가 오면 same, remoteFailed 가 오면 failed 다', async () => {
    const { store, push, shell } = setup({ remoteAtStart: remote(1, [remoteA]) });
    const first = start(store);
    expect(shell.sent).toBe(1);
    push({ type: 'remote', remote: remote(2, [remoteA, remoteB]) });
    await Promise.resolve();
    expect(first.result).toBe('new');
    expect(ids(store)).toEqual(['test-remote-a', 'test-remote-b', ...BUNDLED_IDS]);

    const second = start(store);
    push({ type: 'remote', remote: remote(2, [remoteA, remoteB]) });
    await Promise.resolve();
    expect(second.result).toBe('same');

    const third = start(store);
    push({ type: 'remoteFailed' });
    await Promise.resolve();
    expect(third.result).toBe('failed');
    expect(shell.sent).toBe(3);
    expect(ids(store)).toEqual(['test-remote-a', 'test-remote-b', ...BUNDLED_IDS]);
  });

  it('seq 가 작은 자료가 오면 same, 쓸 수 없는 모양(null 포함)이 오면 failed 이고 목록은 그대로다', async () => {
    const { store, push } = setup({ remoteAtStart: remote(3, [remoteA]) });
    const before = store.get();
    const smaller = start(store);
    push({ type: 'remote', remote: remote(2, [remoteB]) });
    const none = start(store);
    push({ type: 'remote', remote: null });
    const bad = start(store);
    push({ type: 'remote', remote: { seq: 4 } });
    await Promise.resolve();
    expect([smaller.result, none.result, bad.result]).toEqual(['same', 'failed', 'failed']);
    expect(store.get()).toBe(before);
  });

  it('보내지 못하면 곧바로 failed 이고 목록은 그대로다', async () => {
    vi.useFakeTimers();
    const { store, shell } = setup({ remoteAtStart: remote(1, [remoteA]) });
    shell.accept = false;
    const before = store.get();
    const box = start(store);
    await Promise.resolve();
    expect(box.result).toBe('failed');
    expect(shell.sent).toBe(1);
    expect(store.get()).toBe(before);
    // 기다리던 것이 남지 않아서, 다음 새로 확인은 다시 보낸다.
    shell.accept = true;
    start(store);
    expect(shell.sent).toBe(2);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('10초 동안 아무 응답이 없으면 failed 이고, 그 뒤에 늦게 온 자료도 목록에는 받는다', async () => {
    vi.useFakeTimers();
    const { store, push } = setup({ remoteAtStart: remote(1, [remoteA]) });
    let calls = 0;
    store.subscribe(() => {
      calls += 1;
    });
    const box = start(store);
    await vi.advanceTimersByTimeAsync(REMOTE_TIMEOUT_MS - 1);
    expect(box.result).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(box.result).toBe('failed');
    expect(ids(store)).toEqual(['test-remote-a', ...BUNDLED_IDS]);
    // 늦게 온 자료: 새로 확인의 결과는 이미 failed 로 끝났지만, seq 가 크면 목록은 바꾼다.
    push({ type: 'remote', remote: remote(2, [remoteB]) });
    expect(box.result).toBe('failed');
    expect(calls).toBe(1);
    expect(ids(store)).toEqual(['test-remote-b', ...BUNDLED_IDS]);
    expect(store.get().remote).toEqual({ seq: 2, issuedAt: '2030-01-02T17:10' });
  });

  it('응답이 오면 기다리는 시간을 멈춘다. 기다리는 시간은 바꿔 끼울 수 있다', async () => {
    vi.useFakeTimers();
    const { store, push } = setup({ remoteAtStart: remote(1), timeoutMs: 50 });
    const late = start(store);
    await vi.advanceTimersByTimeAsync(50);
    expect(late.result).toBe('failed');
    const box = start(store);
    push({ type: 'remoteFailed' });
    await Promise.resolve();
    expect(box.result).toBe('failed');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('기다리는 동안 다시 부르면 또 보내지 않고 같은 결과를 기다린다', async () => {
    const { store, push, shell } = setup({ remoteAtStart: remote(1) });
    const p1 = store.refresh();
    const p2 = store.refresh();
    expect(p2).toBe(p1);
    expect(shell.sent).toBe(1);
    push({ type: 'remote', remote: remote(2, [remoteA]) });
    expect(await p1).toBe('new');
    expect(await p2).toBe('new');
  });

  it('껍데기가 받자마자 답해도 그 답을 결과로 받는다', async () => {
    const { store, push, shell } = setup({ remoteAtStart: remote(1) });
    shell.onSend = () => push({ type: 'remote', remote: remote(1) });
    expect(await store.refresh()).toBe('same');
    shell.onSend = () => push({ type: 'remote', remote: remote(2, [remoteB]) });
    expect(await store.refresh()).toBe('new');
    expect(ids(store)).toEqual(['test-remote-b', ...BUNDLED_IDS]);
  });

  it('기다리는 새로 확인이 없을 때 온 소식(remoteFailed 포함)은 목록 규칙대로만 다룬다', () => {
    const { store, push } = setup({ remoteAtStart: remote(1) });
    const before = store.get();
    push({ type: 'remoteFailed' });
    expect(store.get()).toBe(before);
    push({ type: 'remote', remote: remote(2, [remoteA]) });
    expect(ids(store)).toEqual(['test-remote-a', ...BUNDLED_IDS]);
  });
});
