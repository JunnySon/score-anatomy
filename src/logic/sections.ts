import type { Exam, ItemKind } from '../types';

/** 같은 문항 유형이 이어지는 구간. 화면의 "객관식 1~21번" 같은 이름에 쓴다. */
export interface Section {
  kind: ItemKind;
  from: number;
  to: number;
  count: number;
}

export function sectionsOf(exam: Exam): Section[] {
  const out: Section[] = [];
  for (const it of exam.items) {
    const last = out[out.length - 1];
    if (last && last.kind === it.kind) {
      last.to = it.no;
      last.count += 1;
    } else {
      out.push({ kind: it.kind, from: it.no, to: it.no, count: 1 });
    }
  }
  return out;
}

export function sectionOf(exam: Exam, no: number): Section | null {
  return sectionsOf(exam).find((s) => no >= s.from && no <= s.to) ?? null;
}

export const GROUP_SIZE = 5;

/** 문항을 5개씩 묶는다. 묶음 번호는 0부터. */
export function groupIndexOf(index: number): number {
  return Math.floor(index / GROUP_SIZE);
}

export function groupCount(exam: Exam): number {
  return Math.ceil(exam.items.length / GROUP_SIZE);
}
