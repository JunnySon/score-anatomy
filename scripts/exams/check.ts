import { join } from 'node:path';
import { answersRevOf, checkExam, revOf, typesReadyOf, validateLocks } from '../../src/exams/validate.ts';
import type { Exam, LockEntry } from '../../src/types.ts';
import { EXAM_ID_RE, LOCKS_FILE, SRC_DIR, STATE_FILE, bundledExamIds, isRecord, listSourceFiles, readJsonFile } from './data.ts';
import type { Io } from './io.ts';
import { compareWithPublished, cutsText, locksSha256, missingExams, nosText, parseState, publishedEntry } from './state.ts';
import type { ExamState, Finding } from './state.ts';

// exams:check(작업 지시서 3의 6-4): 원본(exam-data/src/*.json, locks.json)을 모두 검사하고, 마지막으로 발행한 기록(state.json)과
// 견줘 금지된 변경을 찾고, 사람이 읽을 변경 요약을 보여 준다. 아무 파일도 쓰지 않는다.
// 시험 파일 검사는 src/exams/validate.ts 를 그대로 쓰고, 발행 기록과의 비교는 state.ts 의 compareWithPublished 를 쓴다.
// exams:publish 도 checkData 를 그대로 불러, 거부가 하나라도 있으면 발행하지 않는다.

/** 검사를 통과한 원본 시험 하나. file 은 src 폴더 안의 파일 이름이다. */
export interface CheckedExam {
  file: string;
  exam: Exam;
}

export interface CheckReport {
  /** 거부가 하나도 없으면 true. */
  ok: boolean;
  /** 거부(발행을 막는 것). 문장마다 어느 파일인지 앞에 붙인다. */
  errors: string[];
  /** 알림(발행은 막지 않음). */
  warnings: string[];
  /** 사람이 읽을 요약(파일별 변경, 잠금 달력). 들여쓰기까지 적은 줄이다. */
  lines: string[];
  state: ExamState | null;
  /** 검사를 통과한 원본 시험(파일 이름 차례). */
  exams: CheckedExam[];
  /** 검사를 통과한 잠금 달력. 읽지 못했거나 틀렸으면 null. */
  locks: LockEntry[] | null;
}

// 화면 문구 규칙(docs/작업지시서.md 3장의 5, 9장): 시험 파일의 글자는 학생 화면에 그대로 나오므로
// 금지 문자(줄표 U+2014, U+2013, 가운뎃점 U+00B7, U+318D, U+30FB, U+2027), 느낌표, 이모지를 받지 않는다.
// 문자를 직접 적지 않고 코드 값으로 정규식을 만든다.
const FORBIDDEN_CODES = [0x2014, 0x2013, 0x00b7, 0x318d, 0x30fb, 0x2027];
const FORBIDDEN_RE = new RegExp(`[${FORBIDDEN_CODES.map((c) => String.fromCodePoint(c)).join('')}]`, 'u');
const EXCLAMATION_RE = new RegExp(`[${String.fromCodePoint(0x21)}${String.fromCodePoint(0xff01)}]`, 'u');
const EMOJI_RE = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}]/u;

function codeName(ch: string): string {
  return `U+${(ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`;
}

/** 시험 파일 안의 모든 글자 값에서 화면 문구 규칙에 어긋나는 곳을 찾는다. 몇 번째 칸인지와 문자 코드를 적는다. */
export function screenTextProblems(value: unknown, path = ''): string[] {
  if (typeof value === 'string') {
    const found: string[] = [];
    const bad = [...value].filter((ch) => FORBIDDEN_RE.test(ch));
    if (bad.length > 0) found.push(`${path}: 쓰지 않는 문자가 있어요(${[...new Set(bad.map(codeName))].join(', ')}).`);
    if (EXCLAMATION_RE.test(value)) found.push(`${path}: 화면에 나오는 글자에는 느낌표를 쓰지 않아요.`);
    if (EMOJI_RE.test(value)) found.push(`${path}: 화면에 나오는 글자에는 이모지를 쓰지 않아요.`);
    return found;
  }
  if (Array.isArray(value)) return value.flatMap((v: unknown, i: number) => screenTextProblems(v, `${path}[${i}]`));
  if (isRecord(value)) return Object.entries(value).flatMap(([k, v]) => screenTextProblems(v, path === '' ? k : `${path}.${k}`));
  return [];
}

// 정정 안내(answersNote)는 학생이 "정답 보기"를 누르기 전에 보는 글자다(절대 원칙 6). 정답 값이 든 것처럼 보이는 모양을 알린다.
// "3번에서 5번으로", "5로", "정답은 3", "답: 4", 원 숫자(①).
const ANSWER_LIKE = [/\d\s*번?\s*(?:으로|로|에서)/u, /(?:정답|답)\s*(?:은|는|이|가|을|를|:)?\s*\d/u, /[\u{2460}-\u{2473}\u{2776}-\u{277F}]/u];

