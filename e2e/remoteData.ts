import { exampleAnswers, exampleCauses, exampleMarks } from '../src/logic/example';
import type { Exam, ExamItem } from '../src/types';
import { loadExam } from './helpers';

// 앱 화면 테스트(e2e/appRemote.spec.ts)가 가짜 껍데기로 넘겨주는 시험 자료(다리 규격 2의 remote)와, 껍데기가 넣어 주는 기록(store)을 만든다.
// 넘겨받는 시험은 모두 예시 시험 A(src/exams/sample-a.json)의 사본으로 지은 테스트 전용 시험이다.
// id 는 예시 시험과 겹치지 않는 test-remote-*, isSample 은 true, 제목은 "테스트 전용 시험 A" 같은 이름이다.
// 날짜와 시각은 작업 지시서 3의 형식 예시(2030-01-02, 08:40, 17:10, 17:45, 20:10)만 쓰고, 등급컷의 출처는 "예시 값"만 쓴다.
// 정정 안내는 "테스트 전용 정정 안내예요."이고 정답 값을 담지 않는다. 실제 시험의 정답, 배점, 등급컷, 시행일, 시험 시간은 없다.

/** 작업 지시서 3의 형식 예시 시각(한국 시간). 넘겨받은 자료의 issuedAt, 등급컷 기준, 잠금 항목에만 쓴다. */
export const AT_0840 = '2030-01-02T08:40';
export const AT_1710 = '2030-01-02T17:10';
export const AT_1745 = '2030-01-02T17:45';
export const AT_2010 = '2030-01-02T20:10';

/** 테스트 전용 정정 안내(answersNote). 정답 값을 담지 않는다. */
export const TEST_NOTE = '테스트 전용 정정 안내예요.';

/** 껍데기가 넘겨주는 시험 자료(docs/앱_다리_규격.md 7장의 remote). */
export interface RemoteData {
  seq: number;
  issuedAt: string;
  exams: unknown[];
  locks: unknown[];
}

export function remoteData(seq: number, issuedAt: string, exams: unknown[], locks: unknown[] = []): RemoteData {
  return { seq, issuedAt, exams, locks };
}

/**
 * 예시 시험 A의 사본으로 지은 테스트 전용 시험(id test-remote-a, 정답이 든 판). 등급컷은 빼고 시작한다.
 * more 로 칸을 바꾼다(cuts 를 주면 그 등급컷을 쓴다).
 */
export function testExam(more: Partial<Exam> = {}): Exam {
  const exam: Exam = { ...loadExam('a'), id: 'test-remote-a', title: '테스트 전용 시험 A', note: '테스트 전용으로 지은 시험이에요.', isSample: true };
  delete exam.cuts;
  return { ...exam, ...more };
}

/** 정답 공개 전 판: 문항 구성과 배점만 있다(정답 칸이 없다). */
export function unreleasedExam(more: Partial<Exam> = {}): Exam {
  const items: ExamItem[] = testExam().items.map(({ answer: _answer, ...it }) => it);
  return testExam({ answerReleased: false, items, ...more });
}

/** 문항의 칸을 바꾼 문항 목록. changes 는 문항 번호마다 바꿀 칸이다. */
export function itemsWith(changes: Record<number, Partial<ExamItem>>): ExamItem[] {
  return testExam().items.map((it) => (changes[it.no] ? { ...it, ...changes[it.no] } : it));
}

/**
 * 정답이 정정된 판(answersRev 2 이상, 정정 안내는 테스트 전용 문장). answers 는 문항 번호마다 바꾼 정답이다.
 * 판 번호(rev)는 부르는 쪽이 정한다.
 */
export function correctedExam(rev: number, answers: Record<number, number>, more: Partial<Exam> = {}): Exam {
  const changes = Object.fromEntries(Object.entries(answers).map(([no, answer]) => [no, { answer }]));
  return testExam({ rev, answersRev: 2, answersNote: TEST_NOTE, items: itemsWith(changes), ...more });
}

/** 기록(Session) 한 건이 넣은 때와 채점한 때. 한국 시간 2030년 1월 2일 오전 8시 40분과 오후 5시 10분(형식 예시)이다. */
export const CREATED_AT = '2030-01-01T23:40:00.000Z';
export const GRADED_AT = '2030-01-02T08:10:00.000Z';

/**
 * 껍데기의 store 에 넣는 기록 한 건(저장 형식 version 1 의 Session). 기본은 검산 예시의 답, 찍음 표시, 원인으로 채점까지 마친 기록이고
 * 채점 흔적(gradedWith)은 없다. more 로 칸을 바꾼다.
 */
export function sessionRecord(id: string, examId: string, more: Record<string, unknown> = {}): Record<string, unknown> {
  const a = loadExam('a');
  return {
    id,
    examId,
    createdAt: CREATED_AT,
    gradedBefore: 'not_yet',
    seenBefore: null,
    answers: exampleAnswers(a),
    marks: exampleMarks(),
    marksEditedAfterGrading: false,
    timeFeel: null,
    savedAt: null,
    gradedAt: GRADED_AT,
    firstGradedAt: GRADED_AT,
    answersEditedAfterGrading: [],
    causes: exampleCauses(),
    answerViewed: {},
    targetGrade: null,
    retries: {},
    selfChecks: {},
    ...more,
  };
}

/** 껍데기가 넣어 주는 store(기록 전체를 담은 JSON 글자). 지금 기록(currentId)은 첫 기록이다. */
export function storeOf(sessions: Record<string, unknown>[], currentId: string | null = (sessions[0]?.id as string | undefined) ?? null): string {
  return JSON.stringify({ version: 1, sessions, currentId, inputMode: 'keypad', testRuns: [], activeRunId: null });
}
