import { existsSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 자료 폴더(기본 exam-data, 작업 지시서 3의 6-1)를 읽고 쓰는 곳.
// - src/: 발행할 시험 파일의 원본. 사람이 고친다. 도구는 이 폴더의 *.json 만 읽는다. 파일 이름은 시험 id 에 .json 을 붙인 것이다.
// - locks.json: 풀이 잠금 달력의 원본.
// - state.json: 마지막으로 발행한 내용의 기록(scripts/exams/state.ts).

export const SRC_DIR = 'src';
export const LOCKS_FILE = 'locks.json';
export const STATE_FILE = 'state.json';

/**
 * 발행할 시험의 id 모양: 영어 소문자와 숫자를 붙임표(-) 하나로 이은 것(형식 예시: test-only-exam).
 * id 는 원본 파일 이름(src/<id>.json)과 발행 파일 이름, 주소에 들어가서, 운영체제와 주소에서 뜻이 바뀌지 않는 글자만 받는다.
 * 앱의 시험 파일 검사(src/exams/validate.ts)는 id 모양을 보지 않는다. 이것은 발행 도구만의 규칙이다.
 */
export const EXAM_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** 원본 시험 파일의 경로. */
export function examPath(dataDir: string, id: string): string {
  return join(dataDir, SRC_DIR, `${id}.json`);
}

/** 읽은 JSON 파일. 읽지 못했으면 error 에 이유가 있고 value 는 undefined 다. */
export interface JsonFile {
  path: string;
  /** 출력에 쓰는 이름(자료 폴더 기준 경로 같은 것). */
  name: string;
  exists: boolean;
  value: unknown;
  error: string | null;
}

/** JSON 파일을 읽는다. 맨 앞의 BOM 은 건너뛴다. 던지지 않고, 읽지 못한 이유를 한국어로 돌려준다. */
export function readJsonFile(path: string, name: string): JsonFile {
  if (!existsSync(path)) return { path, name, exists: false, value: undefined, error: `${name}: 파일이 없어요.` };
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return { path, name, exists: true, value: undefined, error: `${name}: 파일을 읽지 못했어요.` };
  }
  return parseJsonText(text, path, name);
}

/** JSON 글자를 읽는다. 맨 앞의 BOM 은 건너뛴다. */
export function parseJsonText(text: string, path: string, name: string): JsonFile {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  try {
    return { path, name, exists: true, value: JSON.parse(body), error: null };
  } catch (e) {
    return { path, name, exists: true, value: undefined, error: `${name}: JSON 으로 읽지 못했어요${jsonErrorPlace(body, e)}.` };
  }
}

/** JSON.parse 오류에서 자리(줄과 글자)를 찾아 "(3번째 줄 5번째 글자 근처)"로 적는다. 찾지 못하면 빈 글자. 오류 원문(영어)은 쓰지 않는다. */
function jsonErrorPlace(text: string, e: unknown): string {
  const message = e instanceof Error ? e.message : '';
  const lc = /line (\d+) column (\d+)/.exec(message);
  if (lc) return `(${lc[1]}번째 줄 ${lc[2]}번째 글자 근처)`;
  const pos = /position (\d+)/.exec(message);
  if (!pos) return '';
  const before = text.slice(0, Number(pos[1]));
  const line = before.split('\n').length;
  const column = before.length - before.lastIndexOf('\n');
  return `(${line}번째 줄 ${column}번째 글자 근처)`;
}

/** 앱 묶음에 든 시험 파일이 있는 폴더(저장소의 src/exams). */
export const BUNDLED_EXAMS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'exams');

/**
 * 앱 묶음에 든 시험의 id 와 파일 이름(저장소의 src/exams/*.json 가운데 잠금 달력 locks.json 을 뺀 것, 별도 검토 A2, B1).
 * 발행하는 시험은 이 id 를 쓰지 않는다. 같은 id 의 두 판은 앱에서 판 번호(rev)로만 갈려서, 학생 기기의 점수가 알림 없이 바뀌거나
 * 저장한 답이 다른 문항에 붙을 수 있다. JSON 으로 읽지 못하거나 id 가 글자가 아닌 파일은 건너뛴다.
 */
export function bundledExamIds(dir: string = BUNDLED_EXAMS_DIR): Map<string, string> {
  const out = new Map<string, string>();
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return out;
  const names = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith('.json') && d.name !== 'locks.json')
    .map((d) => d.name)
    .sort();
  for (const name of names) {
    const file = readJsonFile(join(dir, name), name);
    if (!file.error && isRecord(file.value) && typeof file.value.id === 'string' && file.value.id !== '') out.set(file.value.id, name);
  }
  return out;
}

/** src 폴더의 *.json 파일 이름을 이름 차례로 돌려준다. 폴더가 없으면 null. 다른 파일(README.md 등)과 하위 폴더는 보지 않는다. */
export function listSourceFiles(dataDir: string): string[] | null {
  const dir = join(dataDir, SRC_DIR);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return null;
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith('.json'))
    .map((d) => d.name)
    .sort();
}

/** 파일을 통째로 바꿔 쓴다. 옆에 임시 파일을 쓴 뒤 이름을 바꿔서, 쓰다가 멈춰도 반쯤 쓴 파일이 남지 않는다. */
export function writeTextFile(path: string, text: string): void {
  const temp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temp, text);
    renameSync(temp, path);
  } finally {
    rmSync(temp, { force: true });
  }
}

