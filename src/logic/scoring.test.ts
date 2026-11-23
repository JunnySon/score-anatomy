import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXAMS, findExam } from '../exams';
import { parseExam, validateExam } from '../exams/validate';
import type { Answers, AnswerValue, Exam, ExamItem, Marks } from '../types';
import { cutView, gapFor, gradeKeys } from './cuts';
import { exampleResponses } from './example';
import { analyze, findMissing, GradeError, gradeExam, isCorrectResponse, luckFraction, roundLuck } from './scoring';
import { sectionsOf } from './sections';
import { rankTypes, selectSteps } from './steps';
import { luckLine } from './text';

const examA = findExam('sample-a') as Exam;
const examB = findExam('sample-b') as Exam;
const examC = findExam('sample-c') as Exam;

/** 모든 문항에 정답(answer)을 넣은 답. 시험 칸 allCorrect(모두 정답 처리)와 헷갈리지 않게 이름을 correctAnswers 로 둔다. */
function correctAnswers(exam: Exam): Answers {
  const a: Answers = {};
  for (const it of exam.items) a[it.no] = it.answer as number;
  return a;
}

function wrongValue(exam: Exam, no: number): number {
  const it = exam.items.find((x) => x.no === no)!;
  const ans = it.answer as number;
  return it.kind === 'mc' ? (ans % 5) + 1 : ans + 1;
}

describe('예시 시험 데이터', () => {
  it('예시 시험 3개가 모두 검사를 통과한다', () => {
    expect(EXAMS.map((e) => e.id)).toEqual(['sample-a', 'sample-b', 'sample-c']);
    for (const e of EXAMS) expect(validateExam(e)).toEqual([]);
  });

  it('예시 시험 A: 1~21번 mc, 22~30번 short, 배점 합 100점', () => {
    expect(examA.items).toHaveLength(30);
    expect(sectionsOf(examA)).toEqual([
      { kind: 'mc', from: 1, to: 21, count: 21 },
      { kind: 'short', from: 22, to: 30, count: 9 },
    ]);
    const pts = (from: number, to: number) => examA.items.filter((i) => i.no >= from && i.no <= to).map((i) => i.points);
    expect(new Set(pts(1, 3))).toEqual(new Set([2]));
    expect(new Set(pts(4, 11))).toEqual(new Set([3]));
    expect(new Set(pts(12, 21))).toEqual(new Set([4]));
    expect(new Set(pts(22, 27))).toEqual(new Set([3]));
    expect(new Set(pts(28, 30))).toEqual(new Set([4]));
    expect(examA.items.reduce((s, i) => s + i.points, 0)).toBe(100);
    expect(examA.cuts).toEqual({
      source: '예시 값',
      asOf: '2026-11-22',
      confirmed: false,
      grades: { '1': [88, 92], '2': [81, 85], '3': [72, 76] },
    });
  });

  it('예시 시험 A: 유형 배정이 검산 예시와 맞는다', () => {
    const typeName = (no: number) => examA.types[examA.items.find((i) => i.no === no)!.typeId]!.name;
    for (const no of [14, 20, 21]) expect(typeName(no)).toBe('적분');
    for (const no of [15, 29]) expect(typeName(no)).toBe('수열');
    for (const no of [9, 11]) expect(typeName(no)).toBe('확률');
    expect(typeName(27)).toBe('통계');
    expect(Object.keys(examA.types).length).toBeGreaterThanOrEqual(9);
    expect(Object.keys(examA.types).length).toBeLessThanOrEqual(11);
  });

  it('예시 시험 B: 섞인 배열, 지난 시험, 배점 합 100점', () => {
    expect(examB.isPast).toBe(true);
    expect(sectionsOf(examB)).toEqual([
      { kind: 'mc', from: 1, to: 15, count: 15 },
      { kind: 'short', from: 16, to: 22, count: 7 },
      { kind: 'mc', from: 23, to: 28, count: 6 },
      { kind: 'short', from: 29, to: 30, count: 2 },
    ]);
    expect(examB.items.reduce((s, i) => s + i.points, 0)).toBe(100);
  });

  it('예시 시험 C: 정답 공개 전이고 정답이 실려 있지 않다', () => {
    expect(examC.answerReleased).toBe(false);
    expect(examC.items.every((i) => i.answer === undefined || i.answer === null)).toBe(true);
    expect(examC.cuts).toBeUndefined();
  });

  it('예시 시험의 좌표 라벨은 예시 좌표뿐이다', () => {
    // 실제 시험(isSample이 false)을 추가하면 그 시험의 좌표에는 확인한 실제 표기를 쓴다(docs/시험_추가_방법.md).
    const samples = EXAMS.filter((e) => e.isSample);
    expect(samples.length).toBeGreaterThanOrEqual(3);
    for (const e of samples) {
      for (const t of Object.values(e.types)) {
        for (const c of t.coords ?? []) expect(c.label).toBe('예시 좌표');
      }
    }
  });

  it('잘못된 시험 데이터를 걸러 낸다', () => {
    const bad = JSON.parse(JSON.stringify(examA)) as Exam;
    bad.items[0]!.answer = 9;
    bad.items[1]!.typeId = 'nope';
    bad.cuts!.confirmed = true;
    const errors = validateExam(bad);
    expect(errors.some((e) => e.startsWith('1번'))).toBe(true);
    expect(errors.some((e) => e.startsWith('2번'))).toBe(true);
    expect(errors.some((e) => e.includes('확정 컷'))).toBe(true);
  });
});

