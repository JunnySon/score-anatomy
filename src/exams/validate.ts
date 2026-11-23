import { isValidYmd, parseAsOf, parseYmdHm } from '../logic/dates';
import type { Exam, ExamItem, LockEntry } from '../types';

// 시험 파일(JSON)과 풀이 잠금 달력의 검사, 시험 파일 선택 칸의 기본값.
// 묶음 안 자료, 껍데기가 넘겨준 자료, 발행 도구가 모두 이 규칙을 쓴다(작업 지시서 3의 4-5, 5-2, 6-4). 규칙을 두 벌로 만들지 않는다.
// 넘겨받은 자료는 모양이 크게 틀릴 수 있어서, 검사는 어떤 값을 받아도 던지지 않고 오류 문장을 돌려준다.

export const SHORT_MIN = 0;
export const SHORT_MAX = 999;
export const DEFAULT_CHOICES = 5;

export function choicesOf(item: ExamItem): number {
  return item.kind === 'mc' ? (item.choices ?? DEFAULT_CHOICES) : 0;
}

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}

/** 객체인지. 배열과 null 은 객체로 보지 않는다. */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 그 객체에 직접 적힌 칸인지. "constructor" 처럼 모든 객체가 물려받는 이름은 직접 적힌 칸이 아니다. */
function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/** 넣을 수 있는 답인지 본다. 5지선다는 1부터 보기 수까지, 단답형은 0부터 999까지. */
export function isValidAnswerNumber(item: ExamItem, v: unknown): v is number {
  if (!isInt(v)) return false;
  if (item.kind === 'mc') return v >= 1 && v <= choicesOf(item);
  return v >= SHORT_MIN && v <= SHORT_MAX;
}

// 선택 칸의 기본값(작업 지시서 3의 4-1~4-3). 칸이 없을 때의 값은 여기 한 곳에서 정한다.

/** 판 번호(rev). 없으면 1이다. */
export function revOf(exam: Exam): number {
  return exam.rev ?? 1;
}

/** 정답 판 번호(answersRev). 없으면 1이다. */
export function answersRevOf(exam: Exam): number {
  return exam.answersRev ?? 1;
}

/** 유형 분류가 끝났는지(typesReady). 칸이 없으면 끝난 것으로 보고, false 로 적었을 때만 false 다. */
export function typesReadyOf(exam: Exam): boolean {
  return exam.typesReady !== false;
}

/**
 * 정답으로 인정하는 답. answer 다음에 복수 정답(altAnswers)을 적힌 차례대로 담는다. 정답 공개 전(answer 없음)이면 빈 배열이다.
 * 모두 정답 처리(allCorrect)는 여기에 넣지 않는다. 채점에서 따로 본다.
 */
export function acceptedAnswers(item: ExamItem): number[] {
  if (item.answer === undefined || item.answer === null) return [];
  return [item.answer, ...(item.altAnswers ?? [])];
}

/**
 * 등급컷 값(cuts.grades)을 검사한다. 등급 이름은 1~9, 값은 [낮은 값, 높은 값] 정수이고 0점부터 만점(total)까지다.
 * 높은 등급(작은 번호)의 컷은 낮은 등급의 컷보다 낮을 수 없다. 낮은 값끼리, 높은 값끼리 견주고 같은 값은 받는다.
 * 시험 파일 검사와 발행 도구(exams:cuts)가 함께 쓴다. 확정 컷의 두 값이 같아야 한다는 검사는 validateExam 에 있다.
 */
