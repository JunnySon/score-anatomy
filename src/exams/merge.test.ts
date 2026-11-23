import { describe, expect, it } from 'vitest';
import type { Exam } from '../types';
import { mergeExams, parseRemote, sameStructure, sortExams, type MergeWarn } from './merge';
import rawA from './sample-a.json';
import { parseExam, validateExam } from './validate';

// 넘겨받은 시험 자료(다리 규격 2의 remote)의 겉모양 읽기와 묶음 안 시험과의 합치기(작업 지시서 3의 5-2). 순수 함수만 본다.
// 시험은 예시 시험 A의 사본으로 그 자리에서 지은 테스트 전용 자료다(id 는 예시 시험과 겹치지 않는 test-...). 실제 시험의 값이 아니다.
// 날짜와 시각은 지시서의 형식 예시(2030-01-02, 17:10, 20:10)만 쓴다.

const examA = parseExam(rawA) as Exam;

/** 예시 시험 A의 사본으로 지은 테스트 전용 시험. */
function testExam(id: string, title: string, more: Partial<Exam> = {}): Exam {
  const exam: Exam = { ...examA, id, title, note: '테스트 전용으로 지은 시험이에요.', isSample: true, ...more };
  expect(validateExam(exam)).toEqual([]);
  return exam;
}

/** 검사를 통과하지 못하는 테스트 전용 시험: 정답 공개 상태인데 1번에 정답이 없다. */
function brokenExam(id: string): unknown {
  return { ...examA, id, title: '테스트 전용 시험(틀린 자료)', items: examA.items.map((it) => (it.no === 1 ? { ...it, answer: undefined } : it)) };
}

/** 경고를 모은다. */
function collector() {
  const warned: { message: string; reasons: readonly string[] }[] = [];
  const warn: MergeWarn = (message, reasons) => {
    warned.push({ message, reasons });
  };
  return { warned, warn };
}

const ok = { seq: 3, issuedAt: '2030-01-02T17:10', exams: [], locks: [] };

describe('넘겨받은 시험 자료의 겉모양(parseRemote, 작업 지시서 3의 5-2)', () => {
  it('seq 는 0 이상의 정수, issuedAt 은 한국 시간의 날짜와 시각, exams 와 locks 는 배열이면 그 네 값을 돌려준다', () => {
    const { warned, warn } = collector();
    const exams = [{ id: 'test-remote-a' }];
    const locks: unknown[] = [];
    // 다른 칸은 보지 않는다.
    const got = parseRemote({ seq: 0, issuedAt: '2030-01-02T20:10', exams, locks, format: 1 }, warn);
    expect(got).toEqual({ seq: 0, issuedAt: '2030-01-02T20:10', exams, locks });
    // 원소는 검사하지 않고 받은 배열 그대로 넘긴다(시험과 달력은 합칠 때 하나씩 검사한다).
    expect(got!.exams).toBe(exams);
    expect(got!.locks).toBe(locks);
    expect(parseRemote(ok, warn)).toEqual(ok);
    expect(warned).toEqual([]);
  });

  it('null 과 undefined 는 넘겨받은 자료가 없다는 뜻이라 알리지 않고 null 이다', () => {
    const { warned, warn } = collector();
    expect(parseRemote(null, warn)).toBeNull();
    expect(parseRemote(undefined, warn)).toBeNull();
    expect(warned).toEqual([]);
  });

  it('겉모양이 틀리면 null 이고 이유를 경고로 남긴다', () => {
    const cases: [unknown, string][] = [
      ['{"seq":1}', 'remote는'],
      [[ok], 'remote는'],
      [5, 'remote는'],
      [{ ...ok, seq: -1 }, 'seq는'],
      [{ ...ok, seq: 1.5 }, 'seq는'],
      [{ ...ok, seq: '2' }, 'seq는'],
      [{ ...ok, seq: Number.NaN }, 'seq는'],
      [{ ...ok, seq: undefined }, 'seq는'],
      [{ ...ok, issuedAt: '2030-01-02' }, 'issuedAt은'],
      [{ ...ok, issuedAt: '2030-01-02T24:00' }, 'issuedAt은'],
      [{ ...ok, issuedAt: '2030-01-02T8:10' }, 'issuedAt은'],
      [{ ...ok, issuedAt: '2030-01-02T17:10:00' }, 'issuedAt은'],
      [{ ...ok, issuedAt: '2030-02-30T17:10' }, 'issuedAt은'],
      [{ ...ok, issuedAt: undefined }, 'issuedAt은'],
      [{ ...ok, exams: {} }, 'exams는'],
      [{ ...ok, exams: undefined }, 'exams는'],
      [{ ...ok, locks: null }, 'locks는'],
      [{ ...ok, locks: undefined }, 'locks는'],
    ];
    for (const [raw, word] of cases) {
      const { warned, warn } = collector();
      expect(parseRemote(raw, warn), JSON.stringify(raw)).toBeNull();
      expect(warned).toHaveLength(1);
      expect(warned[0]!.message).toBe('넘겨받은 시험 자료를 쓰지 않았어요.');
      expect(warned[0]!.reasons.join(' ')).toContain(word);
    }
  });

  it('어떤 값을 받아도 던지지 않는다', () => {
    const { warned, warn } = collector();
    const evil = {
      get seq(): number {
        throw new Error('읽을 수 없는 칸');
      },
    };
    expect(parseRemote(evil, warn)).toBeNull();
    expect(warned[0]!.reasons).toEqual(['넘겨받은 시험 자료를 끝까지 검사하지 못했어요.']);
  });
});

