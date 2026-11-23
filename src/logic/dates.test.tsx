import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EXAMS, findExam, sortExams } from '../exams';
import { validateExam } from '../exams/validate';
import { heldText } from '../screens/ExamSelect';
import type { Exam } from '../types';
import { compareYmd, daysInMonth, isValidYmd, parseYmd } from './dates';

// 시험 시행일(examDate)과 등급컷 기준일(cuts.asOf). Date 로 바꾸지 않고 문자열을 연, 월, 일로 잘라 쓴다.

const examA = findExam('sample-a') as Exam;

/** 테스트용 시험. 예시 시험에는 시행일을 넣지 않는다(지어낸 날짜 금지). */
function testExam(id: string, examDate?: string): Exam {
  return { ...examA, id, title: `시험 ${id}`, ...(examDate === undefined ? {} : { examDate }) };
}

describe('날짜 문자열', () => {
  it('실제로 있는 날짜만 받는다', () => {
    expect(parseYmd('2030-01-02')).toEqual({ y: 2030, m: 1, d: 2 });
    expect(isValidYmd('2028-02-29')).toBe(true);
    expect(isValidYmd('2000-02-29')).toBe(true);
    expect(isValidYmd('2027-02-29')).toBe(false);
    expect(isValidYmd('2100-02-29')).toBe(false);
    expect(isValidYmd('2026-04-31')).toBe(false);
    expect(isValidYmd('2026-13-01')).toBe(false);
    expect(isValidYmd('2026-00-10')).toBe(false);
    expect(isValidYmd('2026-11-00')).toBe(false);
    expect(isValidYmd('2026-1-02')).toBe(false);
    expect(isValidYmd('2026/11/22')).toBe(false);
    expect(isValidYmd('2026-11-22T00:00:00Z')).toBe(false);
    expect(isValidYmd(20261122)).toBe(false);
    expect(isValidYmd(undefined)).toBe(false);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  it('자릿수가 같아서 글자 순서가 곧 날짜 순서다', () => {
    expect(compareYmd('2030-01-02', '2029-12-31')).toBeGreaterThan(0);
    expect(compareYmd('2030-01-02', '2030-01-02')).toBe(0);
    expect(compareYmd('2030-01-02', '2030-01-10')).toBeLessThan(0);
  });

  it('실행하는 곳의 시간대와 상관없이 같은 날짜를 적는다(Date 로 바꾸지 않는다)', () => {
    const html = renderToStaticMarkup(<>{heldText('2030-01-02')}</>);
    expect(html).toContain('2030년 1월 2일 시행');
    expect(renderToStaticMarkup(<>{heldText('2030-12-31')}</>)).toContain('2030년 12월 31일 시행');
    expect(renderToStaticMarkup(<>{heldText(undefined)}</>)).toBe('');
    expect(renderToStaticMarkup(<>{heldText('2027-02-29')}</>)).toBe('');
  });
});

describe('시험 시행일(examDate)', () => {
  it('없어도 되고, 있으면 실제로 있는 날짜여야 한다', () => {
    expect(validateExam(testExam('x'))).toEqual([]);
    expect(validateExam(testExam('x', '2030-01-02'))).toEqual([]);
    expect(validateExam(testExam('x', '2027-02-29')).join(' ')).toContain('examDate');
    expect(validateExam(testExam('x', '2030-1-2')).join(' ')).toContain('examDate');
    expect(validateExam({ ...testExam('x'), examDate: 20300102 }).join(' ')).toContain('examDate');
  });

  it('등급컷 기준일(cuts.asOf)에도 같은 검사를 쓴다', () => {
    const withAsOf = (asOf: string) => ({ ...examA, cuts: { ...examA.cuts!, asOf } });
    expect(validateExam(withAsOf('2028-02-29'))).toEqual([]);
    expect(validateExam(withAsOf('2027-02-29')).join(' ')).toContain('cuts.asOf');
    expect(validateExam(withAsOf('2026-11-31')).join(' ')).toContain('cuts.asOf');
  });

  it('시행일이 있는 시험은 최근 날짜가 위로 오고, 같은 날짜는 배열 순서, 없는 시험은 그 아래에 배열 순서대로 둔다', () => {
    const list = [
      testExam('n1'),
      testExam('d-2029', '2029-11-14'),
      testExam('d-2030a', '2030-03-21'),
      testExam('n2'),
      testExam('d-2030b', '2030-03-21'),
      testExam('d-2030c', '2030-06-04'),
    ];
    expect(sortExams(list).map((e) => e.id)).toEqual(['d-2030c', 'd-2030a', 'd-2030b', 'd-2029', 'n1', 'n2']);
    // 받은 배열은 바꾸지 않는다.
    expect(list.map((e) => e.id)).toEqual(['n1', 'd-2029', 'd-2030a', 'n2', 'd-2030b', 'd-2030c']);
  });

  it('예시 시험 A, B, C에는 시행일을 넣지 않았고(지어낸 날짜 금지) 지금 순서 그대로다', () => {
    expect(EXAMS.map((e) => e.id)).toEqual(['sample-a', 'sample-b', 'sample-c']);
    for (const e of EXAMS) expect(e.examDate).toBeUndefined();
  });
});
