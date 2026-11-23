import { answersRevOf } from '../exams/validate';
import { findMissing, gradeExam, isAnswered, type Grade } from '../logic/scoring';
import type { AnswerValue, AppData, Cause, Exam, GradedBefore, Mark, RetryRecord, SeenBefore, SelfCheck, Session, TimeFeel } from '../types';
import { newId } from './store';

// 기록 한 건(Session)을 고치는 순수 함수들. 화면은 이 함수들로만 기록을 바꾼다.

export function newSession(
  examId: string,
  gradedBefore: GradedBefore | null,
  seenBefore: SeenBefore | null,
  nowIso: string,
): Session {
  return {
    id: newId('s'),
    examId,
    createdAt: nowIso,
    gradedBefore,
    seenBefore,
    answers: {},
    marks: {},
    marksEditedAfterGrading: false,
    timeFeel: null,
    savedAt: null,
    gradedAt: null,
    firstGradedAt: null,
    answersEditedAfterGrading: [],
    causes: {},
    answerViewed: {},
    targetGrade: null,
    retries: {},
    selfChecks: {},
  };
}

function omit<T>(rec: Record<number, T>, no: number): Record<number, T> {
  if (!(no in rec)) return rec;
  const next = { ...rec };
  delete next[no];
  return next;
}

/**
 * 답을 넣거나(숫자, 안 풂) 지운다(undefined).
 * 답이 바뀌면 그 문항의 원인과 재풀이 기록은 지운다.
 * 채점한 뒤에 답을 고치면 채점 시각을 비워 다시 채점하게 하고, 고친 문항을 적어 둔다.
 */
export function setAnswer(session: Session, no: number, value: AnswerValue | undefined): Session {
  const prev = session.answers[no];
  if (prev === value) return session;
  const answers = value === undefined ? omit(session.answers, no) : { ...session.answers, [no]: value };
  // 안 푼 문항이나 비운 문항에는 표시를 남기지 않는다.
  const marks = value === undefined || value === 'skip' ? omit(session.marks, no) : session.marks;
  const afterGrading = session.firstGradedAt !== null;
  const edited =
    afterGrading && !session.answersEditedAfterGrading.includes(no)
      ? [...session.answersEditedAfterGrading, no].sort((a, b) => a - b)
      : session.answersEditedAfterGrading;
  return {
    ...session,
    answers,
    marks,
    causes: omit(session.causes, no),
    retries: omit(session.retries, no),
    selfChecks: omit(session.selfChecks, no),
    gradedAt: afterGrading ? null : session.gradedAt,
    answersEditedAfterGrading: edited,
  };
}

/** 5지선다 표시: 표시 없음, 고민, 찍음, 표시 없음 순으로 바뀐다. */
export function cycleMark(session: Session, no: number): Session {
  const cur = session.marks[no];
  const nextMark: Mark | undefined = cur === undefined ? 'doubt' : cur === 'doubt' ? 'guess' : undefined;
  const marks = nextMark === undefined ? omit(session.marks, no) : { ...session.marks, [no]: nextMark };
  return { ...session, marks, marksEditedAfterGrading: session.marksEditedAfterGrading || session.firstGradedAt !== null };
}

/** 단답형 표시: 자신 없음을 붙였다 뗀다. */
export function toggleUnsure(session: Session, no: number): Session {
  const marks = session.marks[no] === 'unsure' ? omit(session.marks, no) : { ...session.marks, [no]: 'unsure' as Mark };
  return { ...session, marks, marksEditedAfterGrading: session.marksEditedAfterGrading || session.firstGradedAt !== null };
}

export function setTimeFeel(session: Session, timeFeel: TimeFeel | null): Session {
  return { ...session, timeFeel };
}

/** 채점한 뒤에 표시한 기록인지. "이미 했어요" 경로이거나 앱에서 채점한 뒤 표시를 바꾼 경우. */
export function isMarkedAfterGrading(session: Session): boolean {
  return session.gradedBefore === 'already' || session.marksEditedAfterGrading;
}

