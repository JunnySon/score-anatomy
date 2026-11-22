import { isValidAnswerNumber } from '../exams/validate';
import type { Answers, AnswerValue, AppData, Exam, InputMode, Session, TestRun } from '../types';
import { newId } from './store';

// 사용성 테스트 측정 기록. 진행자가 테스트를 시작했을 때만 남기고, 이 기기 밖으로 보내지 않는다.

export const PARTICIPANT_PATTERN = /^P\d{2}$/;

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
    inputStartAt: null,
    firstInputAt: null,
    inputDoneAt: null,
    reviewConfirmAt: null,
    itemInputs: {},
    reviewFixed: [],
    marksMs: 0,
    firstScoreAt: null,
    answerKeyText: '',
    finalAnswers: null,
  };
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

/** 시험 기록이 지워지거나 참가자가 끝날 때, 최종 제출한 답을 측정 기록에 옮겨 둔다. */
export function withFinalAnswers(run: TestRun, session: Session | null, exam: Exam | null): TestRun {
  if (!session || !exam || run.sessionId !== session.id) return run;
  return { ...run, finalAnswers: answersInOrder(exam, session.answers) };
}

/** 측정 기록의 최종 답. 시험 기록이 남아 있으면 그 답을, 없으면 옮겨 둔 사본을 쓴다. */
export function finalAnswersOf(run: TestRun, session: Session | null, exam: Exam | null): (AnswerValue | null)[] | null {
  if (session && exam) return answersInOrder(exam, session.answers);
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

function iso(ms: number | null): string {
  return ms === null ? '' : new Date(ms).toISOString();
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
        startedAtIso: iso(run.startedAt),
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
    'started_at',
    'input_seconds',
    'input_count',
    'review_fixed_count',
    'marks_seconds',
    'select_to_score_seconds',
    'residual_errors',
    'residual_items',
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
      iso(run.startedAt),
      m.inputSeconds,
      m.inputCount,
      m.reviewFixedCount,
      m.marksSeconds,
      m.selectToScoreSeconds,
      m.residualErrors,
      m.residualNos.join(' '),
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
