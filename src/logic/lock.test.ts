import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { catalog } from '../exams';
import rawLocks from '../exams/locks.json';
import { validateLocks } from '../exams/validate';
import type { LockEntry } from '../types';
import { KST_OFFSET_MS } from './dates';
import { lockStateAt, mergeLocks, sameLockState, type LockState, type LockWarn } from './lock';

// 풀이 잠금(작업 지시서 3의 4-5): 잠금 달력의 형식, 판정, 묶음 안 달력과 넘겨받은 달력 합치기.
// 테스트 자료는 그 자리에서 지은 테스트 전용 항목뿐이다. 실제 시험의 시행일이나 시험 시간이 아니다.
// 날짜와 시각은 지시서의 형식 예시(2030-01-02, 08:40, 17:10, 17:45, 20:10)와 그 1분 앞, 그리고 일부러 틀린 값만 쓴다.

/** 테스트 전용 잠금 항목. */
function entry(id: string, start: string, end: string): LockEntry {
  return { id, label: '테스트 전용 잠금 항목', start, end };
}

/** 한국 시간 2030년 1월 2일 h시 mi분의 UTC 밀리초. 한국 시간은 UTC보다 9시간 빠르다. */
const at = (h: number, mi: number) => Date.UTC(2030, 0, 2, h, mi) - KST_OFFSET_MS;
const OPEN: LockState = { locked: false };
const lockedUntil = (h: number, mi: number): LockState => ({ locked: true, until: { h, mi } });

// 형식 예시: "2030-01-02T08:40"부터 "2030-01-02T17:45"까지.
const DAY = [entry('test-lock-a', '2030-01-02T08:40', '2030-01-02T17:45')];

