import type { Exam } from '../types';
import type { Anatomy } from './scoring';

// 등급컷까지 남은 점수(작업 지시서 7장).

export type Gap =
  /** 컷 범위보다 아래. from~to점 남았다. 한 숫자 컷(두 값이 같은 컷)이면 from과 to가 같다. */
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
  /**
   * 배지("확정", "추정"). confirmed가 true이고 lo와 hi가 같을 때만 확정으로 본다.
   * confirmed는 주관 기관이 원점수 등급컷을 직접 발표했을 때만 true다(작업 지시서 3의 4-4).
   */
  confirmed: boolean;
  /**
   * 한 숫자 컷인지(lo와 hi가 같음). 확정 컷과, 두 값이 같은 추정 컷이다(작업 지시서 3의 4-4).
   * 범위가 아니라서 "범위 안", "범위보다 위" 대신 "컷과 같은 점수", "컷보다 위"로 적는다. 배지는 confirmed를 따른다.
   */
  single: boolean;
  source: string;
  /** 등급컷 기준. 날짜("YYYY-MM-DD")이거나 한국 시간의 날짜와 시각("YYYY-MM-DDTHH:mm")이다. */
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
  if (!Object.prototype.hasOwnProperty.call(exam.cuts.grades, grade)) return null;
  const range = exam.cuts.grades[grade];
  if (!Array.isArray(range) || typeof range[0] !== 'number' || typeof range[1] !== 'number') return null;
  const [lo, hi] = range;
  return {
    grade,
    lo,
    hi,
    confirmed: exam.cuts.confirmed === true && lo === hi,
    single: lo === hi,
    source: exam.cuts.source,
    asOf: exam.cuts.asOf,
    actualGap: gapFor(anatomy.actual, lo, hi),
    luckGap: anatomy.showLuckAverage ? gapFor(anatomy.luckAverageRounded, lo, hi) : null,
  };
}
