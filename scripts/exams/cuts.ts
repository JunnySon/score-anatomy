import { validateCutGrades } from '../../src/exams/validate.ts';
import { parseAsOf, isValidYmdHm } from '../../src/logic/dates.ts';
import type { ExamCuts } from '../../src/types.ts';
import { EXAM_ID_RE, commandHint, isRecord, readJsonFile, withKey } from './data.ts';
import { EXAM_KEYS_BEFORE, bumpRevForEdit, loadEditTarget, writeEdit } from './edit.ts';
import type { Io } from './io.ts';

// exams:cuts(작업 지시서 3의 6-4): 기관별 추정 컷을 적은 입력 파일을 받아, 등급마다 가장 낮은 값과 가장 높은 값으로 범위를 만들어
// 원본 시험 파일의 cuts 를 쓴다. 등급컷을 앱이 스스로 예측하지 않는다(지시서 3장의 6). 기관이 한 곳이면 한 값([v, v])으로 쓴다.
//
// 입력 파일(JSON, 나중에 수집 도구가 그대로 만들 수 있는 모양):
//   { "format": 1, "exam": "<시험 id>", "asOf": "YYYY-MM-DDTHH:mm"(한국 시간),
//     "estimates": [ { "source": "<기관 이름>", "grades": { "1": <원점수>, "2": <원점수> } } ] }
// grades 의 키는 등급(1~9), 값은 그 기관이 추정한 원점수 컷(정수) 하나다.
// 기관마다 적은 등급이 다르면 모든 기관이 적은 등급만 쓰고, 빠진 등급을 알린다.

export const CUTS_INPUT_FORMAT = 1;

export interface CutEstimate {
  source: string;
  grades: Record<string, number>;
}

export interface CutsInput {
  exam: string;
  asOf: string;
  estimates: CutEstimate[];
}

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}

/** 입력 파일의 겉모양을 검사한다. 값의 범위와 등급 순서는 buildCuts 가 시험의 만점으로 본다. */
export function parseCutsInput(raw: unknown): { input: CutsInput | null; errors: string[] } {
  if (!isRecord(raw)) return { input: null, errors: ['입력 파일은 JSON 객체여야 해요.'] };
  const errors: string[] = [];
  if (raw.format !== CUTS_INPUT_FORMAT) errors.push(`format 은 ${CUTS_INPUT_FORMAT}이어야 해요.`);
  if (typeof raw.exam !== 'string' || !EXAM_ID_RE.test(raw.exam)) errors.push('exam 은 시험 id 여야 해요(형식 예시: test-only-exam).');
  if (!isValidYmdHm(raw.asOf)) errors.push('asOf 는 2030-01-02T20:10 같은 날짜와 시각(한국 시간)이어야 해요. 실제로 있는 값만 받아요.');
  const estimates: CutEstimate[] = [];
  if (!Array.isArray(raw.estimates) || raw.estimates.length === 0) {
    errors.push('estimates 는 기관별 추정을 담은 배열이어야 해요(한 곳 이상).');
  } else {
    const names = new Set<string>();
    raw.estimates.forEach((e: unknown, i: number) => {
      const at = `estimates ${i + 1}번째`;
      if (!isRecord(e)) {
        errors.push(`${at}: 객체가 아니에요.`);
        return;
      }
      const source = typeof e.source === 'string' ? e.source.trim() : '';
      if (source === '') {
        errors.push(`${at}: source(기관 이름)가 비어 있어요.`);
        return;
      }
      const who = `${at}(${source})`;
      if (names.has(source)) errors.push(`${who}: 기관 이름이 앞의 항목과 겹쳐요.`);
      names.add(source);
      if (!isRecord(e.grades) || Object.keys(e.grades).length === 0) {
        errors.push(`${who}: grades 는 등급별 원점수 컷을 담은 객체여야 해요(형식 예시: { "1": 88 }).`);
        return;
      }
      const bad = Object.entries(e.grades).filter(([, v]) => !isInt(v));
      if (bad.length > 0) {
        errors.push(`${who}: 컷 값은 정수 하나씩이어야 해요(${bad.map(([g]) => `${g}등급`).join(', ')}).`);
        return;
      }
      estimates.push({ source, grades: e.grades as Record<string, number> });
    });
  }
  if (errors.length > 0) return { input: null, errors };
  return { input: { exam: raw.exam as string, asOf: raw.asOf as string, estimates }, errors: [] };
}

/** 등급 이름을 작은 번호부터. 숫자가 아닌 이름은 뒤로. */
function sortGrades(names: Iterable<string>): string[] {
  return [...names].sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
}

/**
 * 기관별 추정으로 등급컷을 만든다. 기관별 값과 만든 값을 모두 validateCutGrades(만점 total)로 검사한다.
 * 값이 0보다 작거나 만점보다 크거나 높은 등급의 컷이 낮은 등급의 컷보다 낮으면 거부한다.
 * notes 는 알릴 것(모든 기관이 적지 않아 뺀 등급)이다.
 */
