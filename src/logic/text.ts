import { S } from '../strings';
import type { Cause, RetryRecord } from '../types';
import type { CutView, Gap } from './cuts';
import type { Anatomy } from './scoring';
import type { Step } from './steps';

// 계산 결과를 화면 문장으로 바꾼다. 문구 자체는 strings.ts에 있다.

/** 점수 해부 화면의 문장. 표시가 없는 부분은 말하지 않는다. */
export function anatomySentences(an: Anatomy): string[] {
  const out: string[] = [];
  if (an.hasGuessMark) {
    out.push(an.guessCorrectPoints > 0 ? S.anatomy.sentenceGuess(an.actual, an.guessCorrectPoints) : S.anatomy.sentenceGuessNone);
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
  if (gap.pos === 'below') return S.anatomy.luckBelow(rounded, gap.from, gap.to);
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

/** 재풀이 기록 라벨. 같은 문항을 다시 맞힌 것만으로 처음 틀린 이유를 단정하지 않는다. */
export function retryLabel(rec: RetryRecord, cause: Cause | null): string {
  if (!rec.correct) return S.retry.labelWrong;
  if (rec.answerKnown) return S.retry.labelCorrectKnown;
  if (rec.attempts > 1) return S.retry.labelCorrectLater(rec.attempts);
  if (cause === 'slip') return S.retry.labelCorrectSlip;
  return S.retry.labelCorrect;
}

export function retrySentence(rec: RetryRecord): string {
  if (!rec.correct) return S.retry.wrong;
  return rec.answerKnown ? S.retry.correctKnown : S.retry.correct;
}
