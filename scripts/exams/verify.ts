import type { KeyObject } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { revOf, validateExam, validateLocks } from '../../src/exams/validate.ts';
import { isValidYmdHm } from '../../src/logic/dates.ts';
import type { Exam } from '../../src/types.ts';
import { sha256Hex } from './canonical.ts';
import { STATE_FILE, isRecord, readJsonFile } from './data.ts';
import type { Io } from './io.ts';
import { INDEX_FILE, RELEASE_FORMAT, SIG_FILE } from './release.ts';
import type { ReleaseEntry } from './release.ts';
import { checkSignature, isTestOnlyKey, keyFingerprint, parsePublicKeyText } from './sign.ts';
import { parseState } from './state.ts';

// exams:verify(작업 지시서 3의 6-2, 6-4): 발행 폴더나 http(s) 주소의 발행물을 공개 키로 확인한다. 발행 직후와 올린 뒤에 쓴다.
// 받은 바이트 그대로 본다(다시 직렬화하지 않음): index.json.sig 로 서명 확인, format 이 1, seq 가 1 이상의 정수, issuedAt 모양,
// 시험 파일 경로가 안전한지, 시험 파일마다 sha256, 그 시험이 src/exams/validate.ts 의 검사를 통과하고 id 와 rev 가 목록과 같은지,
// 잠금 달력이 validateLocks 를 통과하는지. 하나라도 틀리면 이유와 함께 실패한다. 서명이 맞지 않으면 다른 것은 보지 않는다.
// 주소에서 받을 때는 캐시를 쓰지 않고(cache 'no-store' 와 Cache-Control: no-cache), 파일마다 제한 시간을 두고,
// 다른 주소로 넘기는 응답은 따라가지 않는다. 주소에 기기나 사용자를 가리키는 값(쿼리, 쿠키, 계정)을 붙이지 않는다.

/** 주소에서 파일 하나를 받을 때의 제한 시간. */
export const VERIFY_TIMEOUT_MS = 15000;

/** 발행물 안 파일 하나로 받는 가장 큰 크기. 시험 파일은 수십 KB 안쪽이다. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

/**
 * 발행물 안 시험 파일의 경로로 받는 모양: index.json 이 있는 곳 기준의 상대 경로이고 / 로 나눈 조각마다
 * 영어 글자, 숫자, 밑줄, 붙임표로 시작하고 그 뒤에는 점도 올 수 있다. 그래서 '..', '.', 숨은 파일, 절대 경로, 역슬래시, 드라이브 글자,
 * 퍼센트 인코딩, 빈 조각은 받지 않는다. 발행 도구가 만드는 경로(files/<id>.<rev>.json)는 늘 이 모양이다.
 */
