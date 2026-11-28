import { randomUUID } from 'node:crypto';
import { linkSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateExam } from '../../src/exams/validate.ts';
import type { Exam, ExamItem, ExamType } from '../../src/types.ts';
import { BUNDLED_EXAMS_DIR, examPath, sourceJson } from './data.ts';
import type { Io } from './io.ts';

const ID = 'suneung-2027-math-probstat';
const COLUMNS = ['no', 'kind', 'choices', 'points', 'answer', 'typeId', 'memo'];
const COUNT = 30;

// Excel의 UTF-8 CSV에서 따옴표, 쉼표, 셀 안 줄바꿈을 셀 값으로 읽는다.
function csvRows(source: string): string[][] {
  let text = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (text.endsWith('\n')) text = text.slice(0, -1);
  if (text.length === 0) return [];
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;
  let closed = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch !== '"') value += ch;
      else if (text[i + 1] === '"') {
        value += '"';
        i += 1;
      } else {
        quoted = false;
        closed = true;
      }
    } else if (ch === ',' || ch === '\n') {
      row.push(value);
      if (ch === '\n') {
        rows.push(row);
        row = [];
      }
      value = '';
      closed = false;
    } else if (ch === '"' && value === '' && !closed) {
      quoted = true;
    } else {
      if (ch === '"' || closed) throw new Error((rows.length + 1) + '번째 행의 CSV 따옴표 위치를 확인해 주세요.');
      value += ch;
    }
  }
  if (quoted) throw new Error((rows.length + 1) + '번째 행의 CSV 따옴표가 닫히지 않았어요.');
  row.push(value);
  rows.push(row);
  return rows;
}

