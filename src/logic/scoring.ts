import { isValidAnswerNumber } from '../exams/validate';
import type { Answers, AnswerValue, Cause, Causes, Exam, ExamItem, ItemKind, Mark, Marks } from '../types';

// 계산 규칙(작업 지시서 7장).
// 실제 점수는 채점 결과 그대로다. 자동 차감은 없다.

export interface Responses {
  answers: Answers;
  marks: Marks;
  causes: Causes;
}

export interface ItemResult {
  no: number;
  kind: ItemKind;
  points: number;
  typeId: string;
  response: AnswerValue;
  skipped: boolean;
  correct: boolean;
  /** 계산에 쓰는 찍음 표시. 답을 넣은 5지선다 문항에만 붙는다. */
  guess: boolean;
  mark: Mark | null;
  /** 틀린 문항에 학생이 고른 원인. */
  cause: Cause | null;
}

export interface Grade {
  total: number;
  itemCount: number;
  actual: number;
  correctCount: number;
  items: ItemResult[];
  wrong: ItemResult[];
}

export class GradeError extends Error {
  reason: 'unreleased' | 'missing';
  missing: number[];
  constructor(reason: 'unreleased' | 'missing', missing: number[] = []) {
    super(reason === 'missing' ? `미입력 문항이 있어요: ${missing.join(', ')}` : '정답이 아직 공개되지 않았어요.');
    this.name = 'GradeError';
    this.reason = reason;
    this.missing = missing;
  }
}

/** 넣은 답으로 볼 수 있는 값인지. 숫자 범위를 벗어난 값은 미입력으로 본다. */
export function isAnswered(item: ExamItem, v: unknown): v is AnswerValue {
  return v === 'skip' || isValidAnswerNumber(item, v);
}

/** 미입력 문항 번호. 안 풂은 미입력이 아니다. */
export function findMissing(exam: Exam, answers: Answers): number[] {
  return exam.items.filter((it) => !isAnswered(it, answers[it.no])).map((it) => it.no);
}

export function countEntered(exam: Exam, answers: Answers): number {
  return exam.items.length - findMissing(exam, answers).length;
}

/**
 * 채점한다. 미입력이 남아 있으면 채점하지 않는다(몰래 오답 처리 금지).
 * 안 풂은 0점으로 채점하되 미입력과 구분한다.
 */
export function gradeExam(exam: Exam, r: Responses): Grade {
  if (!exam.answerReleased) throw new GradeError('unreleased');
  const missing = findMissing(exam, r.answers);
  if (missing.length > 0) throw new GradeError('missing', missing);
  const items: ItemResult[] = exam.items.map((it) => {
    const response = r.answers[it.no] as AnswerValue;
    const skipped = response === 'skip';
    const correct = !skipped && response === it.answer;
    const rawMark = r.marks[it.no] ?? null;
    // 5지선다에는 고민과 찍음만, 단답형에는 자신 없음만 인정한다. 안 푼 문항의 표시는 쓰지 않는다.
    const mark: Mark | null = skipped
      ? null
      : it.kind === 'mc'
        ? rawMark === 'doubt' || rawMark === 'guess'
          ? rawMark
          : null
        : rawMark === 'unsure'
          ? rawMark
          : null;
    return {
      no: it.no,
      kind: it.kind,
      points: it.points,
      typeId: it.typeId,
      response,
      skipped,
      correct,
      guess: mark === 'guess',
      mark,
      cause: correct ? null : (r.causes[it.no] ?? null),
    };
  });
  const total = exam.items.reduce((s, it) => s + it.points, 0);
  const actual = items.reduce((s, it) => s + (it.correct ? it.points : 0), 0);
  return {
    total,
    itemCount: items.length,
    actual,
    correctCount: items.filter((it) => it.correct).length,
    items,
    wrong: items.filter((it) => !it.correct),
  };
}

export interface Anatomy {
  total: number;
  itemCount: number;
  actual: number;
  correctCount: number;
  wrongCount: number;
  wrongPoints: number;
  /** 고민, 찍음, 자신 없음 가운데 하나라도 있는지. */
  hasAnyMark: boolean;
  /** 찍음 표시가 하나라도 있는지. */
  hasGuessMark: boolean;
  guessMarkCount: number;
  /** 추측 표시 정답 점수: 찍음 표시가 있고 맞힌 5지선다 문항 배점의 합. */
  guessCorrectPoints: number;
  /** 찍음 전체 배점: 찍음 표시가 있는 5지선다 문항(맞음과 틀림 모두) 배점의 합. */
  guessTotalPoints: number;
  /** 찍기 운을 평균으로 본 점수(반올림 전). */
  luckAverage: number;
  /** 화면에 "약 N점"으로 보여 주는 값. */
  luckAverageRounded: number;
  /** 찍음 표시가 없거나 반올림 값이 실제 점수와 같으면 보여 주지 않는다. */
  showLuckAverage: boolean;
  /** 원인을 고른 틀린 문항 수. */
  causeMarkedCount: number;
  /** 실수 표시 오답 점수: 원인을 "풀 줄 아는데 틀렸어요"로 고른 틀린 문항 배점의 합. 실제 점수 안에 들어 있지 않다. */
  slipPoints: number;
  otherWrongPoints: number;
  /** 찍음 표시 없이 맞힌 점수. 막대의 채움 구간. */
  plainCorrectPoints: number;
}

/** 찍어서 맞힐 평균 비율. 지시서 7장의 식 그대로 0.2(5지선다)를 쓴다. */
export const GUESS_RATE = 0.2;

function round6(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}

export function analyze(_exam: Exam, grade: Grade): Anatomy {
  const guessItems = grade.items.filter((it) => it.guess);
  const guessCorrectPoints = guessItems.filter((it) => it.correct).reduce((s, it) => s + it.points, 0);
  const guessTotalPoints = guessItems.reduce((s, it) => s + it.points, 0);
  // 찍기 운을 평균으로 본 점수 = 실제 점수 - 추측 표시 정답 점수 + 0.2 x 찍음 전체 배점
  const luckAverage = round6(grade.actual - guessCorrectPoints + GUESS_RATE * guessTotalPoints);
  const luckAverageRounded = Math.round(luckAverage);
  const wrongPoints = grade.wrong.reduce((s, it) => s + it.points, 0);
  const slipPoints = grade.wrong.filter((it) => it.cause === 'slip').reduce((s, it) => s + it.points, 0);
  return {
    total: grade.total,
    itemCount: grade.itemCount,
    actual: grade.actual,
    correctCount: grade.correctCount,
    wrongCount: grade.wrong.length,
    wrongPoints,
    hasAnyMark: grade.items.some((it) => it.mark !== null),
    hasGuessMark: guessItems.length > 0,
    guessMarkCount: guessItems.length,
    guessCorrectPoints,
    guessTotalPoints,
    luckAverage,
    luckAverageRounded,
    showLuckAverage: guessItems.length > 0 && luckAverageRounded !== grade.actual,
    causeMarkedCount: grade.wrong.filter((it) => it.cause !== null).length,
    slipPoints,
    otherWrongPoints: wrongPoints - slipPoints,
    plainCorrectPoints: grade.actual - guessCorrectPoints,
  };
}
