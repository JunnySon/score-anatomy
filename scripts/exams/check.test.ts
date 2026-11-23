import { renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkExam } from '../../src/exams/validate.ts';
import type { Exam } from '../../src/types.ts';
import { checkData, looksLikeAnswerNote, runCheck, screenTextProblems } from './check.ts';
import { examPath } from './data.ts';
import { compareWithPublished, stateEntryOf } from './state.ts';
import { collectIo, makeDataDir, markPublished, releasedExam, removeDir, runTool, snapshot, testExam, writeExam, writeLocks } from './testkit.ts';

// exams:check(작업 지시서 3의 6-4): 원본 검사, 발행 기록(state.json)과의 비교, 변경 요약. 아무 파일도 쓰지 않는다.
// 시험은 그 자리에서 지은 테스트 전용 시험이고(testkit.ts), 모든 쓰기는 임시 폴더에서 한다.

const dirs: string[] = [];
function dataDir(): string {
  const dir = makeDataDir();
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) removeDir(dir);
});

/** 시험을 발행해 둔 자료 폴더. */
function published(exam: Record<string, unknown>): string {
  const dir = dataDir();
  writeExam(dir, exam);
  markPublished(dir, [exam]);
  return dir;
}

/** 검사하고 거부가 있으면 그 문장들을, 없으면 빈 배열을 돌려준다. runCheck 의 종료 코드도 함께 본다. */
function rejections(dir: string): string[] {
  const report = checkData(dir);
  const { io } = collectIo();
  expect(runCheck({ dataDir: dir, dataName: 'data' }, io)).toBe(report.ok ? 0 : 1);
  return report.errors;
}

interface Scenario {
  /** 어떤 변경인지. */
  label: string;
  /** 발행해 둘 시험. */
  published: Record<string, unknown>;
  /** 발행 뒤에 원본을 바꾼다. */
  change(dir: string): void;
  /** 거부 문장에 들어 있어야 하는 글자. */
  expected: string;
}