describe('넘겨받은 시험 합치기(mergeExams, 작업 지시서 3의 5-2)', () => {
  // 묶음 안 시험 자리에 놓는 테스트 전용 시험(시행일 없음).
  const bundledA = testExam('test-remote-a', '테스트 전용 시험 A');
  const bundledB = testExam('test-bundled-b', '테스트 전용 시험 B');

  it('묶음 안 시험과 id 가 같으면 rev 가 큰 넘겨받은 판을 쓴다(rev 칸이 없으면 1)', () => {
    const { warned, warn } = collector();
    const newer = testExam('test-remote-a', '테스트 전용 시험 A 판 2', { rev: 2 });
    const got = mergeExams([bundledA, bundledB], [newer], warn);
    expect(got.map((e) => e.title)).toEqual(['테스트 전용 시험 A 판 2', '테스트 전용 시험 B']);
    // 검사를 통과한 객체를 고치지 않고 그대로 쓴다.
    expect(got[0]).toBe(newer);
    expect(got[1]).toBe(bundledB);
    expect(warned).toEqual([]);
  });

  it('rev 가 같으면 넘겨받은 쪽을 쓴다(둘 다 rev 칸이 없어도 같은 1로 본다)', () => {
    const same = testExam('test-remote-a', '테스트 전용 시험 A 넘겨받은 판');
    expect(mergeExams([bundledA], [same])[0]).toBe(same);
    const bundled3 = testExam('test-remote-a', '테스트 전용 시험 A 묶음 판 3', { rev: 3 });
    const remote3 = testExam('test-remote-a', '테스트 전용 시험 A 넘겨받은 판 3', { rev: 3 });
    expect(mergeExams([bundled3], [remote3])[0]).toBe(remote3);
    // rev 칸이 없는 넘겨받은 판과 rev 1 로 적은 묶음 안 판도 같은 판이다.
    const bundled1 = testExam('test-remote-a', '테스트 전용 시험 A 묶음 판 1', { rev: 1 });
    expect(mergeExams([bundled1], [same])[0]).toBe(same);
  });

  it('넘겨받은 판의 rev 가 작으면 묶음 안 시험을 쓴다', () => {
    const { warned, warn } = collector();
    const bundled3 = testExam('test-remote-a', '테스트 전용 시험 A 묶음 판 3', { rev: 3 });
    const older = testExam('test-remote-a', '테스트 전용 시험 A 넘겨받은 판 2', { rev: 2 });
    expect(mergeExams([bundled3], [older], warn)).toEqual([bundled3]);
    expect(mergeExams([bundled3], [older], warn)[0]).toBe(bundled3);
    // rev 칸이 없는 넘겨받은 판(1)은 rev 2 인 묶음 안 판보다 작다.
    const bundled2 = testExam('test-remote-a', '테스트 전용 시험 A 묶음 판 2', { rev: 2 });
    expect(mergeExams([bundled2], [testExam('test-remote-a', '테스트 전용 시험 A 넘겨받은 판')], warn)[0]).toBe(bundled2);
    // 판이 작은 것은 틀린 자료가 아니라서 알리지 않는다.
    expect(warned).toEqual([]);
  });

  it('묶음 안 시험과 id 가 같아도 문항 구성(문항 수, no, kind, choices)이 다른 넘겨받은 판은 rev 가 커도 버리고 이유를 남긴다', () => {
    // 별도 검토 A2: 묶음 안 시험과 같은 id 로 구성이 다른 판이 오면, 저장한 답이 다른 문항이나 다른 시험에 붙었다.
    const variants: [string, Exam][] = [
      ['보기 수', testExam('test-remote-a', '테스트 전용 시험 A 보기 수', { rev: 2, items: examA.items.map((it) => (it.no === 7 ? { ...it, choices: 4, answer: 4 } : it)) })],
      ['문항 수', testExam('test-remote-a', '테스트 전용 시험 A 문항 수', { rev: 2, items: examA.items.filter((it) => it.no !== 21) })],
      [
        'kind',
        testExam('test-remote-a', '테스트 전용 시험 A kind', {
          rev: 2,
          items: examA.items.map((it) => (it.no === 22 ? { no: 22, kind: 'mc' as const, points: it.points, answer: 3, typeId: it.typeId } : it)),
        }),
      ],
    ];
    for (const [name, changed] of variants) {
      const { warned, warn } = collector();
      const got = mergeExams([bundledA, bundledB], [changed], warn);
      expect(got[0], name).toBe(bundledA);
      expect(warned, name).toEqual([
        {
          message: '넘겨받은 1번째 시험(id: test-remote-a)을 쓰지 않았어요.',
          reasons: ['앱에 든 같은 id 의 시험과 문항 구성(문항 수, no, kind, choices)이 달라요. 저장한 답이 엇갈려 붙지 않게 앱에 든 시험을 써요.'],
        },
      ]);
    }
    // 구성이 같으면(제목과 정답만 다름) 지금처럼 rev 가 큰 넘겨받은 판을 쓴다.
    const sameShape = testExam('test-remote-a', '테스트 전용 시험 A 정답 판', { rev: 2, items: examA.items.map((it) => (it.no === 1 ? { ...it, answer: 4 } : it)) });
    expect(sameStructure(bundledA, sameShape)).toBe(true);
    expect(mergeExams([bundledA], [sameShape])[0]).toBe(sameShape);
  });

  it('판 번호(rev)로 고른 판의 정답 판 번호(answersRev)가 쓰지 않은 판보다 작으면 알린다', () => {
    // 별도 검토 B1: 정정 판(answersRev 2)으로 채점한 뒤 rev 는 크지만 정답은 정정 전인 판이 쓰이면 점수가 알림 없이 바뀌었다.
    const corrected = testExam('test-remote-a', '테스트 전용 시험 A 정정 판', { rev: 2, answersRev: 2, answersNote: '테스트 전용 정정 안내예요.' });
    const newerOld = testExam('test-remote-a', '테스트 전용 시험 A 묶음 판 3', { rev: 3 });
    const a = collector();
    expect(mergeExams([newerOld], [corrected], a.warn)[0]).toBe(newerOld);
    expect(a.warned).toEqual([
      {
        message: '넘겨받은 1번째 시험(id: test-remote-a)과 앱에 든 같은 id 의 시험은 정답 판 번호가 어긋나요.',
        reasons: ['판 번호(rev)가 큰 앱에 든 판을 썼는데, 그 판의 answersRev(1)가 다른 판(2)보다 작아요.'],
      },
    ]);
    const b = collector();
    const remoteOld = testExam('test-remote-a', '테스트 전용 시험 A 넘겨받은 판 3', { rev: 3 });
    expect(mergeExams([corrected], [remoteOld], b.warn)[0]).toBe(remoteOld);
    expect(b.warned.map((w) => w.reasons)).toEqual([['판 번호(rev)가 크거나 같은 넘겨받은 판을 썼는데, 그 판의 answersRev(1)가 다른 판(2)보다 작아요.']]);
    // 정답 판 번호가 같거나 큰 쪽을 쓰면 알리지 않는다.
    const c = collector();
    mergeExams([bundledA], [corrected], c.warn);
    expect(c.warned).toEqual([]);
  });

  it('검사를 통과하지 못한 시험만 버리고 id 와 이유를 남기며 나머지는 쓴다', () => {
    const { warned, warn } = collector();
    const good = testExam('test-remote-c', '테스트 전용 시험 C');
    const alsoGood = testExam('test-remote-d', '테스트 전용 시험 D');
    // 묶음 안 시험과 id 가 같은 넘겨받은 판이 틀렸으면 rev 가 커도 묶음 안 시험이 그대로 남는다.
    const brokenA = { ...(brokenExam('test-remote-a') as Exam), rev: 9 };
    const got = mergeExams([bundledA, bundledB], [good, brokenExam('test-remote-e'), null, { items: [null] }, brokenA, alsoGood], warn);
    expect(got.map((e) => e.id)).toEqual(['test-remote-c', 'test-remote-d', 'test-remote-a', 'test-bundled-b']);
    expect(got[2]).toBe(bundledA);
    expect(warned.map((w) => w.message)).toEqual([
      '넘겨받은 2번째 시험(id: test-remote-e)을 쓰지 않았어요.',
      '넘겨받은 3번째 시험을 쓰지 않았어요.',
      '넘겨받은 4번째 시험을 쓰지 않았어요.',
      '넘겨받은 5번째 시험(id: test-remote-a)을 쓰지 않았어요.',
    ]);
    // 이유는 묶음 안 시험 파일과 같은 검사(validateExam)의 문장이다.
    expect(warned[0]!.reasons).toEqual(validateExam(brokenExam('test-remote-e')));
    expect(warned[0]!.reasons).toContain('1번: 정답 공개 상태인데 answer가 없어요.');
    expect(warned[1]!.reasons).toEqual(['시험 데이터가 객체가 아니에요.']);
    expect(warned[2]!.reasons.length).toBeGreaterThan(0);
  });

  it('넘겨받은 목록 안에서 id 가 겹치면 앞의 것을 쓰고 뒤의 것은 버린다', () => {
    const { warned, warn } = collector();
    const first = testExam('test-remote-c', '테스트 전용 시험 C 앞');
    const second = testExam('test-remote-c', '테스트 전용 시험 C 뒤', { rev: 5 });
    const got = mergeExams([bundledB], [first, second], warn);
    expect(got).toEqual([first, bundledB]);
    expect(got[0]).toBe(first);
    expect(warned).toEqual([{ message: '넘겨받은 2번째 시험(id: test-remote-c)을 쓰지 않았어요.', reasons: ['앞의 시험과 id가 겹쳐요.'] }]);
  });

  it('넘겨받은 것이 없으면(null, undefined, 빈 배열) 묶음 안 시험 그대로다', () => {
    const { warned, warn } = collector();
    const bundled = [bundledA, bundledB];
    for (const none of [null, undefined, []]) {
      const got = mergeExams(bundled, none, warn);
      expect(got).toEqual(bundled);
      expect(got[0]).toBe(bundledA);
      expect(got[1]).toBe(bundledB);
    }
    expect(warned).toEqual([]);
  });

  it('묶음에 없는 시험은 묶음 안 시험보다 앞에 넘겨받은 차례대로 두고, 시행일이 있는 시험은 맨 위에 둔다', () => {
    const c = testExam('test-remote-c', '테스트 전용 시험 C');
    const d = testExam('test-remote-d', '테스트 전용 시험 D', { examDate: '2030-01-02' });
    const e = testExam('test-remote-e', '테스트 전용 시험 E');
    const got = mergeExams([bundledA, bundledB], [c, d, e]);
    expect(got.map((x) => x.id)).toEqual(['test-remote-d', 'test-remote-c', 'test-remote-e', 'test-remote-a', 'test-bundled-b']);
    // 정렬 규칙은 묶음 안 시험의 목록과 같은 sortExams 다.
    expect(got).toEqual(sortExams([c, d, e, bundledA, bundledB]));
  });

  it('받은 배열과 시험 객체를 고치지 않고, 어떤 값을 받아도 던지지 않는다', () => {
    const c = Object.freeze(testExam('test-remote-c', '테스트 전용 시험 C'));
    const remote = Object.freeze([c, Object.freeze(brokenExam('test-remote-e'))]);
    const bundled = Object.freeze([bundledA, bundledB]);
    const got = mergeExams(bundled, remote, () => undefined);
    expect(got.map((x) => x.id)).toEqual(['test-remote-c', 'test-remote-a', 'test-bundled-b']);
    expect(remote).toHaveLength(2);
    expect(bundled).toEqual([bundledA, bundledB]);
    const evil = {
      get id(): string {
        throw new Error('읽을 수 없는 칸');
      },
    };
    expect(() => mergeExams(bundled, [evil, 'x', 7, [], {}] as unknown[], () => undefined)).not.toThrow();
    expect(mergeExams(bundled, '[]' as unknown as unknown[], () => undefined)).toEqual([bundledA, bundledB]);
  });
});
