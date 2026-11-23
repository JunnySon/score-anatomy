import { describe, expect, it } from 'vitest';
import { findExam } from '../exams';
import type { Exam } from '../types';
import { cutView } from './cuts';
import { exampleResponses } from './example';
import { analyze, gradeExam } from './scoring';
import { selectSteps } from './steps';
import { actualLine, anatomySentences, luckLine, retryLabel, retrySentence, selfCheckLabel, selfCheckSentence, stepReasons } from './text';

const examA = findExam('sample-a') as Exam;
const grade = gradeExam(examA, exampleResponses(examA));
const an = analyze(examA, grade);

describe('검산 예시의 화면 문장', () => {
  it('점수 해부 문장', () => {
    expect(anatomySentences(an).join(' ')).toBe(
      '78점 가운데 7점은 찍었다고 표시한 문항에서 나왔어요. 틀린 22점 가운데 8점은 실수라고 표시했어요.',
    );
  });

  it('목표 2등급: 첫 줄과 둘째 줄', () => {
    const cv = cutView(examA, an, '2')!;
    const line = actualLine(cv, an.actual);
    expect(line.lead.join(' ')).toBe('실제 78점 기준 3~7점 남았어요');
    expect(line.rest).toBeNull();
    expect(luckLine(cv, an.luckAverageRounded)).toBe('찍기 운을 평균으로 보면 약 75점, 그 기준으로는 6~10점이에요');
  });

  it('목표 1등급', () => {
    const cv = cutView(examA, an, '1')!;
    expect(actualLine(cv, an.actual).lead.join(' ')).toBe('실제 78점 기준 10~14점 남았어요');
    expect(luckLine(cv, an.luckAverageRounded)).toBe('찍기 운을 평균으로 보면 약 75점, 그 기준으로는 13~17점이에요');
  });

  it('목표 3등급: 컷 범위보다 위, 둘째 줄은 범위 안', () => {
    const cv = cutView(examA, an, '3')!;
    expect(actualLine(cv, an.actual)).toEqual({ lead: ['컷 범위보다 위예요.'], rest: null });
    expect(luckLine(cv, an.luckAverageRounded)).toBe('찍기 운을 평균으로 보면 약 75점, 그 기준으로는 컷 범위 안이에요');
  });

  it('컷 범위 안이면 컷이 확정되면 바뀐다고 알린다', () => {
    const exam: Exam = { ...examA, cuts: { ...examA.cuts!, grades: { '2': [76, 80] } } };
    const cv = cutView(exam, an, '2')!;
    expect(actualLine(cv, an.actual)).toEqual({ lead: ['컷 범위 안이에요.'], rest: '컷이 확정되면 이 화면이 바뀌어요.' });
    // 첫 줄이 남은 점수가 아니라서 둘째 줄에 "남았어요"를 붙인다.
    expect(luckLine(cv, an.luckAverageRounded)).toBe('찍기 운을 평균으로 보면 약 75점, 그 기준으로는 1~5점 남았어요');
  });

  it('확정 컷이면 한 숫자로 쓴다', () => {
    const exam: Exam = { ...examA, cuts: { source: '예시 값', asOf: '2026-11-22', confirmed: true, grades: { '1': [82, 82], '2': [78, 78], '3': [75, 75] } } };
    const cv1 = cutView(exam, an, '1')!;
    expect(actualLine(cv1, an.actual).lead.join(' ')).toBe('실제 78점 기준 4점 남았어요');
    expect(luckLine(cv1, an.luckAverageRounded)).toBe('찍기 운을 평균으로 보면 약 75점, 그 기준으로는 7점이에요');
    const cv2 = cutView(exam, an, '2')!;
    expect(actualLine(cv2, an.actual).lead).toEqual(['컷과 같은 점수예요.']);
    const cv3 = cutView(exam, an, '3')!;
    expect(actualLine(cv3, an.actual).lead).toEqual(['컷보다 위예요.']);
    expect(luckLine(cv3, an.luckAverageRounded)).toBe('찍기 운을 평균으로 보면 약 75점, 그 기준으로는 컷과 같은 점수예요');
  });

  it('첫 줄이 남은 점수가 아니면 둘째 줄에 "남았어요"를 붙인다', () => {
    // 확정 컷 76점: 실제 78점은 컷보다 위, 약 75점은 1점 아래.
    const exam: Exam = { ...examA, cuts: { source: '예시 값', asOf: '2026-11-22', confirmed: true, grades: { '2': [76, 76] } } };
    const cv = cutView(exam, an, '2')!;
    expect(actualLine(cv, an.actual).lead).toEqual(['컷보다 위예요.']);
    expect(luckLine(cv, an.luckAverageRounded)).toBe('찍기 운을 평균으로 보면 약 75점, 그 기준으로는 1점 남았어요');
    // 추정 범위 76~77: 실제 78점은 범위보다 위, 약 75점은 1~2점 아래.
    const exam2: Exam = { ...examA, cuts: { ...examA.cuts!, grades: { '2': [76, 77] } } };
    const cv2 = cutView(exam2, an, '2')!;
    expect(luckLine(cv2, an.luckAverageRounded)).toBe('찍기 운을 평균으로 보면 약 75점, 그 기준으로는 1~2점 남았어요');
  });

  it('계단 카드의 이유는 기록에서 만든다', () => {
    const steps = selectSteps(examA, grade);
    expect(stepReasons(steps[0]!)).toEqual([
      '이번 시험에서 이 유형으로 8점을 놓쳤고, 둘 다 풀이가 안 떠올랐다고 표시했어요.',
      '이 유형의 14번은 찍었다고 표시했고, 채점해 보니 맞았어요.',
    ]);
    expect(stepReasons(steps[1]!)).toEqual(['이번 시험에서 이 유형으로 8점을 놓쳤고, 둘 다 실수라고 표시했어요.']);
    expect(stepReasons(steps[2]!)).toEqual([
      '이번 시험에서 이 유형으로 3점을 놓쳤고, 풀이가 안 떠올랐다고 표시했어요.',
      '이 유형의 9번은 찍었다고 표시했고, 채점해 보니 맞았어요.',
    ]);
  });

  it('원인을 고르지 않았으면 단정하지 않는다', () => {
    const r = exampleResponses(examA);
    const g = gradeExam(examA, { ...r, causes: {} });
    const steps = selectSteps(examA, g);
    for (const s of steps) expect(stepReasons(s)[0]).toMatch(/점을 놓쳤어요\.$/);
    expect(anatomySentences(analyze(examA, g))).toEqual(['78점 가운데 7점은 찍었다고 표시한 문항에서 나왔어요.']);
  });

  it('표시가 없으면 문장도 없다', () => {
    const r = exampleResponses(examA);
    const g = gradeExam(examA, { answers: r.answers, marks: {}, causes: {} });
    expect(anatomySentences(analyze(examA, g))).toEqual([]);
  });
});