/**
 * 채점 시각과 채점 흔적(gradedWith: 지금 정답 판 번호와 실제 점수, 작업 지시서 3의 4-6)을 남긴다.
 * 미입력이 있거나 정답 공개 전이면 gradeExam이 오류를 던진다.
 * 오답 원인은 지우지 않는다. 답을 고친 문항의 원인은 답을 고칠 때(setAnswer) 이미 지웠고, 정답 정정으로 맞게 된 문항의 원인은
 * 기록에 남긴 채 화면에서만 빠진다(맞은 문항의 채점 결과에는 원인이 붙지 않는다).
 */
export function markGraded(session: Session, exam: Exam, nowIso: string): Session {
  const grade = gradeExam(exam, session);
  return {
    ...session,
    gradedAt: nowIso,
    firstGradedAt: session.firstGradedAt ?? nowIso,
    savedAt: null,
    gradedWith: { answersRev: answersRevOf(exam), score: grade.actual },
  };
}

/** 정답 공개 전 시험의 답을 저장해 둔다. */
export function markSaved(session: Session, nowIso: string): Session {
  return { ...session, savedAt: nowIso };
}

export function setCause(session: Session, no: number, cause: Cause): Session {
  if (session.causes[no] === cause) return session;
  return { ...session, causes: { ...session.causes, [no]: cause } };
}

/** 정답 보기를 눌렀다는 기록("정답 확인함"). */
export function viewAnswer(session: Session, no: number): Session {
  if (session.answerViewed[no]) return session;
  return { ...session, answerViewed: { ...session.answerViewed, [no]: true } };
}

export function setTargetGrade(session: Session, grade: string | null): Session {
  return { ...session, targetGrade: grade };
}

/** 재풀이 기록을 남긴 때의 정답 판 번호. 칸이 없으면 1이다. */
function retryRevOf(rec: RetryRecord): number {
  return rec.answersRev ?? 1;
}

/**
 * 재풀이 결과를 남긴다. 가장 최근 결과가 기록이 된다. answersRev 는 지금 시험의 정답 판 번호다(작업 지시서 3의 4-6).
 * 정답 판 번호가 다른 판에서 남긴 기록은 그때의 정답으로 맞춰 본 것이라 이어 세지 않고 처음부터 센다.
 */
export function recordRetry(session: Session, no: number, correct: boolean, answerKnown: boolean, nowIso: string, answersRev = 1): Session {
  const old = session.retries[no];
  const prev = old && retryRevOf(old) === answersRev ? old : undefined;
  const attempts = (prev?.attempts ?? 0) + 1;
  const rec: RetryRecord = {
    correct,
    attempts,
    firstCorrectAttempt: prev?.firstCorrectAttempt ?? (correct ? attempts : null),
    answerKnown: answerKnown || (prev?.answerKnown ?? false),
    at: nowIso,
  };
  // 정답 판 번호는 2 이상일 때만 적는다(칸이 없으면 1이라 지금까지의 기록과 모양이 같다).
  if (answersRev >= 2) rec.answersRev = answersRev;
  return { ...session, retries: { ...session.retries, [no]: rec } };
}

/**
 * 지금 정답 판에서 남긴 재풀이 기록(작업 지시서 3의 4-6). 정답이 정정되기 전의 판에서 남긴 기록은 그때의 정답으로 맞춰 본 것이라
 * 지우지 않고 화면에서만 뺀다(null). 어느 문항의 정답이 바뀌었는지는 기록에 없어서 판이 다르면 모두 뺀다.
 */
export function currentRetry(session: Session, no: number, exam: Exam): RetryRecord | null {
  const rec = session.retries[no];
  return rec && retryRevOf(rec) === answersRevOf(exam) ? rec : null;
}

/**
 * 찍었다고 표시하고 맞은 문항을 스스로 확인한 결과를 남긴다. 마지막 선택이 기록이 된다.
 * result가 null이면("아직 안 풀어 봤어요") 기록을 남기지 않고, 앞서 남긴 기록도 지운다.
 */
