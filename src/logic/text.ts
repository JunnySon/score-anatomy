import { typesReadyOf } from '../exams/validate';
import { S } from '../strings';
import type { Cause, Exam, RetryRecord, SelfCheck } from '../types';
import { gradeKeys, type CutView, type Gap } from './cuts';
import type { Anatomy } from './scoring';
import type { Step } from './steps';

// 계산 결과를 화면 문장으로 바꾼다. 문구 자체는 strings.ts에 있다.

/**
 * 유형 분류가 끝나지 않았을 때(typesReady false) 계단 화면과 계단으로 가는 길에 계단 대신 보여 주는 문장(작업 지시서 3의 4-3).
 * 등급컷 자료가 없으면 "등급컷은 지금 볼 수 있어요"가 사실과 달라서 점수만 적는다.
 */
export function typesPendingText(exam: Exam): string {
  return gradeKeys(exam).length > 0 ? S.steps.typesPending : S.steps.typesPendingNoCuts;
}

/** 등급컷 자료가 없을 때 등급컷 상자의 문장. 유형 분류 전에는 고칠 것(계단)을 볼 수 없어서 그 말을 빼고 적는다. */
export function noCutsText(exam: Exam): string {
  return typesReadyOf(exam) ? S.anatomy.noCuts : S.anatomy.noCutsTypesPending;
}

/** 점수 해부 화면의 문장. 표시가 없는 부분은 말하지 않는다. */
export function anatomySentences(an: Anatomy): string[] {
  const out: string[] = [];
  if (an.guessCorrectPoints > 0) out.push(S.anatomy.sentenceGuess(an.actual, an.guessCorrectPoints));
  if (an.slipPoints > 0) out.push(S.anatomy.sentenceSlip(an.wrongPoints, an.slipPoints));
  return out;
}

export interface ActualLine {
  /** 보조 숫자 크기로 쓰는 부분. 줄이 바뀌어도 되는 조각으로 나눈다. */
  lead: readonly string[];
  /** 본문 크기로 잇는 부분. */
  rest: string | null;
}

/** 등급컷 상자의 첫 줄. 항상 실제 점수 기준이다. */
export function actualLine(cv: CutView, actual: number): ActualLine {
  const gap: Gap = cv.actualGap;
  if (gap.pos === 'below') return { lead: S.anatomy.actualBelow(actual, gap.from, gap.to), rest: null };
  if (cv.confirmed) return { lead: [gap.pos === 'within' ? S.anatomy.actualEqualConfirmed : S.anatomy.actualAboveConfirmed], rest: null };
  if (gap.pos === 'within') return { lead: [S.anatomy.actualWithinLead], rest: S.anatomy.actualWithinRest };
  return { lead: [S.anatomy.actualAbove], rest: null };
}

/** 등급컷 상자의 둘째 줄. 찍기 운을 평균으로 본 점수(반올림 값) 기준. */
export function luckLine(cv: CutView, rounded: number): string | null {
  const gap = cv.luckGap;
  if (!gap) return null;
  if (gap.pos === 'below') {
    // 첫 줄도 남은 점수면 지시서의 문장 그대로, 아니면 "남았어요"를 붙여 혼자서도 읽히게 한다.
    return cv.actualGap.pos === 'below' ? S.anatomy.luckBelow(rounded, gap.from, gap.to) : S.anatomy.luckBelowAlone(rounded, gap.from, gap.to);
  }
  if (cv.confirmed) return gap.pos === 'within' ? S.anatomy.luckEqualConfirmed(rounded) : S.anatomy.luckAboveConfirmed(rounded);
  return gap.pos === 'within' ? S.anatomy.luckWithin(rounded) : S.anatomy.luckAbove(rounded);
}

/** 계단 카드의 이유. 기록에서 만든다. */
export function stepReasons(step: Step): string[] {
  const out: string[] = [];
  if (step.wrongItems.length > 0) {
    const causes = step.wrongItems.map((w) => w.cause);
    const first = causes[0] ?? null;
    const same = first !== null && causes.every((c) => c === first);
    const kind: Cause | 'mixed' | 'none' = same ? first : causes.some((c) => c !== null) ? 'mixed' : 'none';
    out.push(S.steps.reasonMissed(step.wrongPoints, step.wrongItems.length, kind));
  }
  if (step.guessCorrectItems.length > 0) out.push(S.steps.reasonGuess(step.guessCorrectItems.map((i) => i.no)));
  return out;
}

/**
 * 재풀이 기록 라벨(틀린 문항을 다시 풀어 답을 넣은 경우).
 * 가장 최근 결과가 틀렸으면 "다시 풀었지만 답이 다름"이다.
 * 맞았으면: 정답을 먼저 봤거나 "이미 했어요" 경로면 "정답 확인 후 다시 맞힘"이 먼저다.
 * 그 밖에는 처음 맞은 차례(firstCorrectAttempt)가 첫 차례면 "다시 풀어 맞힘"(원인이 실수였으면 "실수로 표시함, 다시 풀어 맞힘"),
 * 둘째 차례 이후면 "풀어"라는 말을 빼고 "N번째로 넣은 답이 맞음"이라고 적는다(5지선다는 틀린 보기를 지워 가며 맞힐 수 있다).
 * 같은 문항을 다시 맞힌 것만으로 처음 틀린 이유를 단정하지 않는다.
 */
export function retryLabel(rec: RetryRecord, cause: Cause | null): string {
  if (!rec.correct) return S.retry.labelWrong;
  if (rec.answerKnown) return S.retry.labelCorrectKnown;
  const n = firstCorrect(rec);
  if (n >= 2) return cause === 'slip' ? S.retry.labelCorrectNthSlip(n) : S.retry.labelCorrectNth(n);
  return cause === 'slip' ? S.retry.labelCorrectSlip : S.retry.labelCorrect;
}

/** 재풀이 결과 문장. */
export function retrySentence(rec: RetryRecord): string {
  if (!rec.correct) return S.retry.wrong;
  if (rec.answerKnown) return S.retry.correctKnown;
  const n = firstCorrect(rec);
  return n >= 2 ? S.retry.correctNth(n) : S.retry.correct;
}

/** 처음 맞은 차례. 옛 기록에 값이 없으면 맞힌 마지막 차례로 본다. */
function firstCorrect(rec: RetryRecord): number {
  return rec.firstCorrectAttempt ?? rec.attempts;
}

/** 찍었다고 표시하고 맞은 문항을 스스로 확인한 기록의 라벨. 정답 대조가 아니므로 맞음과 틀림을 말하지 않는다. */
export function selfCheckLabel(result: SelfCheck): string {
  return result === 'solved' ? S.retry.labelSelfSolved : S.retry.labelSelfStuck;
}

/** 스스로 확인한 결과 문장. */
export function selfCheckSentence(result: SelfCheck): string {
  return result === 'solved' ? S.retry.selfSolved : S.retry.selfStuck;
}
