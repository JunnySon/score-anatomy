import { isValidAnswerNumber } from '../exams/validate';
import type { Answers, AnswerValue, AppData, Exam, InputMode, RunPart, Session, TestRun } from '../types';
import { newId } from './store';

// 사용성 테스트 측정 기록. 진행자가 테스트를 시작했을 때만 남기고, 이 기기 밖으로 보내지 않는다.

export const PARTICIPANT_PATTERN = /^P\d{2}$/;

export function emptyPart(): RunPart {
  return {
    inputStartAt: null,
    firstInputAt: null,
    inputDoneAt: null,
    reviewConfirmAt: null,
    itemInputs: {},
    reviewFixed: [],
    marksMs: 0,
    firstScoreAt: null,
    finalAnswers: null,
  };
}

function partOf(run: TestRun): RunPart {
  return {
    inputStartAt: run.inputStartAt,
    firstInputAt: run.firstInputAt,
    inputDoneAt: run.inputDoneAt,
    reviewConfirmAt: run.reviewConfirmAt,
    itemInputs: run.itemInputs,
    reviewFixed: run.reviewFixed,
    marksMs: run.marksMs,
    firstScoreAt: run.firstScoreAt,
    finalAnswers: run.finalAnswers,
  };
}

export function newRun(participant: string, inputMode: InputMode, plannedExamId: string, now: number): TestRun {
  return {
    id: newId('run'),
    participant,
    inputMode,
    plannedExamId,
    startedAt: now,
    endedAt: null,
    sessionId: null,
    examId: null,
    screens: [],
    examSelectAt: null,
    ...emptyPart(),
    examReselects: 0,
    discardedTaps: 0,
    filledTaps: 0,
    filledHeldTaps: 0,
    parts: {},
    answerKeyText: '',
  };
}

/**
 * 측정 기록을 시험 기록에 묶는다. 다른 기록에 묶여 있었으면(참가자가 다른 시험 기록으로 옮겨 감)
 * 앞 기록에서 재던 값을 parts 에 넣어 두고, 새로 묶는 기록의 값을 꺼내 쓴다(처음이면 빈 값).
 * 그래서 앞 시험에서 누른 횟수가 섞이지 않고, 원래 기록으로 돌아오면 재던 값이 이어진다.
 * 화면 진입 기록과 시험 선택 화면에 처음 들어온 시각은 그대로 둔다.
 */
export function bindRun(run: TestRun, sessionId: string, examId: string): TestRun {
  if (run.sessionId === sessionId && run.examId === examId) return run;
  if (run.sessionId === null) return { ...run, sessionId, examId };
  const parts: Record<string, RunPart> = { ...run.parts, [run.sessionId]: partOf(run) };
  const back = parts[sessionId] ?? emptyPart();
  delete parts[sessionId];
  return { ...run, ...back, sessionId, examId, parts, examReselects: run.examReselects + 1 };
}

/**
 * 채점까지 마친 측정인지. 마친 측정은 다른 기록에 다시 묶지 않는다.
 * 묶인 기록이 지워졌어도 첫 점수 시각이 남아 있으면 마친 것으로 본다.
 */
export function isRunDone(run: TestRun, bound: Session | null): boolean {
  return run.firstScoreAt !== null || (bound !== null && bound.firstGradedAt !== null);
}

/**
 * 이번 참가자가 만든 기록인지: 측정에 묶인 기록이거나, 측정을 시작한 뒤에 만든 기록.
 * 시작 시각을 읽지 못한 측정(저장 값이 망가진 경우)은 언제 시작했는지 모르므로 묶인 기록만 이번 참가자의 것으로 본다.
 * 그러지 않으면 기기에 남은 앞 참가자의 기록이 모두 이번 참가자의 것으로 보인다.
 */
export function isMine(run: TestRun, session: Session): boolean {
  if (session.id === run.sessionId) return true;
  const start = startOf(run);
  return start !== null && Date.parse(session.createdAt) > start;
}

/** 기록 한 건을 보여 주는 화면들. 측정에 묶인 기록이 아닌 기록에서 열리면 이름 앞에 OTHER_PREFIX를 붙여 적는다. */
const SESSION_SCREENS = new Set(['input', 'review', 'marks', 'score', 'causes', 'anatomy', 'steps', 'retry']);
export const OTHER_PREFIX = 'other:';

/**
 * 화면 진입 기록에 적을 이름. own은 지금 보는 기록이 이 측정에 묶인 기록인지다.
 * 다른 기록(앞 참가자의 기록 등)의 화면은 답 입력 시작, 첫 점수, 표시 화면에 머문 시간에 쓰이지 않게 이름을 달리한다.
 */
export function screenLogName(name: string, own: boolean): string {
  return SESSION_SCREENS.has(name) && !own ? `${OTHER_PREFIX}${name}` : name;
}

export function activeRun(data: AppData): TestRun | null {
  return data.testRuns.find((r) => r.id === data.activeRunId) ?? null;
}