// 지시서 6-4 의 "publish 가 거부해야 하는 변경" 일곱 가지. 이름은 지시서의 문장 그대로이고, 다음 단계(publish)와 verify 가 이름으로 확인한다.
const FORBIDDEN: { name: string; scenarios: Scenario[] }[] = [
  {
    name: '발행했던 시험 id 가 사라짐',
    scenarios: [
      { label: '원본 파일을 지움', published: testExam(), change: (dir) => rmSync(examPath(dir, 'test-tool-a')), expected: '발행했던 시험 test-tool-a 의 원본 파일이 없어요' },
      {
        label: '파일 이름과 id 를 바꿈',
        published: testExam(),
        change: (dir) => {
          rmSync(examPath(dir, 'test-tool-a'));
          writeExam(dir, testExam({ id: 'test-tool-c' }));
        },
        expected: '발행했던 시험 test-tool-a 의 원본 파일이 없어요',
      },
    ],
  },
  {
    name: '내용이 바뀌었는데 rev 가 그대로이거나 rev 가 내려감',
    scenarios: [
      {
        label: '제목을 고치고 rev 그대로',
        published: testExam(),
        change: (dir) => writeExam(dir, testExam({ title: '테스트 전용 시험(제목을 고침)' })),
        expected: '내용이 발행한 판과 다른데 rev 가 그대로예요(1)',
      },
      { label: 'rev 를 내림', published: testExam({ rev: 2 }), change: (dir) => writeExam(dir, testExam({ rev: 1 })), expected: 'rev 가 발행한 판(2)보다 작아요(지금 1)' },
    ],
  },
  {
    name: 'answerReleased 가 true 에서 false 로 돌아감',
    scenarios: [
      {
        label: '정답을 두고 공개만 거둠',
        published: releasedExam(),
        change: (dir) => writeExam(dir, releasedExam({ rev: 2, answerReleased: false })),
        expected: 'answerReleased 가 false 로 돌아갔어요',
      },
      {
        label: '정답 칸을 모두 빼고 공개 전으로 되돌림',
        published: releasedExam(),
        change: (dir) => writeExam(dir, testExam({ rev: 2 })),
        expected: 'answerReleased 가 false 로 돌아갔어요',
      },
    ],
  },
  {
    name: '문항의 no, kind, choices 가 바뀜',
    scenarios: [
      { label: '보기 수', published: testExam(), change: (dir) => writeExam(dir, withItem(testExam({ rev: 2 }), 3, { choices: 5 })), expected: '3번의 choices(발행한 판 4, 지금 5)' },
      {
        label: '문항 종류',
        published: testExam(),
        change: (dir) => writeExam(dir, withItem(testExam({ rev: 2 }), 6, { kind: 'mc', choices: 5 })),
        expected: '6번의 kind(발행한 판 short, 지금 mc)',
      },
      { label: '문항 번호', published: testExam(), change: (dir) => writeExam(dir, withItem(testExam({ rev: 2 }), 6, { no: 7 })), expected: '6번째 문항의 번호(발행한 판 6, 지금 7)' },
      {
        label: '문항 수',
        published: testExam(),
        change: (dir) => {
          const exam = testExam({ rev: 2 });
          writeExam(dir, { ...exam, items: (exam.items as unknown[]).slice(0, 5) });
        },
        expected: '문항 수(발행한 판 6개, 지금 5개)',
      },
    ],
  },
  {
    name: '채점에 영향을 주는 값이 바뀌었는데 answersRev 를 올리지 않았거나 answersNote 가 없음',
    scenarios: [
      {
        label: '정답을 바꾸고 answersRev 그대로',
        published: releasedExam(),
        change: (dir) => writeExam(dir, withItem(releasedExam({ rev: 2 }), 2, { answer: 1 })),
        expected: '공개한 정답이나 배점이 바뀌었는데(2번(정답)) answersRev 를 올리지 않았어요(1)',
      },
      {
        label: '배점을 바꾸고 answersRev 그대로',
        published: releasedExam(),
        change: (dir) => writeExam(dir, withItem(releasedExam({ rev: 2 }), 1, { points: 3 })),
        expected: '공개한 정답이나 배점이 바뀌었는데(1번(배점)) answersRev 를 올리지 않았어요(1)',
      },
      {
        label: '모두 정답 처리를 더하고 answersRev 그대로',
        published: releasedExam(),
        change: (dir) => writeExam(dir, withItem(releasedExam({ rev: 2 }), 6, { answer: undefined, allCorrect: true })),
        expected: '6번(정답, 모두 정답 처리)',
      },
      {
        label: '복수 정답을 더하고 answersRev 는 올렸지만 answersNote 가 없음',
        published: releasedExam(),
        change: (dir) => writeExam(dir, withItem(releasedExam({ rev: 2, answersRev: 2 }), 1, { altAnswers: [4] })),
        // 정답 판 번호가 2 이상인데 정정 안내가 없는 것은 시험 파일 검사(validate.ts)가 먼저 거부한다.
        expected: 'answersRev가 2 이상이면 answersNote에 정정 안내를 적어야 해요.',
      },
      {
        label: '정답을 바꾸고 answersRev 도 answersNote 도 그대로',
        published: releasedExam(),
        change: (dir) => writeExam(dir, withItem(releasedExam({ rev: 2 }), 5, { answer: 7 })),
        expected: '공개한 정답이나 배점이 바뀌었는데(5번(정답)) answersNote 에 정정 안내가 없어요.',
      },
    ],
  },
  {
    name: 'confirmed 가 true 인데 두 값이 다름',
    scenarios: [
      {
        label: '발행한 시험에 확정 컷을 범위로 넣음',
        published: releasedExam(),
        change: (dir) => writeExam(dir, releasedExam({ rev: 2, cuts: { source: '예시 값', asOf: '2030-01-02T20:10', confirmed: true, grades: { 1: [17, 18] } } })),
        expected: '확정 컷은 두 값이 같아야 해요',
      },
      {
        label: '새 시험에 확정 컷을 범위로 넣음',
        published: releasedExam(),
        change: (dir) =>
          writeExam(dir, releasedExam({ id: 'test-tool-b', cuts: { source: '예시 값', asOf: '2030-01-02', confirmed: true, grades: { 1: [18, 18], 2: [14, 15] } } })),
        expected: '2등급: 확정 컷은 두 값이 같아야 해요',
      },
    ],
  },
  {
    name: '잠금 달력 항목의 형식이 틀림',
    scenarios: [
      {
        label: 'start 가 end 보다 늦음',
        published: testExam(),
        change: (dir) => writeLocks(dir, [{ id: 'test-lock-a', label: '테스트 전용 잠금', start: '2030-01-02T17:45', end: '2030-01-02T08:40' }]),
        expected: '1번째 항목: start가 end보다 앞서야 해요',
      },
      {
        label: '시각 모양이 틀림',
        published: testExam(),
        change: (dir) => writeLocks(dir, [{ id: 'test-lock-a', label: '테스트 전용 잠금', start: '2030-01-02T8:40', end: '2030-01-02T17:45' }]),
        expected: 'start는 2030-01-02T08:40 같은',
      },
      {
        label: 'id 가 겹침',
        published: testExam(),
        change: (dir) =>
          writeLocks(dir, [
            { id: 'test-lock-a', label: '테스트 전용 잠금', start: '2030-01-02T08:40', end: '2030-01-02T17:45' },
            { id: 'test-lock-a', label: '테스트 전용 잠금 둘', start: '2030-01-02T08:40', end: '2030-01-02T17:10' },
          ]),
        expected: '앞의 항목과 id가 겹쳐요',
      },
    ],
  },
];