describe('7장 검산 예시', () => {
  const grade = gradeExam(examA, exampleResponses(examA));
  const an = analyze(examA, grade);

  it('틀린 문항 6개와 배점', () => {
    expect(grade.wrong.map((w) => [w.no, w.points])).toEqual([
      [11, 3],
      [15, 4],
      [20, 4],
      [21, 4],
      [27, 3],
      [29, 4],
    ]);
  });

  it('실제 78점, 맞힌 문항 24개', () => {
    expect(an.actual).toBe(78);
    expect(an.correctCount).toBe(24);
    expect(an.itemCount).toBe(30);
    expect(an.total).toBe(100);
  });

  it('추측 표시 정답 7점, 찍음 전체 배점 18점', () => {
    expect(an.guessCorrectPoints).toBe(7);
    expect(an.guessTotalPoints).toBe(18);
    expect(an.guessMarkCount).toBe(5);
  });

  it('찍기 운을 평균으로 본 점수 74.6, 화면에는 약 75점', () => {
    expect(an.luckAverage).toBe(74.6);
    expect(an.luckAverageRounded).toBe(75);
    expect(an.showLuckAverage).toBe(true);
    // 정수 계산: G = 78 - 7 = 71, D = 5(보기 5개), N = 3 + 3 + 4 + 4 + 4 = 18. (71 x 5 + 18) / 5 = 373 / 5.
    expect(an.luck).toEqual({ numerator: 373, denominator: 5 });
    // 보기가 모두 5개면 1 나누기 보기 수는 0.2다: 실제 점수 - 추측 표시 정답 점수 + 0.2 x 찍음 전체 배점과 같다.
    expect(an.luckAverage).toBeCloseTo(an.actual - an.guessCorrectPoints + 0.2 * an.guessTotalPoints, 9);
  });

  it('실수 표시 오답 8점, 그 외 오답 14점', () => {
    expect(an.slipPoints).toBe(8);
    expect(an.otherWrongPoints).toBe(14);
    expect(an.wrongPoints).toBe(22);
    expect(an.causeMarkedCount).toBe(6);
  });

  it('막대 네 구간의 합은 100점이다', () => {
    expect(an.plainCorrectPoints).toBe(71);
    expect(an.plainCorrectPoints + an.guessCorrectPoints + an.slipPoints + an.otherWrongPoints).toBe(100);
  });

  it('목표 2등급(컷 81~85): 첫 줄 3~7점, 둘째 줄 6~10점', () => {
    const cv = cutView(examA, an, '2')!;
    expect([cv.lo, cv.hi, cv.confirmed]).toEqual([81, 85, false]);
    expect(cv.actualGap).toEqual({ pos: 'below', from: 3, to: 7 });
    expect(cv.luckGap).toEqual({ pos: 'below', from: 6, to: 10 });
  });

  it('목표 1등급(컷 88~92): 10~14점, 13~17점', () => {
    const cv = cutView(examA, an, '1')!;
    expect(cv.actualGap).toEqual({ pos: 'below', from: 10, to: 14 });
    expect(cv.luckGap).toEqual({ pos: 'below', from: 13, to: 17 });
  });

  it('목표 3등급(컷 72~76): 컷 범위보다 위', () => {
    const cv = cutView(examA, an, '3')!;
    expect(cv.actualGap).toEqual({ pos: 'above' });
    // 둘째 줄은 같은 방식으로: 약 75점은 72~76 범위 안이다.
    expect(cv.luckGap).toEqual({ pos: 'within' });
  });

  it('계단: 적분 12점, 수열 8점, 확률 6점 순으로 3개', () => {
    const steps = selectSteps(examA, grade);
    expect(steps.map((s) => [s.name, s.score])).toEqual([
      ['적분', 12],
      ['수열', 8],
      ['확률', 6],
    ]);
    expect(steps[0]!.wrongPoints).toBe(8);
    expect(steps[0]!.guessCorrectPoints).toBe(4);
    expect(steps[0]!.retryNos).toEqual([14, 20, 21]);
    expect(steps[1]!.retryNos).toEqual([15, 29]);
    expect(steps[2]!.retryNos).toEqual([9, 11]);
    // 4위 통계(3점)는 빠진다.
    expect(rankTypes(examA, grade).map((s) => [s.name, s.score])).toEqual([
      ['적분', 12],
      ['수열', 8],
      ['확률', 6],
      ['통계', 3],
    ]);
  });
});

