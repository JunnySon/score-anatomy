import { isValidYmd } from '../logic/dates';
import type { Exam, ExamItem } from '../types';

export const SHORT_MIN = 0;
export const SHORT_MAX = 999;
export const DEFAULT_CHOICES = 5;

export function choicesOf(item: ExamItem): number {
  return item.kind === 'mc' ? (item.choices ?? DEFAULT_CHOICES) : 0;
}

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}

/** 넣을 수 있는 답인지 본다. 5지선다는 1부터 보기 수까지, 단답형은 0부터 999까지. */
export function isValidAnswerNumber(item: ExamItem, v: unknown): v is number {
  if (!isInt(v)) return false;
  if (item.kind === 'mc') return v >= 1 && v <= choicesOf(item);
  return v >= SHORT_MIN && v <= SHORT_MAX;
}

/** 시험 JSON을 검사한다. 문제가 있으면 사람이 읽을 수 있는 오류 목록을 돌려준다. */
export function validateExam(raw: unknown): string[] {
  const errors: string[] = [];
  if (typeof raw !== 'object' || raw === null) return ['시험 데이터가 객체가 아니에요.'];
  const e = raw as Partial<Exam> & Record<string, unknown>;
  for (const key of ['id', 'title', 'note'] as const) {
    if (typeof e[key] !== 'string' || e[key] === '') errors.push(`${key} 값이 비어 있어요.`);
  }
  for (const key of ['isSample', 'isPast', 'answerReleased'] as const) {
    if (typeof e[key] !== 'boolean') errors.push(`${key} 값은 true나 false여야 해요.`);
  }
  // 시행일은 없어도 된다. 있으면 실제로 있는 날짜여야 한다(2027-02-29 같은 값은 거른다).
  if (e.examDate !== undefined && !isValidYmd(e.examDate)) errors.push('examDate는 2030-01-02 같은, 실제로 있는 날짜여야 해요.');
  const types = (typeof e.types === 'object' && e.types !== null ? e.types : {}) as Exam['types'];
  if (Object.keys(types).length === 0) errors.push('types가 비어 있어요.');
  for (const [id, t] of Object.entries(types)) {
    if (!t || typeof t.name !== 'string' || t.name === '') errors.push(`유형 ${id}의 name이 비어 있어요.`);
    for (const c of t?.coords ?? []) {
      if (typeof c.label !== 'string' || c.label === '' || !isInt(c.itemNo) || c.itemNo < 1) {
        errors.push(`유형 ${id}의 좌표는 label과 itemNo가 있어야 해요.`);
      }
    }
  }
  if (!Array.isArray(e.items) || e.items.length === 0) {
    errors.push('items가 비어 있어요.');
    return errors;
  }
  let prevNo = 0;
  for (const it of e.items as ExamItem[]) {
    const where = `${it?.no}번`;
    if (!isInt(it?.no) || it.no <= prevNo) errors.push(`${where}: 문항 번호는 1부터 커지는 순서여야 해요.`);
    prevNo = isInt(it?.no) ? it.no : prevNo;
    if (it.kind !== 'mc' && it.kind !== 'short') errors.push(`${where}: kind는 mc나 short여야 해요.`);
    if (!isInt(it.points) || it.points <= 0) errors.push(`${where}: points는 1 이상의 정수여야 해요.`);
    if (it.kind === 'mc' && it.choices !== undefined && (!isInt(it.choices) || it.choices < 2 || it.choices > 9)) {
      errors.push(`${where}: choices는 2부터 9까지예요.`);
    }
    if (typeof it.typeId !== 'string' || !(it.typeId in types)) errors.push(`${where}: typeId가 types에 없어요.`);
    const hasAnswer = it.answer !== undefined && it.answer !== null;
    if (e.answerReleased === true && !hasAnswer) errors.push(`${where}: 정답 공개 상태인데 answer가 없어요.`);
    if (hasAnswer && (it.kind === 'mc' || it.kind === 'short') && !isValidAnswerNumber(it, it.answer)) {
      errors.push(`${where}: answer가 범위를 벗어났어요.`);
    }
  }
  if (e.cuts !== undefined && e.cuts !== null && (typeof e.cuts !== 'object' || Array.isArray(e.cuts))) {
    errors.push('cuts는 객체여야 해요. 자료가 없으면 칸을 빼요.');
  } else if (e.cuts !== undefined && e.cuts !== null) {
    const c = e.cuts;
    if (typeof c.source !== 'string' || c.source === '') errors.push('cuts.source가 비어 있어요.');
    if (!isValidYmd(c.asOf)) errors.push('cuts.asOf는 2026-11-22 같은, 실제로 있는 날짜여야 해요.');
    if (typeof c.confirmed !== 'boolean') errors.push('cuts.confirmed는 true나 false여야 해요.');
    const grades = typeof c.grades === 'object' && c.grades !== null ? Object.entries(c.grades) : [];
    if (grades.length === 0) errors.push('cuts.grades가 비어 있어요.');
    for (const [g, range] of grades) {
      if (!/^[1-9]$/.test(g)) errors.push(`cuts.grades의 등급 이름 ${g}는 1부터 9까지의 숫자여야 해요.`);
      if (!Array.isArray(range) || range.length !== 2 || !isInt(range[0]) || !isInt(range[1]) || range[0] > range[1]) {
        errors.push(`cuts.grades ${g}등급은 [낮은 값, 높은 값]이어야 해요.`);
      } else if (c.confirmed === true && range[0] !== range[1]) {
        errors.push(`cuts.grades ${g}등급: 확정 컷은 두 값이 같아야 해요.`);
      }
    }
  }
  return errors;
}

/** 검사를 통과한 시험만 돌려준다. 통과하지 못하면 null. cuts가 null이면 없는 것으로 본다. */
export function parseExam(raw: unknown): Exam | null {
  if (validateExam(raw).length > 0) return null;
  const exam = raw as Exam & { cuts?: Exam['cuts'] | null };
  if (exam.cuts === null) {
    const { cuts: _none, ...rest } = exam;
    return rest as Exam;
  }
  return exam as Exam;
}