/** 정정 안내가 정답 값을 드러내는 것처럼 보이는지. */
export function looksLikeAnswerNote(note: string): boolean {
  return ANSWER_LIKE.some((re) => re.test(note));
}

/** 발행 기록과 상관없이 시험 하나에서 알릴 것. */
export function examWarnings(exam: Exam): string[] {
  const out: string[] = [];
  if (exam.isSample) out.push('isSample 이 true 라 앱에서 예시 시험으로 보여요. 실제 시험이면 false 로 적어요.');
  if (typeof exam.answersNote === 'string' && looksLikeAnswerNote(exam.answersNote)) {
    out.push(
      'answersNote 에 정답 값처럼 보이는 글자가 있어요. 학생은 정답 보기를 누르기 전에 이 문장을 봐요. 문항 번호만 적어 주세요(형식 예시: 12번 정답이 정정됐어요.).',
    );
  }
  if (!exam.answerReleased) {
    const withAnswers = exam.items.filter((it) => (it.answer !== undefined && it.answer !== null) || it.altAnswers !== undefined || it.allCorrect === true);
    if (withAnswers.length > 0) {
      out.push(
        `정답 공개 전(answerReleased false)인데 정답 칸(answer, altAnswers, allCorrect)이 든 문항이 있어요(${nosText(withAnswers.map((it) => it.no))}). 발행하면 누구나 파일에서 볼 수 있어요.`,
      );
    }
  }
  return out;
}

/** 처음 발행하는 시험의 요약 한 줄. */
export function describeNew(exam: Exam): string {
  const mc = exam.items.filter((it) => it.kind === 'mc').length;
  const total = exam.items.reduce((sum, it) => sum + it.points, 0);
  const parts = [
    `rev ${revOf(exam)}`,
    `문항 ${exam.items.length}개(5지선다 ${mc}개, 단답형 ${exam.items.length - mc}개)`,
    `만점 ${total}점`,
    exam.answerReleased ? '정답 공개' : '정답 공개 전',
    typesReadyOf(exam) ? '유형 분류 끝남' : '유형 분류 전',
    exam.cuts ? `등급컷 ${cutsText(exam.cuts)}` : '등급컷 없음',
  ];
  return `새 시험이에요. ${parts.join(', ')}.`;
}

/**
 * 자료 폴더를 읽어 검사한다. 파일을 쓰지 않는다.
 * bundled 는 앱 묶음에 든 시험의 id 와 파일 이름이다(기본은 저장소의 src/exams). 그 id 를 쓴 원본은 거부한다(별도 검토 A2, B1).
 */