export const SAFE_PATH_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]*(?:\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*$/;
const MAX_PATH_LENGTH = 200;
const SHA256_RE = /^[0-9a-f]{64}$/;

/** 파일 하나를 읽거나 받은 결과. 읽지 못했으면 bytes 가 null 이고 error 에 이유가 있다. */
export interface Fetched {
  bytes: Uint8Array | null;
  error: string | null;
}

/** 엄격한 UTF-8 로 읽는다. UTF-8 이 아니면 null. 맨 앞의 BOM 은 지우지 않아서 JSON 으로 읽을 때 걸린다. */
function utf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** 시험 파일 경로가 안전한지. 안전하지 않으면 이유를 돌려준다. */
export function unsafePathReason(file: unknown): string | null {
  if (typeof file !== 'string' || file === '') return 'file 이 비어 있어요.';
  if (file.length > MAX_PATH_LENGTH || !SAFE_PATH_RE.test(file) || file === INDEX_FILE || file === SIG_FILE) {
    return `file 은 index.json 이 있는 곳 기준의 안전한 상대 경로여야 해요('..', 절대 경로, 역슬래시, 숨은 파일, 영어 글자와 숫자와 . _ - / 밖의 글자는 받지 않아요).`;
  }
  return null;
}

/** index.json 과 서명을 확인한 결과. entries 는 경로가 안전해서 이어서 받아 확인할 시험 파일이다. */
export interface IndexCheck {
  /** 서명이 맞았는지. 맞지 않으면 index.json 의 내용은 보지 않는다. */
  signed: boolean;
  seq: number | null;
  issuedAt: string | null;
  examCount: number | null;
  lockCount: number | null;
  entries: ReleaseEntry[];
  errors: string[];
}

/** index.json 과 index.json.sig 를 받은 바이트 그대로 확인한다. */
export function checkIndex(index: Fetched, sig: Fetched, publicKey: KeyObject): IndexCheck {
  const out: IndexCheck = { signed: false, seq: null, issuedAt: null, examCount: null, lockCount: null, entries: [], errors: [] };
  if (index.bytes === null) out.errors.push(`${INDEX_FILE}: ${index.error ?? '읽지 못했어요.'}`);
  if (sig.bytes === null) out.errors.push(`${SIG_FILE}: ${sig.error ?? '읽지 못했어요.'}`);
  if (index.bytes === null || sig.bytes === null) return out;

  const signature = checkSignature(index.bytes, utf8(sig.bytes) ?? '', publicKey);
  if (!signature.ok) {
    out.errors.push(signature.error ?? '서명이 맞지 않아요.');
    return out;
  }
  out.signed = true;

  const text = utf8(index.bytes);
  let raw: unknown;
  try {
    raw = text === null ? undefined : JSON.parse(text);
  } catch {
    raw = undefined;
  }
  if (!isRecord(raw)) {
    out.errors.push(`${INDEX_FILE}: JSON 객체로 읽지 못했어요(UTF-8 글자의 JSON 객체여야 해요).`);
    return out;
  }
  if (raw.format !== RELEASE_FORMAT) {
    out.errors.push(`${INDEX_FILE}: format 이 아는 값(${RELEASE_FORMAT})이 아니에요.`);
    return out;
  }
  if (typeof raw.seq === 'number' && Number.isSafeInteger(raw.seq) && raw.seq >= 1) out.seq = raw.seq;
  else out.errors.push(`${INDEX_FILE}: seq 는 1 이상의 정수여야 해요.`);
  if (isValidYmdHm(raw.issuedAt)) out.issuedAt = raw.issuedAt as string;
  else out.errors.push(`${INDEX_FILE}: issuedAt 은 2030-01-02T17:10 같은, 실제로 있는 날짜와 시각(한국 시간)이어야 해요.`);
  const lockErrors = validateLocks(raw.locks);
  if (lockErrors.length > 0) out.errors.push(...lockErrors.map((e) => `${INDEX_FILE} 의 잠금 달력(locks): ${e}`));
  else out.lockCount = (raw.locks as unknown[]).length;

  if (!Array.isArray(raw.exams)) {
    out.errors.push(`${INDEX_FILE}: exams 는 시험 목록의 배열이어야 해요.`);
    return out;
  }
  out.examCount = raw.exams.length;
  const ids = new Set<string>();
  const files = new Set<string>();
  raw.exams.forEach((e: unknown, i: number) => {
    const at = `${INDEX_FILE} 의 exams ${i + 1}번째`;
    if (!isRecord(e)) {
      out.errors.push(`${at}: 객체가 아니에요.`);
      return;
    }
    const problems: string[] = [];
    if (typeof e.id !== 'string' || e.id.trim() === '') problems.push('id 가 비어 있어요.');
    else if (ids.has(e.id)) problems.push(`id 가 앞의 항목과 겹쳐요(${e.id}).`);
    if (typeof e.rev !== 'number' || !Number.isSafeInteger(e.rev) || e.rev < 1) problems.push('rev 는 1 이상의 정수여야 해요.');
    const unsafe = unsafePathReason(e.file);
    if (unsafe !== null) problems.push(unsafe);
    else if (files.has(e.file as string)) problems.push(`file 이 앞의 항목과 겹쳐요(${e.file as string}).`);
    if (typeof e.sha256 !== 'string' || !SHA256_RE.test(e.sha256)) problems.push('sha256 은 SHA-256(16진수 소문자 64자)이어야 해요.');
    if (typeof e.id === 'string') ids.add(e.id);
    if (unsafe === null) files.add(e.file as string);
    if (problems.length > 0) {
      out.errors.push(...problems.map((p) => `${at}: ${p}`));
      return;
    }
    out.entries.push({ id: e.id as string, rev: e.rev as number, file: e.file as string, sha256: e.sha256 as string });
  });
  return out;
}

/** 시험 파일 하나를 확인한다: sha256, 시험 파일 검사(src/exams/validate.ts), id 와 rev 가 목록과 같은지. 틀린 곳이 없으면 빈 배열. */
export function checkExamFile(entry: ReleaseEntry, file: Fetched): string[] {
  const at = `${entry.file}(${entry.id})`;
  if (file.bytes === null) return [`${at}: ${file.error ?? '읽지 못했어요.'}`];
  if (sha256Hex(file.bytes) !== entry.sha256) return [`${at}: sha256 이 index.json 에 적힌 값과 달라요. 파일이 바뀌었거나 다른 파일이에요.`];
  const text = utf8(file.bytes);
  let raw: unknown;
  try {
    raw = text === null ? undefined : JSON.parse(text);
  } catch {
    raw = undefined;
  }
  if (raw === undefined) return [`${at}: JSON 으로 읽지 못했어요.`];
  const found = validateExam(raw);
  if (found.length > 0) return found.map((e) => `${at}: 시험 파일 검사를 통과하지 못했어요: ${e}`);
  const exam = raw as Exam;
  const errors: string[] = [];
  if (exam.id !== entry.id) errors.push(`${at}: 파일 안의 id(${exam.id})가 index.json 의 id 와 달라요.`);
  if (revOf(exam) !== entry.rev) errors.push(`${at}: 파일 안의 rev(${revOf(exam)})가 index.json 의 rev(${entry.rev})와 달라요.`);
  return errors;
}

/** 확인 결과. lines 는 사람이 읽을 요약, errors 는 실패 이유, warnings 는 알림이다. */
export interface VerifyResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  lines: string[];
  seq: number | null;
  issuedAt: string | null;
  entries: ReleaseEntry[];
}

