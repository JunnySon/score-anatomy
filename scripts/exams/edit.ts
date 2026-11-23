import { join } from 'node:path';
import { checkExam, revOf, validateExam } from '../../src/exams/validate.ts';
import type { Exam } from '../../src/types.ts';
import { canonicalJson } from './canonical.ts';
import { EXAM_ID_RE, SRC_DIR, STATE_FILE, examPath, isRecord, readJsonFile, sourceJson, withKey, writeTextFile } from './data.ts';
import { screenTextProblems } from './check.ts';
import { examSha256, parseState, publishedEntry, ro } from './state.ts';
import type { StateEntry } from './state.ts';

// 원본 시험 파일을 고치는 명령(exams:answers, exams:cuts)이 함께 쓰는 것.
// 고친 내용은 src/exams/validate.ts 의 검사를 통과할 때만 쓰고, 원본 파일의 키 차례를 되도록 지킨다(data.ts 의 withKey).

/** 시험 파일의 칸을 새로 넣을 때 그 앞에 올 수 있는 칸(src/types.ts 의 차례). */
export const EXAM_KEYS_BEFORE = {
  rev: ['id', 'title', 'note', 'isSample', 'isPast', 'answerReleased', 'examDate'],
  answersRev: ['id', 'title', 'note', 'isSample', 'isPast', 'answerReleased', 'examDate', 'rev'],
  answersNote: ['id', 'title', 'note', 'isSample', 'isPast', 'answerReleased', 'examDate', 'rev', 'answersRev'],
  cuts: ['items'],
} as const;

/** 고칠 원본 시험 파일. */
export interface EditTarget {
  id: string;
  path: string;
  /** 출력에 쓰는 이름(src/<id>.json). */
  label: string;
  /** 파일에서 읽은 그대로의 객체. 이것을 고쳐 쓴다. */
  raw: Record<string, unknown>;
  /** 검사를 통과한 시험(raw 와 같은 내용). */
  exam: Exam;
  /** 발행한 기록. 아직 발행하지 않았으면 null. */
  prev: StateEntry | null;
}

/** 원본 시험 파일과 발행 기록을 읽는다. 지금 파일이 검사를 통과하지 못하면 고치지 않는다. */
export function loadEditTarget(dataDir: string, id: string): { target: EditTarget | null; errors: string[] } {
  if (!EXAM_ID_RE.test(id)) return { target: null, errors: [`시험 id 는 영어 소문자와 숫자를 붙임표(-)로 이은 모양이어야 해요(형식 예시: test-only-exam).`] };
  const label = `${SRC_DIR}/${id}.json`;
  const file = readJsonFile(examPath(dataDir, id), label);
  if (file.error) return { target: null, errors: [file.error] };
  if (!isRecord(file.value)) return { target: null, errors: [`${label}: 시험 데이터가 객체가 아니에요.`] };
  const checked = checkExam(file.value);
  if (checked.exam === null) {
    return { target: null, errors: [`${label}: 지금 파일이 검사를 통과하지 못해요. 먼저 고쳐 주세요.`, ...checked.errors.map((e) => `${label}: ${e}`)] };
  }
  if (checked.exam.id !== id) return { target: null, errors: [`${label}: 파일 안의 id 가 파일 이름과 달라요. 파일 이름은 시험 id 에 .json 을 붙여요.`] };
  const stateFile = readJsonFile(join(dataDir, STATE_FILE), STATE_FILE);
  if (stateFile.error) return { target: null, errors: [stateFile.error] };
  const parsed = parseState(stateFile.value);
  if (parsed.state === null) return { target: null, errors: parsed.errors.map((e) => `${STATE_FILE}: ${e}`) };
  return { target: { id, path: examPath(dataDir, id), label, raw: file.value, exam: checked.exam, prev: publishedEntry(parsed.state, id) }, errors: [] };
}

/**
 * 발행한 판과 내용이 달라졌는데 판 번호(rev)가 발행한 판보다 크지 않으면 발행한 판 + 1 로 올린다.
 * 원본의 rev 가 이미 더 크면 그대로 둔다. 같은 명령을 여러 번 돌려도 발행한 판 + 1 에서 멈춘다. 내리지는 않는다.
 * 올렸으면 알릴 문장을 함께 돌려준다.
 */
export function bumpRevForEdit(raw: Record<string, unknown>, prev: StateEntry | null): { raw: Record<string, unknown>; note: string | null } {
  if (prev === null) return { raw, note: null };
  const exam = checkExam(raw).exam;
  if (exam === null) return { raw, note: null };
  const rev = revOf(exam);
  const sameAsPublished = examSha256({ ...exam, rev: prev.rev }) === prev.sha256;
  if (sameAsPublished || rev > prev.rev) return { raw, note: null };
  const next = prev.rev + 1;
  return { raw: withKey(raw, 'rev', next, EXAM_KEYS_BEFORE.rev), note: `rev 를 ${rev}에서 ${ro(next)} 올렸어요(발행한 판과 내용이 달라서).` };
}

/**
 * 고친 객체를 검사하고 원본 파일에 쓴다. 검사를 통과하지 못하면 쓰지 않는다. 내용이 같으면 파일을 그대로 둔다.
 * 돌려주는 written 은 파일을 썼는지, errors 는 쓰지 않은 이유다.
 */
export function writeEdit(target: EditTarget, next: Record<string, unknown>): { written: boolean; errors: string[] } {
  const found = [...validateExam(next), ...screenTextProblems(next)];
  if (found.length > 0) return { written: false, errors: found.map((e) => `${target.label}: ${e}`) };
  if (canonicalJson(next) === canonicalJson(target.raw)) return { written: false, errors: [] };
  writeTextFile(target.path, sourceJson(next));
  return { written: true, errors: [] };
}