describe('추가 경우', () => {
  it('표시 없음: 추정 점수를 보여 주지 않는다', () => {
    const r = exampleResponses(examA);
    const grade = gradeExam(examA, { answers: r.answers, marks: {}, causes: {} });
    const an = analyze(examA, grade);
    expect(an.actual).toBe(78);
    expect(an.hasAnyMark).toBe(false);
    expect(an.hasGuessMark).toBe(false);
    expect(an.guessCorrectPoints).toBe(0);
    expect(an.showLuckAverage).toBe(false);
    expect(an.luckAverage).toBe(78);
    expect(an.causeMarkedCount).toBe(0);
    expect(an.slipPoints).toBe(0);
    expect(cutView(examA, an, '2')!.luckGap).toBeNull();
    // 계단은 틀린 문항만으로 정한다: 적분 8, 수열 8(번호가 앞선 수열 15번이 먼저), 확률 3, 통계 3.
    expect(selectSteps(examA, grade).map((s) => [s.name, s.score])).toEqual([
      ['수열', 8],
      ['적분', 8],
    ]);
  });

  it('고민 표시와 자신 없음 표시는 계산에 쓰지 않는다', () => {
    const r = exampleResponses(examA);
    const marks: Marks = { 3: 'doubt', 11: 'doubt', 25: 'unsure' };
    const an = analyze(examA, gradeExam(examA, { answers: r.answers, marks, causes: {} }));
    expect(an.hasAnyMark).toBe(true);
    expect(an.hasGuessMark).toBe(false);
    expect(an.showLuckAverage).toBe(false);
    expect(an.actual).toBe(78);
  });

  it('전부 정답: 100점, 계단 없음', () => {
    const grade = gradeExam(examA, { answers: correctAnswers(examA), marks: {}, causes: {} });
    const an = analyze(examA, grade);
    expect(an.actual).toBe(100);
    expect(an.correctCount).toBe(30);
    expect(an.wrongPoints).toBe(0);
    expect(selectSteps(examA, grade)).toEqual([]);
    expect(cutView(examA, an, '1')!.actualGap).toEqual({ pos: 'above' });
  });

  it('전부 정답이어도 찍음 표시 정답은 계단이 된다', () => {
    const grade = gradeExam(examA, { answers: correctAnswers(examA), marks: { 14: 'guess' }, causes: {} });
    const an = analyze(examA, grade);
    expect(an.actual).toBe(100);
    expect(an.guessCorrectPoints).toBe(4);
    expect(an.luckAverage).toBe(96.8);
    expect(an.luckAverageRounded).toBe(97);
    expect(selectSteps(examA, grade).map((s) => [s.name, s.score])).toEqual([['적분', 4]]);
  });

  it('전부 안 풂: 0점으로 채점하고 미입력과 구분한다', () => {
    const answers: Answers = {};
    for (const it of examA.items) answers[it.no] = 'skip';
    expect(findMissing(examA, answers)).toEqual([]);
    // 안 푼 문항에 붙은 찍음 표시는 계산에 쓰지 않는다.
    const grade = gradeExam(examA, { answers, marks: { 1: 'guess' }, causes: {} });
    const an = analyze(examA, grade);
    expect(an.actual).toBe(0);
    expect(an.correctCount).toBe(0);
    expect(an.wrongCount).toBe(30);
    expect(an.wrongPoints).toBe(100);
    expect(an.hasGuessMark).toBe(false);
    expect(grade.items.every((i) => i.skipped)).toBe(true);
    // 3위(11점)가 2위(15점)의 70%(10.5점) 이상이라 3개다.
    expect(selectSteps(examA, grade).map((s) => [s.name, s.score])).toEqual([
      ['미분', 16],
      ['적분', 15],
      ['지수함수와 로그함수', 11],
    ]);
  });

  it('계단 70% 경계: 3위가 2위의 정확히 70%면 3개, 바로 아래면 2개', () => {
    const wrongAt = (nos: number[]): Answers => {
      const answers = correctAnswers(examA);
      for (const no of nos) {
        const item = examA.items.find((i) => i.no === no)!;
        const right = item.answer as number;
        answers[no] = item.kind === 'mc' ? (right % 5) + 1 : (right + 1) % 1000;
      }
      return answers;
    };
    // 적분 12점, 미분 10점, 지수와 로그 7점: 7은 10의 정확히 70%.
    const exact = gradeExam(examA, { answers: wrongAt([14, 20, 21, 6, 17, 24, 16, 23]), marks: {}, causes: {} });
    expect(selectSteps(examA, exact).map((s) => [s.name, s.score])).toEqual([
      ['적분', 12],
      ['미분', 10],
      ['지수와 로그', 7],
    ]);
    // 적분 15점, 미분 13점, 지수와 로그 9점: 9는 13의 70%(9.1점)에 못 미친다.
    const below = gradeExam(examA, { answers: wrongAt([8, 14, 20, 21, 2, 6, 17, 30, 1, 16, 23]), marks: {}, causes: {} });
    expect(selectSteps(examA, below).map((s) => [s.name, s.score])).toEqual([
      ['적분', 15],
      ['미분', 13],
    ]);
  });

  it('고민 표시와 자신 없음 표시가 붙은 정답은 계단 점수에 들어가지 않는다', () => {
    const marks: Marks = { 14: 'doubt', 20: 'doubt', 22: 'unsure' };
    const grade = gradeExam(examA, { answers: correctAnswers(examA), marks, causes: {} });
    expect(selectSteps(examA, grade)).toEqual([]);
  });

  it('미입력이 남아 있으면 채점하지 않는다', () => {
    const answers = correctAnswers(examA);
    delete answers[14];
    delete answers[22];
    expect(findMissing(examA, answers)).toEqual([14, 22]);
    try {
      gradeExam(examA, { answers, marks: {}, causes: {} });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(GradeError);
      expect((e as GradeError).reason).toBe('missing');
      expect((e as GradeError).missing).toEqual([14, 22]);
    }
  });

  it('범위를 벗어난 값은 미입력으로 본다', () => {
    const answers = correctAnswers(examA);
    answers[1] = 6;
    answers[22] = 1000;
    answers[23] = 1.5;
    expect(findMissing(examA, answers)).toEqual([1, 22, 23]);
  });

  it('정답 공개 전 시험은 채점하지 않는다', () => {
    const answers: Answers = {};
    for (const it of examC.items) answers[it.no] = it.kind === 'mc' ? 1 : 0;
    try {
      gradeExam(examC, { answers, marks: {}, causes: {} });
      expect.unreachable();
    } catch (e) {
      expect((e as GradeError).reason).toBe('unreleased');
    }
  });

  it('컷 범위 안, 컷 범위 위, 컷 범위 아래', () => {
    expect(gapFor(81, 81, 85)).toEqual({ pos: 'within' });
    expect(gapFor(83, 81, 85)).toEqual({ pos: 'within' });
    expect(gapFor(85, 81, 85)).toEqual({ pos: 'within' });
    expect(gapFor(86, 81, 85)).toEqual({ pos: 'above' });
    expect(gapFor(80, 81, 85)).toEqual({ pos: 'below', from: 1, to: 5 });
  });

  it('컷 범위 안인 실제 점수', () => {
    // 15번(4점)만 틀리면 96점. 12번(4점)과 13번(4점)도 틀리면 88점으로 1등급 컷 88~92 안이다.
    const answers = correctAnswers(examA);
    for (const no of [12, 13, 15]) answers[no] = wrongValue(examA, no);
    const an = analyze(examA, gradeExam(examA, { answers, marks: {}, causes: {} }));
    expect(an.actual).toBe(88);
    expect(cutView(examA, an, '1')!.actualGap).toEqual({ pos: 'within' });
    expect(cutView(examA, an, '2')!.actualGap).toEqual({ pos: 'above' });
  });

  it('컷 자료 없음', () => {
    const noCuts: Exam = { ...examA, cuts: undefined };
    const an = analyze(noCuts, gradeExam(noCuts, exampleResponses(noCuts)));
    expect(gradeKeys(noCuts)).toEqual([]);
    expect(cutView(noCuts, an, '2')).toBeNull();
    expect(an.actual).toBe(78);
  });

  it('목표 등급을 고르기 전에는 컷 줄이 없다', () => {
    const an = analyze(examA, gradeExam(examA, exampleResponses(examA)));
    expect(gradeKeys(examA)).toEqual(['1', '2', '3']);
    expect(cutView(examA, an, null)).toBeNull();
    expect(cutView(examA, an, '7')).toBeNull();
    // 저장된 값이 망가져 엉뚱한 이름이 들어와도 죽지 않는다.
    expect(cutView(examA, an, 'constructor')).toBeNull();
    expect(cutView(examA, an, 'toString')).toBeNull();
    expect(cutView(examA, an, '')).toBeNull();
  });

  it('cuts가 null이면 자료 없음으로 본다', () => {
    const raw = { ...JSON.parse(JSON.stringify(examA)), cuts: null };
    expect(validateExam(raw)).toEqual([]);
    const parsed = parseExam(raw)!;
    expect(parsed.cuts).toBeUndefined();
    expect(gradeKeys(parsed)).toEqual([]);
    expect(validateExam({ ...raw, cuts: 'x' }).length).toBeGreaterThan(0);
  });

  it('찍기 운 평균은 문항의 보기 수를 따른다(1 나누기 보기 수)', () => {
    // 보기 6개: 2점 문항을 찍어 틀림. G = 98, D = 6, N = 2. (98 x 6 + 2) / 6 = 590 / 6 = 98.33..., 약 98점.
    const six: Exam = { ...examA, items: examA.items.map((it) => (it.kind === 'mc' ? { ...it, choices: 6 } : it)) };
    const answers = correctAnswers(six);
    answers[1] = wrongValue(six, 1);
    const an = analyze(six, gradeExam(six, { answers, marks: { 1: 'guess' }, causes: {} }));
    expect(an.actual).toBe(98);
    expect(an.luck).toEqual({ numerator: 590, denominator: 6 });
    expect(an.luckAverage).toBeCloseTo(98.3333333, 6);
    expect(an.luckAverageRounded).toBe(98);
  });

  it('확정 컷: 범위 대신 한 숫자', () => {
    const confirmed: Exam = {
      ...examA,
      cuts: { source: '예시 값', asOf: '2026-11-22', confirmed: true, grades: { '1': [90, 90], '2': [82, 82], '3': [75, 75] } },
    };
    const an = analyze(confirmed, gradeExam(confirmed, exampleResponses(confirmed)));
    const cv2 = cutView(confirmed, an, '2')!;
    expect(cv2.confirmed).toBe(true);
    expect(cv2.actualGap).toEqual({ pos: 'below', from: 4, to: 4 });
    expect(cv2.luckGap).toEqual({ pos: 'below', from: 7, to: 7 });
    const cv3 = cutView(confirmed, an, '3')!;
    expect(cv3.actualGap).toEqual({ pos: 'above' });
    expect(cv3.luckGap).toEqual({ pos: 'within' });
  });

  it('confirmed가 false면 두 값이 같아도 확정으로 보지 않는다', () => {
    const same: Exam = { ...examA, cuts: { ...examA.cuts!, grades: { '2': [82, 82] } } };
    const an = analyze(same, gradeExam(same, exampleResponses(same)));
    expect(cutView(same, an, '2')!.confirmed).toBe(false);
  });

  it('섞인 배열 시험 B: 채점, 확정 컷, 계단', () => {
    const answers = correctAnswers(examB);
    // 7번(mc, 3점, 적분), 12번(mc, 4점, 적분), 17번(short, 3점, 수열), 24번(mc, 3점, 확률), 30번(short, 4점, 확률)을 틀린다.
    for (const no of [7, 12, 17, 24, 30]) answers[no] = wrongValue(examB, no);
    answers[21] = 'skip'; // 21번(short, 4점, 함수의 극한과 연속)은 안 풂
    const marks: Marks = { 3: 'guess', 12: 'guess', 16: 'unsure' };
    const grade = gradeExam(examB, { answers, marks, causes: { 17: 'slip', 21: 'unknown' } });
    const an = analyze(examB, grade);
    expect(an.total).toBe(100);
    expect(an.actual).toBe(100 - (3 + 4 + 3 + 3 + 4 + 4));
    expect(an.actual).toBe(79);
    expect(an.correctCount).toBe(24);
    expect(grade.wrong.map((w) => w.no)).toEqual([7, 12, 17, 21, 24, 30]);
    expect(grade.items.find((i) => i.no === 21)!.skipped).toBe(true);
    // 3번(mc, 3점, 정답)과 12번(mc, 4점, 틀림)에 찍음. 16번의 자신 없음은 계산에 쓰지 않는다.
    expect(an.guessCorrectPoints).toBe(3);
    expect(an.guessTotalPoints).toBe(7);
    // 79 - 3 + 0.2 x 7 = 77.4
    expect(an.luckAverage).toBe(77.4);
    expect(an.luckAverageRounded).toBe(77);
    expect(an.showLuckAverage).toBe(true);
    expect(an.slipPoints).toBe(3);
    expect(an.otherWrongPoints).toBe(18);
    expect(an.causeMarkedCount).toBe(2);
    expect(gradeKeys(examB)).toEqual(['1', '2', '3', '4']);
    const cv = cutView(examB, an, '2')!;
    expect(cv.confirmed).toBe(true);
    expect([cv.lo, cv.hi]).toEqual([82, 82]);
    expect(cv.actualGap).toEqual({ pos: 'below', from: 3, to: 3 });
    expect(cv.luckGap).toEqual({ pos: 'below', from: 5, to: 5 });
    // 유형별 점수: 함수의 극한과 연속 7(21번 4점 + 3번 찍음 정답 3점), 적분 7(7번, 12번), 확률 7(24번, 30번), 수열 3.
    // 셋이 동점이라 번호가 앞선 순서다(3번, 7번, 24번). 3위(7)는 2위(7)의 70% 이상이라 3개.
    expect(selectSteps(examB, grade).map((s) => [s.name, s.score, s.firstNo])).toEqual([
      ['함수의 극한과 연속', 7, 3],
      ['적분', 7, 7],
      ['확률', 7, 24],
    ]);
  });

  it('반올림 값이 실제 점수와 같으면 추정 점수를 보여 주지 않는다', () => {
    // 찍음 표시 1개가 틀린 2점 문항이면 0.2 x 2 = 0.4점이 더해져 반올림해도 실제 점수와 같다.
    const answers = correctAnswers(examA);
    answers[1] = wrongValue(examA, 1);
    const an = analyze(examA, gradeExam(examA, { answers, marks: { 1: 'guess' }, causes: {} }));
    expect(an.actual).toBe(98);
    expect(an.luckAverage).toBe(98.4);
    expect(an.luckAverageRounded).toBe(98);
    expect(an.hasGuessMark).toBe(true);
    expect(an.showLuckAverage).toBe(false);
  });

  it('추정 점수는 가장 가까운 정수로 반올림한다', () => {
    // 1~6번(2, 2, 2, 3, 3, 3점)을 찍어서 틀리고 14번(4점)을 찍어서 맞힌 경우.
    // 실제 100 - 15 = 85, 찍음 전체 배점 19, 85 - 4 + 0.2 x 19 = 84.8, 화면에는 약 85점(실제와 같아 숨김).
    const answers = correctAnswers(examA);
    for (const no of [1, 2, 3, 4, 5, 6]) answers[no] = wrongValue(examA, no);
    const marks: Marks = { 1: 'guess', 2: 'guess', 3: 'guess', 4: 'guess', 5: 'guess', 6: 'guess', 14: 'guess' };
    const an = analyze(examA, gradeExam(examA, { answers, marks, causes: {} }));
    expect(an.actual).toBe(85);
    expect(an.guessCorrectPoints).toBe(4);
    expect(an.guessTotalPoints).toBe(19);
    expect(an.luckAverage).toBe(84.8);
    expect(an.luckAverageRounded).toBe(85);
    expect(an.showLuckAverage).toBe(false);
    // 7번, 9번, 10번(3점씩)도 찍었다고 표시했고 맞았으면 85 - 13 + 0.2 x 28 = 77.6, 화면에는 약 78점.
    const marks2: Marks = { ...marks, 7: 'guess', 9: 'guess', 10: 'guess' };
    const an2 = analyze(examA, gradeExam(examA, { answers, marks: marks2, causes: {} }));
    expect(an2.guessCorrectPoints).toBe(13);
    expect(an2.guessTotalPoints).toBe(28);
    expect(an2.luckAverage).toBe(77.6);
    expect(an2.luckAverageRounded).toBe(78);
    expect(an2.showLuckAverage).toBe(true);
  });
});

