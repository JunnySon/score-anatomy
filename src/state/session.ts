import { findMissing, gradeExam, isAnswered } from '../logic/scoring';
import type { AnswerValue, Cause, Exam, GradedBefore, Mark, SeenBefore, Session, TimeFeel } from '../types';
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

/** 표시를 모두 지운다("없어요"). 채점한 뒤에 지웠으면 그것도 채점한 뒤 표시로 적는다. */
export function clearMarks(session: Session): Session {
  if (Object.keys(session.marks).length === 0) return session;
  return { ...session, marks: {}, marksEditedAfterGrading: session.marksEditedAfterGrading || session.firstGradedAt !== null };
}

export function setTimeFeel(session: Session, timeFeel: TimeFeel | null): Session {
  return { ...session, timeFeel };
}

/** 채점한 뒤에 표시한 기록인지. "이미 했어요" 경로이거나 앱에서 채점한 뒤 표시를 바꾼 경우. */
export function isMarkedAfterGrading(session: Session): boolean {
  return session.gradedBefore === 'already' || session.marksEditedAfterGrading;
}

/**
 * 채점 시각을 남긴다. 미입력이 있거나 정답 공개 전이면 gradeExam이 오류를 던진다.
 * 더는 틀린 문항이 아닌 문항의 원인은 지운다.
 */
export function markGraded(session: Session, exam: Exam, nowIso: string): Session {
  const grade = gradeExam(exam, session);
  const wrongNos = new Set(grade.wrong.map((w) => w.no));
  const causes: Session['causes'] = {};
  for (const [k, v] of Object.entries(session.causes)) if (wrongNos.has(Number(k))) causes[Number(k)] = v;
  return { ...session, gradedAt: nowIso, firstGradedAt: session.firstGradedAt ?? nowIso, savedAt: null, causes };
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

/** 재풀이 결과를 남긴다. 가장 최근 결과가 기록이 된다. */
export function recordRetry(session: Session, no: number, correct: boolean, answerKnown: boolean, nowIso: string): Session {
  const prev = session.retries[no];
  const attempts = (prev?.attempts ?? 0) + 1;
  return {
    ...session,
    retries: {
      ...session.retries,
      [no]: {
        correct,
        attempts,
        firstCorrectAttempt: prev?.firstCorrectAttempt ?? (correct ? attempts : null),
        answerKnown: answerKnown || (prev?.answerKnown ?? false),
        at: nowIso,
      },
    },
  };
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
