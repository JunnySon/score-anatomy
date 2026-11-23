import { compareYmd, parseYmdHm } from '../logic/dates';
import type { Exam } from '../types';
import { answersRevOf, checkExam, choicesOf, revOf } from './validate';

// 넘겨받은 시험 자료(다리 규격 2의 remote)를 읽고 묶음 안 시험과 합친다(작업 지시서 3의 5-2). 순수 함수만 둔다.
// 화면, 기록 저장소, 플랫폼(#platform)을 가져오지 않는다. 버린 것의 이유는 warn 으로만 남긴다(기본은 개발자 콘솔의 경고).
// 화면 테스트(e2e/helpers.ts)는 console.error 를 실패로 센다. 버린 자료는 화면이 멈춘 오류가 아니라서 경고(console.warn)로 남긴다.
// 넘겨받은 자료는 모양이 크게 틀릴 수 있어서, 이 파일의 함수는 어떤 값을 받아도 던지지 않는다.

/** 버린 자료의 이유를 남기는 곳. message 는 무엇을 버렸는지, reasons 는 그 이유다. */
export type MergeWarn = (message: string, reasons: readonly string[]) => void;

const warnConsole: MergeWarn = (message, reasons) => console.warn(message, reasons);

/**
 * 넘겨받은 시험 자료의 겉모양(parseRemote 를 통과한 것). exams 와 locks 의 원소는 아직 검사하지 않은 값이다.
 * 시험은 mergeExams, 잠금 달력은 src/logic/lock.ts 의 mergeLocks 가 하나씩 검사한다.
 */
export interface RemoteData {
  /** 발행 번호. 0 이상의 정수이고, 클수록 새 자료다. */
  seq: number;
  /** 발행 시각 "YYYY-MM-DDTHH:mm"(한국 시간). */
  issuedAt: string;
  /** 시험 파일 내용의 배열(검사 전). */
  exams: unknown[];
  /** 잠금 달력(검사 전). */
  locks: unknown[];
}

/** 객체인지. 배열과 null 은 객체로 보지 않는다. */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 시험 목록의 순서. 시행일이 있는 시험이 먼저(최근 날짜가 위), 같은 날짜와 시행일이 없는 시험은 받은 순서대로. 받은 배열은 바꾸지 않는다. */
export function sortExams(list: readonly Exam[]): Exam[] {
  const dated = list.filter((e) => e.examDate !== undefined);
  const undated = list.filter((e) => e.examDate === undefined);
  // Array.prototype.sort 는 같은 값의 순서를 바꾸지 않는다.
  dated.sort((a, b) => compareYmd(b.examDate as string, a.examDate as string));
  return [...dated, ...undated];
}

function remoteErrors(raw: unknown): string[] {
  if (!isRecord(raw)) return ['remote는 { seq, issuedAt, exams, locks } 객체여야 해요.'];
  const errors: string[] = [];
  const seq = raw.seq;
  if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0) errors.push('seq는 0 이상의 정수여야 해요.');
  if (parseYmdHm(raw.issuedAt) === null) errors.push('issuedAt은 2030-01-02T17:10 같은, 실제로 있는 날짜와 시각(한국 시간)이어야 해요.');
  if (!Array.isArray(raw.exams)) errors.push('exams는 시험 파일 내용의 배열이어야 해요.');
  if (!Array.isArray(raw.locks)) errors.push('locks는 잠금 달력(항목의 배열)이어야 해요. 항목이 없으면 빈 배열([])이에요.');
  return errors;
}

/**
 * 넘겨받은 시험 자료(__SA_APP__.remote, remote 알림의 remote)의 겉모양을 본다. 던지지 않는다.
 * { seq, issuedAt, exams, locks } 이고 seq 는 0 이상의 정수, issuedAt 은 "YYYY-MM-DDTHH:mm"(한국 시간, 실제로 있는 날짜와 시각),
 * exams 와 locks 는 배열이어야 한다. 맞으면 그 네 값을, 아니면 null 을 돌려준다. 다른 칸은 보지 않는다.
 * null 과 undefined 는 넘겨받은 자료가 없다는 뜻이라 알리지 않고 null 이다. 그 밖에 모양이 틀리면 이유를 warn 으로 남긴다.
 */
export function parseRemote(raw: unknown, warn: MergeWarn = warnConsole): RemoteData | null {
  if (raw === null || raw === undefined) return null;
  let errors: string[];
  try {
    errors = remoteErrors(raw);
  } catch {
    errors = ['넘겨받은 시험 자료를 끝까지 검사하지 못했어요.'];
  }
  if (errors.length > 0) {
    warn('넘겨받은 시험 자료를 쓰지 않았어요.', errors);
    return null;
  }
  const r = raw as Record<string, unknown>;
  return { seq: r.seq as number, issuedAt: r.issuedAt as string, exams: r.exams as unknown[], locks: r.locks as unknown[] };
}

/** 경고에 적는 넘겨받은 시험의 이름. 몇 번째 시험인지와, 읽을 수 있으면 id. */
function nameOf(raw: unknown, index: number): string {
  let id: unknown;
  try {
    id = isRecord(raw) ? raw.id : undefined;
  } catch {
    id = undefined;
  }
  return typeof id === 'string' && id !== '' ? `${index + 1}번째 시험(id: ${id})` : `${index + 1}번째 시험`;
}

/**
 * 화면의 연달아 누르기 보호에 쓰는 시험 판의 이름(id 와 판 번호). 넘겨받은 새 판으로 바뀌면 값이 바뀐다
 * (화면 틀 Screen 의 shiftKey, src/tapGuard.ts 의 markContentShifted, 작업 지시서 3의 별도 검토 A3).
 */