export function validateCutGrades(grades: unknown, total: number): string[] {
  if (!isRecord(grades)) return ['cuts.grades는 등급별 [낮은 값, 높은 값]을 담은 객체여야 해요.'];
  const entries = Object.entries(grades);
  if (entries.length === 0) return ['cuts.grades가 비어 있어요.'];
  const errors: string[] = [];
  const known: { grade: number; lo: number; hi: number }[] = [];
  for (const [g, range] of entries) {
    const named = /^[1-9]$/.test(g);
    if (!named) errors.push(`cuts.grades의 등급 이름 ${g}는 1부터 9까지의 숫자여야 해요.`);
    if (!Array.isArray(range) || range.length !== 2 || !isInt(range[0]) || !isInt(range[1]) || range[0] > range[1]) {
      errors.push(`cuts.grades ${g}등급은 [낮은 값, 높은 값]이어야 해요.`);
    } else if (range[0] < 0 || range[1] > total) {
      errors.push(`cuts.grades ${g}등급의 값은 0점부터 만점(${total}점)까지여야 해요.`);
    } else if (named) {
      known.push({ grade: Number(g), lo: range[0], hi: range[1] });
    }
  }
  known.sort((a, b) => a.grade - b.grade);
  for (let i = 1; i < known.length; i += 1) {
    const upper = known[i - 1];
    const lower = known[i];
    if (upper.lo < lower.lo || upper.hi < lower.hi) errors.push(`cuts.grades ${upper.grade}등급 컷이 ${lower.grade}등급 컷보다 낮아요.`);
  }
  return errors;
}

/** 문항의 정답 칸(answer, altAnswers, allCorrect)을 검사한다(작업 지시서 3의 4-2). */
function answerErrors(it: Record<string, unknown>, where: string, released: boolean): string[] {
  const errors: string[] = [];
  const item = it as unknown as ExamItem;
  const ranged = it.kind === 'mc' || it.kind === 'short';
  const hasAnswer = it.answer !== undefined && it.answer !== null;
  if (it.allCorrect !== undefined && it.allCorrect !== true) {
    errors.push(`${where}: allCorrect는 true만 쓸 수 있어요. 모두 정답 처리가 아니면 칸을 빼요.`);
  }
  // 모두 정답 처리 문항은 넣은 답과 상관없이 맞은 것으로 채점하므로, 정답을 공개한 뒤에도 answer 가 없어도 된다.
  if (released && !hasAnswer && it.allCorrect !== true) errors.push(`${where}: 정답 공개 상태인데 answer가 없어요.`);
  if (hasAnswer && ranged && !isValidAnswerNumber(item, it.answer)) errors.push(`${where}: answer가 범위를 벗어났어요.`);
  if (it.altAnswers === undefined) return errors;
  const alt = it.altAnswers;
  if (!Array.isArray(alt) || alt.length === 0) {
    errors.push(`${where}: altAnswers는 다른 정답을 담은 배열이어야 해요. 다른 정답이 없으면 칸을 빼요.`);
  } else if (!hasAnswer) {
    errors.push(`${where}: answer 없이 altAnswers만 있어요.`);
  } else {
    if (ranged && !alt.every((v) => isValidAnswerNumber(item, v))) errors.push(`${where}: altAnswers에 범위를 벗어난 답이 있어요.`);
    if (alt.includes(it.answer)) errors.push(`${where}: altAnswers에 answer와 같은 답이 있어요.`);
    if (new Set(alt).size !== alt.length) errors.push(`${where}: altAnswers에 겹치는 답이 있어요.`);
  }
  return errors;
}