/** 찍음 표시 문항에 더할 수 있는 정답 칸(작업 지시서 3의 4-2). */
type GuessExtra = Pick<ExamItem, 'altAnswers' | 'allCorrect'>;

/**
 * 찍음 표시 문항을 마음대로 만든 시험(테스트 전용 자료). guess 는 [배점, 보기 수, 맞혔는지, 더할 정답 칸] 목록이다.
 * 찍음 표시 문항의 정답(answer)은 1이고 맞혔으면 1을, 아니면 2를 넣는다. 그래서 복수 정답(altAnswers)은 3 이상으로 적는다.
 * 모두 정답 처리(allCorrect) 문항은 넣은 답과 상관없이 배점을 받는다.
 * 나머지 배점은 단답형 두 문항으로 채워 실제 점수가 actual 이 되게 한다(합 100점).
 */
function luckExam(actual: number, guess: [number, number, boolean, GuessExtra?][]): { exam: Exam; answers: Answers; marks: Marks } {
  const items: Exam['items'] = [];
  const answers: Answers = {};
  const marks: Marks = {};
  let no = 0;
  let guessScored = 0;
  let guessTotal = 0;
  for (const [points, choices, correct, extra] of guess) {
    no += 1;
    items.push({ no, kind: 'mc', choices, points, answer: 1, typeId: 't', ...extra });
    answers[no] = correct ? 1 : 2;
    marks[no] = 'guess';
    guessTotal += points;
    if (correct || extra?.allCorrect === true) guessScored += points;
  }
  const restCorrect = actual - guessScored;
  const restWrong = 100 - guessTotal - restCorrect;
  items.push({ no: ++no, kind: 'short', points: restCorrect, answer: 1, typeId: 't' });
  answers[no] = 1;
  items.push({ no: ++no, kind: 'short', points: restWrong, answer: 1, typeId: 't' });
  answers[no] = 2;
  const exam: Exam = { id: 'luck', title: '보기 수 시험', note: '테스트 전용으로 지은 시험이에요.', isSample: true, isPast: false, answerReleased: true, items, types: { t: { name: '유형' } } };
  return { exam, answers, marks };
}

