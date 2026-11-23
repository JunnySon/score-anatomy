import { readFileSync, realpathSync } from 'node:fs';
import type { ExamItem } from '../../src/types.ts';
import { choicesOf, SHORT_MAX, SHORT_MIN } from '../../src/exams/validate.ts';
import { isRecord, withKey } from './data.ts';
import { looksLikeAnswerNote, screenTextProblems } from './check.ts';
import { EXAM_KEYS_BEFORE, bumpRevForEdit, loadEditTarget, writeEdit } from './edit.ts';
import type { Io } from './io.ts';
import { itemSummary, nosText, ro, scoringDiff, scoringText, structureDiff } from './state.ts';

// exams:answers(작업 지시서 3의 6-4): 두 사람이 따로 적은 정답 파일 두 개를 받아, 완전히 같을 때만 원본 시험 파일에 정답을 넣고
// answerReleased 를 true 로 한다. 다르면 다른 문항 번호만 보여 주고(답 값은 보여 주지 않음) 아무것도 쓰지 않는다.
//
// 정답 파일(글자 파일, UTF-8):
//   시험 <시험 id>        첫 줄. 빈 줄과 # 으로 시작하는 줄은 어디서든 건너뛴다.
//   12 3                  12번의 정답은 3
//   12 3,5                복수 정답. 앞의 답이 answer, 나머지가 altAnswers(쉼표 둘레의 빈칸은 괜찮음)
//   12 *                  모두 정답 처리(allCorrect)
// 시험의 모든 문항을 한 번씩 적는다. 줄의 차례는 상관없다. 두 파일은 줄마다가 아니라 읽은 정답으로 견준다(복수 정답은 차례까지 같아야 함).
//
// 이미 발행한 정답(state.json 에서 정답 공개)과 채점이 달라지면 정정이다. 그때는 --note "<정정 안내>" 가 있어야 하고
// answersRev 를 발행한 판 + 1 로 둔다. 처음 공개하는 정답(발행 기록이 없거나 정답 공개 전)에는 --note 를 쓰지 않는다.

/** 문항 하나의 정답. '*' 는 모두 정답 처리, 숫자 배열은 인정하는 답(앞이 answer)이다. */
export type AnswerSpec = '*' | number[];

export interface AnswerSheet {
  id: string;
  answers: Map<number, AnswerSpec>;
}

function lines(text: string): string[] {
  return (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).split(/\r?\n/);
}

function meaningful(line: string): boolean {
  const t = line.trim();
  return t !== '' && !t.startsWith('#');
}

const HEADER_RE = /^시험\s+(\S+)$/u;
const LINE_RE = /^(\d+)\s+(\*|\d+(?:\s*,\s*\d+)*)$/u;

/** 정답 파일의 첫 줄에 적힌 시험 id. 첫 줄이 "시험 <id>" 모양이 아니면 null. */
export function sheetExamId(text: string): string | null {
  const first = lines(text).find(meaningful);
  const m = first === undefined ? null : HEADER_RE.exec(first.trim());
  return m ? m[1] : null;
}

/**
 * 정답 파일을 시험의 문항에 맞춰 읽는다. 틀린 줄은 줄 번호와 이유를 errors 에 담는다(줄의 글자와 답 값은 적지 않는다).
 * 형식이 틀린 줄, 시험에 없는 문항, 겹친 문항, 범위 밖 답, 한 줄 안에서 겹친 답, 빠진 문항을 거부한다.
 */
export function parseAnswerSheet(text: string, name: string, items: readonly ExamItem[]): { sheet: AnswerSheet | null; errors: string[] } {
  const errors: string[] = [];
  const byNo = new Map(items.map((it) => [it.no, it]));
  const seen = new Map<number, number>();
  const answers = new Map<number, AnswerSpec>();
  let id: string | null = null;
  let header = false;
  const all = lines(text);
  for (let i = 0; i < all.length; i += 1) {
    const at = `${name} ${i + 1}번째 줄`;
    if (!meaningful(all[i])) continue;
    const line = all[i].trim();
    if (!header) {
      // 첫 줄이 틀려도 그 줄을 시험 이름 자리로 보고 다음 줄부터 정답으로 읽어, 틀린 곳을 한 번에 알린다.
      header = true;
      const m = HEADER_RE.exec(line);
      if (m) id = m[1];
      else errors.push(`${at}: 첫 줄은 "시험 <시험 id>" 모양이어야 해요.`);
      continue;
    }
    const m = LINE_RE.exec(line);
    if (!m) {
      errors.push(`${at}: "번호 답" 모양이 아니에요(형식 예시: 12 3, 복수 정답은 12 3,5, 모두 정답 처리는 12 *).`);
      continue;
    }
    const no = Number(m[1]);
    const item = byNo.get(no);
    if (item === undefined) {
      errors.push(`${at}: ${no}번은 이 시험에 없는 문항이에요.`);
      continue;
    }
    const before = seen.get(no);
    if (before !== undefined) {
      errors.push(`${at}: ${no}번이 앞(${before}번째 줄)에도 있어요.`);
      continue;
    }
    seen.set(no, i + 1);
    if (m[2] === '*') {
      answers.set(no, '*');
      continue;
    }
    const values = m[2].split(',').map((v) => Number(v.trim()));
    const lo = item.kind === 'mc' ? 1 : SHORT_MIN;
    const hi = item.kind === 'mc' ? choicesOf(item) : SHORT_MAX;
    if (values.some((v) => !Number.isSafeInteger(v) || v < lo || v > hi)) {
      errors.push(`${at}: ${no}번은 ${item.kind === 'mc' ? '5지선다라' : '단답형이라'} 답은 ${lo}부터 ${hi}까지예요.`);
      continue;
    }
    if (new Set(values).size !== values.length) {
      errors.push(`${at}: ${no}번에 같은 답이 두 번 있어요.`);
      continue;
    }
    answers.set(no, values);
  }
  if (!header) {
    errors.push(`${name}: 정답 파일이 비어 있어요. 첫 줄은 "시험 <시험 id>" 예요.`);
  } else {
    const missing = items.filter((it) => !seen.has(it.no)).map((it) => it.no);
    if (missing.length > 0) errors.push(`${name}: 답을 적지 않은 문항이 있어요(${nosText(missing)}). 모든 문항을 한 번씩 적어요.`);
  }
  if (errors.length > 0 || id === null) return { sheet: null, errors };
  return { sheet: { id, answers }, errors: [] };
}