function collectErrors(raw: unknown): string[] {
  if (!isRecord(raw)) return ['시험 데이터가 객체가 아니에요.'];
  const errors: string[] = [];
  const e = raw;
  for (const key of ['id', 'title', 'note'] as const) {
    if (typeof e[key] !== 'string' || e[key] === '') errors.push(`${key} 값이 비어 있어요.`);
  }
  for (const key of ['isSample', 'isPast', 'answerReleased'] as const) {
    if (typeof e[key] !== 'boolean') errors.push(`${key} 값은 true나 false여야 해요.`);
  }
  // 시행일은 없어도 된다. 있으면 실제로 있는 날짜여야 한다(2027-02-29 같은 값은 거른다).
  if (e.examDate !== undefined && !isValidYmd(e.examDate)) errors.push('examDate는 2030-01-02 같은, 실제로 있는 날짜여야 해요.');
  // 판 번호와 정답 판 번호(4-1, 4-2). 칸이 없으면 1로 본다.
  for (const key of ['rev', 'answersRev'] as const) {
    const v = e[key];
    if (v !== undefined && (!isInt(v) || v < 1)) errors.push(`${key} 값은 1 이상의 정수여야 해요. 칸이 없으면 1로 봐요.`);
  }
  // 정정 안내(4-2). 학생에게 그대로 보이는 문장이라 비어 있으면 안 되고, 정답을 정정했으면(answersRev 2 이상) 꼭 있어야 한다.
  if (e.answersNote !== undefined) {
    if (typeof e.answersNote !== 'string' || e.answersNote.trim() === '') errors.push('answersNote 값이 비어 있어요.');
  } else if (isInt(e.answersRev) && e.answersRev >= 2) {
    errors.push('answersRev가 2 이상이면 answersNote에 정정 안내를 적어야 해요.');
  }
  // 유형 분류(4-3). 칸이 없으면 true 로 본다.
  if (e.typesReady !== undefined && typeof e.typesReady !== 'boolean') {
    errors.push('typesReady 값은 true나 false여야 해요. 칸이 없으면 true로 봐요.');
  }
  const types: Record<string, unknown> = isRecord(e.types) ? e.types : {};
  if (Object.keys(types).length === 0) errors.push('types가 비어 있어요.');
  for (const [id, t] of Object.entries(types)) {
    if (!isRecord(t) || typeof t.name !== 'string' || t.name === '') errors.push(`유형 ${id}의 name이 비어 있어요.`);
    // 좌표는 없어도 된다(null 도 없는 것으로 본다).
    const coords = isRecord(t) ? t.coords : undefined;
    if (coords === undefined || coords === null) continue;
    if (!Array.isArray(coords)) {
      errors.push(`유형 ${id}의 coords는 좌표 목록(배열)이어야 해요. 좌표가 없으면 칸을 빼요.`);
      continue;
    }
    for (const c of coords) {
      if (!isRecord(c) || typeof c.label !== 'string' || c.label === '' || !isInt(c.itemNo) || c.itemNo < 1) {
        errors.push(`유형 ${id}의 좌표는 label과 itemNo가 있어야 해요.`);
      }
    }
  }
  if (!Array.isArray(e.items) || e.items.length === 0) {
    errors.push('items가 비어 있어요.');
    return errors;
  }
  const items: unknown[] = e.items;
  let prevNo = 0;
  // 만점(배점의 합). 배점을 읽을 수 없는 문항이 있으면 만점을 모르므로 컷 값의 위쪽 끝은 보지 않는다(그 문항의 오류로 이미 걸러진다).
  let total = 0;
  let totalKnown = true;
  for (let i = 0; i < items.length; i += 1) {
    const it = items[i];
    if (!isRecord(it)) {
      errors.push(`${i + 1}번째 문항이 객체가 아니에요.`);
      totalKnown = false;
      continue;
    }
    // 번호를 읽을 수 없으면 몇 번째 문항인지로 가리킨다.
    const where = isInt(it.no) ? `${it.no}번` : `${i + 1}번째 문항`;
    if (!isInt(it.no) || it.no <= prevNo) errors.push(`${where}: 문항 번호는 1부터 커지는 순서여야 해요.`);
    if (isInt(it.no)) prevNo = it.no;
    if (it.kind !== 'mc' && it.kind !== 'short') errors.push(`${where}: kind는 mc나 short여야 해요.`);
    if (isInt(it.points) && it.points > 0) {
      total += it.points;
    } else {
      errors.push(`${where}: points는 1 이상의 정수여야 해요.`);
      totalKnown = false;
    }
    if (it.kind === 'mc' && it.choices !== undefined && (!isInt(it.choices) || it.choices < 2 || it.choices > 9)) {
      errors.push(`${where}: choices는 2부터 9까지예요.`);
    }
    if (typeof it.typeId !== 'string' || !hasOwn(types, it.typeId)) errors.push(`${where}: typeId가 types에 없어요.`);
    errors.push(...answerErrors(it, where, e.answerReleased === true));
  }
  if (e.cuts !== undefined && e.cuts !== null) {
    if (!isRecord(e.cuts)) {
      errors.push('cuts는 객체여야 해요. 자료가 없으면 칸을 빼요.');
    } else {
      const c = e.cuts;
      if (typeof c.source !== 'string' || c.source === '') errors.push('cuts.source가 비어 있어요.');
      // 기준은 날짜만이거나 날짜와 시각(한국 시간)이다(작업 지시서 3의 4-4).
      if (parseAsOf(c.asOf) === null) {
        errors.push('cuts.asOf는 2026-11-22 같은 날짜나 2030-01-02T20:10 같은 날짜와 시각(한국 시간)이어야 해요. 실제로 있는 값만 받아요.');
      }
      if (typeof c.confirmed !== 'boolean') errors.push('cuts.confirmed는 true나 false여야 해요.');
      errors.push(...validateCutGrades(c.grades, totalKnown ? total : Number.POSITIVE_INFINITY));
      // 확정 컷(주관 기관이 원점수 컷을 발표한 값)은 등급마다 한 값이다.
      if (c.confirmed === true && isRecord(c.grades)) {
        for (const [g, range] of Object.entries(c.grades)) {
          if (Array.isArray(range) && range.length === 2 && isInt(range[0]) && isInt(range[1]) && range[0] < range[1]) {
            errors.push(`cuts.grades ${g}등급: 확정 컷은 두 값이 같아야 해요.`);
          }
        }
      }
    }
  }
  return errors;
}