describe('찍기 운 평균의 보기 수', () => {
  it('보기 수 섞임: 58.2, 약 58점', () => {
    // 손으로 계산한 값: G = 60 - (3 + 2) = 55, D = 3, 4, 5의 최소공배수 60,
    // N = 3 x 20 + 4 x 15 + 2 x 12 + 4 x 12 = 192. (55 x 60 + 192) / 60 = 3492 / 60 = 58.2.
    // 약 N점: (2 x 3492 + 60) / (2 x 60) = 7044 / 120 의 몫 58.
    const f = luckFraction(60, [{ points: 3, choices: 3 }, { points: 4, choices: 4 }, { points: 2, choices: 5 }, { points: 4, choices: 5 }], 5);
    expect(f).toEqual({ numerator: 3492, denominator: 60 });
    expect(roundLuck(f)).toBe(58);
    const { exam, answers, marks } = luckExam(60, [
      [3, 3, true],
      [4, 4, false],
      [2, 5, true],
      [4, 5, false],
    ]);
    const an = analyze(exam, gradeExam(exam, { answers, marks, causes: {} }));
    expect(an.actual).toBe(60);
    expect(an.luckAverage).toBe(58.2);
    expect(an.luckAverageRounded).toBe(58);
    expect(an.showLuckAverage).toBe(true);
  });

  it('딱 0.5는 올라간다: 70.5, 약 71점', () => {
    // G = 70, D = 4, N = 2. (280 + 2) / 4 = 70.5. 약 N점: (564 + 4) / 8 = 71.
    const { exam, answers, marks } = luckExam(70, [[2, 4, false]]);
    const an = analyze(exam, gradeExam(exam, { answers, marks, causes: {} }));
    expect(an.actual).toBe(70);
    expect(an.luck).toEqual({ numerator: 282, denominator: 4 });
    expect(an.luckAverage).toBe(70.5);
    expect(an.luckAverageRounded).toBe(71);
    expect(an.showLuckAverage).toBe(true);
  });

  it('반올림 값이 실제 점수와 같으면 둘째 줄을 보여 주지 않는다: 63.5, 약 64점', () => {
    // G = 64 - 3 = 61, D = 60, N = 3 x 20 + 2 x 15 + 5 x 12 = 150. (3660 + 150) / 60 = 63.5. 약 N점: 7680 / 120 = 64.
    const { exam, answers, marks } = luckExam(64, [
      [3, 3, true],
      [2, 4, false],
      [5, 5, false],
    ]);
    const an = analyze(exam, gradeExam(exam, { answers, marks, causes: {} }));
    expect(an.actual).toBe(64);
    expect(an.luck).toEqual({ numerator: 3810, denominator: 60 });
    expect(an.luckAverage).toBe(63.5);
    expect(an.luckAverageRounded).toBe(64);
    expect(an.showLuckAverage).toBe(false);
    // 둘째 줄(등급컷 상자)도 나오지 않는다.
    const withCuts: Exam = { ...exam, cuts: { source: '예시 값', asOf: '2026-11-22', confirmed: false, grades: { '2': [81, 85] } } };
    expect(cutView(withCuts, an, '2')!.luckGap).toBeNull();
  });

  it('찍음 표시가 하나도 없으면 D = 1, N = 0 이다', () => {
    expect(luckFraction(78, [], 0)).toEqual({ numerator: 78, denominator: 1 });
    expect(roundLuck({ numerator: 78, denominator: 1 })).toBe(78);
  });

  it('보기 수가 없는 5지선다는 5개로 본다', () => {
    const { exam, answers, marks } = luckExam(70, [[2, 5, false]]);
    const noChoices: Exam = { ...exam, items: exam.items.map((it) => ({ ...it, choices: undefined })) };
    const an = analyze(noChoices, gradeExam(noChoices, { answers, marks, causes: {} }));
    expect(an.luck).toEqual({ numerator: 352, denominator: 5 });
    expect(an.luckAverage).toBe(70.4);
  });
});

