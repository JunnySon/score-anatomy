import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BUNDLED_EXAMS, findExam, sortExams } from '../exams';
import { validateExam } from '../exams/validate';
import { heldText } from '../screens/ExamSelect';
import { clockText, dateText } from '../strings';
import type { Exam } from '../types';
import { compareYmd, daysInMonth, isValidYmd, isValidYmdHm, KST_OFFSET_MS, kstText, parseAsOf, parseYmd, parseYmdHm } from './dates';

// 시험 시행일(examDate)과 등급컷 기준일(cuts.asOf). Date 로 바꾸지 않고 문자열을 연, 월, 일로 잘라 쓴다.
// 작업 지시서 3의 4-4부터 cuts.asOf 에는 한국 시간의 시각("YYYY-MM-DDTHH:mm")도 적을 수 있다.
// 날짜와 시각은 지시서의 형식 예시(2030-01-02, 08:40, 17:45, 17:10, 20:10)와 경계 값만 쓴다. 실제 시험의 시행일이나 시험 시간이 아니다.

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
    expect(BUNDLED_EXAMS.map((e) => e.id)).toEqual(['sample-a', 'sample-b', 'sample-c']);
    for (const e of BUNDLED_EXAMS) expect(e.examDate).toBeUndefined();
  });

  it('시행일(examDate)은 날짜만 받는다(시각을 붙이면 오류)', () => {
    expect(validateExam(testExam('x', '2030-01-02T20:10')).join(' ')).toContain('examDate');
  });

  it('등급컷 기준(cuts.asOf)에는 한국 시간의 시각도 적을 수 있고, 실제로 있는 날짜와 시각만 받는다', () => {
    const withAsOf = (asOf: unknown) => ({ ...examA, cuts: { ...examA.cuts!, asOf } });
    for (const ok of ['2026-11-22', '2030-01-02T20:10', '2030-01-02T00:00', '2030-01-02T12:00', '2030-01-02T23:59', '2028-02-29T08:40']) {
      expect(validateExam(withAsOf(ok)), ok).toEqual([]);
    }
    for (const bad of [
      '2030-01-02T24:00',
      '2030-01-02T23:60',
      '2030-01-02T8:10',
      '2027-02-29T10:00',
      '2030-01-02 20:10',
      '2030-01-02T20:10:00',
      '2030-01-02T20:10Z',
      '2030-01-02T',
      20300102,
      null,
    ]) {
      expect(validateExam(withAsOf(bad)).join(' '), String(bad)).toContain('cuts.asOf');
    }
  });
});

