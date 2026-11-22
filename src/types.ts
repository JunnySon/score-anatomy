// 시험 데이터와 기록의 자료형.
// 시험 화면 구성은 코드에 박아 넣지 않고 전부 시험 데이터(Exam)에서 읽는다.

export type ItemKind = 'mc' | 'short';

export interface ExamItem {
  no: number;
  kind: ItemKind;
  /** 5지선다의 보기 수. 적지 않으면 5로 본다. */
  choices?: number;
  points: number;
  /** 정답 공개 전에는 없다. */
  answer?: number | null;
  typeId: string;
}

export interface Coord {
  label: string;
  itemNo: number;
}

export interface ExamType {
  name: string;
  coords?: Coord[];
}

export interface ExamCuts {
  source: string;
  asOf: string;
  confirmed: boolean;
  grades: Record<string, [number, number]>;
}

export interface Exam {
  id: string;
  title: string;
  note: string;
  isSample: boolean;
  isPast: boolean;
  answerReleased: boolean;
  items: ExamItem[];
  cuts?: ExamCuts;
  types: Record<string, ExamType>;
}

/** 넣은 답. 숫자이거나 안 풂. 키가 없으면 미입력이다. */
export type AnswerValue = number | 'skip';
export type Answers = Record<number, AnswerValue>;

/** 5지선다 표시는 고민(doubt)과 찍음(guess), 단답형 표시는 자신 없음(unsure). */
export type Mark = 'doubt' | 'guess' | 'unsure';
export type Marks = Record<number, Mark>;

/** 오답 원인. slip은 "풀 줄 아는데 틀렸어요", blank는 "풀이가 안 떠올랐어요", unknown은 "잘 모르겠어요". */
export type Cause = 'slip' | 'blank' | 'unknown';
export type Causes = Record<number, Cause>;

export type InputMode = 'keypad' | 'rows';
export type GradedBefore = 'not_yet' | 'already';
export type SeenBefore = 'first' | 'partial' | 'solved';
export type TimeFeel = 'enough' | 'tight' | 'missed';

export interface RetryRecord {
  correct: boolean;
  attempts: number;
  /** 다시 풀기 전에 정답을 알 수 있었는지. 정답 보기를 눌렀거나, 이미 채점한 경로이거나, 맞힌 문항이었던 경우. */
  answerKnown: boolean;
  at: string;
}

export interface Session {
  id: string;
  examId: string;
  createdAt: string;
  gradedBefore: GradedBefore | null;
  seenBefore: SeenBefore | null;
  answers: Answers;
  marks: Marks;
  /** 앱에서 채점한 뒤에 표시를 바꿨는지. */
  marksEditedAfterGrading: boolean;
  timeFeel: TimeFeel | null;
  /** 정답 공개 전 시험의 답을 저장한 시각. */
  savedAt: string | null;
  gradedAt: string | null;
  causes: Causes;
  answerViewed: Record<number, true>;
  targetGrade: string | null;
  retries: Record<number, RetryRecord>;
}

/** 사용성 테스트 한 번의 측정 기록. 이 기기 안에만 둔다. */
export interface TestRun {
  id: string;
  participant: string;
  inputMode: InputMode;
  plannedExamId: string;
  startedAt: number;
  endedAt: number | null;
  sessionId: string | null;
  examId: string | null;
  screens: { screen: string; at: number }[];
  examSelectAt: number | null;
  inputStartAt: number | null;
  firstInputAt: number | null;
  inputDoneAt: number | null;
  reviewConfirmAt: number | null;
  itemInputs: Record<number, number>;
  reviewFixed: number[];
  marksMs: number;
  firstScoreAt: number | null;
  answerKeyText: string;
}

export interface AppData {
  version: 1;
  sessions: Session[];
  currentId: string | null;
  inputMode: InputMode;
  testRuns: TestRun[];
  activeRunId: string | null;
}