/** 시험 JSON을 검사한다. 문제가 있으면 사람이 읽을 수 있는 오류 목록을 돌려준다. 모양이 틀린 자료를 받아도 던지지 않는다. */
export function validateExam(raw: unknown): string[] {
  try {
    return collectErrors(raw);
  } catch {
    // 위 검사가 미처 막지 못한 모양에서 멈추더라도 던지지 않고, 통과시키지도 않는다.
    return ['시험 데이터를 끝까지 검사하지 못했어요.'];
  }
}

/** 검사 결과. 통과하면 exam 에 시험이 있고 errors 는 비어 있다. 통과하지 못하면 exam 은 null 이고 errors 가 버린 이유다. */
export interface ExamCheck {
  exam: Exam | null;
  errors: string[];
}

/**
 * 시험 JSON을 검사해 통과한 시험이나 버린 이유를 돌려준다. 던지지 않는다.
 * 넘겨받은 시험을 하나씩 검사해 통과하지 못한 것을 버리고 이유를 남길 때 쓴다(작업 지시서 3의 5-2).
 * 받은 객체를 고치지 않고 그대로 돌려준다(기본값을 채우지 않는다). cuts가 null이면 그 칸만 뺀 얕은 사본이다.
 */
export function checkExam(raw: unknown): ExamCheck {
  const errors = validateExam(raw);
  if (errors.length > 0) return { exam: null, errors };
  try {
    const exam = raw as Exam & { cuts?: Exam['cuts'] | null };
    if (exam.cuts === null) {
      const { cuts: _none, ...rest } = exam;
      return { exam: rest as Exam, errors: [] };
    }
    return { exam, errors: [] };
  } catch {
    return { exam: null, errors: ['시험 데이터를 읽지 못했어요.'] };
  }
}

/** 검사를 통과한 시험만 돌려준다. 통과하지 못하면 null. cuts가 null이면 없는 것으로 본다. 던지지 않는다. */
export function parseExam(raw: unknown): Exam | null {
  return checkExam(raw).exam;
}

// 풀이 잠금 달력(작업 지시서 3의 4-5). 항목의 배열이고, 항목은 id, label, start, end 다.
// 판정과 두 달력 합치기는 src/logic/lock.ts 에 있다.

/** 빈칸뿐이 아닌 글자인지. */
function isFilled(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== '';
}