/** 작업 지시서 3의 4-2 테스트에 쓰는 작은 시험(테스트 전용 자료). 문항은 테스트마다 그 자리에서 짓는다. */
function testExam(items: ExamItem[]): Exam {
  return { id: 'test-4-2', title: '테스트 전용 시험', note: '테스트 전용으로 지은 시험이에요.', isSample: true, isPast: false, answerReleased: true, items, types: { t: { name: '테스트 유형' } } };
}

describe('정답 정정과 복수 정답(4-2)', () => {
  it('복수 정답 문항은 answer 도 altAnswers 의 답도 정답이고 그 밖의 답은 오답이다', () => {
    // 1번(5지선다, 4점): 정답 2, 복수 정답 4. 2번(단답형, 3점): 정답 12, 복수 정답 21. 3번(5지선다, 3점): 정답 5만.
    const exam = testExam([
      { no: 1, kind: 'mc', points: 4, answer: 2, altAnswers: [4], typeId: 't' },
      { no: 2, kind: 'short', points: 3, answer: 12, altAnswers: [21], typeId: 't' },
      { no: 3, kind: 'mc', points: 3, answer: 5, typeId: 't' },
    ]);
    expect(validateExam(exam)).toEqual([]);
    const grade = (a1: AnswerValue, a2: AnswerValue, a3: AnswerValue = 5) => gradeExam(exam, { answers: { 1: a1, 2: a2, 3: a3 }, marks: {}, causes: {} });
    // answer 를 넣어도, altAnswers 의 답을 넣어도 배점을 받는다.
    for (const [a1, a2] of [[2, 12], [4, 21], [2, 21], [4, 12]] as const) {
      const g = grade(a1, a2);
      expect(g.actual, `${a1}, ${a2}`).toBe(10);
      expect(g.wrong).toEqual([]);
    }
    // 그 밖의 답과 안 풂은 오답이다.
    for (const a1 of [1, 3, 5, 'skip'] as const) {
      const g = grade(a1, 12);
      expect(g.actual, `${a1}`).toBe(6);
      expect(g.wrong.map((w) => w.no)).toEqual([1]);
    }
    for (const a2 of [0, 13, 120, 'skip'] as const) {
      const g = grade(2, a2);
      expect(g.actual, `${a2}`).toBe(7);
      expect(g.wrong.map((w) => w.no)).toEqual([2]);
    }
    // 복수 정답이 없는 문항은 answer 만 정답이다.
    expect(grade(2, 12, 4).wrong.map((w) => w.no)).toEqual([3]);
    // 재풀이의 맞춰 보기도 같은 판정(isCorrectResponse)을 쓴다.
    const [mc, short, single] = exam.items;
    expect([1, 2, 3, 4, 5].filter((v) => isCorrectResponse(mc!, v))).toEqual([2, 4]);
    expect([12, 21, 0, 13].filter((v) => isCorrectResponse(short!, v))).toEqual([12, 21]);
    expect([1, 2, 3, 4, 5].filter((v) => isCorrectResponse(single!, v))).toEqual([5]);
    expect(isCorrectResponse(mc!, 'skip')).toBe(false);
  });

  it('모두 정답 처리 문항은 오답을 넣어도 안 풂이어도 배점을 받는다', () => {
    // 1번(5지선다, 4점): 정답 2를 남긴 채 모두 정답 처리. 2번(단답형, 3점): 정답 없이 모두 정답 처리. 3번(5지선다, 3점): 정답 5.
    const exam = testExam([
      { no: 1, kind: 'mc', points: 4, answer: 2, allCorrect: true, typeId: 't' },
      { no: 2, kind: 'short', points: 3, allCorrect: true, typeId: 't' },
      { no: 3, kind: 'mc', points: 3, answer: 5, typeId: 't' },
    ]);
    expect(validateExam(exam)).toEqual([]);
    for (const [a1, a2] of [[2, 7], [3, 0], [5, 999], ['skip', 'skip']] as const) {
      // 3번은 틀린다(1을 넣음). 1번과 2번은 넣은 답과 상관없이 맞은 것이다.
      const g = gradeExam(exam, { answers: { 1: a1, 2: a2, 3: 1 }, marks: {}, causes: { 1: 'blank', 2: 'slip', 3: 'unknown' } });
      expect(g.actual, `${a1}, ${a2}`).toBe(7);
      expect(g.correctCount).toBe(2);
      expect(g.wrong.map((w) => [w.no, w.cause])).toEqual([[3, 'unknown']]);
      // 맞은 문항이라 원인을 붙이지 않는다.
      expect(g.items.filter((i) => i.no !== 3).every((i) => i.correct && i.cause === null)).toBe(true);
    }
    // 안 풂은 안 풂으로 남고(넣은 답을 바꾸지 않는다) 배점은 받는다.
    const skipped = gradeExam(exam, { answers: { 1: 'skip', 2: 'skip', 3: 5 }, marks: {}, causes: {} });
    expect(skipped.items.map((i) => [i.no, i.response, i.skipped, i.correct])).toEqual([
      [1, 'skip', true, true],
      [2, 'skip', true, true],
      [3, 5, false, true],
    ]);
    expect(skipped.actual).toBe(10);
    // 미입력이 남아 있으면 모두 정답 처리 문항이어도 지금처럼 채점하지 않는다.
    expect(() => gradeExam(exam, { answers: { 2: 7, 3: 5 }, marks: {}, causes: {} })).toThrow(GradeError);
    expect(isCorrectResponse(exam.items[1]!, 'skip')).toBe(true);
  });

  it('실제 60점, 찍음 표시 4점 문항 하나(보기 5개, 인정하는 답 2개, 오답): 61.6, 약 62점', () => {
    // 손으로 계산한 값: 맞힐 확률을 인정하는 답 2개 나누기 보기 5개로 본다.
    // G = 60 - 0 = 60, D = 5, N = 4 x 2 x (5 / 5) = 8. (60 x 5 + 8) / 5 = 308 / 5 = 61.6.
    // 약 N점: (2 x 308 + 5) / (2 x 5) = 621 / 10 의 몫 62.
    expect(luckFraction(60, [{ points: 4, choices: 5, accepted: 2 }], 0)).toEqual({ numerator: 308, denominator: 5 });
    const { exam, answers, marks } = luckExam(60, [[4, 5, false, { altAnswers: [3] }]]);
    expect(validateExam(exam)).toEqual([]);
    const an = analyze(exam, gradeExam(exam, { answers, marks, causes: {} }));
    expect(an.actual).toBe(60);
    expect(an.guessCorrectPoints).toBe(0);
    expect(an.guessTotalPoints).toBe(4);
    expect(an.luck).toEqual({ numerator: 308, denominator: 5 });
    expect(an.luckAverage).toBe(61.6);
    expect(an.luckAverageRounded).toBe(62);
    expect(an.showLuckAverage).toBe(true);
  });

  it('같은 문항을 맞혔고 실제 60점: 57.6, 약 58점', () => {
    // 손으로 계산한 값: G = 60 - 4 = 56, D = 5, N = 4 x 2 x (5 / 5) = 8. (56 x 5 + 8) / 5 = 288 / 5 = 57.6.
    // 약 N점: (2 x 288 + 5) / (2 x 5) = 581 / 10 의 몫 58.
    expect(luckFraction(60, [{ points: 4, choices: 5, accepted: 2 }], 4)).toEqual({ numerator: 288, denominator: 5 });
    const { exam, answers, marks } = luckExam(60, [[4, 5, true, { altAnswers: [3] }]]);
    // answer(1)로 맞혀도, 복수 정답(3)으로 맞혀도 같다.
    for (const picked of [1, 3]) {
      const an = analyze(exam, gradeExam(exam, { answers: { ...answers, 1: picked }, marks, causes: {} }));
      expect(an.actual, `${picked}`).toBe(60);
      expect(an.guessCorrectPoints).toBe(4);
      expect(an.luck).toEqual({ numerator: 288, denominator: 5 });
      expect(an.luckAverage).toBe(57.6);
      expect(an.luckAverageRounded).toBe(58);
      expect(an.showLuckAverage).toBe(true);
    }
  });

  it('실제 60점, 찍음 표시가 모두 정답 처리 문항 하나뿐이면 둘째 줄을 보여 주지 않는다', () => {
    // 1번(5지선다, 4점)은 모두 정답 처리이고, 오답(2)을 넣고 찍음 표시를 붙였다. 표시가 없는 정답으로 다뤄서
    // 추측 표시 정답 0점, 찍음 전체 배점 0점, G = 60, D = 1, N = 0. 값은 60 / 1 이라 실제 점수와 같고 둘째 줄이 없다.
    // 인정하는 답을 보기 수만큼으로 세어 찍음 표시에 남겨도 60 이 나오므로, 추측 표시 정답과 찍음 표시 수도 함께 본다.
    const { exam, answers, marks } = luckExam(60, [[4, 5, false, { allCorrect: true }]]);
    expect(validateExam(exam)).toEqual([]);
    const grade = gradeExam(exam, { answers, marks, causes: {} });
    const an = analyze(exam, grade);
    expect(an.actual).toBe(60);
    // 학생이 붙인 표시는 지우지 않고, 계산에 쓰는 찍음 표시만 붙이지 않는다.
    expect(grade.items[0]).toMatchObject({ no: 1, response: 2, correct: true, guess: false, mark: 'guess' });
    expect(an.hasGuessMark).toBe(false);
    expect(an.guessMarkCount).toBe(0);
    expect(an.allCorrectGuessCount).toBe(1);
    expect(an.guessCorrectPoints).toBe(0);
    expect(an.guessTotalPoints).toBe(0);
    expect(an.plainCorrectPoints).toBe(60);
    expect(an.luck).toEqual({ numerator: 60, denominator: 1 });
    expect(an.showLuckAverage).toBe(false);
    // 등급컷 상자의 둘째 줄이 없다.
    const withCuts: Exam = { ...exam, cuts: { source: '예시 값', asOf: '2026-11-22', confirmed: false, grades: { '2': [81, 85] } } };
    const cv = cutView(withCuts, an, '2')!;
    expect(cv.luckGap).toBeNull();
    expect(luckLine(cv, an.luckAverageRounded)).toBeNull();
    // 계단과 다시 풀기에도 넣지 않는다.
    expect(rankTypes(exam, grade).flatMap((s) => s.retryNos)).toEqual([3]);
  });

  it('모두 정답 처리 문항의 찍음 표시는 다른 찍음 표시와 함께 있어도 계산에 넣지 않는다', () => {
    // 1번(4점)은 모두 정답 처리이고 찍음 표시가 있다. 2번(3점, 보기 5개)은 찍어서 틀렸다.
    // 손으로 계산한 값: G = 60 - 0 = 60, D = 5, N = 3 x 1 x (5 / 5) = 3. (300 + 3) / 5 = 303 / 5 = 60.6, 약 61점.
    const { exam, answers, marks } = luckExam(60, [
      [4, 5, false, { allCorrect: true }],
      [3, 5, false],
    ]);
    const an = analyze(exam, gradeExam(exam, { answers, marks, causes: {} }));
    expect(an.actual).toBe(60);
    expect(an.guessMarkCount).toBe(1);
    expect(an.allCorrectGuessCount).toBe(1);
    expect(an.guessTotalPoints).toBe(3);
    expect(an.luck).toEqual({ numerator: 303, denominator: 5 });
    expect(an.luckAverageRounded).toBe(61);
    expect(an.showLuckAverage).toBe(true);
  });

  it('재풀이의 맞춰 보기는 채점과 같은 판정을 쓴다', () => {
    // 재풀이 화면은 서버 그리기로 답을 넣어 볼 수 없어서 소스를 읽어 확인한다. answer 와 바로 견주면 복수 정답을 놓친다.
    const src = readFileSync(resolve(process.cwd(), 'src/screens/Retry.tsx'), 'utf8');
    expect(src).toContain('isCorrectResponse(item, value)');
    expect(src).not.toMatch(/===\s*item\.answer|item\.answer\s*===/);
  });
});