/** no 번 문항의 칸을 바꾼 시험. undefined 인 칸은 뺀다. */
function withItem(exam: Record<string, unknown>, no: number, patch: Record<string, unknown>): Record<string, unknown> {
  const items = (exam.items as Record<string, unknown>[]).map((it) => {
    if (it.no !== no) return it;
    const next: Record<string, unknown> = { ...it, ...patch };
    for (const [k, v] of Object.entries(next)) if (v === undefined) delete next[k];
    return next;
  });
  return { ...exam, items };
}

describe('발행 도구 exams:check 금지된 변경(작업 지시서 3의 6-4)', () => {
  // 이름이 길어도 줄이지 않게 $name 대신 %s 로 넣는다.
  it.each(FORBIDDEN.map((c) => [c.name, c.scenarios] as const))('%s: check 가 거부한다', (_name, scenarios) => {
    for (const s of scenarios) {
      const dir = published(s.published);
      // 바꾸기 전에는 통과한다(비교 대상이 맞는지).
      expect(rejections(dir), s.label).toEqual([]);
      s.change(dir);
      const found = rejections(dir);
      expect(found.length, s.label).toBeGreaterThan(0);
      expect(found.join('\n'), s.label).toContain(s.expected);
    }
  });

  it('바뀐 것이 없으면 통과하고, 발행한 판과 같다고 적는다', () => {
    const dir = published(releasedExam());
    const report = checkData(dir);
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.lines).toContain('  발행한 판과 같아요(rev 1).');
    expect(report.lines).toContain('잠금 달력(locks.json): 항목 0개, 발행한 것과 같아요.');
    expect(report.exams.map((e) => e.exam.id)).toEqual(['test-tool-a']);
  });

  it('허락된 변경은 통과한다: rev 를 올린 수정, 처음 정답 공개, answersRev 와 answersNote 를 갖춘 정정', () => {
    const fix = published(testExam());
    writeExam(fix, testExam({ rev: 2, title: '테스트 전용 시험(제목을 고침)' }));
    expect(rejections(fix)).toEqual([]);

    const first = published(testExam());
    writeExam(first, releasedExam({ rev: 2 }));
    expect(rejections(first)).toEqual([]);
    expect(checkData(first).lines).toContain('  정답을 처음 공개해요(answerReleased 가 false 에서 true 로).');

    const fixed = published(releasedExam());
    writeExam(fixed, withItem(releasedExam({ rev: 2, answersRev: 2, answersNote: '테스트 전용 정정 안내예요.' }), 2, { answer: 1 }));
    const report = checkData(fixed);
    expect(report.errors).toEqual([]);
    expect(report.lines).toContain('  정답 정정: 채점이 바뀌는 문항 2번(정답). answersRev 가 1에서 2로 올라요. 정정 안내: "테스트 전용 정정 안내예요."');
  });

  it('채점은 그대로인데 answersRev 를 올리면 거부한다(학생에게 거짓 정정 알림이 가서)', () => {
    const dir = published(releasedExam());
    writeExam(dir, releasedExam({ rev: 2, answersRev: 2, answersNote: '테스트 전용 정정 안내예요.' }));
    expect(rejections(dir).join('\n')).toContain('발행한 판과 같은데 answersRev 가 올랐어요(발행한 판 1, 지금 2). 학생에게 거짓 정정 알림이 가요.');
    // answer 와 altAnswers 를 맞바꾼 것도 인정하는 답이 같아서 채점이 같다.
    const swapped = published(releasedExam());
    writeExam(swapped, withItem(releasedExam({ rev: 2, answersRev: 2, answersNote: '테스트 전용 정정 안내예요.' }), 3, { answer: 4, altAnswers: [2] }));
    expect(rejections(swapped).join('\n')).toContain('학생에게 거짓 정정 알림이 가요');
    writeExam(swapped, withItem(releasedExam({ rev: 2 }), 3, { answer: 4, altAnswers: [2] }));
    expect(rejections(swapped)).toEqual([]);
  });

  it('발행 기록과 견주는 함수(compareWithPublished)는 시험 파일 검사 없이도 정정 안내가 없는 정정을 거부한다(publish 가 같은 함수를 써서)', () => {
    const before = checkExam(releasedExam()).exam as Exam;
    const prev = stateEntryOf(before, 'files/test-tool-a.1.json');
    const after = { ...before, rev: 2, answersRev: 2, items: before.items.map((it) => (it.no === 2 ? { ...it, answer: 1 } : it)) } as Exam;
    const texts = compareWithPublished(prev, after).findings.map((f) => `${f.level} ${f.text}`);
    expect(texts).toEqual(['error 공개한 정답이나 배점이 바뀌었는데(2번(정답)) answersNote 에 정정 안내가 없어요.']);
    // 같은 시험 객체를 그대로 견주면 바뀐 것이 없다.
    expect(compareWithPublished(prev, before)).toEqual({ findings: [], changes: ['발행한 판과 같아요(rev 1).'] });
  });

  it('answersRev 가 내려가면 거부한다', () => {
    const dir = published(withItem(releasedExam({ answersRev: 2, answersNote: '테스트 전용 정정 안내예요.' }), 2, { answer: 1 }));
    writeExam(dir, withItem(releasedExam({ rev: 2 }), 2, { answer: 1 }));
    expect(rejections(dir).join('\n')).toContain('answersRev 가 발행한 판(2)보다 작아요(지금 1)');
  });

  it('정답 공개 전에 발행한 시험의 첫 정답 공개에서 answersRev 를 올리면 거부한다(처음 공개는 정정이 아니어서)', () => {
    const dir = published(testExam());
    writeExam(dir, releasedExam({ rev: 2, answersRev: 2, answersNote: '테스트 전용 정정 안내예요.' }));
    expect(rejections(dir).join('\n')).toContain('처음 공개하는 정답은 정정이 아니라서 answersRev 를 올리지 않아요');
  });

  it('내용은 같고 rev 만 오르거나, 판 번호가 한 번에 2 이상 오르면 알리기만 한다', () => {
    const dir = published(releasedExam());
    writeExam(dir, releasedExam({ rev: 3 }));
    const report = checkData(dir);
    expect(report.errors).toEqual([]);
    expect(report.warnings).toContain('src/test-tool-a.json: 내용은 발행한 판과 같고 rev 만 올랐어요(발행한 판 1, 지금 3). 학생 화면은 바뀌지 않아요.');
    expect(report.warnings).toContain('src/test-tool-a.json: rev 가 한 번에 2 이상 올랐어요(발행한 판 1, 지금 3).');
  });

  it('정정인데 answersNote 가 발행한 판과 같거나, 유형 분류와 등급컷을 거두면 알린다', () => {
    const note = '테스트 전용 정정 안내예요.';
    const cuts = { source: '예시 값', asOf: '2030-01-02T20:10', confirmed: false, grades: { 1: [17, 18] } };
    const dir = published(withItem(releasedExam({ answersRev: 2, answersNote: note, cuts }), 2, { answer: 1 }));
    writeExam(dir, withItem(releasedExam({ rev: 2, answersRev: 3, answersNote: note, typesReady: false }), 2, { answer: 4 }));
    const report = checkData(dir);
    expect(report.errors).toEqual([]);
    expect(report.warnings).toContain('src/test-tool-a.json: answersRev 가 올랐는데 answersNote 가 발행한 판과 같아요. 이번 정정을 알리는 문장인지 확인해 주세요.');
    expect(report.warnings).toContain('src/test-tool-a.json: 유형 분류를 마친 판을 발행했는데 typesReady 가 false 로 돌아갔어요. 학생 화면에서 계단이 사라져요.');
    expect(report.warnings).toContain('src/test-tool-a.json: 발행한 등급컷을 뺐어요. 학생 화면에서 등급컷이 사라져요.');
  });
});

