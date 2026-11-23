import { describe, expect, it } from 'vitest';
import type { Exam } from '../types';
import { findExam } from './index';
import { acceptedAnswers, answersRevOf, checkExam, parseExam, revOf, typesReadyOf, validateCutGrades, validateExam } from './validate';

// 시험 파일 규격(작업 지시서 3의 4-1~4-3)과 검사 보강.
// 테스트 자료는 예시 시험을 고친 사본만 쓴다. 실제 시험의 정답, 배점, 등급컷을 쓰지 않는다.

const examA = findExam('sample-a') as Exam;
const examB = findExam('sample-b') as Exam;
const examC = findExam('sample-c') as Exam;

/** 예시 시험의 사본에서 한 문항의 칸을 바꾼다. 원본은 건드리지 않는다. */
function withItem(exam: Exam, no: number, patch: Record<string, unknown>): Record<string, unknown> {
  return { ...exam, items: exam.items.map((it) => (it.no === no ? { ...it, ...patch } : it)) };
}

function errorsOf(raw: unknown): string {
  return validateExam(raw).join(' ');
}

// 예시 시험 A의 1번(5지선다)과 22번(단답형). 정답이 아닌 답은 정답에서 만든다.
const item1 = examA.items.find((it) => it.no === 1)!;
const a1 = item1.answer as number;
const other1 = (a1 % 5) + 1;
const a22 = examA.items.find((it) => it.no === 22)!.answer as number;
const other22 = a22 === 999 ? 0 : a22 + 1;
const NOTE = '테스트 전용 정정 안내예요.';

