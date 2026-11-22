import type { Exam } from '../types';
import type { Anatomy } from './scoring';

// 등급컷까지 남은 점수(작업 지시서 7장).

export type Gap =
  /** 컷 범위보다 아래. from~to점 남았다. 확정 컷이면 from과 to가 같다. */
  | { pos: 'below'; from: number; to: number }
  | { pos: 'within' }
  | { pos: 'above' };

export function gapFor(score: number, lo: number, hi: number): Gap {
  if (score < lo) return { pos: 'below', from: lo - score, to: hi - score };
  if (score <= hi) return { pos: 'within' };
  return { pos: 'above' };
}

export interface CutView {
  grade: string;
  lo: number;
  hi: number;
  /** confirmed가 true이고 lo와 hi가 같을 때만 확정으로 본다. */
  confirmed: boolean;
  source: string;
  asOf: string;
  /** 첫 줄. 항상 실제 점수 기준이다. */
  actualGap: Gap;
  /** 둘째 줄. 찍기 운을 평균으로 본 점수(반올림 값) 기준. 보여 줄 것이 없으면 null. */
  luckGap: Gap | null;
}

/** 시험 데이터에 있는 등급만, 숫자가 작은 등급부터. */
export function gradeKeys(exam: Exam): string[] {
  if (!exam.cuts) return [];
  return Object.keys(exam.cuts.grades).sort((a, b) => Number(a) - Number(b));
}

export function cutView(exam: Exam, anatomy: Anatomy, grade: string | null): CutView | null {
  if (!exam.cuts || grade === null) return null;
  const range = exam.cuts.grades[grade];
  if (!range) return null;
  const [lo, hi] = range;
  return {
    grade,
    lo,
    hi,
    confirmed: exam.cuts.confirmed === true && lo === hi,
    source: exam.cuts.source,
    asOf: exam.cuts.asOf,
    actualGap: gapFor(anatomy.actual, lo, hi),
    luckGap: anatomy.showLuckAverage ? gapFor(anatomy.luckAverageRounded, lo, hi) : null,
  };
}