/** index.json 의 확인 결과와 받은 시험 파일로 결과를 만든다. */
export function finishVerify(head: IndexCheck, files: ReadonlyMap<string, Fetched>): VerifyResult {
  const errors = [...head.errors];
  const lines: string[] = [];
  if (head.signed) {
    lines.push(`서명이 맞아요(${SIG_FILE}).`);
    const parts = [
      `seq ${head.seq ?? '틀림'}`,
      `issuedAt ${head.issuedAt === null ? '틀림' : `${head.issuedAt}(한국 시간)`}`,
      `시험 ${head.examCount ?? '틀림'}${head.examCount === null ? '' : '개'}`,
      `잠금 달력 항목 ${head.lockCount ?? '틀림'}${head.lockCount === null ? '' : '개'}`,
    ];
    lines.push(`${parts.join(', ')}.`);
  }
  for (const entry of head.entries) {
    const found = checkExamFile(entry, files.get(entry.file) ?? { bytes: null, error: '받지 않았어요.' });
    errors.push(...found);
    lines.push(`  ${entry.id}: rev ${entry.rev}, sha256 ${entry.sha256.slice(0, 12)}, ${entry.file}, ${found.length === 0 ? '맞아요' : '맞지 않아요'}.`);
  }
  return { ok: errors.length === 0, errors, warnings: [], lines, seq: head.seq, issuedAt: head.issuedAt, entries: head.entries };
}

/** 폴더 안 파일 하나를 읽는다. path 는 / 로 나눈 상대 경로다. */
export function readLocal(dir: string, path: string): Fetched {
  const full = join(dir, ...path.split('/'));
  try {
    const st = statSync(full);
    if (!st.isFile()) return { bytes: null, error: '파일이 아니에요.' };
    if (st.size > MAX_FILE_BYTES) return { bytes: null, error: '파일이 너무 커요.' };
    return { bytes: readFileSync(full), error: null };
  } catch (e) {
    return { bytes: null, error: (e as { code?: unknown }).code === 'ENOENT' ? '파일이 없어요.' : '파일을 읽지 못했어요.' };
  }
}