export function setSelfCheck(session: Session, no: number, result: SelfCheck | null, nowIso: string): Session {
  if (result === null) {
    if (!(no in session.selfChecks)) return session;
    return { ...session, selfChecks: omit(session.selfChecks, no) };
  }
  return { ...session, selfChecks: { ...session.selfChecks, [no]: { result, at: nowIso } } };
}

export type Stage = 'input' | 'review' | 'saved' | 'graded';

/**
 * 기록이 어디까지 진행됐는지.
 * saved는 정답 공개 전에 답을 저장해 둔 기록이다. 정답이 공개된 뒤에도 채점하기 전까지는 saved로 남는다.
 * 그래서 다시 열면 안내문("공개되면 여기서 바로 채점돼요")이 말한 표시 화면으로 간다.
 */
export function stageOf(session: Session, exam: Exam): Stage {
  const missing = findMissing(exam, session.answers);
  if (missing.length > 0) return 'input';
  if (exam.answerReleased && session.gradedAt) return 'graded';
  if (session.savedAt) return 'saved';
  return 'review';
}

/** 이어서 보기로 돌아갈 화면. */
export function resumePath(session: Session, exam: Exam): string {
  const stage = stageOf(session, exam);
  if (stage === 'graded') return '/anatomy';
  if (stage === 'saved') return '/marks';
  if (stage === 'review') return '/review';
  return '/input';
}

/** 화면에 적는 답. 숫자나 "안 풂". */
export function answerText(v: AnswerValue | undefined, skipLabel: string): string {
  if (v === undefined) return '';
  return v === 'skip' ? skipLabel : String(v);
}

/** 첫 미입력 문항의 순번(0부터). 전부 넣었으면 -1. */
export function firstMissingIndex(exam: Exam, session: Session): number {
  return exam.items.findIndex((it) => !isAnswered(it, session.answers[it.no]));
}

// 정답 정정(작업 지시서 3의 4-6). 점수는 저장하지 않고 늘 지금 시험 파일로 다시 계산하므로, 정정된 판을 받으면 점수는 저절로
// 지금 정답 기준이 된다. 채점 흔적(gradedWith)은 그 전에 본 점수를 알려 주려고 남긴다. 학생이 넣은 답과 표시는 바꾸지 않는다.

/**
 * 채점된 기록의 정답 정정 상태.
 * - none: 알릴 것이 없다.
 * - fill: 채점 흔적이 없는 옛 기록이고 시험의 정답 판 번호가 1이다. 알리지 않고 채운다(fillGradedWith).
 * - changed, same: 채점한 뒤에 정답이 정정됐다. 다시 계산한 점수가 달라졌는지에 따라 나눈다.
 * - noPrevious: 채점 흔적이 없는 옛 기록인데 정답이 정정된 판(정답 판 번호 2 이상)이라 예전 점수를 알 수 없다.
 * - differs: 정답 판 번호는 오르지 않았는데 지금 시험 자료로 계산한 점수가 채점 흔적의 점수와 다르다
 *   (같은 정답 판 번호에 다른 정답이 든 판, 정답 판 번호가 더 작은 예전 판이 쓰일 때). 정정 안내는 이 바뀜의 까닭이 아닐 수 있어서 note 는 비운다.
 * note 는 시험 파일의 정정 안내(answersNote)이고 알림의 다음 줄에 그대로 보인다.
 */
export type Correction =
  | { kind: 'none' }
  | { kind: 'fill' }
  | { kind: 'changed'; from: number; to: number; note: string }
  | { kind: 'same'; score: number; note: string }
  | { kind: 'noPrevious'; note: string }
  | { kind: 'differs'; from: number; to: number; note: string };

/** 알림을 보여 주는 정정(점수 화면과 점수 해부 화면 위쪽, 기록 화면의 표시). */
export type CorrectionNotice = Extract<Correction, { note: string }>;