describe('재풀이 기록 라벨', () => {
  /** first는 처음 맞힌 차례. 적지 않으면 이번에 처음 맞힌(또는 아직 못 맞힌) 것으로 둔다. */
  const rec = (correct: boolean, attempts = 1, answerKnown = false, first: number | null = correct ? attempts : null) => ({
    correct,
    attempts,
    firstCorrectAttempt: first,
    answerKnown,
    at: '2026-11-22T10:00:00.000Z',
  });

  it('맞혔고 정답을 본 적이 없으면 "다시 풀어 맞힘"', () => {
    expect(retryLabel(rec(true), 'blank')).toBe('다시 풀어 맞힘');
    expect(retryLabel(rec(true), null)).toBe('다시 풀어 맞힘');
    expect(retrySentence(rec(true))).toBe('다시 풀어 맞혔어요.');
  });

  it('원인이 실수였으면 "실수로 표시함, 다시 풀어 맞힘"', () => {
    expect(retryLabel(rec(true), 'slip')).toBe('실수로 표시함, 다시 풀어 맞힘');
  });

  it('정답을 먼저 봤으면 "정답 확인 후 다시 맞힘"', () => {
    expect(retryLabel(rec(true, 1, true), 'slip')).toBe('정답 확인 후 다시 맞힘');
    expect(retrySentence(rec(true, 1, true))).toBe('정답을 확인한 뒤 다시 맞혔어요.');
  });

  it('틀리면 "다시 풀었지만 답이 다름"이고, 계단에 남긴다는 말은 하지 않는다', () => {
    expect(retryLabel(rec(false), 'slip')).toBe('다시 풀었지만 답이 다름');
    expect(retrySentence(rec(false))).toBe('이번에도 답이 달랐어요.');
  });

  it('여러 번 만에 맞히면 "풀어"를 빼고 몇 번째로 넣은 답이 맞았는지 적는다', () => {
    expect(retryLabel(rec(true, 2), 'blank')).toBe('2번째로 넣은 답이 맞음');
    expect(retryLabel(rec(true, 2), null)).toBe('2번째로 넣은 답이 맞음');
    expect(retryLabel(rec(true, 3), 'slip')).toBe('실수로 표시함, 3번째로 넣은 답이 맞음');
    expect(retrySentence(rec(true, 2))).toBe('2번째로 넣은 답이 맞았어요.');
    expect(retrySentence(rec(true, 5))).toBe('5번째로 넣은 답이 맞았어요.');
    // 처음 맞은 차례가 기준이다. 맞힌 뒤에 또 맞혀도 바뀌지 않는다.
    expect(retryLabel(rec(true, 4, false, 2), 'blank')).toBe('2번째로 넣은 답이 맞음');
  });

  it('정답을 확인한 뒤에 맞힌 경우는 차례와 상관없이 "정답 확인 후 다시 맞힘"이 먼저다', () => {
    expect(retryLabel(rec(true, 3, true), 'blank')).toBe('정답 확인 후 다시 맞힘');
    expect(retryLabel(rec(true, 3, true), 'slip')).toBe('정답 확인 후 다시 맞힘');
    expect(retrySentence(rec(true, 3, true))).toBe('정답을 확인한 뒤 다시 맞혔어요.');
  });

  it('처음에 바로 맞힌 문항은 또 맞혀도 라벨이 바뀌지 않는다', () => {
    expect(retryLabel(rec(true, 2, false, 1), 'slip')).toBe('실수로 표시함, 다시 풀어 맞힘');
    expect(retryLabel(rec(true, 3, false, 1), 'blank')).toBe('다시 풀어 맞힘');
    expect(retrySentence(rec(true, 3, false, 1))).toBe('다시 풀어 맞혔어요.');
  });

  it('맞힌 뒤에 다시 넣어 틀리면 최근 결과를 따른다', () => {
    expect(retryLabel(rec(false, 2, false, 1), 'slip')).toBe('다시 풀었지만 답이 다름');
    expect(retryLabel(rec(false, 3, false, 2), 'blank')).toBe('다시 풀었지만 답이 다름');
    expect(retrySentence(rec(false, 3, false, 2))).toBe('이번에도 답이 달랐어요.');
  });
});

describe('찍음 표시 정답의 스스로 확인', () => {
  it('라벨과 결과 문장', () => {
    expect(selfCheckLabel('solved')).toBe('찍음 표시 정답, 끝까지 풀었다고 표시함');
    expect(selfCheckLabel('stuck')).toBe('찍음 표시 정답, 막힌다고 표시함');
    expect(selfCheckSentence('solved')).toBe('끝까지 풀었다고 표시했어요.');
    expect(selfCheckSentence('stuck')).toBe('막힌다고 표시했어요.');
  });

  it('맞음, 틀림, 다시 풀어 맞힘, 정답 확인 후라는 말을 쓰지 않는다', () => {
    for (const r of ['solved', 'stuck'] as const) {
      for (const text of [selfCheckLabel(r), selfCheckSentence(r)]) {
        expect(text).not.toMatch(/맞힘|맞혔|틀림|틀렸|정답 확인/);
      }
    }
  });
});
