import { typesReadyOf } from '../exams/validate';
import type { CorrectionNotice } from '../state/session';
import { S } from '../strings';
import type { Cause, Exam, RetryRecord, SelfCheck } from '../types';
import { gradeKeys, type CutView, type Gap } from './cuts';
import { parseAsOf } from './dates';
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

/**
 * 정답 정정 알림의 첫 줄(작업 지시서 3의 4-6). 점수가 달라졌으면 예전 점수와 지금 점수를, 같으면 그대로라는 것을,
 * 채점 흔적이 없는 옛 기록이면 지금 정답으로 채점했다는 것만 적는다. 다음 줄의 정정 안내(answersNote)는 화면이 그대로 붙인다.
 */
export function correctionText(n: CorrectionNotice): string {
  if (n.kind === 'changed') return S.correction.changed(n.from, n.to);
  if (n.kind === 'same') return S.correction.same(n.score);
  if (n.kind === 'differs') return S.correction.differs(n.from, n.to);
  return S.correction.noPrevious;
}

/** 점수 해부 화면의 문장. 표시가 없는 부분은 말하지 않는다. */
export function anatomySentences(an: Anatomy): string[] {
  const out: string[] = [];
  if (an.guessCorrectPoints > 0) {
    out.push(S.anatomy.sentenceGuess(an.actual, an.guessCorrectPoints));
    // 찍음 표시가 붙은 모두 정답 처리 문항의 점수는 이 점수에 넣지 않았다는 것을 덧붙인다(작업 지시서 3의 4-2, 별도 검토 D1).
    if (an.allCorrectGuessCount > 0) out.push(S.anatomy.sentenceGuessAllCorrect);
  }
  if (an.slipPoints > 0) out.push(S.anatomy.sentenceSlip(an.wrongPoints, an.slipPoints));
  return out;
}

export interface ActualLine {
  /** 보조 숫자 크기로 쓰는 부분. 줄이 바뀌어도 되는 조각으로 나눈다. */
  lead: readonly string[];
  /** 본문 크기로 잇는 부분. */
  rest: string | null;
}

/**
 * 등급컷 상자의 첫 줄. 항상 실제 점수 기준이다.
 * 한 숫자 컷(확정 컷이나 두 값이 같은 추정 컷)에는 "범위"라는 말이 맞지 않아서 "컷과 같은 점수", "컷보다 위"로 적는다.
 * 추정 컷은 새 자료가 나오면 바뀌므로, 컷 범위 안이거나 컷과 같은 점수면 그 사실을 덧붙인다. 확정 컷에는 붙이지 않는다(작업 지시서 3의 4-4).
 */
export function actualLine(cv: CutView, actual: number): ActualLine {
  const gap: Gap = cv.actualGap;
  if (gap.pos === 'below') return { lead: S.anatomy.actualBelow(actual, gap.from, gap.to), rest: null };
  const within = gap.pos === 'within';
  const rest = within && !cv.confirmed ? S.anatomy.actualWithinRest : null;
  if (cv.single) return { lead: [within ? S.anatomy.actualEqualSingle : S.anatomy.actualAboveSingle], rest };
  return { lead: [within ? S.anatomy.actualWithinLead : S.anatomy.actualAbove], rest };
}

/** 등급컷 상자의 둘째 줄. 찍기 운을 평균으로 본 점수(반올림 값) 기준. */
export function luckLine(cv: CutView, rounded: number): string | null {
  const gap = cv.luckGap;
  if (!gap) return null;
  if (gap.pos === 'below') {
    // 첫 줄도 남은 점수면 지시서의 문장 그대로, 아니면 "남았어요"를 붙여 혼자서도 읽히게 한다.
    return cv.actualGap.pos === 'below' ? S.anatomy.luckBelow(rounded, gap.from, gap.to) : S.anatomy.luckBelowAlone(rounded, gap.from, gap.to);
  }
  if (cv.single) return gap.pos === 'within' ? S.anatomy.luckEqualSingle(rounded) : S.anatomy.luckAboveSingle(rounded);
  return gap.pos === 'within' ? S.anatomy.luckWithin(rounded) : S.anatomy.luckAbove(rounded);
}

/**
 * 등급컷 출처 시트의 기준 줄. 시각이 적혀 있으면 "기준: 2030년 1월 2일 오후 8시 10분"(형식 예시, 한국 시간)이고,
 * 날짜만이면 지금 글자 그대로 "기준일: 2026-11-22"다(작업 지시서 3의 4-4). Date 로 바꾸지 않고 글자를 잘라 쓴다.
 * 읽을 수 없는 값(검사를 거친 시험에는 없다)은 적힌 그대로 둔다.
 */
export function asOfLine(asOf: string): string {
  const at = parseAsOf(asOf);
  if (at && at.time) return S.anatomy.asOfTime(at.y, at.m, at.d, at.time.h, at.time.mi);
  return S.anatomy.asOf(asOf);
}

/** 등급컷 출처 시트의 설명. 주관 기관이 발표한 컷, 추정 컷(범위), 추정 컷(한 값) 가운데 하나다(작업 지시서 3의 4-4). */
export function cutNote(cv: CutView): string {
  if (cv.confirmed) return S.anatomy.sourceConfirmed;
  return cv.single ? S.anatomy.sourceEstimateOne : S.anatomy.sourceEstimate;
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
