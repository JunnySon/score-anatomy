import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Exam } from '../types';

// 시험 선택 화면을 테스트용 시험 데이터로 그려서(서버 렌더링) 시행일의 정렬과 표시를 확인한다.
// 예시 시험 A, B, C에는 시행일을 넣지 않으므로(지어낸 날짜 금지) 화면이 읽는 시험 목록(useExams)을 테스트용 시험으로 바꿔 끼운다.

vi.mock('../exams', async (importOriginal) => {
  const real = await importOriginal<typeof import('../exams')>();
  const base = real.findBundledExam('sample-a') as Exam;
  const make = (id: string, title: string, examDate?: string): Exam => ({
    ...base,
    id,
    title,
    isSample: false,
    ...(examDate === undefined ? {} : { examDate }),
  });
  // 배열 순서는 일부러 섞어 둔다. 시험 목록 저장소처럼 sortExams 를 거친 목록을 돌려준다.
  const list = [
    make('t-none-1', '날짜 없는 시험 1'),
    make('t-2029', '2029년 시험', '2029-11-14'),
    make('t-2030-a', '2030년 3월 시험 가', '2030-03-21'),
    make('t-none-2', '날짜 없는 시험 2'),
    make('t-2030-b', '2030년 3월 시험 나', '2030-03-21'),
    make('t-2030-jan', '2030년 1월 시험', '2030-01-02'),
  ];
  const sorted = real.sortExams(list);
  return { ...real, useExams: () => sorted };
});

const { ExamSelect } = await import('./ExamSelect');

describe('시험 선택 화면의 시행일(3-8)', () => {
  it('최근 날짜가 위로 오고, 같은 날짜는 배열 순서, 날짜 없는 시험은 그 아래에 배열 순서대로 둔다', () => {
    const html = renderToStaticMarkup(<ExamSelect />);
    const ids = [...html.matchAll(/data-testid="exam-([^"]+)"/g)].map((m) => m[1]).filter((id) => id !== 'date');
    expect(ids).toEqual(['t-2030-a', 't-2030-b', 't-2030-jan', 't-2029', 't-none-1', 't-none-2']);
  });

  it('시행일을 "2030년 1월 2일 시행"처럼 적고, 날짜가 없는 시험에는 적지 않는다', () => {
    const html = renderToStaticMarkup(<ExamSelect />);
    const dates = [...html.matchAll(/data-testid="exam-date">([^<]*)</g)].map((m) => m[1]);
    expect(dates).toEqual(['2030년 3월 21일 시행', '2030년 3월 21일 시행', '2030년 1월 2일 시행', '2029년 11월 14일 시행']);
    expect(html).toContain('2030년 1월 2일 시행');
  });
});