describe('시험 파일 규격의 새 칸(작업 지시서 3의 4-1~4-3)', () => {
  it('새 칸이 없는 지금 시험 파일은 그대로 통과하고 기본값으로 읽는다', () => {
    for (const e of [examA, examB, examC]) {
      expect(validateExam(e)).toEqual([]);
      expect(revOf(e)).toBe(1);
      expect(answersRevOf(e)).toBe(1);
      expect(typesReadyOf(e)).toBe(true);
    }
    // 인정하는 답은 answer 하나뿐이다(검산 예시의 계산이 그대로다).
    for (const it of examA.items) expect(acceptedAnswers(it)).toEqual([it.answer]);
    // 정답 공개 전 시험은 인정하는 답이 없다.
    for (const it of examC.items) expect(acceptedAnswers(it)).toEqual([]);
  });

  it('판 번호(rev)와 정답 판 번호(answersRev)는 1 이상의 정수다', () => {
    expect(validateExam({ ...examA, rev: 3 })).toEqual([]);
    expect(revOf({ ...examA, rev: 3 })).toBe(3);
    expect(validateExam({ ...examA, answersRev: 1 })).toEqual([]);
    for (const bad of [0, -1, 1.5, '2', null, true]) {
      expect(errorsOf({ ...examA, rev: bad }), String(bad)).toContain('rev 값은 1 이상의 정수여야 해요.');
      expect(errorsOf({ ...examA, answersRev: bad }), String(bad)).toContain('answersRev 값은 1 이상의 정수여야 해요.');
    }
  });

  it('정답을 정정했으면(answersRev 2 이상) 정정 안내(answersNote)가 있어야 한다', () => {
    expect(errorsOf({ ...examA, answersRev: 2 })).toContain('answersRev가 2 이상이면 answersNote에 정정 안내를 적어야 해요.');
    const fixed = { ...examA, answersRev: 2, answersNote: NOTE };
    expect(validateExam(fixed)).toEqual([]);
    expect(answersRevOf(fixed)).toBe(2);
    for (const bad of ['', '   ', 5, null]) {
      expect(errorsOf({ ...examA, answersRev: 2, answersNote: bad }), String(bad)).toContain('answersNote 값이 비어 있어요.');
    }
    // 정정하기 전(answersRev 가 1이거나 칸이 없음)에 안내가 있어도 받는다. 정정 알림은 answersRev 가 2 이상일 때만 나온다.
    expect(validateExam({ ...examA, answersNote: NOTE })).toEqual([]);
  });

  it('유형 분류가 끝났는지(typesReady)는 true나 false이고, 칸이 없으면 끝난 것으로 본다', () => {
    expect(validateExam({ ...examA, typesReady: false })).toEqual([]);
    expect(typesReadyOf({ ...examA, typesReady: false })).toBe(false);
    expect(typesReadyOf({ ...examA, typesReady: true })).toBe(true);
    for (const bad of ['false', 0, null]) expect(errorsOf({ ...examA, typesReady: bad }), String(bad)).toContain('typesReady 값은 true나 false여야 해요.');
  });

  it('유형 분류 전에는 자리만 채우는 유형 하나를 모든 문항이 가리켜도 통과하고, typeId 검사는 그대로다', () => {
    // 형식 예시: "t00": { "name": "분류 중" }.
    const waiting = { ...examA, typesReady: false, types: { t00: { name: '분류 중' } }, items: examA.items.map((it) => ({ ...it, typeId: 't00' })) };
    expect(validateExam(waiting)).toEqual([]);
    const stray = { ...waiting, items: waiting.items.map((it) => (it.no === 3 ? { ...it, typeId: 't01' } : it)) };
    expect(errorsOf(stray)).toContain('3번: typeId가 types에 없어요.');
  });

  it('복수 정답(altAnswers)은 answer 와 같은 범위의 정수이고, answer 나 서로 겹치지 않는다', () => {
    const ok = withItem(examA, 1, { altAnswers: [other1] });
    expect(validateExam(ok)).toEqual([]);
    expect(acceptedAnswers({ ...item1, altAnswers: [other1] })).toEqual([a1, other1]);
    expect(errorsOf(withItem(examA, 1, { altAnswers: [a1] }))).toContain('1번: altAnswers에 answer와 같은 답이 있어요.');
    expect(errorsOf(withItem(examA, 1, { altAnswers: [other1, other1] }))).toContain('1번: altAnswers에 겹치는 답이 있어요.');
    for (const bad of [[6], [0], [1.5], ['2'], [null]]) {
      expect(errorsOf(withItem(examA, 1, { altAnswers: bad })), JSON.stringify(bad)).toContain('1번: altAnswers에 범위를 벗어난 답이 있어요.');
    }
    // 보기 수를 따른다(보기가 4개면 5는 범위 밖이다).
    expect(errorsOf(withItem(examA, 1, { choices: 4, answer: 1, altAnswers: [5] }))).toContain('1번: altAnswers에 범위를 벗어난 답이 있어요.');
    // 빈 배열이나 배열이 아닌 값은 받지 않는다. 다른 정답이 없으면 칸을 뺀다.
    for (const bad of [[], 'x', 3, {}, null]) {
      expect(errorsOf(withItem(examA, 1, { altAnswers: bad })), JSON.stringify(bad)).toContain('1번: altAnswers는 다른 정답을 담은 배열이어야 해요.');
    }
    // 단답형은 0부터 999까지다.
    expect(validateExam(withItem(examA, 22, { altAnswers: [other22] }))).toEqual([]);
    for (const bad of [[1000], [-1]]) {
      expect(errorsOf(withItem(examA, 22, { altAnswers: bad })), JSON.stringify(bad)).toContain('22번: altAnswers에 범위를 벗어난 답이 있어요.');
    }
  });

  it('answer 없이 altAnswers 만 있으면 오류다', () => {
    expect(errorsOf(withItem(examA, 1, { answer: null, altAnswers: [other1] }))).toContain('1번: answer 없이 altAnswers만 있어요.');
    // 정답 공개 전 시험도 같다.
    expect(errorsOf(withItem(examC, 1, { altAnswers: [2] }))).toContain('1번: answer 없이 altAnswers만 있어요.');
  });

  it('모두 정답 처리(allCorrect)는 true 만 쓸 수 있고, 정답을 공개한 뒤에도 answer 가 없어도 된다', () => {
    expect(validateExam(withItem(examA, 1, { allCorrect: true }))).toEqual([]);
    expect(validateExam(withItem(examA, 1, { allCorrect: true, answer: null }))).toEqual([]);
    expect(validateExam(withItem(examA, 1, { allCorrect: true, altAnswers: [other1] }))).toEqual([]);
    // 모두 정답 처리는 인정하는 답 목록에 넣지 않고 채점에서 따로 본다.
    expect(acceptedAnswers({ ...item1, allCorrect: true })).toEqual([a1]);
    expect(acceptedAnswers({ ...item1, answer: null, allCorrect: true })).toEqual([]);
    for (const bad of [false, 'true', 1, null]) {
      expect(errorsOf(withItem(examA, 1, { allCorrect: bad })), String(bad)).toContain('1번: allCorrect는 true만 쓸 수 있어요.');
    }
    // 모두 정답 처리가 아닌 문항은 정답을 공개한 뒤 answer 가 그대로 꼭 있어야 한다.
    expect(errorsOf(withItem(examA, 1, { answer: null }))).toContain('1번: 정답 공개 상태인데 answer가 없어요.');
  });
});

