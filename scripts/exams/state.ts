import { acceptedAnswers, answersRevOf, choicesOf, revOf, typesReadyOf } from '../../src/exams/validate.ts';
import { isValidYmdHm } from '../../src/logic/dates.ts';
import type { Exam, ExamCuts, ExamItem } from '../../src/types.ts';
import { canonicalJson, sha256Hex } from './canonical.ts';
import { EXAM_ID_RE, isRecord } from './data.ts';

// 마지막으로 발행한 내용의 기록(exam-data/state.json, 작업 지시서 3의 6-1)과, 그 기록과 원본을 견줘 금지된 변경을 찾는 곳(6-4).
// exams:check 와 exams:publish 가 같은 함수를 쓴다. 시험 파일 자체의 검사는 src/exams/validate.ts 가 한다.
// state.json 은 키를 정렬한 JSON(canonical.ts)으로 적고 커밋한다.

export const STATE_FORMAT = 1;

/**
 * 문항 구성(no, kind, choices)과 채점에 영향을 주는 값(points, answer, altAnswers, allCorrect), 유형(typeId)의 요약. 없는 값은 뺀다.
 * typeId 는 변경 요약에 유형이 바뀐 문항을 적으려고 더한 칸이다(별도 검토 B2). 이 칸이 없는 예전 기록은 유형을 견주지 않는다.
 */
export interface ItemSummary {
  no: number;
  kind: 'mc' | 'short';
  /** 5지선다의 보기 수(적지 않았으면 5). 단답형에는 없다. */
  choices?: number;
  points: number;
  answer?: number;
  altAnswers?: number[];
  allCorrect?: true;
  typeId?: string;
}

/** 발행한 시험 하나의 기록. */
export interface StateEntry {
  rev: number;
  answersRev: number;
  answersNote?: string;
  answerReleased: boolean;
  typesReady: boolean;
  /** 발행 파일의 경로(index.json 이 있는 곳 기준, 형식 예시: files/test-only-exam.1.json). */
  file: string;
  /** 발행 파일 바이트(examFileText)의 SHA-256. 내용이 같은지 견주는 값이기도 하다. */
  sha256: string;
  cuts?: ExamCuts;
  items: ItemSummary[];
  /** 유형 id 와 이름(시험의 types 에서 이름만). 변경 요약에 유형 이름이 바뀐 것을 적으려고 더한 칸이다(별도 검토 B2). */
  types?: Record<string, string>;
}

/** state.json 의 내용. 아직 발행한 적이 없으면 seq 0, issuedAt null, locksSha256 null, exams {} 이다. */
export interface ExamState {
  format: 1;
  seq: number;
  issuedAt: string | null;
  locksSha256: string | null;
  exams: Record<string, StateEntry>;
}

export function initialState(): ExamState {
  return { format: STATE_FORMAT, seq: 0, issuedAt: null, locksSha256: null, exams: {} };
}

/** state.json 의 글자. */
export function stateText(state: ExamState): string {
  return canonicalJson(state);
}

/**
 * 발행 파일의 글자: 검사를 통과한 시험을 키를 정렬한 JSON 으로 적은 것이다. 원본 파일의 모양(줄바꿈, 키 차례)과 상관없이
 * 내용이 같으면 바이트가 같다. 원본 시험 파일에는 rev 를 꼭 적으므로(exams:check) 발행 파일에도 rev 가 있다.
 */
export function examFileText(exam: Exam): string {
  return canonicalJson(exam);
}

export function examSha256(exam: Exam): string {
  return sha256Hex(examFileText(exam));
}

/** 잠금 달력의 SHA-256(키를 정렬한 JSON 의 바이트). 달력이 발행한 것과 같은지 견줄 때 쓴다. */
export function locksSha256(locks: unknown): string {
  return sha256Hex(canonicalJson(locks));
}

export function itemSummary(item: ExamItem): ItemSummary {
  const s: ItemSummary = { no: item.no, kind: item.kind, points: item.points };
  if (item.kind === 'mc') s.choices = choicesOf(item);
  if (item.answer !== undefined && item.answer !== null) s.answer = item.answer;
  if (item.altAnswers !== undefined) s.altAnswers = [...item.altAnswers];
  if (item.allCorrect === true) s.allCorrect = true;
  s.typeId = item.typeId;
  return s;
}