describe('발행 도구 exams:check(작업 지시서 3의 6-4)', () => {
  it('check 는 통과하든 거부하든 아무 파일도 쓰지 않는다(함수와 실제 Node 실행 모두)', () => {
    const dir = published(releasedExam());
    // 거부가 생기게 바꾼다: 정답을 바꾸고 answersRev 그대로, 잠금 항목 하나는 형식이 틀림.
    writeExam(dir, withItem(releasedExam({ rev: 2 }), 2, { answer: 1 }));
    writeLocks(dir, [{ id: 'test-lock-a', label: '테스트 전용 잠금', start: '2030-01-02T17:45', end: '2030-01-02T08:40' }]);
    const before = snapshot(dir);
    expect(checkData(dir).ok).toBe(false);
    const { io } = collectIo();
    expect(runCheck({ dataDir: dir, dataName: 'data' }, io)).toBe(1);
    const run = runTool(['check', '--data', dir]);
    expect(run.status).toBe(1);
    expect(run.stdout).toContain('결과: 검사를 통과하지 못했어요.');
    expect(snapshot(dir)).toEqual(before);

    const ok = published(releasedExam());
    const okBefore = snapshot(ok);
    const okRun = runTool(['check', '--data', ok]);
    expect(okRun.status).toBe(0);
    expect(okRun.stdout).toContain('결과: 검사를 통과했어요. 이 검사는 파일을 쓰지 않아요.');
    expect(snapshot(ok)).toEqual(okBefore);
  });

  it('사람이 읽을 변경 요약: 새 시험, 발행한 판, rev, 정답 공개, 유형 분류, 등급컷, 잠금 달력', () => {
    const dir = published(testExam({ typesReady: false }));
    writeExam(
      dir,
      releasedExam({ rev: 2, typesReady: true, cuts: { source: '기관 가의 추정 값', asOf: '2030-01-02T20:10', confirmed: false, grades: { 1: [18, 18], 2: [15, 15] } } }),
    );
    writeExam(dir, testExam({ id: 'test-tool-b', title: '테스트 전용 시험(둘째)' }));
    writeLocks(dir, [{ id: 'test-lock-a', label: '테스트 전용 잠금', start: '2030-01-02T08:40', end: '2030-01-02T17:45' }]);
    const { io, out } = collectIo();
    expect(runCheck({ dataDir: dir, dataName: 'data' }, io)).toBe(0);
    expect(out).toEqual([
      '시험 자료를 검사해요: data',
      '마지막 발행: seq 1, issuedAt 2030-01-02T17:10.',
      'src/test-tool-a.json(테스트 전용 시험(발행 도구))',
      '  발행한 판: rev 1, answersRev 1, 정답 공개 전.',
      '  rev 가 1에서 2로 바뀌어요. 내용이 발행한 판과 달라요.',
      '  정답을 처음 공개해요(answerReleased 가 false 에서 true 로).',
      '  유형 분류를 마쳐요(typesReady 가 false 에서 true 로). 계단이 나와요.',
      '  등급컷을 처음 넣어요(추정, 기준 2030-01-02T20:10, 등급 2개).',
      'src/test-tool-b.json(테스트 전용 시험(둘째))',
      '  새 시험이에요. rev 1, 문항 6개(5지선다 4개, 단답형 2개), 만점 20점, 정답 공개 전, 유형 분류 끝남, 등급컷 없음.',
      '잠금 달력(locks.json): 항목 1개, 발행한 것과 달라요.',
      '  test-lock-a: 2030-01-02T08:40부터 2030-01-02T17:45까지',
      '알림 2개',
      '  - src/test-tool-a.json: isSample 이 true 라 앱에서 예시 시험으로 보여요. 실제 시험이면 false 로 적어요.',
      '  - src/test-tool-b.json: isSample 이 true 라 앱에서 예시 시험으로 보여요. 실제 시험이면 false 로 적어요.',
      '거부 0개',
      '결과: 검사를 통과했어요. 이 검사는 파일을 쓰지 않아요.',
    ]);
  });

  it('시험 파일의 검사는 src/exams/validate.ts 의 규칙을 그대로 쓴다', () => {
    const dir = dataDir();
    writeExam(dir, withItem(testExam(), 1, { typeId: 't09' }));
    writeExam(dir, releasedExam({ id: 'test-tool-b', answersRev: 2 }));
    const found = rejections(dir);
    // 문장도 validate.ts 의 것 그대로다.
    expect(found).toContain('src/test-tool-a.json: 1번: typeId가 types에 없어요.');
    expect(found).toContain('src/test-tool-b.json: answersRev가 2 이상이면 answersNote에 정정 안내를 적어야 해요.');
  });

  it('발행 도구만의 규칙: 파일 이름은 <id>.json, id 는 소문자와 숫자와 붙임표, rev 를 꼭 적음, JSON 으로 읽을 수 있어야 함', () => {
    const dir = dataDir();
    writeExam(dir, testExam());
    renameSync(examPath(dir, 'test-tool-a'), examPath(dir, 'test-tool-x'));
    writeExam(dir, testExam({ id: 'Test_Tool' }));
    const { rev: _rev, ...noRev } = testExam({ id: 'test-tool-b' });
    writeExam(dir, noRev);
    writeFileSync(examPath(dir, 'test-tool-c'), '{\n  "id": "test-tool-c",\n}\n');
    const found = rejections(dir);
    expect(found).toContain('src/test-tool-x.json: 파일 이름은 시험 id 에 .json 을 붙인 test-tool-a.json 이어야 해요.');
    expect(found).toContain('src/Test_Tool.json: id 는 영어 소문자와 숫자를 붙임표(-)로 이은 모양이어야 해요(형식 예시: test-only-exam).');
    expect(found).toContain('src/test-tool-b.json: rev 를 적어야 해요. 발행하는 시험 파일에는 판 번호를 꼭 적어요(처음은 1).');
    expect(found).toContain('src/test-tool-c.json: JSON 으로 읽지 못했어요(3번째 줄 1번째 글자 근처).');
  });

  it('학생 화면에 나오는 글자의 금지 문자, 느낌표, 이모지를 거부한다', () => {
    const dash = String.fromCodePoint(0x2014);
    const dot = String.fromCodePoint(0x00b7);
    expect(screenTextProblems({ title: `테스트${dash}시험`, types: { t01: { name: `가${dot}나` } } })).toEqual([
      'title: 쓰지 않는 문자가 있어요(U+2014).',
      'types.t01.name: 쓰지 않는 문자가 있어요(U+00B7).',
    ]);
    const dir = dataDir();
    writeExam(dir, releasedExam({ answersRev: 2, answersNote: `정정됐어요${String.fromCodePoint(0x21)}` }));
    expect(rejections(dir)).toContain('src/test-tool-a.json: answersNote: 화면에 나오는 글자에는 느낌표를 쓰지 않아요.');
  });

  it('정정 안내(answersNote)가 정답 값을 드러내는 것처럼 보이면 알린다(정답 보기 전에 보이는 글자라서)', () => {
    expect(looksLikeAnswerNote('12번 정답이 3번에서 5번으로 정정됐어요.')).toBe(true);
    expect(looksLikeAnswerNote('12번 정답은 5예요.')).toBe(true);
    expect(looksLikeAnswerNote('12번 답: 4')).toBe(true);
    expect(looksLikeAnswerNote(`12번 정답이 ${String.fromCodePoint(0x2462)}로 바뀌었어요.`)).toBe(true);
    expect(looksLikeAnswerNote('12번 정답이 정정됐어요.')).toBe(false);
    expect(looksLikeAnswerNote('테스트 전용 정정 안내예요.')).toBe(false);
    const dir = dataDir();
    writeExam(dir, releasedExam({ answersRev: 2, answersNote: '2번 정답이 5에서 1로 정정됐어요.' }));
    const report = checkData(dir);
    expect(report.ok).toBe(true);
    expect(report.warnings.join('\n')).toContain('answersNote 에 정답 값처럼 보이는 글자가 있어요');
  });

  it('state.json, locks.json, src 폴더가 없거나 틀리면 거부한다', () => {
    const noState = dataDir();
    rmSync(join(noState, 'state.json'));
    expect(rejections(noState)).toContain('state.json: 파일이 없어요. 아직 발행한 적이 없으면 처음 값을 둬요(seq 0).');
    const badState = dataDir();
    writeFileSync(join(badState, 'state.json'), '{"format":1,"seq":-1,"issuedAt":null,"locksSha256":null,"exams":{}}\n');
    expect(rejections(badState)).toContain('state.json: seq 는 0 이상의 정수여야 해요.');
    const noLocks = dataDir();
    rmSync(join(noLocks, 'locks.json'));
    expect(rejections(noLocks)).toContain('locks.json: 파일이 없어요. 잠금 항목이 없으면 빈 배열([])로 둬요.');
    const noSrc = dataDir();
    rmSync(join(noSrc, 'src'), { recursive: true });
    expect(rejections(noSrc)).toContain('src 폴더가 없어요. 원본 시험 파일은 src/<시험 id>.json 에 둬요.');
  });

  it('처음 발행하는 시험의 answersRev 가 2 이상이거나, 정답 공개 전 파일에 정답이 있으면 알린다', () => {
    const dir = dataDir();
    writeExam(dir, releasedExam({ answersRev: 2, answersNote: '테스트 전용 정정 안내예요.' }));
    writeExam(dir, withItem(testExam({ id: 'test-tool-b' }), 2, { answer: 5 }));
    const report = checkData(dir);
    expect(report.ok).toBe(true);
    expect(report.warnings).toContain(
      'src/test-tool-a.json: 처음 발행하는 시험인데 answersRev 가 1보다 커요(지금 2). 앱 묶음에 든 예전 판이 없으면 칸을 빼거나 1로 둬요.',
    );
    expect(report.warnings).toContain(
      'src/test-tool-b.json: 정답 공개 전(answerReleased false)인데 정답 칸(answer, altAnswers, allCorrect)이 든 문항이 있어요(2번). 발행하면 누구나 파일에서 볼 수 있어요.',
    );
  });
});