export function checkData(dataDir: string, bundled: ReadonlyMap<string, string> = bundledExamIds()): CheckReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const lines: string[] = [];
  const add = (where: string, found: readonly Finding[]) => {
    for (const f of found) (f.level === 'error' ? errors : warnings).push(`${where}: ${f.text}`);
  };

  // 발행 기록
  let state: ExamState | null = null;
  const stateFile = readJsonFile(join(dataDir, STATE_FILE), STATE_FILE);
  if (stateFile.error) {
    errors.push(stateFile.exists ? stateFile.error : `${STATE_FILE}: 파일이 없어요. 아직 발행한 적이 없으면 처음 값을 둬요(seq 0).`);
  } else {
    const parsed = parseState(stateFile.value);
    state = parsed.state;
    errors.push(...parsed.errors.map((e) => `${STATE_FILE}: ${e}`));
  }

  // 잠금 달력
  let locks: LockEntry[] | null = null;
  const locksFile = readJsonFile(join(dataDir, LOCKS_FILE), LOCKS_FILE);
  if (locksFile.error) {
    errors.push(locksFile.exists ? locksFile.error : `${LOCKS_FILE}: 파일이 없어요. 잠금 항목이 없으면 빈 배열([])로 둬요.`);
  } else {
    const found = validateLocks(locksFile.value);
    if (found.length > 0) errors.push(...found.map((e) => `${LOCKS_FILE}: ${e}`));
    else locks = locksFile.value as LockEntry[];
  }

  // 원본 시험 파일
  const names = listSourceFiles(dataDir);
  if (names === null) errors.push(`${SRC_DIR} 폴더가 없어요. 원본 시험 파일은 ${SRC_DIR}/<시험 id>.json 에 둬요.`);
  const exams: CheckedExam[] = [];
  const present = new Set<string>();
  for (const name of names ?? []) {
    const label = `${SRC_DIR}/${name}`;
    present.add(name.slice(0, -'.json'.length));
    const file = readJsonFile(join(dataDir, SRC_DIR, name), label);
    if (file.error) {
      errors.push(file.error);
      continue;
    }
    const raw = file.value;
    const id = isRecord(raw) && typeof raw.id === 'string' ? raw.id : null;
    if (id !== null) present.add(id);
    const checked = checkExam(raw);
    errors.push(...checked.errors.map((e) => `${label}: ${e}`));
    // 발행 도구만의 규칙: id 모양, 파일 이름, rev 를 꼭 적기, 화면 문구 규칙.
    if (id !== null && id !== '') {
      if (!EXAM_ID_RE.test(id)) errors.push(`${label}: id 는 영어 소문자와 숫자를 붙임표(-)로 이은 모양이어야 해요(형식 예시: test-only-exam).`);
      else if (`${id}.json` !== name) errors.push(`${label}: 파일 이름은 시험 id 에 .json 을 붙인 ${id}.json 이어야 해요.`);
      const inBundle = bundled.get(id);
      if (inBundle !== undefined) {
        errors.push(
          `${label}: 앱 묶음에 든 시험(src/exams/${inBundle})과 id 가 같아요(${id}). 같은 id 의 두 판은 앱에서 판 번호(rev)로만 갈려서, 학생 기기의 점수가 알림 없이 바뀌거나 저장한 답이 다른 문항에 붙을 수 있어요. 발행하는 시험에는 묶음 안 시험과 다른 id 를 써요.`,
        );
      }
    }
    if (isRecord(raw) && raw.rev === undefined) errors.push(`${label}: rev 를 적어야 해요. 발행하는 시험 파일에는 판 번호를 꼭 적어요(처음은 1).`);
    errors.push(...screenTextProblems(raw).map((e) => `${label}: ${e}`));
    const exam = checked.exam;
    if (exam === null) {
      lines.push(`${label}`, '  검사를 통과하지 못했어요(아래 거부를 봐요).');
      continue;
    }
    exams.push({ file: name, exam });
    lines.push(`${label}(${exam.title})`);
    warnings.push(...examWarnings(exam).map((w) => `${label}: ${w}`));
    const prev = publishedEntry(state, exam.id);
    if (prev === null) {
      lines.push(`  ${describeNew(exam)}`);
      if (state !== null && answersRevOf(exam) >= 2) {
        warnings.push(`${label}: 처음 발행하는 시험인데 answersRev 가 1보다 커요(지금 ${answersRevOf(exam)}). 앱 묶음에 든 예전 판이 없으면 칸을 빼거나 1로 둬요.`);
      }
      continue;
    }
    lines.push(`  발행한 판: rev ${prev.rev}, answersRev ${prev.answersRev}, ${prev.answerReleased ? '정답 공개' : '정답 공개 전'}.`);
    const compared = compareWithPublished(prev, exam);
    add(label, compared.findings);
    lines.push(...compared.changes.map((c) => `  ${c}`));
  }
  if (names !== null && names.length === 0) lines.push(`${SRC_DIR} 폴더에 시험 파일(*.json)이 없어요.`);

  // 발행했던 시험이 사라졌는지
  if (state !== null && names !== null) {
    for (const id of missingExams(state, present)) {
      errors.push(`${SRC_DIR}/${id}.json: 발행했던 시험 ${id} 의 원본 파일이 없어요. 발행한 시험은 지울 수 없어요(학생 기기의 기록이 그 시험을 가리켜요).`);
    }
  }

  // 잠금 달력 요약
  if (locks !== null) {
    let status = '';
    if (state !== null) {
      if (state.locksSha256 === null) status = ', 아직 발행한 적이 없어요';
      else status = state.locksSha256 === locksSha256(locks) ? ', 발행한 것과 같아요' : ', 발행한 것과 달라요';
    }
    lines.push(`잠금 달력(${LOCKS_FILE}): 항목 ${locks.length}개${status}.`);
    for (const e of locks) lines.push(`  ${e.id}: ${e.start}부터 ${e.end}까지`);
  }

  return { ok: errors.length === 0, errors, warnings, lines, state, exams, locks };
}

/** exams:check 를 돌리고 결과를 적는다. 거부가 없으면 0, 있으면 1을 돌려준다. */
export function runCheck(opts: { dataDir: string; dataName: string }, io: Io): number {
  const report = checkData(opts.dataDir);
  io.out(`시험 자료를 검사해요: ${opts.dataName}`);
  if (report.state !== null) {
    io.out(
      report.state.seq === 0 && report.state.issuedAt === null
        ? '아직 발행한 적이 없어요(seq 0).'
        : `마지막 발행: seq ${report.state.seq}, issuedAt ${report.state.issuedAt ?? '없음'}.`,
    );
  }
  for (const line of report.lines) io.out(line);
  io.out(`알림 ${report.warnings.length}개`);
  for (const w of report.warnings) io.out(`  - ${w}`);
  io.out(`거부 ${report.errors.length}개`);
  for (const e of report.errors) io.out(`  - ${e}`);
  io.out(
    report.ok
      ? `결과: 검사를 통과했어요. 이 검사는 파일을 쓰지 않아요.`
      : `결과: 검사를 통과하지 못했어요. 거부를 고친 뒤 다시 검사해 주세요. 이 검사는 파일을 쓰지 않아요.`,
  );
  return report.ok ? 0 : 1;
}