/** 시험의 유형 id 와 이름. */
export function typeNames(exam: Exam): Record<string, string> {
  return Object.fromEntries(Object.entries(exam.types).map(([id, t]) => [id, t.name]));
}

/** 검사를 통과한 시험으로 발행 기록 하나를 만든다. file 은 발행 파일의 경로다. */
export function stateEntryOf(exam: Exam, file: string): StateEntry {
  const entry: StateEntry = {
    rev: revOf(exam),
    answersRev: answersRevOf(exam),
    answerReleased: exam.answerReleased,
    typesReady: typesReadyOf(exam),
    file,
    sha256: examSha256(exam),
    items: exam.items.map(itemSummary),
    types: typeNames(exam),
  };
  if (exam.answersNote !== undefined) entry.answersNote = exam.answersNote;
  if (exam.cuts !== undefined) entry.cuts = exam.cuts;
  return entry;
}

/** 발행한 시험의 기록. 없으면 null. "constructor" 같은 이름도 직접 적힌 칸만 본다. */
export function publishedEntry(state: ExamState | null, id: string): StateEntry | null {
  if (state === null || !Object.prototype.hasOwnProperty.call(state.exams, id)) return null;
  return state.exams[id] ?? null;
}

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}

function isSha(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
}

function summaryErrors(raw: unknown, where: string, prevNo: number): string[] {
  if (!isRecord(raw)) return [`${where}: 문항 요약이 객체가 아니에요.`];
  const errors: string[] = [];
  if (!isInt(raw.no) || raw.no <= prevNo) errors.push(`${where}: no 는 1부터 커지는 정수여야 해요.`);
  if (raw.kind === 'mc') {
    if (!isInt(raw.choices) || raw.choices < 2 || raw.choices > 9) errors.push(`${where}: 5지선다 문항의 choices 는 2부터 9까지의 정수여야 해요.`);
  } else if (raw.kind === 'short') {
    if (raw.choices !== undefined) errors.push(`${where}: 단답형 문항에는 choices 를 적지 않아요.`);
  } else {
    errors.push(`${where}: kind 는 mc 나 short 여야 해요.`);
  }
  if (!isInt(raw.points) || raw.points < 1) errors.push(`${where}: points 는 1 이상의 정수여야 해요.`);
  if (raw.answer !== undefined && !isInt(raw.answer)) errors.push(`${where}: answer 는 정수여야 해요.`);
  if (raw.altAnswers !== undefined && (!Array.isArray(raw.altAnswers) || !raw.altAnswers.every(isInt))) {
    errors.push(`${where}: altAnswers 는 정수 배열이어야 해요.`);
  }
  if (raw.allCorrect !== undefined && raw.allCorrect !== true) errors.push(`${where}: allCorrect 는 true 만 적어요.`);
  if (raw.typeId !== undefined && (typeof raw.typeId !== 'string' || raw.typeId === '')) errors.push(`${where}: typeId 는 빈칸이 아닌 글자여야 해요.`);
  return errors;
}

function entryErrors(id: string, raw: unknown): string[] {
  const where = `exams.${id}`;
  if (!EXAM_ID_RE.test(id)) return [`${where}: 시험 id 모양이 아니에요.`];
  if (!isRecord(raw)) return [`${where}: 발행 기록이 객체가 아니에요.`];
  const errors: string[] = [];
  for (const key of ['rev', 'answersRev'] as const) {
    if (!isInt(raw[key]) || (raw[key] as number) < 1) errors.push(`${where}: ${key} 는 1 이상의 정수여야 해요.`);
  }
  if (raw.answersNote !== undefined && (typeof raw.answersNote !== 'string' || raw.answersNote.trim() === '')) {
    errors.push(`${where}: answersNote 가 비어 있어요.`);
  }
  for (const key of ['answerReleased', 'typesReady'] as const) {
    if (typeof raw[key] !== 'boolean') errors.push(`${where}: ${key} 는 true 나 false 여야 해요.`);
  }
  if (typeof raw.file !== 'string' || raw.file === '') errors.push(`${where}: file 이 비어 있어요.`);
  if (!isSha(raw.sha256)) errors.push(`${where}: sha256 은 SHA-256(16진수 소문자 64자)이어야 해요.`);
  if (raw.cuts !== undefined && !isRecord(raw.cuts)) errors.push(`${where}: cuts 는 객체여야 해요.`);
  if (raw.types !== undefined && !(isRecord(raw.types) && Object.values(raw.types).every((v) => typeof v === 'string'))) {
    errors.push(`${where}: types 는 유형 id 마다 이름(글자)을 적은 객체여야 해요.`);
  }
  if (!Array.isArray(raw.items) || raw.items.length === 0) {
    errors.push(`${where}: items 가 비어 있어요.`);
  } else {
    let prevNo = 0;
    raw.items.forEach((it: unknown, i: number) => {
      errors.push(...summaryErrors(it, `${where}.items ${i + 1}번째`, prevNo));
      if (isRecord(it) && isInt(it.no)) prevNo = it.no;
    });
  }
  return errors;
}