export function buildCuts(input: CutsInput, total: number): { cuts: ExamCuts | null; errors: string[]; notes: string[] } {
  const errors: string[] = [];
  for (const e of input.estimates) {
    const ranges = Object.fromEntries(Object.entries(e.grades).map(([g, v]) => [g, [v, v]]));
    errors.push(...validateCutGrades(ranges, total).map((msg) => `${e.source}의 추정: ${msg}`));
  }
  if (errors.length > 0) return { cuts: null, errors, notes: [] };
  const all = new Set(input.estimates.flatMap((e) => Object.keys(e.grades)));
  const common = sortGrades([...all].filter((g) => input.estimates.every((e) => Object.prototype.hasOwnProperty.call(e.grades, g))));
  const notes = sortGrades([...all].filter((g) => !common.includes(g))).map((g) => {
    const who = input.estimates.filter((e) => Object.prototype.hasOwnProperty.call(e.grades, g)).map((e) => e.source);
    return `${g}등급은 모든 기관이 적지 않아서 넣지 않았어요(적은 기관: ${who.join(', ')}).`;
  });
  if (common.length === 0) return { cuts: null, errors: ['모든 기관이 함께 적은 등급이 없어요.'], notes };
  const grades: Record<string, [number, number]> = Object.fromEntries(
    common.map((g) => {
      const values = input.estimates.map((e) => e.grades[g]);
      return [g, [Math.min(...values), Math.max(...values)]];
    }),
  );
  const found = validateCutGrades(grades, total);
  if (found.length > 0) return { cuts: null, errors: found.map((msg) => `만든 등급컷: ${msg}`), notes };
  const names = input.estimates.map((e) => e.source);
  const source = names.length === 1 ? `${names[0]}의 추정 값` : `${names.join(', ')}의 추정 가운데 가장 낮은 값과 가장 높은 값`;
  return { cuts: { source, asOf: input.asOf, confirmed: false, grades }, errors: [], notes };
}

/** 등급컷 기준을 "YYYY-MM-DDTHH:mm" 으로 견줄 수 있게 적는다. 날짜만 있으면 그날 0시로 본다. */
function asOfKey(asOf: string): string | null {
  const t = parseAsOf(asOf);
  if (t === null) return null;
  const two = (n: number) => String(n).padStart(2, '0');
  return `${String(t.y).padStart(4, '0')}-${two(t.m)}-${two(t.d)}T${two(t.time?.h ?? 0)}:${two(t.time?.mi ?? 0)}`;
}

export interface CutsOptions {
  dataDir: string;
  /** 입력 파일의 경로와 출력에 쓰는 이름. */
  file: string;
  name: string;
  /** 다음 차례 안내에 붙일 --data 의 값(기본 자료 폴더가 아닐 때만). 없으면 붙이지 않는다(별도 검토 D5). */
  dataArg?: string | null;
}

/** exams:cuts 를 돌린다. 등급컷을 썼거나 이미 같으면 0, 쓰지 않았으면 1을 돌려준다. */
export function runCuts(opts: CutsOptions, io: Io): number {
  const fail = (messages: readonly string[]) => {
    for (const m of messages) io.err(m);
    io.err('아무것도 쓰지 않았어요.');
    return 1;
  };
  const file = readJsonFile(opts.file, opts.name);
  if (file.error) return fail([file.error]);
  const parsed = parseCutsInput(file.value);
  if (parsed.input === null) return fail(parsed.errors.map((e) => `${opts.name}: ${e}`));
  const input = parsed.input;

  const loaded = loadEditTarget(opts.dataDir, input.exam);
  if (loaded.target === null) return fail(loaded.errors);
  const target = loaded.target;
  const current = target.exam.cuts;
  if (current?.confirmed === true) {
    return fail([`${target.label}: 지금 등급컷이 주관 기관이 발표한 컷(confirmed true)이라 추정 컷으로 바꾸지 않아요.`]);
  }
  const currentKey = current ? asOfKey(current.asOf) : null;
  if (currentKey !== null && input.asOf < currentKey) {
    return fail([`${target.label}: 지금 등급컷의 기준(${current?.asOf})이 입력 파일의 시각(${input.asOf})보다 늦어요. 더 새 자료로만 바꿔요.`]);
  }

  const total = target.exam.items.reduce((sum, it) => sum + it.points, 0);
  const built = buildCuts(input, total);
  if (built.cuts === null) return fail([...built.errors.map((e) => `${opts.name}: ${e}`), ...built.notes]);
  const cuts = built.cuts;

  let next = withKey(target.raw, 'cuts', { source: cuts.source, asOf: cuts.asOf, confirmed: cuts.confirmed, grades: cuts.grades }, EXAM_KEYS_BEFORE.cuts);
  const bumped = bumpRevForEdit(next, target.prev);
  next = bumped.raw;
  const result = writeEdit(target, next);
  if (result.errors.length > 0) return fail(result.errors);
  if (!result.written) {
    io.out(`${target.label} 에는 이미 이 등급컷이 들어 있어요. 파일을 그대로 뒀어요.`);
    return 0;
  }
  const names = input.estimates.map((e) => e.source);
  io.out(`${target.label} 의 등급컷을 썼어요. 추정(confirmed false), 기준 ${cuts.asOf}, 기관 ${names.length}곳(${names.join(', ')}).`);
  for (const [g, [lo, hi]] of Object.entries(cuts.grades)) io.out(lo === hi ? `  ${g}등급 컷 ${lo}점` : `  ${g}등급 컷 ${lo}~${hi}점`);
  for (const n of built.notes) io.out(`  ${n}`);
  if (bumped.note) io.out(`  ${bumped.note}`);
  io.out(`다음 차례: ${commandHint('check', [], [['--data', opts.dataArg ?? null]])} 로 검사해요.`);
  return 0;
}