/** 진행 중인 측정 기록만 고친다. 없으면 아무것도 하지 않는다. */
export function withActiveRun(data: AppData, fn: (run: TestRun) => TestRun): AppData {
  if (!data.activeRunId) return data;
  let changed = false;
  const testRuns = data.testRuns.map((r) => {
    if (r.id !== data.activeRunId) return r;
    const next = fn(r);
    if (next !== r) changed = true;
    return next;
  });
  return changed ? { ...data, testRuns } : data;
}

/** 화면 진입 시각을 남긴다. 표시 화면을 떠날 때는 머문 시간을 더한다. */
export function logScreen(run: TestRun, name: string, now: number): TestRun {
  const last = run.screens[run.screens.length - 1];
  if (last && last.screen === name) return run;
  let next: TestRun = { ...run, screens: [...run.screens, { screen: name, at: now }] };
  if (last && last.screen === 'marks') next.marksMs = run.marksMs + Math.max(0, now - last.at);
  if (name === 'exams' && next.examSelectAt === null) next = { ...next, examSelectAt: now };
  if (name === 'input' && next.inputStartAt === null) next = { ...next, inputStartAt: now };
  if (name === 'score' && next.firstScoreAt === null) next = { ...next, firstScoreAt: now };
  return next;
}

/** 문항별 입력 횟수. 입력 확인 화면에서 값을 바꾸면 고친 문항으로도 센다. */
export function logAnswer(
  run: TestRun,
  no: number,
  where: 'input' | 'review',
  changed: boolean,
  allEntered: boolean,
  now: number,
): TestRun {
  const next: TestRun = {
    ...run,
    itemInputs: { ...run.itemInputs, [no]: (run.itemInputs[no] ?? 0) + 1 },
    firstInputAt: run.firstInputAt ?? now,
  };
  if (where === 'review' && changed && !run.reviewFixed.includes(no)) next.reviewFixed = [...run.reviewFixed, no];
  if (allEntered && run.inputDoneAt === null) next.inputDoneAt = now;
  return next;
}

export interface KeyParse {
  ok: boolean;
  values: AnswerValue[];
  /** 읽지 못한 값의 순번(1부터). 개수가 안 맞으면 0. */
  errorIndex: number;
  got: number;
}

/** 답지에서 값을 가르는 문자: 쉼표, 전각 쉼표(U+FF0C), 모점(U+3001), 공백과 줄바꿈. */
const KEY_SEPARATOR = new RegExp(`[,${String.fromCodePoint(0xff0c, 0x3001)}\\s]+`);

/**
 * 진행자가 붙여 넣은 답지를 읽는다. 쉼표(또는 공백, 줄바꿈)로 구분하고, 안 푼 문항은 x로 적는다.
 * 앞뒤에 남은 쉼표는 무시한다.
 */
export function parseAnswerKey(exam: Exam, text: string): KeyParse {
  // "안 풂"은 가운데 공백이 있어서 먼저 x로 바꿔 둔다.
  const normalized = text.replace(/안\s*풂/g, 'x');
  const tokens = normalized.split(KEY_SEPARATOR).filter((t) => t !== '');
  if (tokens.length !== exam.items.length) return { ok: false, values: [], errorIndex: 0, got: tokens.length };
  const values: AnswerValue[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i]!;
    const item = exam.items[i]!;
    if (/^x$/i.test(t)) {
      values.push('skip');
      continue;
    }
    const n = /^\d{1,3}$/.test(t) ? Number(t) : NaN;
    if (!isValidAnswerNumber(item, n)) return { ok: false, values: [], errorIndex: i + 1, got: tokens.length };
    values.push(n);
  }
  return { ok: true, values, errorIndex: 0, got: tokens.length };
}

/** 답지와 참가자가 최종 제출한 답이 다른 문항 번호. 미입력도 다른 것으로 센다. */
export function diffAnswerKey(exam: Exam, key: AnswerValue[], answers: Answers): number[] {
  const out: number[] = [];
  exam.items.forEach((it, i) => {
    if (answers[it.no] !== key[i]) out.push(it.no);
  });
  return out;
}

/** 참가자가 지금까지 넣은 답을 문항 순서대로 옮긴다. 미입력은 null. */
export function answersInOrder(exam: Exam, answers: Answers): (AnswerValue | null)[] {
  return exam.items.map((it) => answers[it.no] ?? null);
}

/**
 * 시험 기록이 지워지거나 참가자가 끝날 때, 최종 제출한 답을 측정 기록에 옮겨 둔다.
 * 이미 끝난 측정의 사본은 다시 쓰지 않는다. 끝난 뒤에 누가 그 기록을 고쳐도 측정값이 바뀌지 않아야 한다.
 */
export function withFinalAnswers(run: TestRun, session: Session | null, exam: Exam | null): TestRun {
  if (run.endedAt !== null) return run;
  if (!session || !exam || run.sessionId !== session.id) return run;
  return { ...run, finalAnswers: answersInOrder(exam, session.answers) };
}