/**
 * 다음 차례로 칠 명령의 글자(별도 검토 D5). 위치 인자와 선택지(값이 null 이면 뺌)가 없으면 "npm run exams:<명령>" 만이고,
 * 있으면 "npm run exams:verify -- out --data data"(형식 예시)처럼 붙인다. 빈칸이나 역슬래시처럼 셸이 나눠 읽는 글자가 든 값은 큰따옴표로 감싼다.
 * 리허설처럼 --data, --out 을 준 실행에서 안내를 그대로 치면 저장소의 진짜 폴더를 보게 되는 일을 막는다.
 * 큰따옴표 안에서도 셸이 바꾸는 글자(달러, 백틱, 퍼센트, 큰따옴표)나 잇단 역슬래시 둘(Git Bash 가 하나로 줄임, 공유 폴더 경로의 앞)이 들었으면
 * 셸마다 지키는 방법이 달라서, 그대로 치지 말고 경로를 직접 넣으라는 말을 덧붙인다(별도 검토 2차 T6).
 */
export function commandHint(command: string, positional: readonly string[], options: readonly (readonly [string, string | null])[]): string {
  const quote = (v: string) => (/^[A-Za-z0-9_./:-]+$/.test(v) ? v : `"${v}"`);
  const values = [...positional, ...options.flatMap(([, value]) => (value === null ? [] : [value]))];
  const args = [...positional.map(quote), ...options.flatMap(([name, value]) => (value === null ? [] : [name, quote(value)]))];
  const hint = args.length === 0 ? `npm run exams:${command}` : `npm run exams:${command} -- ${args.join(' ')}`;
  const risky = values.some((v) => /[$`%"]/.test(v) || v.includes('\\\\'));
  return risky ? `${hint}(경로에 셸이 바꿀 수 있는 글자가 있어요. 그대로 치지 말고 경로를 셸에 맞게 직접 넣어요)` : hint;
}

/** 출력에 쓰는 경로. base 안이면 base 기준의 상대 경로(/ 로 구분), 밖이면 절대 경로다. */
export function displayPath(path: string, base: string): string {
  const rel = relative(base, path);
  if (rel === '') return '.';
  if (rel.startsWith('..') || isAbsolute(rel)) return resolve(path);
  return rel.split('\\').join('/');
}

// 원본 시험 파일의 모양. 사람이 읽고 고치기 쉬운 모양이고, 예시 시험 파일(src/exams/sample-*.json)과 같다.
// 맨 바깥 값과 그 바로 아래 칸의 객체와 배열은 여러 줄로, 그보다 깊은 값은 한 줄로 적는다. 키 차례는 받은 그대로다.

/** 값을 원본 시험 파일의 모양으로 적는다(2칸 들여쓰기, LF, 끝 줄바꿈). */
export function sourceJson(value: unknown): string {
  return `${block(value, '', 0)}\n`;
}

function isContainer(v: unknown): v is object {
  return typeof v === 'object' && v !== null;
}

function ownEntries(obj: object): [string, unknown][] {
  return Object.entries(obj).filter(([, v]) => v !== undefined && typeof v !== 'function' && typeof v !== 'symbol');
}

function block(value: unknown, indent: string, depth: number): string {
  if (!isContainer(value) || depth >= 2) return inline(value);
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return `[\n${value.map((v: unknown) => `${inner}${block(v, inner, depth + 1)}`).join(',\n')}\n${indent}]`;
  }
  const entries = ownEntries(value);
  if (entries.length === 0) return '{}';
  return `{\n${entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${block(v, inner, depth + 1)}`).join(',\n')}\n${indent}}`;
}

function inline(value: unknown): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const parts = value.map((v: unknown) => inline(v === undefined ? null : v));
    // 객체를 담은 배열은 괄호 안쪽에 빈칸을 둔다(예시 시험 파일의 coords 와 같은 모양).
    return value.some(isContainer) ? `[ ${parts.join(', ')} ]` : `[${parts.join(', ')}]`;
  }
  if (isContainer(value)) {
    const entries = ownEntries(value);
    if (entries.length === 0) return '{}';
    return `{ ${entries.map(([k, v]) => `${JSON.stringify(k)}: ${inline(v)}`).join(', ')} }`;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('JSON 에 적을 수 없는 수예요(NaN 이나 무한대).');
  return JSON.stringify(value);
}

/**
 * 객체의 키 차례를 지키며 key 에 value 를 둔 새 객체를 돌려준다(받은 객체는 고치지 않는다).
 * 이미 있는 키는 그 자리에서 값만 바꾸고, 없는 키는 after 가운데 객체에서 가장 뒤에 있는 키 바로 뒤에 넣는다(하나도 없으면 맨 끝).
 * value 가 undefined 면 키를 뺀다. "__proto__" 같은 이름도 일반 칸으로 다룬다(Object.fromEntries).
 */
export function withKey(obj: Record<string, unknown>, key: string, value: unknown, after: readonly string[]): Record<string, unknown> {
  const entries = Object.entries(obj);
  const at = entries.findIndex(([k]) => k === key);
  if (value === undefined) return Object.fromEntries(entries.filter(([k]) => k !== key));
  if (at >= 0) {
    entries[at] = [key, value];
    return Object.fromEntries(entries);
  }
  let anchor = -1;
  entries.forEach(([k], i) => {
    if (after.includes(k)) anchor = i;
  });
  const pos = anchor < 0 ? entries.length : anchor + 1;
  entries.splice(pos, 0, [key, value]);
  return Object.fromEntries(entries);
}

/** 객체인지(배열과 null 은 아님). */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