describe('모양이 틀린 시험 파일', () => {
  const t01 = examA.types.t01;
  const withType = (type: unknown) => ({ ...examA, types: { ...examA.types, t01: type } });

  it('지금까지 던지던 입력(문항이 null, 좌표가 null, coords 가 5나 {})에서도 던지지 않고 오류 문장을 돌려준다', () => {
    const cases: [unknown, string][] = [
      [{ ...examA, items: [null] }, '1번째 문항이 객체가 아니에요.'],
      [{ ...examA, items: [...examA.items.slice(0, 2), 5, ...examA.items.slice(3)] }, '3번째 문항이 객체가 아니에요.'],
      [{ ...examA, items: [[]] }, '1번째 문항이 객체가 아니에요.'],
      [withType({ ...t01, coords: [null] }), '유형 t01의 좌표는 label과 itemNo가 있어야 해요.'],
      [withType({ ...t01, coords: [5] }), '유형 t01의 좌표는 label과 itemNo가 있어야 해요.'],
      [withType({ ...t01, coords: 5 }), '유형 t01의 coords는 좌표 목록(배열)이어야 해요.'],
      [withType({ ...t01, coords: {} }), '유형 t01의 coords는 좌표 목록(배열)이어야 해요.'],
      [withType({ ...t01, coords: 'x' }), '유형 t01의 coords는 좌표 목록(배열)이어야 해요.'],
      [withType(null), '유형 t01의 name이 비어 있어요.'],
      // 글자로 바꿀 수 없는 문항 번호(JSON 으로도 만들 수 있다)는 몇 번째 문항인지로 가리킨다.
      [withItem(examA, 1, { no: JSON.parse('{"toString": 1}') }), '1번째 문항: 문항 번호는 1부터 커지는 순서여야 해요.'],
      [{ ...examA, cuts: { ...examA.cuts!, grades: 5 } }, 'cuts.grades는 등급별 [낮은 값, 높은 값]을 담은 객체여야 해요.'],
      [{ ...examA, cuts: [] }, 'cuts는 객체여야 해요.'],
      [[examA], '시험 데이터가 객체가 아니에요.'],
      [null, '시험 데이터가 객체가 아니에요.'],
      ['sample-a', '시험 데이터가 객체가 아니에요.'],
    ];
    for (const [raw, message] of cases) {
      let errors: string[] = [];
      expect(() => {
        errors = validateExam(raw);
      }, message).not.toThrow();
      expect(errors.join(' '), message).toContain(message);
      expect(() => parseExam(raw), message).not.toThrow();
      expect(parseExam(raw), message).toBeNull();
      expect(checkExam(raw), message).toEqual({ exam: null, errors });
    }
    // coords 가 null 이면 지금처럼 좌표가 없는 것으로 본다.
    expect(validateExam(withType({ ...t01, coords: null }))).toEqual([]);
  });

  it('typeId 는 types 에 직접 적힌 유형만 받는다(constructor 같은 물려받은 이름은 거른다)', () => {
    for (const name of ['constructor', 'toString', 'hasOwnProperty', 'valueOf', '__proto__']) {
      expect(errorsOf(withItem(examA, 1, { typeId: name })), name).toContain('1번: typeId가 types에 없어요.');
    }
  });
});

