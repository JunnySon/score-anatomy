import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateExam } from '../../src/exams/validate.ts';
import { checkData } from './check.ts';
import { buildCuts, parseCutsInput, runCuts } from './cuts.ts';
import { collectIo, makeDataDir, markPublished, readExam, releasedExam, removeDir, runTool, testExam, writeExam } from './testkit.ts';

// exams:cuts(작업 지시서 3의 6-4): 기관별 추정 컷으로 등급마다 가장 낮은 값과 가장 높은 값의 범위를 만들어 cuts 를 쓴다.
// 기관 이름은 '기관 가', '기관 나', 컷 값은 만점 20점인 테스트 전용 시험(testkit.ts)에 맞춰 그 자리에서 지은 값이다.

const dirs: string[] = [];
function dataDir(): string {
  const dir = makeDataDir();
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) removeDir(dir);
});

type Estimate = { source: string; grades: Record<string, number> };

function input(estimates: Estimate[], over: Record<string, unknown> = {}): Record<string, unknown> {
  return { format: 1, exam: 'test-tool-a', asOf: '2030-01-02T20:10', estimates, ...over };
}

const GA: Estimate = { source: '기관 가', grades: { 1: 19, 2: 16, 3: 12 } };
const NA: Estimate = { source: '기관 나', grades: { 1: 18, 2: 16, 3: 11 } };

/** 입력 파일을 자료 폴더 안에 쓰고 명령을 돌린다. */
function cuts(dir: string, raw: unknown) {
  const file = join(dir, 'cuts-input.json');
  writeFileSync(file, `${JSON.stringify(raw, null, 2)}\n`);
  const c = collectIo();
  const code = runCuts({ dataDir: dir, file, name: 'cuts-input.json' }, c.io);
  return { code, out: c.out, err: c.err, file };
}