/** state.json 의 내용을 검사한다. 모양이 맞으면 state 에 그대로 담고, 아니면 errors 에 이유를 담는다. 던지지 않는다. */
export function parseState(raw: unknown): { state: ExamState | null; errors: string[] } {
  if (!isRecord(raw)) return { state: null, errors: ['발행 기록은 객체여야 해요.'] };
  const errors: string[] = [];
  if (raw.format !== STATE_FORMAT) errors.push(`format 은 ${STATE_FORMAT}이어야 해요.`);
  if (!isInt(raw.seq) || raw.seq < 0) errors.push('seq 는 0 이상의 정수여야 해요.');
  if (raw.issuedAt !== null && !isValidYmdHm(raw.issuedAt)) {
    errors.push('issuedAt 은 null 이거나 2030-01-02T17:10 같은 날짜와 시각(한국 시간)이어야 해요.');
  }
  if (raw.locksSha256 !== null && !isSha(raw.locksSha256)) errors.push('locksSha256 은 null 이거나 SHA-256(16진수 소문자 64자)이어야 해요.');
  if (!isRecord(raw.exams)) {
    errors.push('exams 는 시험 id 를 키로 하는 객체여야 해요.');
  } else {
    for (const [id, entry] of Object.entries(raw.exams)) errors.push(...entryErrors(id, entry));
  }
  if (errors.length > 0) return { state: null, errors };
  return { state: raw as unknown as ExamState, errors: [] };
}

// 숫자 뒤의 조사. 끝 글자를 읽는 소리에 받침이 있으면(0 영, 3 삼, 6 육, 10 십, 100 백 등) "으로", 없거나 ㄹ 이면 "로"다.
// 끝자리가 0 이면 영, 십, 백, 천, 만으로 읽어 모두 받침이 있다.
export function ro(n: number): string {
  const last = Math.abs(n) % 10;
  return `${n}${last === 0 || last === 3 || last === 6 ? '으로' : '로'}`;
}

/** 문항 번호 목록을 "12번, 15번"으로 적는다. */
export function nosText(nos: readonly number[]): string {
  return nos.map((n) => `${n}번`).join(', ');
}

/** 견준 결과 하나. error 는 발행을 막는 거부, warning 은 알리기만 하는 알림이다. */
export interface Finding {
  level: 'error' | 'warning';
  text: string;
}

/** 발행한 기록과 원본을 견준 결과. changes 는 사람이 읽을 변경 요약이다. */
export interface ExamComparison {
  findings: Finding[];
  changes: string[];
}

/** 문항 구성(no, kind, choices)이 달라진 곳. 같으면 빈 배열이다. */
export function structureDiff(before: readonly ItemSummary[], after: readonly ItemSummary[]): string[] {
  if (before.length !== after.length) return [`문항 수(발행한 판 ${before.length}개, 지금 ${after.length}개)`];
  const out: string[] = [];
  before.forEach((p, i) => {
    const n = after[i];
    if (p.no !== n.no) out.push(`${i + 1}번째 문항의 번호(발행한 판 ${p.no}, 지금 ${n.no})`);
    else if (p.kind !== n.kind) out.push(`${n.no}번의 kind(발행한 판 ${p.kind}, 지금 ${n.kind})`);
    else if (p.choices !== n.choices) out.push(`${n.no}번의 choices(발행한 판 ${p.choices ?? '없음'}, 지금 ${n.choices ?? '없음'})`);
  });
  return out;
}