export function examShiftKey(exam: Exam): string {
  return `${exam.id}@${revOf(exam)}`;
}

/** 시험 목록 화면에 쓰는 같은 값. 목록의 차례와, 선택지의 높이를 바꾸는 글자(제목, 안내, 시행일, 배지)까지 넣는다. */
export function examListShiftKey(exams: readonly Exam[]): string {
  return JSON.stringify(exams.map((e) => [e.id, revOf(e), e.title, e.note, e.examDate ?? null, e.isSample, e.answerReleased]));
}

/**
 * 두 판의 문항 구성(문항 수와, 차례대로 문항의 no, kind, 5지선다의 보기 수)이 같은지.
 * 기록의 답과 표시는 문항 번호로 붙고 답 입력 화면의 커서는 문항의 차례라서, 구성이 다른 판으로 바꾸면 답이 다른 문항에 붙는다.
 */
export function sameStructure(a: Exam, b: Exam): boolean {
  if (a.items.length !== b.items.length) return false;
  return a.items.every((it, i) => {
    const other = b.items[i]!;
    return it.no === other.no && it.kind === other.kind && (it.kind !== 'mc' || choicesOf(it) === choicesOf(other));
  });
}

/**
 * 묶음 안 시험과 넘겨받은 시험(remote.exams)을 합친다(작업 지시서 3의 5-2). 순수 함수이고 이유는 warn 으로만 남긴다. 던지지 않는다.
 * - 넘겨받은 시험은 하나씩 묶음 안 시험 파일과 같은 검사(src/exams/validate.ts 의 checkExam)를 거친다.
 *   통과하지 못한 시험은 버리고 id 와 이유를 남기고, 나머지는 쓴다.
 * - 넘겨받은 목록 안에서 id 가 겹치면 앞의 것을 쓰고 뒤의 것은 버린다.
 * - 묶음 안 시험과 id 가 같으면 판 번호(rev, 없으면 1)가 큰 쪽을 쓰고, 같으면 넘겨받은 쪽을 쓴다. 쓰는 판은 묶음 안 시험의 자리에 둔다.
 *   다만 문항 구성(sameStructure)이 묶음 안 시험과 다른 넘겨받은 판은 버리고 이유를 남긴다. 발행 도구는 묶음 안 시험과 같은 id 를
 *   거부하지만(scripts/exams/check.ts), 그 규칙을 어긴 자료가 와도 저장한 답이 다른 문항이나 다른 시험에 붙지 않게 한다.
 *   쓰는 판의 정답 판 번호(answersRev)가 쓰지 않는 판보다 작으면 알린다(점수가 채점 흔적과 다르면 화면이 알린다, src/state/session.ts).
 * - 묶음에 없는 시험은 묶음 안 시험보다 앞에 넘겨받은 차례대로 두고, 그 뒤 sortExams 로 정렬한다
 *   (시행일이 있는 시험은 날짜 순서로 위에, 시행일이 없는 넘겨받은 시험은 시행일이 없는 예시 시험보다 위).
 * - 넘겨받은 것이 없으면(null, undefined, 빈 배열) 묶음 안 시험 그대로다.
 * 시험 객체는 고치지 않고 검사를 통과한 객체를 그대로 담는다(기본값을 채우지 않는다).
 */
export function mergeExams(bundled: readonly Exam[], remoteExams: readonly unknown[] | null | undefined, warn: MergeWarn = warnConsole): Exam[] {
  const list: readonly unknown[] = Array.isArray(remoteExams) ? remoteExams : [];
  const bundledById = new Map(bundled.map((e) => [e.id, e]));
  const fresh: Exam[] = [];
  const replaced = new Map<string, Exam>();
  const seen = new Set<string>();
  for (let i = 0; i < list.length; i += 1) {
    const raw = list[i];
    const { exam, errors } = checkExam(raw);
    if (!exam) {
      warn(`넘겨받은 ${nameOf(raw, i)}을 쓰지 않았어요.`, errors);
      continue;
    }
    if (seen.has(exam.id)) {
      warn(`넘겨받은 ${nameOf(raw, i)}을 쓰지 않았어요.`, ['앞의 시험과 id가 겹쳐요.']);
      continue;
    }
    seen.add(exam.id);
    const mine = bundledById.get(exam.id);
    if (!mine) {
      fresh.push(exam);
      continue;
    }
    if (!sameStructure(mine, exam)) {
      warn(`넘겨받은 ${nameOf(raw, i)}을 쓰지 않았어요.`, [
        '앱에 든 같은 id 의 시험과 문항 구성(문항 수, no, kind, choices)이 달라요. 저장한 답이 다른 문항에 붙지 않게 앱에 든 시험을 써요.',
      ]);
      continue;
    }
    const takeRemote = revOf(exam) >= revOf(mine);
    if (takeRemote) replaced.set(exam.id, exam);
    const used = takeRemote ? exam : mine;
    const other = takeRemote ? mine : exam;
    if (answersRevOf(used) < answersRevOf(other)) {
      warn(`넘겨받은 ${nameOf(raw, i)}과 앱에 든 같은 id 의 시험은 정답 판 번호가 어긋나요.`, [
        `판 번호(rev)가 ${takeRemote ? '크거나 같은 넘겨받은' : '큰 앱에 든'} 판을 썼는데, 그 판의 answersRev(${answersRevOf(used)})가 다른 판(${answersRevOf(other)})보다 작아요.`,
      ]);
    }
  }
  return sortExams([...fresh, ...bundled.map((e) => replaced.get(e.id) ?? e)]);
}