describe('계단 선정 규칙', () => {
  function gradeWithWrong(nos: number[], marks: Marks = {}) {
    const answers = correctAnswers(examA);
    for (const no of nos) answers[no] = wrongValue(examA, no);
    return gradeExam(examA, { answers, marks, causes: {} });
  }

  it('대상이 하나면 하나만', () => {
    const steps = selectSteps(examA, gradeWithWrong([15]));
    expect(steps.map((s) => [s.name, s.score])).toEqual([['수열', 4]]);
  });

  it('대상이 둘이면 둘', () => {
    const steps = selectSteps(examA, gradeWithWrong([15, 1]));
    expect(steps.map((s) => [s.name, s.score])).toEqual([
      ['수열', 4],
      ['지수와 로그', 2],
    ]);
  });

  it('3위가 2위의 70%에 못 미치면 2개만', () => {
    // 적분 20번, 21번(8점), 수열 15번(4점), 지수와 로그 1번(2점). 2 < 4 x 0.7
    const steps = selectSteps(examA, gradeWithWrong([20, 21, 15, 1]));
    expect(steps.map((s) => [s.name, s.score])).toEqual([
      ['적분', 8],
      ['수열', 4],
    ]);
  });

  it('3위가 2위의 70% 이상이면 3개', () => {
    // 적분 20번, 21번(8점), 수열 15번(4점), 확률 9번(3점). 3 >= 4 x 0.7 = 2.8
    const steps = selectSteps(examA, gradeWithWrong([20, 21, 15, 9]));
    expect(steps.map((s) => [s.name, s.score])).toEqual([
      ['적분', 8],
      ['수열', 4],
      ['확률', 3],
    ]);
  });

  it('점수가 같으면 문항 번호가 앞선 유형이 먼저', () => {
    // 확률 9번(3점), 삼각함수 10번(3점), 함수의 극한과 연속 4번(3점)
    const steps = selectSteps(examA, gradeWithWrong([9, 10, 4]));
    expect(steps.map((s) => s.name)).toEqual(['함수의 극한과 연속', '확률', '삼각함수']);
  });

  it('4위 이하는 점수가 같아도 보여 주지 않는다', () => {
    const steps = selectSteps(examA, gradeWithWrong([4, 9, 10, 5, 6]));
    expect(steps).toHaveLength(3);
  });

  it('틀린 문항이 없고 찍음 표시도 없으면 빈 목록', () => {
    expect(selectSteps(examA, gradeWithWrong([]))).toEqual([]);
  });
});
