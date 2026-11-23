import type { Coord, Exam } from '../types';
import type { Grade, ItemResult } from './scoring';

// 계단(먼저 고칠 유형) 선정. 통계 없이 내 기록만으로 정한다(작업 지시서 7장).

export interface Step {
  typeId: string;
  name: string;
  /** 유형별 점수 = 틀린 문항 배점 합 + 찍음 표시 정답 배점 합. */
  score: number;
  wrongPoints: number;
  guessCorrectPoints: number;
  wrongItems: ItemResult[];
  guessCorrectItems: ItemResult[];
  /** 이 유형에서 점수에 들어간 문항 가운데 가장 앞선 번호. 동점일 때 순서를 정한다. */
  firstNo: number;
  /** 오늘 시험지에서 다시 볼 문항 번호. 틀린 문항과, 찍었다고 표시했고 채점해 보니 맞은 문항. */
  retryNos: number[];
  coords: Coord[];
}

/** 점수가 있는 유형 전부를 순서대로. 점수가 큰 순, 같으면 문항 번호가 앞선 유형 순. */
export function rankTypes(exam: Exam, grade: Grade): Step[] {
  const map = new Map<string, Step>();
  for (const it of grade.items) {
    const counts = !it.correct || it.guess;
    if (!counts) continue;
    let step = map.get(it.typeId);
    if (!step) {
      const type = exam.types[it.typeId];
      step = {
        typeId: it.typeId,
        name: type?.name ?? it.typeId,
        score: 0,
        wrongPoints: 0,
        guessCorrectPoints: 0,
        wrongItems: [],
        guessCorrectItems: [],
        firstNo: it.no,
        retryNos: [],
        coords: type?.coords ?? [],
      };
      map.set(it.typeId, step);
    }
    if (!it.correct) {
      step.wrongPoints += it.points;
      step.wrongItems.push(it);
    } else {
      step.guessCorrectPoints += it.points;
      step.guessCorrectItems.push(it);
    }
    step.score += it.points;
    step.firstNo = Math.min(step.firstNo, it.no);
    step.retryNos.push(it.no);
  }
  const steps = [...map.values()].filter((s) => s.score > 0);
  for (const s of steps) s.retryNos.sort((a, b) => a - b);
  return steps.sort((a, b) => b.score - a.score || a.firstNo - b.firstNo);
}

/** 상위 2개를 보여 주고, 3위가 2위의 70% 이상이면 3개까지. 대상이 하나면 하나만. */
export function selectSteps(exam: Exam, grade: Grade): Step[] {
  const ranked = rankTypes(exam, grade);
  if (ranked.length <= 2) return ranked;
  const second = ranked[1]!;
  const third = ranked[2]!;
  // 3위 >= 2위 x 0.7 을 정수 계산으로 비교한다.
  const includeThird = third.score * 10 >= second.score * 7;
  return ranked.slice(0, includeThird ? 3 : 2);
}