/** 채점에 영향을 주는 값이 달라진 문항. 인정하는 답은 차례와 상관없이 모음으로 견준다(answer 와 altAnswers 를 맞바꾼 것은 채점이 같다). */
export interface ScoringChange {
  no: number;
  /** 바뀐 것: 정답, 모두 정답 처리, 배점. */
  parts: string[];
}

function acceptedKey(s: ItemSummary): string {
  const accepted = acceptedAnswers({ ...s, typeId: '' });
  return [...accepted].sort((a, b) => a - b).join(',');
}

/** 문항 구성이 같은 두 요약에서 채점에 영향을 주는 값(answer, altAnswers, allCorrect, points)이 달라진 문항을 찾는다. */
export function scoringDiff(before: readonly ItemSummary[], after: readonly ItemSummary[]): ScoringChange[] {
  const out: ScoringChange[] = [];
  before.forEach((p, i) => {
    const n = after[i];
    if (!n) return;
    const parts: string[] = [];
    if (acceptedKey(p) !== acceptedKey(n)) parts.push('정답');
    if ((p.allCorrect === true) !== (n.allCorrect === true)) parts.push('모두 정답 처리');
    if (p.points !== n.points) parts.push('배점');
    if (parts.length > 0) out.push({ no: n.no, parts });
  });
  return out;
}

export function scoringText(changes: readonly ScoringChange[]): string {
  return changes.map((c) => `${c.no}번(${c.parts.join(', ')})`).join(', ');
}

/** 등급컷을 한 줄로 적는다(형식 예시: 추정, 기준 2030-01-02T20:10, 등급 3개). */
export function cutsText(c: ExamCuts): string {
  return `${c.confirmed ? '확정' : '추정'}, 기준 ${c.asOf}, 등급 ${Object.keys(c.grades).length}개`;
}

function hasNote(exam: Exam): boolean {
  return typeof exam.answersNote === 'string' && exam.answersNote.trim() !== '';
}

/**
 * 발행한 기록(prev)과 검사를 통과한 원본 시험(exam)을 견준다(작업 지시서 3의 6-4).
 * 거부: 판 번호(rev)가 내려감, 내용이 바뀌었는데 rev 가 그대로, answerReleased 가 true 에서 false 로, 문항의 no, kind, choices 가 바뀜,
 * 공개한 뒤 채점에 영향을 주는 값이 바뀌었는데 answersRev 를 올리지 않았거나 answersNote 가 없음, answersRev 가 내려감,
 * 채점이 그대로인데 answersRev 가 오름(거짓 정정 알림), 정답 공개 전에 발행한 시험의 answersRev 가 오름(처음 공개는 정정이 아님).
 * 알림: 내용은 같고 rev 만 오름, rev 나 answersRev 가 한 번에 2 이상 오름, 정정인데 answersNote 가 발행한 것과 같음,
 * 유형 분류를 마친 판을 낸 뒤 typesReady 가 false 로 돌아감, 발행한 등급컷을 뺌, 확정 컷이 추정으로 바뀌거나 값이 바뀜.
 */