function lockEntryErrors(raw: unknown, where: string): string[] {
  if (!isRecord(raw)) return [`${where}이 객체가 아니에요.`];
  const errors: string[] = [];
  if (!isFilled(raw.id)) errors.push(`${where}: id 값이 비어 있어요.`);
  // label 은 화면에 쓰지 않지만, 사람이 달력을 읽고 고칠 때 항목을 알아볼 수 있게 비우지 않는다.
  if (!isFilled(raw.label)) errors.push(`${where}: label 값이 비어 있어요.`);
  const start = parseYmdHm(raw.start);
  const end = parseYmdHm(raw.end);
  if (!start) errors.push(`${where}: start는 2030-01-02T08:40 같은, 실제로 있는 날짜와 시각(한국 시간)이어야 해요.`);
  if (!end) errors.push(`${where}: end는 2030-01-02T17:45 같은, 실제로 있는 날짜와 시각(한국 시간)이어야 해요.`);
  if (start && end) {
    if (start.y !== end.y || start.m !== end.m || start.d !== end.d) errors.push(`${where}: start와 end는 같은 날이어야 해요.`);
    // 같은 모양의 글자는 글자 순서가 곧 시각 순서다(src/logic/dates.ts 의 compareYmd).
    if ((raw.start as string) >= (raw.end as string)) errors.push(`${where}: start가 end보다 앞서야 해요.`);
  }
  return errors;
}

/**
 * 잠금 달력의 항목 하나를 검사한다. id 와 label 은 빈칸뿐이 아닌 글자, start 와 end 는 "YYYY-MM-DDTHH:mm"(한국 시간)이고
 * 같은 날이며 start 가 end 보다 앞서야 한다. 다른 칸은 보지 않는다. where 는 오류 문장 앞에 붙이는 이름이다. 던지지 않는다.
 */
export function validateLockEntry(raw: unknown, where = '잠금 항목'): string[] {
  try {
    return lockEntryErrors(raw, where);
  } catch {
    return [`${where}을 끝까지 검사하지 못했어요.`];
  }
}

/** 형식에 맞는 잠금 항목인지. */
export function isLockEntry(raw: unknown): raw is LockEntry {
  return validateLockEntry(raw).length === 0;
}

/** 잠금 달력의 검사 결과. entries 는 쓸 수 있는 항목(받은 객체 그대로), errors 는 버린 것의 이유다. */
export interface LockCheck {
  entries: LockEntry[];
  errors: string[];
}

/**
 * 잠금 달력을 검사해 쓸 수 있는 항목과 버린 이유를 돌려준다. 던지지 않는다.
 * 달력이 배열이 아니면 쓸 수 있는 항목이 없다. 형식이 틀린 항목과, 앞에서 받은 항목과 id 가 겹치는 항목은 버린다.
 * 항목끼리 시간이 겹치거나 이어 붙는 것은 받는다.
 */
export function checkLocks(raw: unknown): LockCheck {
  if (!Array.isArray(raw)) return { entries: [], errors: ['잠금 달력은 항목의 배열이어야 해요. 항목이 없으면 빈 배열([])로 둬요.'] };
  const entries: LockEntry[] = [];
  const errors: string[] = [];
  try {
    const items: unknown[] = raw;
    for (let i = 0; i < items.length; i += 1) {
      const entry = items[i];
      const where = `${i + 1}번째 항목`;
      const found = validateLockEntry(entry, where);
      if (found.length > 0) {
        errors.push(...found);
      } else if (entries.some((e) => e.id === (entry as LockEntry).id)) {
        errors.push(`${where}: 앞의 항목과 id가 겹쳐요(${(entry as LockEntry).id}).`);
      } else {
        entries.push(entry as LockEntry);
      }
    }
  } catch {
    // 위 검사가 미처 막지 못한 모양에서 멈추면 그때까지 확인한 항목만 쓴다.
    errors.push('잠금 달력을 끝까지 검사하지 못했어요.');
  }
  return { entries, errors };
}

/** 잠금 달력을 검사한다. 문제가 있으면 사람이 읽을 수 있는 오류 목록을 돌려준다. 발행 도구는 오류가 하나라도 있으면 발행하지 않는다. */
export function validateLocks(raw: unknown): string[] {
  return checkLocks(raw).errors;
}