/**
 * 측정 기록의 최종 답.
 * 끝난 측정은 마칠 때 옮겨 둔 사본만 쓴다. 진행 중인 측정은 시험 기록이 남아 있으면 지금 답을, 없으면 사본을 쓴다.
 */
export function finalAnswersOf(run: TestRun, session: Session | null, exam: Exam | null): (AnswerValue | null)[] | null {
  if (run.endedAt !== null) return run.finalAnswers;
  if (session && exam && run.sessionId === session.id) return answersInOrder(exam, session.answers);
  return run.finalAnswers;
}

export interface RunMetrics {
  inputSeconds: number | null;
  inputCount: number;
  reviewFixedCount: number;
  marksSeconds: number;
  selectToScoreSeconds: number | null;
  residualErrors: number | null;
  residualNos: number[];
  enteredCount: number | null;
}

function seconds(from: number | null, to: number | null): number | null {
  if (from === null || to === null) return null;
  return Math.round((to - from) / 100) / 10;
}

export function runMetrics(run: TestRun, session: Session | null, exam: Exam | null): RunMetrics {
  let residualErrors: number | null = null;
  let residualNos: number[] = [];
  const final = finalAnswersOf(run, session, exam);
  if (exam && final && run.answerKeyText.trim() !== '') {
    const parsed = parseAnswerKey(exam, run.answerKeyText);
    if (parsed.ok) {
      residualNos = exam.items.filter((_, i) => final[i] !== parsed.values[i]).map((it) => it.no);
      residualErrors = residualNos.length;
    }
  }
  return {
    inputSeconds: seconds(run.inputStartAt, run.inputDoneAt),
    inputCount: Object.values(run.itemInputs).reduce((s, n) => s + n, 0),
    reviewFixedCount: run.reviewFixed.length,
    marksSeconds: Math.round(run.marksMs / 100) / 10,
    selectToScoreSeconds: seconds(run.examSelectAt, run.firstScoreAt),
    residualErrors,
    residualNos,
    enteredCount: final ? final.filter((v) => v !== null).length : null,
  };
}

/** 측정의 시작 시각. 저장 값이 망가져 읽지 못했으면(0으로 읽힘) null. */
export function startOf(run: TestRun): number | null {
  return run.startedAt > 0 ? run.startedAt : null;
}

/** 시각을 글자로 적는다. 날짜로 쓸 수 없는 값(저장 값이 망가진 경우)은 비워 둔다. */
function iso(ms: number | null): string {
  if (ms === null) return '';
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

function csvCell(v: string | number | null): string {
  if (v === null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export interface RunExportRow {
  run: TestRun;
  session: Session | null;
  exam: Exam | null;
}

export function exportJson(rows: RunExportRow[], exportedAt: number): string {
  return JSON.stringify(
    {
      format: 'score-anatomy-test-log',
      version: 1,
      exportedAt: iso(exportedAt),
      runs: rows.map(({ run, session, exam }) => ({
        ...run,
        // 읽지 못한 시작 시각은 0(1970년)이 아니라 빈 값으로 내보낸다.
        startedAt: startOf(run),
        startedAtIso: iso(startOf(run)),
        metrics: runMetrics(run, session, exam),
        finalAnswers: finalAnswersOf(run, session, exam),
      })),
    },
    null,
    2,
  );
}

export function exportCsv(rows: RunExportRow[]): string {
  const maxItems = rows.reduce((m, r) => Math.max(m, r.exam?.items.length ?? 0), 0);
  const head = [
    'participant',
    'input_mode',
    'planned_exam',
    'exam',
    'exam_reselects',
    'started_at',
    'input_seconds',
    'input_count',
    'review_fixed_count',
    'marks_seconds',
    'select_to_score_seconds',
    'residual_errors',
    'residual_items',
    'discarded_taps',
    'filled_taps',
    // 0.3.2: filled_taps 가운데 누르는 동안 온 dblclick 규칙으로 채운 수(작업 지시서 4의 2-2). filled_taps 바로 뒤 칸이다.
    'filled_held_taps',
    'screens',
  ];
  for (let i = 1; i <= maxItems; i += 1) head.push(`inputs_q${i}`);
  const lines = [head.join(',')];
  for (const { run, session, exam } of rows) {
    const m = runMetrics(run, session, exam);
    const cells: (string | number | null)[] = [
      run.participant,
      run.inputMode,
      run.plannedExamId,
      run.examId,
      run.examReselects,
      iso(startOf(run)),
      m.inputSeconds,
      m.inputCount,
      m.reviewFixedCount,
      m.marksSeconds,
      m.selectToScoreSeconds,
      m.residualErrors,
      m.residualNos.join(' '),
      run.discardedTaps,
      run.filledTaps,
      run.filledHeldTaps,
      run.screens.map((s) => `${s.screen}@${iso(s.at)}`).join(' '),
    ];
    for (let i = 1; i <= maxItems; i += 1) {
      const no = exam?.items[i - 1]?.no;
      cells.push(no === undefined ? null : (run.itemInputs[no] ?? 0));
    }
    lines.push(cells.map(csvCell).join(','));
  }
  return lines.join('\n') + '\n';
}
