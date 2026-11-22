import type { Exam } from '../types';
import rawA from './sample-a.json';
import rawB from './sample-b.json';
import rawC from './sample-c.json';
import { parseExam, validateExam } from './validate';

// 시험 목록. 맨 위가 가장 최근 시험이다. 새 시험은 배열 맨 앞에 추가한다.
// 예시 시험은 시행일이 없어서 A, B, C 순으로 둔다.
const RAW: unknown[] = [rawA, rawB, rawC];

export const EXAMS: Exam[] = RAW.map((raw) => {
  const exam = parseExam(raw);
  if (!exam) {
    // 잘못된 시험 파일은 목록에서 빼고 개발자 콘솔에만 알린다.
    console.error('시험 데이터 오류', validateExam(raw));
  }
  return exam;
}).filter((e): e is Exam => e !== null);

export function findExam(id: string | null | undefined): Exam | null {
  if (!id) return null;
  return EXAMS.find((e) => e.id === id) ?? null;
}

export const SAMPLE_EXAM_ID = 'sample-a';