function readSheet(file: string, errors: string[]): string[][] | null {
  try {
    const bytes = readFileSync(file);
    return csvRows(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(file + ' 파일을 UTF-8 CSV로 읽지 못했어요. ' + message);
    return null;
  }
}

function columnName(index: number): string {
  return COLUMNS[index] ?? (index + 1) + '번째 칸';
}

function findDifferences(first: string[][], second: string[][]): string[] {
  const differences: string[] = [];
  for (let r = 0; r < Math.max(first.length, second.length); r += 1) {
    const a = first[r] ?? [];
    const b = second[r] ?? [];
    const where = r === 0 ? '머리글' : r + '번 자리';
    for (let c = 0; c < Math.max(a.length, b.length); c += 1) {
      if (a[c] !== b[c]) {
        const left = a[c] === undefined ? '(칸 없음)' : JSON.stringify(a[c]);
        const right = b[c] === undefined ? '(칸 없음)' : JSON.stringify(b[c]);
        differences.push(where + ' ' + columnName(c) + ' 다름: 1번 장 ' + left + ', 2번 장 ' + right);
      }
    }
  }
  return differences;
}

function integer(cell: string): number {
  if (!/^[0-9]+$/.test(cell)) return NaN;
  const n = Number(cell);
  return Number.isSafeInteger(n) ? n : NaN;
}

function checkSheet(rows: string[][], types: Record<string, ExamType>, errors: string[]): ExamItem[] {
  const header = rows[0] ?? [];
  if (header.length !== COLUMNS.length || COLUMNS.some((name, i) => header[i] !== name)) {
    errors.push('첫 줄의 칸 이름과 순서는 ' + COLUMNS.join(',') + '여야 해요.');
  }
  if (rows.length !== COUNT + 1) errors.push('머리글 다음에 1번부터 30번까지 한 줄씩 있어야 해요.');
  const items: ExamItem[] = [];
  for (let no = 1; no <= COUNT; no += 1) {
    const row = rows[no];
    const where = no + '번 자리 ';
    if (!row) {
      errors.push(where + '행이 없어요.');
      continue;
    }
    if (row.length !== COLUMNS.length) errors.push(where + '칸 수가 ' + COLUMNS.length + '개여야 해요.');
    const [numberCell, kind, choices, pointsCell, answerCell, typeId] = row;
    const mc = no <= 15 || (no >= 23 && no <= 28);
    if (numberCell !== String(no)) errors.push(where + 'no는 ' + no + '여야 해요.');
    if (kind !== (mc ? 'mc' : 'short')) errors.push(where + 'kind는 ' + (mc ? 'mc' : 'short') + '여야 해요.');
    if (choices !== (mc ? '5' : '')) errors.push(where + (mc ? 'choices는 5여야 해요.' : '단답형의 choices는 비워 주세요.'));
    const points = integer(pointsCell ?? '');
    const answer = integer(answerCell ?? '');
    if (!(points > 0)) errors.push(where + 'points에 배점을 양의 정수로 적어 주세요.');
    const min = mc ? 1 : 0;
    const max = mc ? 5 : 999;
    if (!(answer >= min && answer <= max)) errors.push(where + 'answer에 ' + min + '~' + max + ' 정답을 적어 주세요.');
    if (!Object.hasOwn(types, typeId)) errors.push(where + 'typeId에 안내 문서의 유형 번호를 적어 주세요.');
    items.push({ no, kind: mc ? 'mc' : 'short', ...(mc ? { choices: 5 } : {}), points, answer, typeId });
  }
  if (items.length === COUNT && items.every(it => it.points > 0)) {
    const total = items.reduce((sum, it) => sum + it.points, 0);
    if (total !== 100) errors.push('배점 합계가 ' + total + '점이에요. 100점이어야 해요.');
  }
  return items;
}

// 이미 있는 원본은 보존한다. 동시에 실행해도 완성된 파일 하나만 처음 이름을 얻는다.
function createSource(path: string, text: string): 'created' | 'same' | 'different' {
  const temp = path + '.' + randomUUID() + '.tmp';
  try {
    writeFileSync(temp, text, { flag: 'wx' });
    try {
      linkSync(temp, path);
      return 'created';
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      return readFileSync(path, 'utf8').replace(/\r\n/g, '\n') === text ? 'same' : 'different';
    }
  } finally {
    rmSync(temp, { force: true });
  }
}

export function runEntry(dataDir: string, form: string | undefined, io: Io): number {
  if (form !== undefined && form !== '홀수형' && form !== '짝수형') {
    io.err('문형은 시험지에 표시된 홀수형 또는 짝수형으로 적어 주세요.');
    return 2;
  }
  const errors: string[] = [];
  const firstPath = join(dataDir, 'entry', ID + '.1.csv');
  const secondPath = join(dataDir, 'entry', ID + '.2.csv');
  const first = readSheet(firstPath, errors);
  const second = readSheet(secondPath, errors);
  if (first === null || second === null) {
    errors.forEach(e => io.err(e));
    return 1;
  }
  const a = statSync(firstPath, { bigint: true });
  const b = statSync(secondPath, { bigint: true });
  if (a.ino !== 0n && a.dev === b.dev && a.ino === b.ino) {
    io.err('두 입력지가 같은 파일을 가리켜요. 각각 따로 작성한 CSV 두 개가 필요해요.');
    return 1;
  }
  const different = findDifferences(first, second);
  errors.push(...different);
  // 예시의 유형 이름만 가져온다. 예시 문항, 답, 좌표는 실제 시험 자료가 아니다.
  const sample: Exam = JSON.parse(readFileSync(join(BUNDLED_EXAMS_DIR, 'sample-a.json'), 'utf8'));
  const types: Record<string, ExamType> = Object.fromEntries(Object.entries(sample.types).map(([id, type]) => [id, { name: type.name }]));
  const firstErrors: string[] = [];
  const items = checkSheet(first, types, firstErrors);
  const prefix = different.length === 0 ? '두 입력지: ' : '1번 장: ';
  errors.push(...firstErrors.map(e => prefix + e));
  if (different.length > 0) {
    const secondErrors: string[] = [];
    checkSheet(second, types, secondErrors);
    errors.push(...secondErrors.map(e => '2번 장: ' + e));
  }
  const exam: Exam = {
    id: ID, title: '2027학년도 수능 수학(확률과 통계)',
    note: '공통 1~22번, 확률과 통계 23~30번' + (form ? ' (' + form + ')' : ''),
    examDate: '2026-11-19', isSample: false, isPast: true, answerReleased: true, rev: 1,
    items, types,
  };
  if (errors.length === 0) errors.push(...validateExam(exam));
  if (errors.length > 0) {
    errors.forEach(e => io.err(e));
    return 1;
  }
  const path = examPath(dataDir, ID);
  const result = createSource(path, sourceJson(exam));
  if (result === 'different') {
    io.err('이미 내용이 다른 원본이 있어요. 기존 파일을 보존했어요: ' + path);
    return 1;
  }
  io.out('입력지 두 장의 30문항이 모두 같고 배점 합계는 100점이에요.');
  const unsure = items.filter(it => first[it.no][6].includes('확실하지 않음')).map(it => it.no);
  io.out('유형이 확실하지 않음: ' + (unsure.length ? unsure.join(', ') + '번' : '없음'));
  io.out((result === 'created' ? '원본을 만들었어요: ' : '이미 같은 원본이에요: ') + path);
  return 0;
}
