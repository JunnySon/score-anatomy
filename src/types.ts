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
  /** answer 말고도 정답으로 인정하는 답(복수 정답). answer 가 있을 때만 쓰고 범위는 answer 와 같다. 인정하는 답은 acceptedAnswers 로 읽는다. */
  altAnswers?: number[];
  /** 모두 정답 처리. true 만 쓴다. 넣은 답이 무엇이든, 안 풂이어도 맞은 것으로 채점한다. */
  allCorrect?: true;
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
  /** 기준. "YYYY-MM-DD" 또는 "YYYY-MM-DDTHH:mm"(한국 시간). Date 로 바꾸지 않고 문자열을 잘라 쓴다(src/logic/dates.ts 의 parseAsOf). */
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
  /** 시험 시행일("YYYY-MM-DD"). 없어도 된다. 있으면 시험 목록에서 최근 날짜가 위로 온다. */
  examDate?: string;
  // 아래 네 칸은 작업 지시서 3의 4-1~4-3 에서 더한 선택 칸이다. 없을 때의 값은 src/exams/validate.ts 의 revOf, answersRevOf, typesReadyOf 로 읽는다.
  /** 판 번호. 1 이상의 정수이고 없으면 1이다. 같은 id 의 시험을 고쳐 낼 때마다 1씩 올린다. */
  rev?: number;
  /** 정답 판 번호. 1 이상의 정수이고 없으면 1이다. 채점에 영향을 주는 값(answer, altAnswers, allCorrect, points)을 공개한 뒤에 고칠 때만 올린다. */
  answersRev?: number;
  /** 정답 정정 안내. 학생에게 그대로 보이는 한 문장이다. answersRev 가 2 이상이면 꼭 있어야 한다. */
  answersNote?: string;
  /** 유형 분류가 끝났는지. 없으면 true 로 본다. false 면 계단 대신 유형 분류를 준비하고 있다는 안내를 보여 준다. */
  typesReady?: boolean;
  items: ExamItem[];
  cuts?: ExamCuts;
  types: Record<string, ExamType>;
}

/**
 * 풀이 잠금 달력의 항목(작업 지시서 3의 4-5). 달력은 이 항목의 배열이다. 검사는 src/exams/validate.ts 의 checkLocks 로 한다.
 * start 와 end 는 "YYYY-MM-DDTHH:mm"(한국 시간)이고 같은 날이며 start 가 end 보다 앞선다. 구간은 start 이상 end 미만이다.
 */
export interface LockEntry {
  /** 항목의 이름. 묶음 안 달력과 넘겨받은 달력에 같은 id 가 있으면 넘겨받은 항목을 쓴다. */
  id: string;
  /** 사람이 보는 메모. 화면에 쓰지 않는다. */
  label: string;
  start: string;
  end: string;
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
  /** 가장 최근에 다시 푼 결과. */
  correct: boolean;
  attempts: number;
  /** 처음 맞힌 것이 몇 번째 시도였는지. 아직 맞힌 적이 없으면 null. */
  firstCorrectAttempt: number | null;
  /** 다시 풀기 전에 정답을 알 수 있었는지. 정답 보기를 눌렀거나, "이미 했어요" 경로인 경우. */
  answerKnown: boolean;
  at: string;
  /**
   * 이 기록을 남긴 때의 정답 판 번호(시험의 answersRev). 2 이상일 때만 적고, 칸이 없으면 1이다(작업 지시서 3의 4-6).
   * 지금 시험의 정답 판 번호와 다르면 그때의 정답으로 맞춰 본 기록이라 지우지 않고 화면에서만 뺀다(src/state/session.ts 의 currentRetry).
   */
  answersRev?: number;
}

/**
 * 채점 흔적(작업 지시서 3의 4-6): 채점한 때의 정답 판 번호(시험의 answersRev)와 실제 점수.
 * 정답이 정정된 판(answersRev 가 더 큰 판)을 받으면 이 값과 견줘 바뀐 것을 알린다.
 */
export interface GradedWith {
  answersRev: number;
  score: number;
}

/** 찍었다고 표시하고 맞은 문항을 다시 볼 때 학생이 스스로 고른 결과. solved는 "끝까지 풀었어요", stuck은 "풀어 봤는데 막혀요". */
export type SelfCheck = 'solved' | 'stuck';