/**
 * 기록의 정답 정정 상태를 정한다. grade 는 지금 시험 파일로 계산한 채점 결과다.
 * 채점 흔적의 정답 판 번호보다 시험의 정답 판 번호가 크면 정정으로 본다(changed, same).
 * 같거나 작은데 점수가 채점 흔적과 다르면 다른 시험 자료로 다시 채점한 것으로 알린다(differs). 점수가 같으면 알리지 않는다.
 * 학생이 본 점수가 알림 없이 바뀌지 않게 하려는 것이다(별도 검토 B1).
 * 채점 시각이 비어 있으면(채점한 뒤 답을 고쳐 다시 채점해야 하는 기록) 점수를 보여 주지 않으므로 알리지 않는다.
 */
export function correctionOf(session: Session, exam: Exam, grade: Grade): Correction {
  if (session.gradedAt === null) return { kind: 'none' };
  const rev = answersRevOf(exam);
  const note = exam.answersNote ?? '';
  const prev = session.gradedWith;
  if (!prev) return rev === 1 ? { kind: 'fill' } : { kind: 'noPrevious', note };
  if (rev <= prev.answersRev) return prev.score === grade.actual ? { kind: 'none' } : { kind: 'differs', from: prev.score, to: grade.actual, note: '' };
  return prev.score === grade.actual ? { kind: 'same', score: grade.actual, note } : { kind: 'changed', from: prev.score, to: grade.actual, note };
}

/** 알림을 보여 줄 정정이면 그 정정, 아니면 null. */
export function correctionNotice(c: Correction): CorrectionNotice | null {
  return c.kind === 'changed' || c.kind === 'same' || c.kind === 'noPrevious' || c.kind === 'differs' ? c : null;
}

/**
 * 정정 알림의 "확인했어요": 채점 흔적(gradedWith)만 지금 정답 판 번호와 지금 점수로 바꾼다.
 * 답, 표시, 원인, 재풀이 기록, 채점 시각은 그대로다. 지금 채점할 수 없으면(미입력, 정답 공개 전) 기록을 바꾸지 않는다.
 */
export function acknowledgeCorrection(session: Session, exam: Exam): Session {
  let score: number;
  try {
    score = gradeExam(exam, session).actual;
  } catch {
    return session;
  }
  const answersRev = answersRevOf(exam);
  const prev = session.gradedWith;
  if (prev && prev.answersRev === answersRev && prev.score === score) return session;
  return { ...session, gradedWith: { answersRev, score } };
}

/**
 * 채점 흔적이 없는 옛 채점 기록 가운데 시험의 정답 판 번호가 1인 기록에 지금 값(정답 판 번호 1, 지금 점수)을 조용히 채운다.
 * 정답이 정정된 판(2 이상)의 옛 기록은 예전 점수를 알 수 없어서 채우지 않고 알림으로 알린다(noPrevious).
 * 시험을 찾지 못하거나 채점된 기록이 아니면 건너뛴다. 채울 것이 없으면 받은 객체를 그대로 돌려준다(저장하지 않게).
 * 앱이 시작할 때 부르고(src/state/hooks.ts 의 fillOldGradedRecords), 시험 목록이 바뀔 때도 부른다.
 */
export function fillGradedWith(data: AppData, find: (examId: string) => Exam | null): AppData {
  let sessions: Session[] | null = null;
  for (let i = 0; i < data.sessions.length; i += 1) {
    const s = data.sessions[i]!;
    if (s.gradedWith) continue;
    const exam = find(s.examId);
    if (!exam || answersRevOf(exam) !== 1 || stageOf(s, exam) !== 'graded') continue;
    let score: number;
    try {
      score = gradeExam(exam, s).actual;
    } catch {
      continue;
    }
    sessions ??= data.sessions.slice();
    sessions[i] = { ...s, gradedWith: { answersRev: 1, score } };
  }
  return sessions ? { ...data, sessions } : data;
}