describe('발행 도구 exams:cuts(작업 지시서 3의 6-4)', () => {
  it('기관이 둘 이상이면 등급마다 가장 낮은 값과 가장 높은 값으로 범위를 쓴다(source, asOf, confirmed false)', () => {
    const dir = dataDir();
    writeExam(dir, releasedExam());
    const r = cuts(dir, input([GA, NA]));
    expect(r.err).toEqual([]);
    expect(r.code).toBe(0);
    const exam = readExam(dir);
    expect(exam.cuts).toEqual({
      source: '기관 가, 기관 나의 추정 가운데 가장 낮은 값과 가장 높은 값',
      asOf: '2030-01-02T20:10',
      confirmed: false,
      grades: { 1: [18, 19], 2: [16, 16], 3: [11, 12] },
    });
    // cuts 는 items 와 types 사이(예시 시험 파일과 같은 자리)에 들어가고, 시험 파일은 검사를 통과한다.
    expect(Object.keys(exam)).toEqual(['id', 'title', 'note', 'isSample', 'isPast', 'answerReleased', 'rev', 'items', 'cuts', 'types']);
    expect(validateExam(exam)).toEqual([]);
    expect(r.out).toEqual([
      'src/test-tool-a.json 의 등급컷을 썼어요. 추정(confirmed false), 기준 2030-01-02T20:10, 기관 2곳(기관 가, 기관 나).',
      '  1등급 컷 18~19점',
      '  2등급 컷 16점',
      '  3등급 컷 11~12점',
      '다음 차례: npm run exams:check 로 검사해요.',
    ]);
  });

  it('기관이 한 곳이면 한 값([v, v])으로 쓴다', () => {
    const dir = dataDir();
    writeExam(dir, releasedExam());
    expect(cuts(dir, input([GA])).code).toBe(0);
    expect(readExam(dir).cuts).toEqual({ source: '기관 가의 추정 값', asOf: '2030-01-02T20:10', confirmed: false, grades: { 1: [19, 19], 2: [16, 16], 3: [12, 12] } });
  });

  const REJECT: { name: string; raw: unknown; cuts?: Record<string, unknown>; expected: string }[] = [
    { name: '값이 0보다 작음', raw: input([GA, { source: '기관 나', grades: { 1: 18, 2: 16, 3: -1 } }]), expected: '기관 나의 추정: cuts.grades 3등급의 값은 0점부터 만점(20점)까지여야 해요.' },
    { name: '값이 만점보다 큼', raw: input([{ source: '기관 가', grades: { 1: 21, 2: 16 } }]), expected: '기관 가의 추정: cuts.grades 1등급의 값은 0점부터 만점(20점)까지여야 해요.' },
    { name: '높은 등급의 컷이 낮은 등급의 컷보다 낮음', raw: input([GA, { source: '기관 나', grades: { 1: 15, 2: 16 } }]), expected: '기관 나의 추정: cuts.grades 1등급 컷이 2등급 컷보다 낮아요.' },
    {
      name: '지금 컷이 confirmed true',
      raw: input([GA]),
      cuts: { source: '예시 값', asOf: '2030-01-02', confirmed: true, grades: { 1: [18, 18] } },
      expected: '지금 등급컷이 주관 기관이 발표한 컷(confirmed true)이라 추정 컷으로 바꾸지 않아요.',
    },
    { name: '기관 이름이 겹침', raw: input([GA, { ...NA, source: ' 기관 가 ' }]), expected: 'estimates 2번째(기관 가): 기관 이름이 앞의 항목과 겹쳐요.' },
    {
      name: '입력 파일의 시각이 지금 컷의 기준보다 앞섬',
      raw: input([GA], { asOf: '2030-01-02T17:10' }),
      cuts: { source: '기관 가의 추정 값', asOf: '2030-01-02T20:10', confirmed: false, grades: { 1: [19, 19] } },
      expected: '지금 등급컷의 기준(2030-01-02T20:10)이 입력 파일의 시각(2030-01-02T17:10)보다 늦어요.',
    },
    { name: '컷 값이 정수가 아님', raw: input([{ source: '기관 가', grades: { 1: 18.5 } }]), expected: 'estimates 1번째(기관 가): 컷 값은 정수 하나씩이어야 해요(1등급).' },
    { name: 'asOf 에 시각이 없음', raw: input([GA], { asOf: '2030-01-02' }), expected: 'asOf 는 2030-01-02T20:10 같은 날짜와 시각(한국 시간)이어야 해요.' },
  ];

  it.each(REJECT.map((c) => [c.name, c] as const))('거부한다: %s(원본 파일은 바이트 그대로)', (_name, { raw, cuts: current, expected }) => {
    const dir = dataDir();
    const path = writeExam(dir, releasedExam(current ? { cuts: current } : {}));
    const before = readFileSync(path);
    const r = cuts(dir, raw);
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toContain(expected);
    expect(r.err[r.err.length - 1]).toBe('아무것도 쓰지 않았어요.');
    expect(r.out).toEqual([]);
    expect(readFileSync(path).equals(before)).toBe(true);
  });

  it('기관마다 적은 등급이 다르면 모든 기관이 적은 등급만 쓰고 빠진 등급을 알린다', () => {
    const built = buildCuts({ exam: 'test-tool-a', asOf: '2030-01-02T20:10', estimates: [{ ...GA, grades: { ...GA.grades, 4: 9 } }, { source: '기관 나', grades: { 1: 18, 2: 16 } }] }, 20);
    expect(built.errors).toEqual([]);
    expect(built.cuts?.grades).toEqual({ 1: [18, 19], 2: [16, 16] });
    expect(built.notes).toEqual(['3등급은 모든 기관이 적지 않아서 넣지 않았어요(적은 기관: 기관 가).', '4등급은 모든 기관이 적지 않아서 넣지 않았어요(적은 기관: 기관 가).']);
    const none = buildCuts({ exam: 'test-tool-a', asOf: '2030-01-02T20:10', estimates: [{ source: '기관 가', grades: { 1: 19 } }, { source: '기관 나', grades: { 2: 16 } }] }, 20);
    expect(none.cuts).toBeNull();
    expect(none.errors).toEqual(['모든 기관이 함께 적은 등급이 없어요.']);
  });

  it('입력 파일의 겉모양을 검사한다(format, exam, asOf, estimates)', () => {
    expect(parseCutsInput([]).errors).toEqual(['입력 파일은 JSON 객체여야 해요.']);
    expect(parseCutsInput({ format: 2, exam: '../x', asOf: '2030-01-02T24:00', estimates: [] }).errors).toEqual([
      'format 은 1이어야 해요.',
      'exam 은 시험 id 여야 해요(형식 예시: test-only-exam).',
      'asOf 는 2030-01-02T20:10 같은 날짜와 시각(한국 시간)이어야 해요. 실제로 있는 값만 받아요.',
      'estimates 는 기관별 추정을 담은 배열이어야 해요(한 곳 이상).',
    ]);
    expect(parseCutsInput(input([{ source: '', grades: { 1: 18 } }])).errors).toEqual(['estimates 1번째: source(기관 이름)가 비어 있어요.']);
  });

  it('발행한 시험의 컷을 쓰면 판 번호를 올리고 exams:check 를 통과한다(실제 Node 실행)', () => {
    const dir = dataDir();
    writeExam(dir, releasedExam());
    markPublished(dir, [releasedExam()]);
    const file = join(dir, 'cuts-input.json');
    writeFileSync(file, `${JSON.stringify(input([GA, NA]), null, 2)}\n`);
    const run = runTool(['cuts', file, '--data', dir]);
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('  rev 를 1에서 2로 올렸어요(발행한 판과 내용이 달라서).');
    expect(readExam(dir).rev).toBe(2);
    const report = checkData(dir);
    expect(report.errors).toEqual([]);
    expect(report.lines).toContain('  등급컷을 처음 넣어요(추정, 기준 2030-01-02T20:10, 등급 3개).');
    // 정답 공개 전 시험에도 컷을 넣을 수 있다(순서는 사람이 정한다).
    const early = dataDir();
    writeExam(early, testExam());
    expect(cuts(early, input([GA])).code).toBe(0);
  });
});
