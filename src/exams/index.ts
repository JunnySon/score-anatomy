import { compareYmd } from '../logic/dates';
import { mergeLocks } from '../logic/lock';
import type { Exam, LockEntry } from '../types';
import rawLocks from './locks.json';
import rawA from './sample-a.json';
import rawB from './sample-b.json';
import rawC from './sample-c.json';
import { parseExam, validateExam } from './validate';

// 시험 목록. 시행일(examDate)이 있는 시험은 최근 날짜가 위로 오고, 날짜가 같으면 아래 배열의 순서를 따른다.
// 시행일이 없는 시험은 그 아래에 배열 순서대로 둔다. 예시 시험은 시행일이 없어서(지어낸 날짜를 넣지 않는다) A, B, C 순이다.
const RAW: unknown[] = [rawA, rawB, rawC];

/** 시험 목록의 순서. 시행일이 있는 시험이 먼저(최근 날짜가 위), 같은 날짜와 시행일이 없는 시험은 받은 순서대로. */
export function sortExams(list: Exam[]): Exam[] {
  const dated = list.filter((e) => e.examDate !== undefined);
  const undated = list.filter((e) => e.examDate === undefined);
  // Array.prototype.sort 는 같은 값의 순서를 바꾸지 않는다.
  dated.sort((a, b) => compareYmd(b.examDate as string, a.examDate as string));
  return [...dated, ...undated];
}

const PARSED: Exam[] = RAW.map((raw) => {
  const exam = parseExam(raw);
  if (!exam) {
    // 잘못된 시험 파일은 목록에서 빼고 개발자 콘솔에만 알린다.
    console.error('시험 데이터 오류', validateExam(raw));
  }
  return exam;
}).filter((e): e is Exam => e !== null);

export const EXAMS: Exam[] = sortExams(PARSED);

export function findExam(id: string | null | undefined): Exam | null {
  if (!id) return null;
  return EXAMS.find((e) => e.id === id) ?? null;
}

export const SAMPLE_EXAM_ID = 'sample-a';

/**
 * 풀이 잠금 달력(작업 지시서 3의 4-5). 묶음 안 달력(locks.json)은 빈 배열로 시작하고, 실제 날짜와 시각은
 * 주관 기관 공고를 확인한 사람이 넣는다. 넘겨받은 달력(다리 규격 2)은 2부에서 함께 합친다.
 * 형식이 틀린 항목은 버리고 개발자 콘솔에 경고로 남긴다(src/logic/lock.ts 의 mergeLocks).
 */
export const LOCKS: LockEntry[] = mergeLocks(rawLocks, null);