export function compareWithPublished(prev: StateEntry, exam: Exam): ExamComparison {
  const findings: Finding[] = [];
  const changes: string[] = [];
  const error = (text: string) => findings.push({ level: 'error', text });
  const warn = (text: string) => findings.push({ level: 'warning', text });

  const rev = revOf(exam);
  const changed = examSha256(exam) !== prev.sha256;
  // rev 만 발행한 판으로 되돌렸을 때 바이트가 같으면 rev 말고는 바뀐 것이 없다.
  const onlyRev = changed && examSha256({ ...exam, rev: prev.rev }) === prev.sha256;

  if (rev < prev.rev) error(`rev 가 발행한 판(${prev.rev})보다 작아요(지금 ${rev}). 판 번호는 내려갈 수 없어요.`);
  if (changed && rev === prev.rev) error(`내용이 발행한 판과 다른데 rev 가 그대로예요(${rev}). 고쳐 낼 때는 rev 를 ${ro(prev.rev + 1)} 올려요.`);
  if (onlyRev && rev > prev.rev) warn(`내용은 발행한 판과 같고 rev 만 올랐어요(발행한 판 ${prev.rev}, 지금 ${rev}). 학생 화면은 바뀌지 않아요.`);
  if (rev > prev.rev + 1) warn(`rev 가 한 번에 2 이상 올랐어요(발행한 판 ${prev.rev}, 지금 ${rev}).`);
  if (!changed) return { findings, changes: [`발행한 판과 같아요(rev ${rev}).`] };
  changes.push(rev === prev.rev ? `rev ${rev} 그대로예요. 내용이 발행한 판과 달라요.` : `rev 가 ${prev.rev}에서 ${ro(rev)} 바뀌어요. 내용이 발행한 판과 달라요.`);

  // 정답 공개
  if (prev.answerReleased && !exam.answerReleased) {
    error('정답을 공개한 판을 발행했는데 answerReleased 가 false 로 돌아갔어요. 공개한 정답은 거둘 수 없어요.');
  } else if (!prev.answerReleased && exam.answerReleased) {
    changes.push('정답을 처음 공개해요(answerReleased 가 false 에서 true 로).');
  }

  // 문항 구성
  const now = exam.items.map(itemSummary);
  const structure = structureDiff(prev.items, now);
  if (structure.length > 0) {
    error(`문항 구성(no, kind, choices)이 발행한 판과 달라요: ${structure.join(', ')}. 발행한 시험의 문항 구성은 바꿀 수 없어요.`);
  }

  // 채점에 영향을 주는 값과 정답 판 번호(answersRev)
  const answersRev = answersRevOf(exam);
  const scoring = structure.length === 0 ? scoringDiff(prev.items, now) : [];
  if (answersRev < prev.answersRev) {
    error(`answersRev 가 발행한 판(${prev.answersRev})보다 작아요(지금 ${answersRev}). 정답 판 번호는 내려갈 수 없어요.`);
  }
  if (prev.answerReleased) {
    if (scoring.length > 0) {
      const list = scoringText(scoring);
      if (answersRev === prev.answersRev) {
        error(
          `공개한 정답이나 배점이 바뀌었는데(${list}) answersRev 를 올리지 않았어요(${prev.answersRev}). 정정이면 answersRev 를 ${ro(prev.answersRev + 1)} 올리고 answersNote 에 정정 안내를 적어요.`,
        );
      }
      if (!hasNote(exam)) error(`공개한 정답이나 배점이 바뀌었는데(${list}) answersNote 에 정정 안내가 없어요.`);
      if (answersRev > prev.answersRev + 1) warn(`answersRev 가 한 번에 2 이상 올랐어요(발행한 판 ${prev.answersRev}, 지금 ${answersRev}).`);
      if (answersRev > prev.answersRev && hasNote(exam) && exam.answersNote === prev.answersNote) {
        warn('answersRev 가 올랐는데 answersNote 가 발행한 판과 같아요. 이번 정정을 알리는 문장인지 확인해 주세요.');
      }
      changes.push(`정답 정정: 채점이 바뀌는 문항 ${list}. answersRev 가 ${prev.answersRev}에서 ${ro(answersRev)} 올라요. 정정 안내: "${exam.answersNote ?? ''}"`);
    } else if (answersRev > prev.answersRev) {
      error(
        `채점에 영향을 주는 값(answer, altAnswers, allCorrect, points)은 발행한 판과 같은데 answersRev 가 올랐어요(발행한 판 ${prev.answersRev}, 지금 ${answersRev}). 학생에게 거짓 정정 알림이 가요.`,
      );
    }
  } else {
    if (answersRev > prev.answersRev) {
      error(
        `정답을 공개하기 전에 발행한 시험인데 answersRev 가 올랐어요(발행한 판 ${prev.answersRev}, 지금 ${answersRev}). 처음 공개하는 정답은 정정이 아니라서 answersRev 를 올리지 않아요.`,
      );
    }
    const points = scoring.filter((c) => c.parts.includes('배점')).map((c) => c.no);
    if (points.length > 0) changes.push(`배점이 바뀌는 문항: ${nosText(points)}(정답 공개 전이라 정정이 아니에요).`);
  }
  if (exam.answersNote !== prev.answersNote && answersRev === prev.answersRev) changes.push('정정 안내(answersNote)가 바뀌어요.');

  // 유형 분류
  const typesReady = typesReadyOf(exam);
  const nowTypes = typeNames(exam);
  const typeLabel = (names: Record<string, string> | undefined, id: string) => names?.[id] ?? id;
  if (!prev.typesReady && typesReady) {
    changes.push('유형 분류를 마쳐요(typesReady 가 false 에서 true 로). 계단이 나와요.');
    // 유형마다 문항 수를 적고, 유형 분류 전에 모든 문항이 가리키던 자리만 채우는 유형을 아직 가리키는 문항이 있으면 알린다(별도 검토 B2).
    const counts = new Map<string, number>();
    for (const it of exam.items) counts.set(it.typeId, (counts.get(it.typeId) ?? 0) + 1);
    changes.push(`유형마다 문항 수: ${[...counts].map(([id, n]) => `${typeLabel(nowTypes, id)} ${n}개`).join(', ')}.`);
    const before = new Set(prev.items.map((p) => p.typeId));
    const placeholder = before.size === 1 ? [...before][0] : undefined;
    if (placeholder !== undefined) {
      const stay = exam.items.filter((it) => it.typeId === placeholder).map((it) => it.no);
      if (stay.length > 0) {
        warn(
          `유형 분류를 마치는 판인데, 유형 분류 전에 모든 문항이 가리키던 유형(${typeLabel(prev.types, placeholder)})을 아직 가리키는 문항이 있어요(${nosText(stay)}). 계단에 그 유형 이름이 나와요. 분류를 마쳤는지 확인해 주세요.`,
        );
      }
    }
  }
  if (prev.typesReady && !typesReady) {
    warn('유형 분류를 마친 판을 발행했는데 typesReady 가 false 로 돌아갔어요. 학생 화면에서 계단이 사라져요.');
    changes.push('유형 분류 전으로 돌아가요(typesReady 가 true 에서 false 로).');
  }
  // 유형 분류를 마친 판끼리: 문항의 유형(typeId)과 유형 이름이 바뀐 것(별도 검토 B2). 학생 화면의 계단(유형별 점수, 유형 이름, 다시 풀 문항)이 바뀐다.
  // 발행 기록에 유형이 적혀 있지 않으면(이 칸을 더하기 전의 기록) 견주지 않는다.
  if (prev.typesReady && typesReady && structure.length === 0) {
    const retyped = prev.items.flatMap((p, i) =>
      p.typeId !== undefined && now[i].typeId !== p.typeId ? [`${p.no}번(발행한 판 ${typeLabel(prev.types, p.typeId)}, 지금 ${typeLabel(nowTypes, now[i].typeId as string)})`] : [],
    );
    if (retyped.length > 0) changes.push(`유형이 바뀌는 문항: ${retyped.join(', ')}.`);
    const oldNames = prev.types ?? {};
    const renamed = Object.keys(oldNames).filter((id) => Object.prototype.hasOwnProperty.call(nowTypes, id) && nowTypes[id] !== oldNames[id]);
    if (renamed.length > 0) changes.push(`유형 이름이 바뀌어요: ${renamed.map((id) => `${id}(발행한 판 ${oldNames[id]}, 지금 ${nowTypes[id]})`).join(', ')}.`);
  }

  // 등급컷
  const before = prev.cuts;
  const after = exam.cuts;
  if (!before && after) changes.push(`등급컷을 처음 넣어요(${cutsText(after)}).`);
  if (before && !after) {
    warn('발행한 등급컷을 뺐어요. 학생 화면에서 등급컷이 사라져요.');
    changes.push('등급컷을 빼요.');
  }
  if (before && after && canonicalJson(before) !== canonicalJson(after)) {
    changes.push(`등급컷이 바뀌어요(발행한 판: ${cutsText(before)}, 지금: ${cutsText(after)}).`);
    if (before.confirmed && !after.confirmed) warn('주관 기관이 발표한 컷(confirmed true)으로 발행한 등급컷이 추정으로 바뀌었어요.');
    else if (before.confirmed) warn('주관 기관이 발표한 컷(confirmed true)의 값이나 기준이 바뀌었어요. 발표를 다시 확인해 주세요.');
  }
  return { findings, changes };
}

/** 발행 기록에 있는데 원본에 없는 시험 id. present 는 원본 폴더에 있는 시험 id(파일 이름과 파일 안의 id)다. */
export function missingExams(state: ExamState, present: ReadonlySet<string>): string[] {
  return Object.keys(state.exams).filter((id) => !present.has(id));
}
