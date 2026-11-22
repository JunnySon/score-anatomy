import { findExam, SAMPLE_EXAM_ID } from '../exams';
import { exampleAnswers, exampleCauses, exampleMarks } from '../logic/example';
import type { Session } from '../types';

// "예시 결과 보기"에 쓰는 기록. 7장 검산 예시를 그대로 넣는다.
// 메모리에만 두고 저장하지 않는다. 기록 목록에도 넣지 않는다.

export const DEMO_SESSION_ID = 'demo';

export function buildDemoSession(): Session | null {
  const exam = findExam(SAMPLE_EXAM_ID);
  if (!exam || !exam.answerReleased) return null;
  return {
    id: DEMO_SESSION_ID,
    examId: exam.id,
    createdAt: '2026-11-22T09:00:00.000Z',
    gradedBefore: 'not_yet',
    seenBefore: null,
    answers: exampleAnswers(exam),
    marks: exampleMarks(),
    marksEditedAfterGrading: false,
    timeFeel: null,
    savedAt: null,
    gradedAt: '2026-11-22T09:00:00.000Z',
    causes: exampleCauses(),
    answerViewed: {},
    targetGrade: null,
    retries: {},
  };
}

class DemoStore {
  private session: Session | null = buildDemoSession();
  private listeners = new Set<() => void>();

  get = (): Session | null => this.session;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  update(fn: (s: Session) => Session): void {
    if (!this.session) return;
    const next = fn(this.session);
    if (next === this.session) return;
    this.session = next;
    for (const l of this.listeners) l();
  }

  reset(): void {
    this.session = buildDemoSession();
    for (const l of this.listeners) l();
  }
}

export const demoStore = new DemoStore();