export interface SelfCheckRecord {
  result: SelfCheck;
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
  /** 지금 답으로 채점한 시각. 채점한 뒤 답을 고치면 비워서 다시 채점하게 한다. */
  gradedAt: string | null;
  /** 처음 채점한 시각. 한 번 정해지면 바뀌지 않는다. */
  firstGradedAt: string | null;
  /** 처음 채점한 뒤에 답을 고친 문항 번호. */
  answersEditedAfterGrading: number[];
  causes: Causes;
  answerViewed: Record<number, true>;
  /**
   * 정답 보기를 누른 때 본 인정하는 답(작은 수부터 쉼표로 이은 글자, 형식 예시 "3" 또는 "3,5"). 문항 번호가 열쇠다(별도 검토 A5).
   * 그 뒤 정답이 정정되어 그 문항의 인정하는 답이 바뀌면, 지금 정답은 아직 보지 않은 것으로 다룬다(src/state/session.ts 의 answerSeenNow).
   * 이 칸이 없는 옛 기록도 그대로 읽는다(저장 형식의 version 은 1 그대로). 칸이 없으면 정답 보기를 누른 문항은 지금 정답을 본 것으로 본다.
   */
  answerSeen?: Record<number, string>;
  targetGrade: string | null;
  retries: Record<number, RetryRecord>;
  /** 찍었다고 표시하고 맞은 문항의 스스로 확인한 결과. 이 칸이 없는 옛 기록도 빈 값으로 읽는다. */
  selfChecks: Record<number, SelfCheckRecord>;
  /**
   * 채점 흔적(작업 지시서 3의 4-6). 채점할 때와 정정 알림의 "확인했어요"를 누를 때 지금 값으로 적는다.
   * 이 칸이 없는 옛 기록도 그대로 읽는다(저장 형식의 version 은 1 그대로). 정답 판 번호가 1인 시험의 옛 채점 기록에는 앱이 시작할 때 조용히 채운다.
   */
  gradedWith?: GradedWith;
  /**
   * 기록을 시작한 때의 시험 제목. 그 시험을 지금 시험 목록에서 찾지 못할 때(넘겨받은 시험 자료가 아직 없을 때, 작업 지시서 3의 5-2)
   * 기록 화면이 시험 id 대신 이 제목을 보여 준다(별도 검토 D2). 시험을 찾으면 지금 시험의 제목을 쓴다.
   * 이 칸이 없는 옛 기록도 그대로 읽는다(저장 형식의 version 은 1 그대로). 없으면 시험 id 를 보여 준다.
   */
  examTitle?: string;
}

/** 사용성 테스트 한 번의 측정 기록. 이 기기 안에만 둔다. */
/** 측정 기록 가운데 시험 기록 한 건에 딸린 값. 참가자가 다른 기록으로 옮겨 가면 따로 넣어 두었다가 돌아오면 이어 쓴다. */
export interface RunPart {
  inputStartAt: number | null;
  firstInputAt: number | null;
  inputDoneAt: number | null;
  reviewConfirmAt: number | null;
  itemInputs: Record<number, number>;
  reviewFixed: number[];
  marksMs: number;
  firstScoreAt: number | null;
  /** 참가자가 최종 제출한 답의 사본. 시험 기록을 지워도 남은 오입력을 셀 수 있게 따로 둔다. 미입력은 null. */
  finalAnswers: (AnswerValue | null)[] | null;
}

export interface TestRun extends RunPart {
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
  /** 측정 중에 다른 시험 기록으로 옮겨 간 횟수. */
  examReselects: number;
  /** 측정 중에 연달아 누르기 보호가 받지 않은 누름의 수(측정에 묶인 화면에서만 센다). */
  discardedTaps: number;
  /** 측정 중에 빠진 누름 채우기가 채운 누름의 수(측정에 묶인 화면에서만 센다, 작업 지시서 3-1의 3-1). 두 규칙을 모두 센다. */
  filledTaps: number;
  /** filledTaps 가운데 누르는 동안 온 dblclick 규칙으로 채운 누름의 수(작업 지시서 4의 2-2). */
  filledHeldTaps: number;
  /** 지금 묶인 기록이 아닌 기록에서 재던 값(기록 id별). 그 기록으로 돌아오면 이어 쓴다. */
  parts: Record<string, RunPart>;
  answerKeyText: string;
}

export interface AppData {
  version: 1;
  sessions: Session[];
  currentId: string | null;
  inputMode: InputMode;
  testRuns: TestRun[];
  activeRunId: string | null;
  /** 앱: 앞서 저장된 기록을 읽지 못해 보관해 달라고 한 뒤, 기록 화면이 그 안내를 아직 보여 주지 않았다. 없어도 읽힌다(version 1 그대로). */
  archiveNotice?: true;
}