/** 폴더 안의 모든 파일(하위 폴더 포함)을 / 로 나눈 상대 경로로. */
function listFiles(dir: string): string[] {
  const out: string[] = [];
  const visit = (d: string) => {
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, ent.name);
      if (ent.isDirectory()) visit(full);
      else out.push(relative(dir, full).split('\\').join('/'));
    }
  };
  visit(dir);
  return out.sort();
}

/** 발행 폴더를 확인한다. 목록에 없는 파일이 있으면 알린다(올릴 때 함께 올라가서). */
export function verifyFolder(dir: string, publicKey: KeyObject): VerifyResult {
  const head = checkIndex(readLocal(dir, INDEX_FILE), readLocal(dir, SIG_FILE), publicKey);
  const files = new Map(head.entries.map((e) => [e.file, readLocal(dir, e.file)] as const));
  const result = finishVerify(head, files);
  if (head.signed) {
    const listed = new Set([INDEX_FILE, SIG_FILE, ...head.entries.map((e) => e.file)]);
    for (const f of listFiles(dir)) {
      if (!listed.has(f)) result.warnings.push(`${f}: index.json 의 목록에 없는 파일이에요. 발행 폴더를 통째로 올리면 함께 올라가요.`);
    }
  }
  return result;
}

/** 주소에서 파일 하나를 받는다. 캐시를 쓰지 않고, 제한 시간을 두고, 다른 주소로 넘기는 응답은 따라가지 않는다. */
export async function fetchBytes(url: URL, timeoutMs: number): Promise<Fetched> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' },
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status !== 200) {
      await res.body?.cancel().catch(() => undefined);
      const moved = res.status >= 300 && res.status < 400 ? ' 다른 주소로 넘기는 응답은 따라가지 않아요. 정해진 주소를 그대로 줘요.' : '';
      return { bytes: null, error: `받지 못했어요(HTTP 상태 ${res.status}).${moved}` };
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > MAX_FILE_BYTES) return { bytes: null, error: '파일이 너무 커요.' };
    return { bytes, error: null };
  } catch (e) {
    const name = e instanceof Error || e instanceof DOMException ? e.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') return { bytes: null, error: `제한 시간(${timeoutMs / 1000}초) 안에 받지 못했어요.` };
    const code = (e as { cause?: { code?: unknown } }).cause?.code;
    return { bytes: null, error: `받지 못했어요(연결 오류${typeof code === 'string' ? ` ${code}` : ''}).` };
  }
}

/** 주소의 발행물을 확인한다. base 는 index.json 이 있는 곳(끝이 / 인 주소)이다. */
export async function verifyUrl(base: URL, publicKey: KeyObject, timeoutMs: number = VERIFY_TIMEOUT_MS): Promise<VerifyResult> {
  const get = (path: string) => fetchBytes(new URL(path, base), timeoutMs);
  const index = await get(INDEX_FILE);
  const sig = await get(SIG_FILE);
  const head = checkIndex(index, sig, publicKey);
  const files = new Map<string, Fetched>();
  for (const entry of head.entries) files.set(entry.file, await get(entry.file));
  return finishVerify(head, files);
}

/** 확인할 곳: 발행 폴더나 http(s) 주소. */
export type VerifyTarget = { kind: 'folder'; path: string } | { kind: 'url'; url: URL };

/**
 * 명령의 인자를 확인할 곳으로 읽는다. "http://" 나 "https://" 로 시작하면 주소, 아니면 폴더(base 기준)다.
 * 주소의 끝이 /index.json 이면 그 폴더로 보고, 끝이 / 가 아니면 붙인다. 계정, 쿼리(?), 조각(#)이 든 주소는 받지 않는다.
 */