describe('등급컷 값의 검사(validateCutGrades)', () => {
  it('예시 시험 A, B의 컷은 통과한다', () => {
    expect(validateCutGrades(examA.cuts!.grades, 100)).toEqual([]);
    expect(validateCutGrades(examB.cuts!.grades, 100)).toEqual([]);
  });

  it('컷 값은 0점부터 만점까지다', () => {
    expect(validateCutGrades({ '1': [95, 100] }, 100)).toEqual([]);
    expect(validateCutGrades({ '1': [0, 0] }, 100)).toEqual([]);
    expect(validateCutGrades({ '1': [95, 101] }, 100)).toEqual(['cuts.grades 1등급의 값은 0점부터 만점(100점)까지여야 해요.']);
    expect(validateCutGrades({ '2': [-1, 3] }, 100)).toEqual(['cuts.grades 2등급의 값은 0점부터 만점(100점)까지여야 해요.']);
    // 만점은 받은 값을 따른다.
    expect(validateCutGrades({ '1': [70, 75] }, 74).join(' ')).toContain('만점(74점)');
  });

  it('높은 등급(작은 번호)의 컷은 낮은 등급의 컷보다 낮을 수 없다(낮은 값끼리, 높은 값끼리 견주고 같은 값은 받는다)', () => {
    expect(validateCutGrades({ '1': [81, 85], '2': [88, 92] }, 100)).toEqual(['cuts.grades 1등급 컷이 2등급 컷보다 낮아요.']);
    expect(validateCutGrades({ '1': [88, 92], '2': [81, 93] }, 100)).toEqual(['cuts.grades 1등급 컷이 2등급 컷보다 낮아요.']);
    expect(validateCutGrades({ '1': [88, 92], '2': [89, 90] }, 100)).toEqual(['cuts.grades 1등급 컷이 2등급 컷보다 낮아요.']);
    // 같은 값과, 추정이라 겹치는 범위는 받는다.
    expect(validateCutGrades({ '1': [88, 92], '2': [88, 92] }, 100)).toEqual([]);
    expect(validateCutGrades({ '1': [84, 92], '2': [81, 86] }, 100)).toEqual([]);
    // 사이 등급이 빠져 있어도 적힌 등급끼리 번호 차례로 견준다.
    expect(validateCutGrades({ '3': [91, 91], '1': [90, 90] }, 100)).toEqual(['cuts.grades 1등급 컷이 3등급 컷보다 낮아요.']);
    expect(validateCutGrades({ '3': [72, 76], '1': [88, 92] }, 100)).toEqual([]);
  });

  it('등급 이름과 값의 모양이 틀리면 거른다', () => {
    expect(validateCutGrades({}, 100)).toEqual(['cuts.grades가 비어 있어요.']);
    for (const bad of [null, [], 'x', 5]) {
      expect(validateCutGrades(bad, 100), JSON.stringify(bad)).toEqual(['cuts.grades는 등급별 [낮은 값, 높은 값]을 담은 객체여야 해요.']);
    }
    expect(validateCutGrades({ '0': [1, 2] }, 100).join(' ')).toContain('등급 이름 0는');
    expect(validateCutGrades({ '10': [1, 2] }, 100).join(' ')).toContain('등급 이름 10는');
    for (const bad of [[5, 3], [5], [5, 6, 7], ['5', '6'], [5.5, 6], 5, null]) {
      expect(validateCutGrades({ '1': bad }, 100), JSON.stringify(bad)).toEqual(['cuts.grades 1등급은 [낮은 값, 높은 값]이어야 해요.']);
    }
  });

  it('시험 파일 검사는 문항 배점의 합을 만점으로 보고 컷 값을 견준다', () => {
    // 예시 시험 A의 배점 합은 100점이다.
    const withGrades = (grades: unknown) => ({ ...examA, cuts: { ...examA.cuts!, grades } });
    expect(validateExam(withGrades({ '1': [96, 100] }))).toEqual([]);
    expect(errorsOf(withGrades({ '1': [96, 101] }))).toContain('cuts.grades 1등급의 값은 0점부터 만점(100점)까지여야 해요.');
    expect(errorsOf(withGrades({ '1': [81, 85], '2': [88, 92] }))).toContain('cuts.grades 1등급 컷이 2등급 컷보다 낮아요.');
    // 배점을 읽을 수 없는 문항이 있으면 만점을 모르므로 위쪽 끝은 보지 않고 그 문항의 오류만 남긴다.
    const broken = { ...withItem(examA, 1, { points: 'x' }), cuts: { ...examA.cuts!, grades: { '1': [96, 101] } } };
    expect(errorsOf(broken)).toContain('1번: points는 1 이상의 정수여야 해요.');
    expect(errorsOf(broken)).not.toContain('만점');
    // 확정 컷은 두 값이 같아야 한다(지금 규칙 그대로).
    expect(errorsOf({ ...examA, cuts: { ...examA.cuts!, confirmed: true } })).toContain('cuts.grades 1등급: 확정 컷은 두 값이 같아야 해요.');
  });
});

describe('검사 결과와 버린 이유(checkExam)', () => {
  it('통과한 시험은 받은 객체 그대로, 통과하지 못한 시험은 버린 이유와 함께 돌려준다', () => {
    expect(checkExam(examA)).toEqual({ exam: examA, errors: [] });
    expect(checkExam(examA).exam).toBe(examA);
    expect(parseExam(examA)).toBe(examA);
    const bad = withItem(examA, 1, { altAnswers: [a1] });
    const checked = checkExam(bad);
    expect(checked.exam).toBeNull();
    expect(checked.errors.length).toBeGreaterThan(0);
    expect(checked.errors).toEqual(validateExam(bad));
    // cuts 가 null 이면 그 칸만 뺀 사본이다(지금 규칙 그대로).
    const noCuts = checkExam({ ...examA, cuts: null });
    expect(noCuts.errors).toEqual([]);
    expect(noCuts.exam).not.toBeNull();
    expect('cuts' in noCuts.exam!).toBe(false);
    // 새 칸은 고치거나 채우지 않고 그대로 둔다.
    const raw = { ...examA, rev: 2, answersRev: 2, answersNote: NOTE, typesReady: false };
    expect(checkExam(raw).exam).toBe(raw);
  });
});
