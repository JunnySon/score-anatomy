import type { Answers, Causes, Exam, Marks } from '../types';
import type { Responses } from './scoring';

// 작업 지시서 7장의 검산 예시. 예시 시험 A에 넣는 응답이다.
// 단위 테스트와 "예시 결과 보기"가 같은 값을 쓴다.

/** 틀린 문항 6개와 그때 넣은 답. 나머지 24문항은 정답을 넣는다. */
export const EXAMPLE_WRONG: Record<number, number> = {
  11: 4,
  15: 1,
  20: 3,
  21: 5,
  27: 146,
  29: 275,
};

/** 찍음 표시: 9번과 14번은 정답, 11번, 20번, 21번은 틀림. */
export const EXAMPLE_GUESS: number[] = [9, 11, 14, 20, 21];

/** 원인 "풀 줄 아는데 틀렸어요": 15번, 29번. 나머지 틀린 문항은 "풀이가 안 떠올랐어요". */
export const EXAMPLE_SLIP: number[] = [15, 29];

export function exampleAnswers(exam: Exam): Answers {
  const answers: Answers = {};
  for (const it of exam.items) {
    const wrong = EXAMPLE_WRONG[it.no];
    answers[it.no] = wrong !== undefined ? wrong : (it.answer as number);
  }
  return answers;
}

export function exampleMarks(): Marks {
  const marks: Marks = {};
  for (const no of EXAMPLE_GUESS) marks[no] = 'guess';
  return marks;
}

export function exampleCauses(): Causes {
  const causes: Causes = {};
  for (const no of Object.keys(EXAMPLE_WRONG).map(Number)) {
    causes[no] = EXAMPLE_SLIP.includes(no) ? 'slip' : 'blank';
  }
  return causes;
}

export function exampleResponses(exam: Exam): Responses {
  return { answers: exampleAnswers(exam), marks: exampleMarks(), causes: exampleCauses() };
}