/** 기기의 시간대에 따라 값이 달라지는 Date 메서드(지역 시각을 읽거나 쓰는 것). */
const LOCAL_TIME =
  /\.(?:get|set)(?:FullYear|Year|Month|Date|Day|Hours|Minutes|Seconds|Milliseconds)\(|getTimezoneOffset|toLocale\w*String|toDateString|toTimeString|Date\.parse\(|new Date\([^)]*,/;

/** 버린 이유를 모으는 가짜 경고. */
function warnSpy() {
  return vi.fn<LockWarn>();
}

function reasonsOf(warn: ReturnType<typeof warnSpy>): string {
  return warn.mock.calls.flatMap(([, reasons]) => reasons).join(' ');
}

describe('풀이 잠금(4-5)', () => {
  it('시작 1분 전은 열림', () => {
    expect(lockStateAt(at(8, 39), DAY)).toEqual(OPEN);
    // 시작 직전 밀리초까지 열려 있다.
    expect(lockStateAt(at(8, 40) - 1, DAY)).toEqual(OPEN);
  });

  it('시작 시각은 잠김', () => {
    expect(lockStateAt(at(8, 40), DAY)).toEqual(lockedUntil(17, 45));
    // 한국 시간 2030-01-02 08:40 은 UTC 로 전날(2030-01-01 23:40)이다. 날짜도 한국 시간으로 본다.
    expect(at(8, 40)).toBe(Date.UTC(2030, 0, 1, 23, 40));
    expect(lockStateAt(Date.UTC(2030, 0, 1, 23, 40), DAY)).toEqual(lockedUntil(17, 45));
  });

  it('종료 1분 전은 잠김', () => {
    expect(lockStateAt(at(17, 44), DAY)).toEqual(lockedUntil(17, 45));
    // 종료 직전 밀리초까지 잠겨 있다.
    expect(lockStateAt(at(17, 45) - 1, DAY)).toEqual(lockedUntil(17, 45));
  });

  it('종료 시각은 열림', () => {
    expect(lockStateAt(at(17, 45), DAY)).toEqual(OPEN);
    expect(lockStateAt(at(20, 10), DAY)).toEqual(OPEN);
  });

  it('달력이 비면 늘 열림', () => {
    const warn = warnSpy();
    for (const t of [at(8, 39), at(8, 40), at(17, 10), at(17, 44), at(17, 45), at(20, 10)]) {
      expect(lockStateAt(t, [])).toEqual(OPEN);
      expect(lockStateAt(t, mergeLocks([], null, warn))).toEqual(OPEN);
      expect(lockStateAt(t, mergeLocks([], [], warn))).toEqual(OPEN);
    }
    expect(mergeLocks([], null, warn)).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('같은 UTC 시각이면 기기 시간대가 달라도 결과가 같고 판정 코드는 지역 시각을 읽는 Date 메서드를 쓰지 않는다', () => {
    const times = [at(8, 39), at(8, 40), at(17, 10), at(17, 44), at(17, 45)];
    const expected = [OPEN, lockedUntil(17, 45), lockedUntil(17, 45), lockedUntil(17, 45), OPEN];
    const before = process.env.TZ;
    const localTimes = new Set<string>();
    try {
      for (const tz of ['UTC', 'Asia/Seoul', 'America/Los_Angeles', 'Asia/Kolkata', 'Pacific/Kiritimati']) {
        process.env.TZ = tz;
        // 시간대를 바꾼 것이 실제로 먹었는지 보려고 지역 시각을 함께 모은다(이 테스트 파일에서만 쓴다).
        const local = new Date(at(8, 40));
        localTimes.add(`${local.getDate()}일 ${local.getHours()}시`);
        expect(times.map((t) => lockStateAt(t, DAY)), tz).toEqual(expected);
      }
    } finally {
      if (before === undefined) delete process.env.TZ;
      else process.env.TZ = before;
    }
    expect(localTimes.size).toBeGreaterThan(1);
    // 판정 코드: 판정(lock.ts), 지금 시각을 한국 시간 글자로 바꾸는 곳(dates.ts), 화면에서 판정하는 훅(LockNotice.tsx 의 useLockState).
    for (const file of ['src/logic/lock.ts', 'src/logic/dates.ts', 'src/components/LockNotice.tsx']) {
      expect(readFileSync(resolve(process.cwd(), file), 'utf8'), file).not.toMatch(LOCAL_TIME);
    }
    // 판정은 Date 로 시각을 만들지 않고 한국 시간 글자끼리 견준다.
    expect(readFileSync(resolve(process.cwd(), 'src/logic/lock.ts'), 'utf8')).not.toMatch(/new Date\b|Date\.\w+\(/);
  });

  it('id 가 겹치면 넘겨받은 항목이 이긴다', () => {
    const warn = warnSpy();
    // 묶음 안 항목은 17:45 까지, 넘겨받은 같은 id 의 항목은 17:10 까지다.
    const bundled = [entry('test-lock-a', '2030-01-02T08:40', '2030-01-02T17:45')];
    const remote = [entry('test-lock-a', '2030-01-02T08:40', '2030-01-02T17:10')];
    const merged = mergeLocks(bundled, remote, warn);
    expect(merged).toEqual(remote);
    // 받은 항목 객체를 고치지 않고 그대로 담는다.
    expect(merged[0]).toBe(remote[0]);
    expect(lockStateAt(at(8, 40), merged)).toEqual(lockedUntil(17, 10));
    expect(lockStateAt(at(17, 10), merged)).toEqual(OPEN);
    // 대조: 묶음 안 달력만 보면 17:10 에도 잠겨 있다.
    expect(lockStateAt(at(17, 10), mergeLocks(bundled, null, warn))).toEqual(lockedUntil(17, 45));
    // id 가 다른 항목은 두 달력 모두 남는다(묶음 안 항목 다음에 넘겨받은 항목).
    const onlyMine = entry('test-lock-b', '2030-01-02T17:45', '2030-01-02T20:10');
    const onlyTheirs = entry('test-lock-c', '2030-01-02T17:45', '2030-01-02T20:10');
    expect(mergeLocks([...bundled, onlyMine], [...remote, onlyTheirs], warn)).toEqual([onlyMine, ...remote, onlyTheirs]);
    // 넘겨받은 달력이 없거나 비어 있으면 묶음 안 달력 그대로다(넘겨받은 달력은 같은 id 의 항목만 바꾼다).
    expect(mergeLocks(bundled, null, warn)).toEqual(bundled);
    expect(mergeLocks(bundled, undefined, warn)).toEqual(bundled);
    expect(mergeLocks(bundled, [], warn)).toEqual(bundled);
    expect(warn).not.toHaveBeenCalled();
  });

  it('형식이 틀린 항목은 버린다', () => {
    const good = DAY[0]!;
    const { label } = good;
    const bad: [unknown, string][] = [
      [null, '2번째 항목이 객체가 아니에요.'],
      [[good.id, label, good.start, good.end], '2번째 항목이 객체가 아니에요.'],
      ['test-lock-x', '2번째 항목이 객체가 아니에요.'],
      [{ label, start: good.start, end: good.end }, '2번째 항목: id 값이 비어 있어요.'],
      [{ ...good, id: '' }, '2번째 항목: id 값이 비어 있어요.'],
      [{ ...good, id: 5 }, '2번째 항목: id 값이 비어 있어요.'],
      [{ ...good, id: 'test-lock-x', label: '  ' }, '2번째 항목: label 값이 비어 있어요.'],
      [{ id: 'test-lock-x', start: good.start, end: good.end }, '2번째 항목: label 값이 비어 있어요.'],
      // 시각은 두 자리이고 시는 0~23, 분은 0~59 이며 실제로 있는 날짜여야 한다. 초와 시간대 표시는 붙이지 않는다.
      ...['2030-01-02T8:40', '2030-01-02T24:00', '2030-01-02T08:60', '2027-02-29T08:40', '2030-01-02 08:40', '2030-01-02T08:40:00', '2030-01-02T08:40+09:00', '2030-01-02', 203001020840, null].map(
        (start): [unknown, string] => [{ ...good, id: 'test-lock-x', start }, '2번째 항목: start는'],
      ),
      ...['2030-01-02T17:60', '2030-01-02T25:45', '2030-01-02T17:45Z', undefined].map((end): [unknown, string] => [{ ...good, id: 'test-lock-x', end }, '2번째 항목: end는']),
      // start 와 end 는 같은 날이어야 한다(다른 날은 일부러 틀리게 지은 값이다).
      [{ ...good, id: 'test-lock-x', end: '2030-01-03T17:45' }, '2번째 항목: start와 end는 같은 날이어야 해요.'],
      // start 가 end 보다 앞서야 한다. 같은 시각도 받지 않는다.
      [{ ...good, id: 'test-lock-x', start: '2030-01-02T17:45' }, '2번째 항목: start가 end보다 앞서야 해요.'],
      [{ ...good, id: 'test-lock-x', start: '2030-01-02T20:10' }, '2번째 항목: start가 end보다 앞서야 해요.'],
    ];
    const at1710 = at(17, 10);
    for (const [raw, reason] of bad) {
      // 묶음 안 달력과 넘겨받은 달력 어느 쪽에 있어도 버리고 이유를 남긴다. 형식에 맞는 항목은 그대로 쓴다.
      const fromBundled = warnSpy();
      expect(mergeLocks([good, raw], null, fromBundled), reason).toEqual([good]);
      expect(fromBundled, reason).toHaveBeenCalledTimes(1);
      expect(fromBundled.mock.calls[0]![0], reason).toContain('묶음 안 잠금 달력');
      expect(reasonsOf(fromBundled), reason).toContain(reason);
      const fromRemote = warnSpy();
      expect(mergeLocks([], [good, raw], fromRemote), reason).toEqual([good]);
      expect(fromRemote.mock.calls[0]![0], reason).toContain('넘겨받은 잠금 달력');
      expect(reasonsOf(fromRemote), reason).toContain(reason);
      // 판정도 버린 항목을 보지 않는다.
      expect(lockStateAt(at1710, mergeLocks([raw], null, warnSpy())), reason).toEqual(OPEN);
      expect(lockStateAt(at1710, [raw as LockEntry]), reason).toEqual(OPEN);
    }

    // 같은 달력 안에서 앞의 항목과 id 가 겹치면 뒤의 항목을 버린다.
    const dup = { ...good, end: '2030-01-02T20:10' };
    const dupWarn = warnSpy();
    expect(mergeLocks([good, dup], null, dupWarn)).toEqual([good]);
    expect(mergeLocks([], [good, dup], dupWarn)).toEqual([good]);
    expect(dupWarn).toHaveBeenCalledTimes(2);
    expect(reasonsOf(dupWarn)).toContain('2번째 항목: 앞의 항목과 id가 겹쳐요(test-lock-a).');
    expect(lockStateAt(at(17, 45), mergeLocks([good, dup], null, dupWarn))).toEqual(OPEN);

    // 넘겨받은 항목이 형식이 틀려 버려지면 같은 id 의 묶음 안 항목이 그대로 남는다(잠금이 사라지지 않는다).
    const warn = warnSpy();
    const broken = { ...good, end: '2030-01-02T17:60' };
    expect(mergeLocks([good], [broken], warn)).toEqual([good]);
    expect(lockStateAt(at(17, 10), mergeLocks([good], [broken], warn))).toEqual(lockedUntil(17, 45));

    // 달력이 배열이 아니면 빈 달력으로 보고 이유를 남긴다.
    for (const notList of [{}, 'test-lock-a', 5, true]) {
      const w = warnSpy();
      expect(mergeLocks(notList, null, w), String(notList)).toEqual([]);
      expect(mergeLocks([good], notList, w), String(notList)).toEqual([good]);
      expect(w, String(notList)).toHaveBeenCalledTimes(2);
      expect(reasonsOf(w), String(notList)).toContain('잠금 달력은 항목의 배열이어야 해요.');
    }

    // 개발자 콘솔에는 오류(console.error)가 아니라 경고(console.warn)로 남긴다. 화면 테스트는 console.error 를 실패로 센다.
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(mergeLocks([good, null], [{ ...good, id: 'test-lock-x', start: '2030-01-02T8:40' }])).toEqual([good]);
      expect(consoleWarn).toHaveBeenCalledTimes(2);
      expect(String(consoleWarn.mock.calls[0]?.[0])).toContain('묶음 안 잠금 달력에서 형식이 틀린 항목을 버렸어요.');
      expect(consoleWarn.mock.calls[0]?.[1]).toEqual(['2번째 항목이 객체가 아니에요.']);
      expect(String(consoleWarn.mock.calls[1]?.[0])).toContain('넘겨받은 잠금 달력에서 형식이 틀린 항목을 버렸어요.');
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleWarn.mockRestore();
      consoleError.mockRestore();
    }
  });
});

describe('풀이 잠금 달력과 판정의 세부(4-5)', () => {
  it('이어 붙거나 겹친 항목은 따라가서 가장 늦은 end 에 풀리고, 사이가 빈 시간은 열림이다', () => {
    const morning = entry('test-lock-a', '2030-01-02T08:40', '2030-01-02T17:10');
    const next = entry('test-lock-b', '2030-01-02T17:10', '2030-01-02T17:45');
    // 이어 붙은 항목: 앞 항목의 end 에도 잠겨 있으므로 뒤 항목의 end 가 풀리는 시각이다. 항목의 차례와 상관없다.
    expect(lockStateAt(at(8, 40), [morning, next])).toEqual(lockedUntil(17, 45));
    expect(lockStateAt(at(8, 40), [next, morning])).toEqual(lockedUntil(17, 45));
    expect(lockStateAt(at(17, 10), [morning, next])).toEqual(lockedUntil(17, 45));
    expect(lockStateAt(at(17, 45), [morning, next])).toEqual(OPEN);
    // 겹친 항목: 가장 늦은 end.
    const wide = entry('test-lock-c', '2030-01-02T17:10', '2030-01-02T20:10');
    expect(lockStateAt(at(8, 40), [...DAY, wide])).toEqual(lockedUntil(20, 10));
    expect(lockStateAt(at(8, 40), [morning, next, wide])).toEqual(lockedUntil(20, 10));
    // 사이가 비면 앞 항목의 end 에 풀리고, 뒤 항목의 start 까지는 열림이다.
    const evening = entry('test-lock-d', '2030-01-02T17:45', '2030-01-02T20:10');
    expect(lockStateAt(at(8, 40), [morning, evening])).toEqual(lockedUntil(17, 10));
    expect(lockStateAt(at(17, 10), [morning, evening])).toEqual(OPEN);
    expect(lockStateAt(at(17, 44), [morning, evening])).toEqual(OPEN);
    expect(lockStateAt(at(17, 45), [morning, evening])).toEqual(lockedUntil(20, 10));
  });

  it('날짜로 쓸 수 없는 지금 값은 어느 구간에도 들지 않아 열림이다', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 8.64e15]) {
      expect(lockStateAt(bad, DAY), String(bad)).toEqual(OPEN);
    }
  });

  it('두 판정 결과가 같은지 견준다', () => {
    expect(sameLockState(OPEN, { locked: false })).toBe(true);
    expect(sameLockState(lockedUntil(17, 45), lockedUntil(17, 45))).toBe(true);
    expect(sameLockState(lockedUntil(17, 45), lockedUntil(17, 10))).toBe(false);
    expect(sameLockState(lockedUntil(17, 45), lockedUntil(20, 45))).toBe(false);
    expect(sameLockState(OPEN, lockedUntil(17, 45))).toBe(false);
    expect(sameLockState(lockedUntil(17, 45), OPEN)).toBe(false);
  });

  it('잠금 달력의 형식 검사(validateLocks)는 발행 도구와 함께 쓰고, 틀린 곳을 항목의 차례와 함께 문장으로 알려 준다', () => {
    const good = DAY[0]!;
    expect(validateLocks([])).toEqual([]);
    expect(validateLocks(DAY)).toEqual([]);
    // 다른 칸은 보지 않는다. 항목끼리 시간이 겹치거나 이어 붙는 것은 받는다.
    expect(validateLocks([{ ...good, memo: '테스트 전용' }])).toEqual([]);
    expect(validateLocks([good, entry('test-lock-b', '2030-01-02T17:10', '2030-01-02T20:10'), entry('test-lock-c', '2030-01-02T17:45', '2030-01-02T20:10')])).toEqual([]);
    expect(validateLocks({})).toEqual(['잠금 달력은 항목의 배열이어야 해요. 항목이 없으면 빈 배열([])로 둬요.']);
    expect(validateLocks(null)).toEqual(['잠금 달력은 항목의 배열이어야 해요. 항목이 없으면 빈 배열([])로 둬요.']);
    expect(validateLocks([null])).toEqual(['1번째 항목이 객체가 아니에요.']);
    expect(validateLocks([{ ...good, id: ' ', label: '' }])).toEqual(['1번째 항목: id 값이 비어 있어요.', '1번째 항목: label 값이 비어 있어요.']);
    expect(validateLocks([{ ...good, start: '2030-01-02T8:40', end: '2030-01-02T24:00' }])).toEqual([
      '1번째 항목: start는 2030-01-02T08:40 같은, 실제로 있는 날짜와 시각(한국 시간)이어야 해요.',
      '1번째 항목: end는 2030-01-02T17:45 같은, 실제로 있는 날짜와 시각(한국 시간)이어야 해요.',
    ]);
    expect(validateLocks([{ ...good, end: '2030-01-03T17:45' }])).toEqual(['1번째 항목: start와 end는 같은 날이어야 해요.']);
    expect(validateLocks([{ ...good, start: '2030-01-03T08:40' }])).toEqual(['1번째 항목: start와 end는 같은 날이어야 해요.', '1번째 항목: start가 end보다 앞서야 해요.']);
    expect(validateLocks([{ ...good, start: '2030-01-02T17:45' }])).toEqual(['1번째 항목: start가 end보다 앞서야 해요.']);
    expect(validateLocks([good, { ...good, start: '2030-01-02T17:10' }])).toEqual(['2번째 항목: 앞의 항목과 id가 겹쳐요(test-lock-a).']);
  });

  it('풀이 잠금 안내 조각과 판정 훅은 지금 진행자용 화면만 쓰고, 학생이 보는 화면에는 붙이지 않는다', () => {
    // 지금 앱에는 풀이 계열 기능이 없다. 그런 기능을 더할 때 이 검사를 함께 고친다(docs/결정기록.md 6장의 풀이 잠금 규칙).
    const root = process.cwd();
    const sources = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) return sources(full);
        return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [relative(root, full).split(sep).join('/')] : [];
      });
    const files = sources(resolve(root, 'src'));
    const read = (f: string) => readFileSync(resolve(root, f), 'utf8');
    expect(files.length).toBeGreaterThan(30);
    // 조각과 판정 훅(src/components/LockNotice.tsx)을 가져다 쓰는 곳은 진행자용 화면뿐이다(앱 배포용 묶음에는 실리지 않는다).
    expect(files.filter((f) => /from '[^']*\/LockNotice'/.test(read(f)))).toEqual(['src/screens/TestAdmin.tsx']);
    expect(read('src/screens/TestAdmin.tsx')).not.toContain('<LockNotice');
    // 학생에게 보일 안내 문구는 조각 안에서만 쓴다.
    expect(files.filter((f) => /S\.solutionLock\b/.test(read(f)))).toEqual(['src/components/LockNotice.tsx']);
  });

  it('묶음 안 달력(src/exams/locks.json)은 형식에 맞고, 넘겨받은 자료가 없으면 합친 달력(시험 목록 저장소의 locks)은 그 항목 그대로다', () => {
    // 실제 날짜와 시각은 주관 기관 공고를 확인한 사람이 넣는다. 넣은 값이 형식에 맞지 않으면 여기서 잡힌다.
    expect(Array.isArray(rawLocks)).toBe(true);
    expect(validateLocks(rawLocks)).toEqual([]);
    // 단위 테스트는 브라우저용 플랫폼(src/platform/web.ts)이라 넘겨받는 자료가 없다.
    expect(catalog.get().remote).toBeNull();
    expect(catalog.get().locks).toEqual(rawLocks);
  });
});