export function parseTarget(arg: string, base: string): { target: VerifyTarget | null; error: string | null } {
  if (!/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(arg)) return { target: { kind: 'folder', path: resolve(base, arg) }, error: null };
  let url: URL;
  try {
    url = new URL(arg);
  } catch {
    return { target: null, error: `주소를 읽지 못했어요: ${arg}` };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { target: null, error: '주소는 http:// 나 https:// 로 시작해야 해요.' };
  if (url.username !== '' || url.password !== '') return { target: null, error: '주소에 사용자 이름이나 암호를 넣지 않아요.' };
  if (url.search !== '' || url.hash !== '') return { target: null, error: '주소에 ? 나 # 뒤의 값을 붙이지 않아요. 발행물이 있는 폴더의 주소만 줘요.' };
  if (url.pathname.endsWith(`/${INDEX_FILE}`)) url.pathname = url.pathname.slice(0, -INDEX_FILE.length);
  else if (!url.pathname.endsWith('/')) url.pathname = `${url.pathname}/`;
  return { target: { kind: 'url', url }, error: null };
}

export interface VerifyOptions {
  target: VerifyTarget;
  /** 출력에 쓰는 이름(폴더 경로나 주소). */
  targetName: string;
  /** 공개 키 파일과 출력에 쓰는 이름. */
  keyFile: string;
  keyName: string;
  /**
   * 자료 폴더. state.json 의 마지막 발행과 견준다. 폴더를 확인할 때 다르면 알리고, 주소를 확인할 때(올린 뒤) 다르면 실패로 본다.
   */
  dataDir: string;
  timeoutMs?: number;
}

/**
 * 발행물이 자료 폴더의 마지막 발행(state.json)과 같은지 견준 결과. 견주지 않았으면(state.json 이 없음, 발행한 적이 없음, seq 를 읽지 못함)
 * lines, warnings 가 비고 differs 가 null 이다. 다르면 warnings 에 폴더 확인의 알림을, differs 에 주소 확인(올린 뒤)의 실패 이유를 둔다.
 */
interface StateCompare {
  lines: string[];
  warnings: string[];
  differs: string | null;
}

/** 발행물이 자료 폴더의 마지막 발행(state.json)과 같은지 견준다. */
function compareWithState(dataDir: string, result: VerifyResult): StateCompare {
  const none: StateCompare = { lines: [], warnings: [], differs: null };
  const file = readJsonFile(join(dataDir, STATE_FILE), STATE_FILE);
  if (file.error) return none;
  const state = parseState(file.value).state;
  if (state === null || state.seq === 0 || result.seq === null) return none;
  const last = `자료 폴더의 마지막 발행(seq ${state.seq}, issuedAt ${state.issuedAt ?? '없음'})`;
  const here = `주소의 발행물(seq ${result.seq}, issuedAt ${result.issuedAt ?? '틀림'})`;
  if (result.seq !== state.seq || result.issuedAt !== state.issuedAt) {
    let differs: string;
    if (result.seq > state.seq) {
      differs = `${here}이 ${last}보다 새로워요. 자료 폴더가 최신이 아닐 수 있어요. git pull 로 자료 폴더를 받은 뒤 다시 확인하고, 그 전에는 발행하지 않아요.`;
    } else if (result.seq < state.seq) {
      differs = `${here}이 ${last}보다 예전 것이에요. 새 발행물이 아직 올라가지 않았거나 캐시가 남아 있을 수 있어요. 올리기를 마친 뒤 다시 확인해요.`;
    } else {
      differs = `${here}은 seq 가 ${last}과 같은데 issuedAt 이 달라요. 다른 자료 폴더에서 같은 seq 로 발행했을 수 있어요.`;
    }
    return {
      lines: [],
      warnings: [`이 발행물(seq ${result.seq}, issuedAt ${result.issuedAt ?? '틀림'})은 ${last}과 달라요. 올린 뒤라면 새 발행물이 아직 올라가지 않았거나 캐시가 남아 있을 수 있어요.`],
      differs,
    };
  }
  const ids = Object.keys(state.exams).sort();
  const same =
    ids.length === result.entries.length &&
    result.entries.every((e) => Object.prototype.hasOwnProperty.call(state.exams, e.id) && state.exams[e.id].sha256 === e.sha256 && state.exams[e.id].file === e.file);
  if (!same) {
    return {
      lines: [],
      warnings: [`seq 는 ${last}과 같은데 시험 목록이나 시험 파일의 SHA-256 이 state.json 과 달라요.`],
      differs: `${here}은 seq 와 issuedAt 이 ${last}과 같은데 시험 목록이나 시험 파일의 SHA-256 이 state.json 과 달라요. 다른 자료 폴더에서 같은 seq 로 발행했을 수 있어요.`,
    };
  }
  return { lines: [`${last}과 같아요.`], warnings: [], differs: null };
}

/** exams:verify 를 돌린다. 발행물이 맞으면 0, 맞지 않거나 확인하지 못했으면 1을 돌려준다. */
export async function runVerify(opts: VerifyOptions, io: Io): Promise<number> {
  const fail = (messages: readonly string[]) => {
    for (const m of messages) io.err(m);
    return 1;
  };
  io.out(`발행물을 확인해요: ${opts.targetName}`);
  if (!existsSync(opts.keyFile)) {
    return fail([
      `공개 키 파일이 없어요(${opts.keyName}). 진짜 공개 키는 키를 맡은 사람이 npm run exams:keygen 으로 만들어 자료 폴더에 둬요. 다른 공개 키로 확인하려면 --key <공개 키 파일> 을 줘요.`,
      '확인하지 못했어요.',
    ]);
  }
  let keyText: string;
  try {
    keyText = readFileSync(opts.keyFile, 'utf8');
  } catch {
    return fail([`공개 키 파일을 읽지 못했어요(${opts.keyName}).`, '확인하지 못했어요.']);
  }
  const parsed = parsePublicKeyText(keyText);
  if (parsed.key === null) return fail([`${opts.keyName}: ${parsed.error ?? '공개 키로 읽지 못했어요.'}`, '확인하지 못했어요.']);
  io.out(`공개 키: ${opts.keyName}(지문 ${keyFingerprint(parsed.key)}).`);
  if (isTestOnlyKey(parsed.key)) io.out('  이 공개 키는 테스트 전용 키예요(exam-data/testdata, 작업 지시서 3의 6-5). 진짜 발행물은 이 키로 확인하지 않아요.');

  let result: VerifyResult;
  if (opts.target.kind === 'folder') {
    if (!existsSync(opts.target.path) || !statSync(opts.target.path).isDirectory()) {
      return fail([`발행 폴더가 없어요(${opts.targetName}). 먼저 npm run exams:publish 로 발행해요.`, '확인하지 못했어요.']);
    }
    result = verifyFolder(opts.target.path, parsed.key);
  } else {
    result = await verifyUrl(opts.target.url, parsed.key, opts.timeoutMs ?? VERIFY_TIMEOUT_MS);
  }
  const state = compareWithState(opts.dataDir, result);
  for (const line of [...result.lines, ...state.lines]) io.out(line);
  // 주소를 확인할 때(올린 뒤) 자료 폴더의 마지막 발행과 다르면 알림이 아니라 실패로 본다(별도 검토 C2). 결과 줄이나 종료 코드만 보고
  // 올리기를 마친 것으로 아는 일을 막고, 최신이 아닌 자료 폴더로 다음 발행을 하기 전에 알아채게 한다. 폴더 확인은 지금처럼 알리기만 한다.
  const urlDiffers = opts.target.kind === 'url' && result.ok ? state.differs : null;
  const warnings = [...result.warnings, ...(urlDiffers === null ? state.warnings : [])];
  if (warnings.length > 0) {
    io.out(`알림 ${warnings.length}개`);
    for (const w of warnings) io.out(`  - ${w}`);
  }
  if (urlDiffers !== null) {
    return fail(['결과: 주소의 발행물이 자료 폴더의 마지막 발행과 달라요. 서명, 시험 파일의 SHA-256 과 검사는 맞아요. 이유 1개:', `  - ${urlDiffers}`]);
  }
  if (result.ok) {
    io.out('결과: 발행물이 맞아요. 서명, 시험 파일의 SHA-256 과 검사, 잠금 달력이 모두 맞아요.');
    return 0;
  }
  return fail([`결과: 발행물이 맞지 않아요. 이유 ${result.errors.length}개:`, ...result.errors.map((e) => `  - ${e}`)]);
}