describe('날짜와 시각 문자열(작업 지시서 3의 4-4)', () => {
  it('"YYYY-MM-DDTHH:mm" 은 실제로 있는 날짜와 시각만 받는다(시 0~23, 분 0~59, 두 자리)', () => {
    expect(parseYmdHm('2030-01-02T20:10')).toEqual({ y: 2030, m: 1, d: 2, h: 20, mi: 10 });
    expect(parseYmdHm('2030-01-02T00:00')).toEqual({ y: 2030, m: 1, d: 2, h: 0, mi: 0 });
    expect(parseYmdHm('2030-01-02T23:59')).toEqual({ y: 2030, m: 1, d: 2, h: 23, mi: 59 });
    expect(parseYmdHm('2028-02-29T08:40')).toEqual({ y: 2028, m: 2, d: 29, h: 8, mi: 40 });
    for (const bad of [
      '2030-01-02T24:00',
      '2030-01-02T23:60',
      '2030-01-02T8:10',
      '2030-01-02T08:1',
      '2027-02-29T10:00',
      '2030-13-02T10:00',
      '2030-01-02 20:10',
      '2030-01-02t20:10',
      '2030-01-02T20:10:00',
      '2030-01-02T20:10Z',
      '2030-01-02T20:10+09:00',
      ' 2030-01-02T20:10',
      '2030-01-02T20:10\n',
      '2030-01-02',
      '',
    ]) {
      expect(parseYmdHm(bad), bad).toBeNull();
      expect(isValidYmdHm(bad), bad).toBe(false);
    }
    expect(parseYmdHm(undefined)).toBeNull();
    expect(parseYmdHm(203001022010)).toBeNull();
    // 날짜만 받는 곳(examDate)은 시각이 붙은 값을 받지 않는다.
    expect(isValidYmd('2030-01-02T20:10')).toBe(false);
    // 같은 모양끼리는 글자 순서가 곧 시각 순서다.
    expect(compareYmd('2030-01-02T17:45', '2030-01-02T08:40')).toBeGreaterThan(0);
    expect(compareYmd('2030-01-02T08:40', '2030-01-02T08:40')).toBe(0);
  });

  it('등급컷 기준(cuts.asOf)은 날짜만이거나 날짜와 시각이다', () => {
    expect(parseAsOf('2026-11-22')).toEqual({ y: 2026, m: 11, d: 22, time: null });
    expect(parseAsOf('2030-01-02T20:10')).toEqual({ y: 2030, m: 1, d: 2, time: { h: 20, mi: 10 } });
    expect(parseAsOf('2030-01-02T00:00')).toEqual({ y: 2030, m: 1, d: 2, time: { h: 0, mi: 0 } });
    for (const bad of ['2030-01-02T24:00', '2030-01-02T23:60', '2030-01-02T8:10', '2027-02-29T10:00', '2027-02-29', '2030/01/02', '']) {
      expect(parseAsOf(bad), bad).toBeNull();
    }
    expect(parseAsOf(null)).toBeNull();
  });

  it('시각 문구 조각은 오전과 오후로 적고, 분이 0이면 분을 뺀다(0시는 오전 0시, 12시는 오후 12시)', () => {
    expect(clockText(20, 10)).toBe('오후 8시 10분');
    expect(clockText(20, 0)).toBe('오후 8시');
    expect(clockText(17, 45)).toBe('오후 5시 45분');
    expect(clockText(17, 10)).toBe('오후 5시 10분');
    expect(clockText(8, 40)).toBe('오전 8시 40분');
    expect(clockText(0, 0)).toBe('오전 0시');
    expect(clockText(0, 5)).toBe('오전 0시 5분');
    expect(clockText(11, 59)).toBe('오전 11시 59분');
    expect(clockText(12, 0)).toBe('오후 12시');
    expect(clockText(12, 30)).toBe('오후 12시 30분');
    expect(clockText(13, 0)).toBe('오후 1시');
    expect(clockText(23, 59)).toBe('오후 11시 59분');
    // 날짜 표기는 시험 목록의 시행일과 같은 방식이다.
    expect(dateText(2030, 1, 2)).toBe('2030년 1월 2일');
    const t = parseYmdHm('2030-01-02T20:10')!;
    expect(`${dateText(t.y, t.m, t.d)} ${clockText(t.h, t.mi)}`).toBe('2030년 1월 2일 오후 8시 10분');
  });

  it('지금 시각(UTC 밀리초)은 9시간을 더해 한국 시간 글자로 적는다', () => {
    expect(KST_OFFSET_MS).toBe(9 * 60 * 60 * 1000);
    // 한국 시간 2030-01-02 08:40 은 UTC 로 2030-01-01 23:40 이다(날짜가 넘어간다).
    expect(kstText(Date.UTC(2030, 0, 1, 23, 40))).toBe('2030-01-02T08:40');
    expect(kstText(Date.UTC(2030, 0, 2, 8, 45))).toBe('2030-01-02T17:45');
    // 초 아래는 버린다.
    expect(kstText(Date.UTC(2030, 0, 2, 11, 10, 59, 999))).toBe('2030-01-02T20:10');
    // 해가 바뀌는 경계.
    expect(kstText(Date.UTC(2029, 11, 31, 14, 59))).toBe('2029-12-31T23:59');
    expect(kstText(Date.UTC(2029, 11, 31, 15, 0))).toBe('2030-01-01T00:00');
    // 적은 글자는 다시 읽을 수 있는 모양이다.
    expect(isValidYmdHm(kstText(Date.UTC(2030, 0, 2, 8, 10)))).toBe(true);
    // 날짜로 쓸 수 없는 값은 null.
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 8.64e15]) expect(kstText(bad), String(bad)).toBeNull();
    // 네 자리 해를 넘으면 모양이 달라지므로 null.
    expect(kstText(Date.UTC(9999, 11, 31, 14, 59))).toBe('9999-12-31T23:59');
    expect(kstText(Date.UTC(9999, 11, 31, 15, 0))).toBeNull();
  });

  it('같은 UTC 시각이면 기기의 시간대가 달라도 같은 한국 시간 글자가 나온다', () => {
    const at = Date.UTC(2030, 0, 2, 11, 10, 30);
    const before = process.env.TZ;
    const localHours = new Set<number>();
    try {
      for (const tz of ['UTC', 'Asia/Seoul', 'America/Los_Angeles', 'Asia/Kolkata', 'Pacific/Kiritimati']) {
        process.env.TZ = tz;
        // 시간대를 바꾼 것이 실제로 먹었는지 보려고 지역 시각을 함께 모은다(이 테스트 파일에서만 쓴다).
        localHours.add(new Date(at).getHours());
        expect(kstText(at), tz).toBe('2030-01-02T20:10');
      }
    } finally {
      if (before === undefined) delete process.env.TZ;
      else process.env.TZ = before;
    }
    expect(localHours.size).toBeGreaterThan(1);
  });

  it('dates.ts 는 기기의 시간대를 읽는 Date 메서드를 쓰지 않는다', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/logic/dates.ts'), 'utf8');
    const local =
      /\.(?:get|set)(?:FullYear|Year|Month|Date|Day|Hours|Minutes|Seconds|Milliseconds)\(|getTimezoneOffset|toLocale\w*String|toDateString|toTimeString|Date\.parse\(|new Date\([^)]*,/;
    expect(src).not.toMatch(local);
    // 쓰는 것은 UTC 로 읽는 메서드뿐이다.
    expect(src).toContain('toISOString');
  });
});