function sameSpec(a: AnswerSpec | undefined, b: AnswerSpec | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  if (a === '*' || b === '*') return a === b;
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** 두 정답 파일에서 정답이 다른 문항 번호(작은 번호부터). */
export function diffSheets(a: AnswerSheet, b: AnswerSheet): number[] {
  const nos = new Set([...a.answers.keys(), ...b.answers.keys()]);
  return [...nos].filter((no) => !sameSpec(a.answers.get(no), b.answers.get(no))).sort((x, y) => x - y);
}

const ITEM_KEYS_BEFORE = {
  answer: ['no', 'kind', 'choices', 'points'],
  altAnswers: ['no', 'kind', 'choices', 'points', 'answer'],
  allCorrect: ['no', 'kind', 'choices', 'points', 'answer', 'altAnswers'],
} as const;

/** 원본 시험 객체에 정답을 넣고 answerReleased 를 true 로 한 새 객체를 돌려준다(받은 객체는 고치지 않는다). */
export function applyAnswers(raw: Record<string, unknown>, sheet: AnswerSheet): Record<string, unknown> {
  const items = Array.isArray(raw.items) ? raw.items : [];
  const nextItems = items.map((it: unknown) => {
    if (!isRecord(it) || typeof it.no !== 'number') return it;
    const spec = sheet.answers.get(it.no);
    if (spec === undefined) return it;
    let next = it;
    if (spec === '*') {
      next = withKey(next, 'answer', undefined, []);
      next = withKey(next, 'altAnswers', undefined, []);
      next = withKey(next, 'allCorrect', true, ITEM_KEYS_BEFORE.allCorrect);
    } else {
      next = withKey(next, 'answer', spec[0], ITEM_KEYS_BEFORE.answer);
      next = withKey(next, 'altAnswers', spec.length > 1 ? spec.slice(1) : undefined, ITEM_KEYS_BEFORE.altAnswers);
      next = withKey(next, 'allCorrect', undefined, []);
    }
    return next;
  });
  return withKey(withKey(raw, 'items', nextItems, []), 'answerReleased', true, ['isPast']);
}

export interface AnswersOptions {
  dataDir: string;
  /** 두 정답 파일의 경로와 출력에 쓰는 이름. */
  files: [string, string];
  names: [string, string];
  /** --note 로 받은 정정 안내. 없으면 null. */
  note: string | null;
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/** 두 경로가 같은 파일인지. 윈도우는 대소문자를 가리지 않으므로 소문자로 견준다. */
function sameFile(a: string, b: string): boolean {
  const fold = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p);
  try {
    return fold(realpathSync(a)) === fold(realpathSync(b));
  } catch {
    return false;
  }
}

/** exams:answers 를 돌린다. 정답을 넣었거나 이미 같으면 0, 쓰지 않았으면 1을 돌려준다. */
export function runAnswers(opts: AnswersOptions, io: Io): number {
  const fail = (messages: readonly string[]) => {
    for (const m of messages) io.err(m);
    io.err('아무것도 쓰지 않았어요.');
    return 1;
  };
  const [pathA, pathB] = opts.files;
  const [nameA, nameB] = opts.names;
  if (sameFile(pathA, pathB)) return fail(['같은 파일을 두 번 줬어요. 두 사람이 따로 적은 정답 파일 두 개가 필요해요.']);
  const textA = readText(pathA);
  const textB = readText(pathB);
  const unread = [textA === null ? `${nameA}: 파일을 읽지 못했어요.` : null, textB === null ? `${nameB}: 파일을 읽지 못했어요.` : null];
  if (textA === null || textB === null) return fail(unread.filter((m): m is string => m !== null));

  const idA = sheetExamId(textA);
  const idB = sheetExamId(textB);
  if (idA === null || idB === null) {
    return fail([idA === null ? `${nameA}: 첫 줄은 "시험 <시험 id>" 모양이어야 해요.` : null, idB === null ? `${nameB}: 첫 줄은 "시험 <시험 id>" 모양이어야 해요.` : null].filter((m): m is string => m !== null));
  }
  if (idA !== idB) return fail([`두 정답 파일의 시험이 달라요(${nameA}: ${idA}, ${nameB}: ${idB}).`]);

  const loaded = loadEditTarget(opts.dataDir, idA);
  if (loaded.target === null) return fail(loaded.errors);
  const target = loaded.target;

  const a = parseAnswerSheet(textA, nameA, target.exam.items);
  const b = parseAnswerSheet(textB, nameB, target.exam.items);
  if (a.sheet === null || b.sheet === null) return fail([...a.errors, ...b.errors]);
  const differ = diffSheets(a.sheet, b.sheet);
  if (differ.length > 0) return fail([`두 정답 파일이 달라요. 다른 문항: ${nosText(differ)}.`]);

  let next = applyAnswers(target.raw, a.sheet);
  const notes: string[] = [];
  const prev = target.prev;
  const note = opts.note === null ? null : opts.note.trim();
  if (opts.note !== null && note === '') return fail(['--note 의 정정 안내가 비어 있어요.']);
  if (prev !== null && prev.answerReleased) {
    // 공개한 정답과 견준다. 배점도 채점에 영향을 주므로 함께 본다(exams:check 와 같은 기준).
    const applied = ((Array.isArray(next.items) ? next.items : []) as ExamItem[]).map(itemSummary);
    if (structureDiff(prev.items, applied).length > 0) {
      return fail(['문항 구성(no, kind, choices)이 발행한 판과 달라서 정답을 넣지 않아요. 먼저 npm run exams:check 로 확인해 주세요.']);
    }
    const changes = scoringDiff(prev.items, applied);
    if (changes.length > 0) {
      if (note === null) {
        return fail([
          `발행한 정답과 채점이 다른 문항: ${scoringText(changes)}. 정정이라 --note "<정정 안내>" 가 있어야 해요(형식 예시: 12번 정답이 정정됐어요.).`,
        ]);
      }
      const problems = screenTextProblems(note, 'answersNote');
      if (problems.length > 0) return fail(problems);
      const nextRev = prev.answersRev + 1;
      next = withKey(next, 'answersRev', nextRev, EXAM_KEYS_BEFORE.answersRev);
      next = withKey(next, 'answersNote', note, EXAM_KEYS_BEFORE.answersNote);
      notes.push(`정정이에요. 발행한 정답과 채점이 다른 문항: ${scoringText(changes)}. answersRev 를 ${ro(nextRev)} 두고 정정 안내를 넣었어요.`);
      if (looksLikeAnswerNote(note)) notes.push('알림: 정정 안내에 정답 값처럼 보이는 글자가 있어요. 학생은 정답 보기를 누르기 전에 이 문장을 봐요.');
    } else {
      if (note !== null) return fail(['발행한 정답과 채점이 같아서 정정 안내(--note)를 쓰지 않아요.']);
      // 앞서 이 명령으로 정정을 넣었다가(발행 전) 발행한 정답으로 되돌린 경우: 정답 판 번호와 정정 안내를 발행한 판의 값으로 돌린다.
      const srcRev = typeof next.answersRev === 'number' ? next.answersRev : 1;
      if (srcRev !== prev.answersRev) {
        next = withKey(next, 'answersRev', prev.answersRev === 1 ? undefined : prev.answersRev, EXAM_KEYS_BEFORE.answersRev);
        next = withKey(next, 'answersNote', prev.answersNote, EXAM_KEYS_BEFORE.answersNote);
        notes.push(`발행한 정답과 같아서 answersRev 를 발행한 판의 값(${prev.answersRev})으로 돌렸어요.`);
      }
    }
  } else if (note !== null) {
    return fail(['처음 공개하는 정답이라 정정 안내(--note)를 쓰지 않아요. 정정은 정답을 발행한 뒤에 해요.']);
  }

  const bumped = bumpRevForEdit(next, prev);
  next = bumped.raw;
  if (bumped.note) notes.push(bumped.note);
  const result = writeEdit(target, next);
  if (result.errors.length > 0) return fail(result.errors);
  if (!result.written) {
    io.out(`${target.label} 에는 이미 이 정답이 들어 있어요. 파일을 그대로 뒀어요.`);
    return 0;
  }
  const specs = [...a.sheet.answers.values()];
  const multi = specs.filter((s) => s !== '*' && s.length > 1).length;
  const all = specs.filter((s) => s === '*').length;
  io.out(`${target.label} 에 정답을 넣었어요. 문항 ${specs.length}개(복수 정답 ${multi}문항, 모두 정답 처리 ${all}문항), answerReleased true.`);
  for (const n of notes) io.out(`  ${n}`);
  io.out('다음 차례: npm run exams:check 로 검사해요.');
  return 0;
}
