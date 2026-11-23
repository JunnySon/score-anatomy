import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateExam } from '../../src/exams/validate.ts';
import type { ExamItem } from '../../src/types.ts';
import { diffSheets, parseAnswerSheet, runAnswers } from './answers.ts';
import { checkData } from './check.ts';
import { examPath, sourceJson } from './data.ts';
import { SHEET, collectIo, makeDataDir, markPublished, readExam, releasedExam, removeDir, runTool, snapshot, testExam, writeExam } from './testkit.ts';

// exams:answers(작업 지시서 3의 6-4): 두 사람이 따로 적은 정답 파일이 완전히 같을 때만 원본 시험 파일에 정답을 넣는다.
// 다르면 다른 문항 번호만 보여 주고(답 값은 보여 주지 않음) 아무것도 쓰지 않는다.
// 시험과 정답은 그 자리에서 지은 테스트 전용 값이다(testkit.ts). 모든 쓰기는 임시 폴더에서 한다.

const dirs: string[] = [];
function dataDir(): string {
  const dir = makeDataDir();
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) removeDir(dir);
});

/** 자료 폴더 안에 정답 파일 두 개를 쓴다(자료 폴더는 테스트가 끝나면 지운다). */
function sheets(dir: string, a: string, b: string): [string, string] {
  const pa = join(dir, 'sheet-a.txt');
  const pb = join(dir, 'sheet-b.txt');
  writeFileSync(pa, a);
  writeFileSync(pb, b);
  return [pa, pb];
}

function answers(dir: string, files: [string, string], note: string | null = null) {
  const c = collectIo();
  const code = runAnswers({ dataDir: dir, files, names: ['가.txt', '나.txt'], note }, c.io);
  return { code, out: c.out, err: c.err };
}

const ITEMS = (testExam().items as ExamItem[]).map((it) => ({ ...it }));

describe('발행 도구 exams:answers(작업 지시서 3의 6-4)', () => {
  it('두 파일이 같으면 정답을 넣고 answerReleased 를 true 로 한다(줄 차례, 빈 줄, # 줄, 쉼표 둘레 빈칸은 상관없음)', () => {
    const dir = dataDir();
    writeExam(dir, testExam());
    const other = ['# 둘째 사람이 적은 정답', '시험 test-tool-a', '', '6 42', '5 608', '# 3번은 복수 정답', '3 2, 4', '4 *', '2 5', '1 3'].join('\r\n');
    const r = answers(dir, sheets(dir, SHEET, other));
    expect(r.err).toEqual([]);
    expect(r.code).toBe(0);
    expect(r.out).toEqual([
      'src/test-tool-a.json 에 정답을 넣었어요. 문항 6개(복수 정답 1문항, 모두 정답 처리 1문항), answerReleased true.',
      '다음 차례: npm run exams:check 로 검사해요.',
    ]);
    // 손으로 넣은 정답(testkit 의 releasedExam)과 같고, 원본 모양과 키 차례(answer 는 points 뒤, typeId 앞)를 지킨다.
    const written = readFileSync(examPath(dir, 'test-tool-a'), 'utf8');
    expect(written).toBe(sourceJson(releasedExam()));
    expect(written).toContain('{ "no": 3, "kind": "mc", "choices": 4, "points": 3, "answer": 2, "altAnswers": [4], "typeId": "t02" }');
    expect(validateExam(readExam(dir))).toEqual([]);
    // 같은 정답으로 다시 돌리면 파일을 그대로 둔다.
    const before = snapshot(dir);
    expect(answers(dir, sheets(dir, SHEET, SHEET)).out).toEqual(['src/test-tool-a.json 에는 이미 이 정답이 들어 있어요. 파일을 그대로 뒀어요.']);
    const after = snapshot(dir);
    expect(after['src/test-tool-a.json']).toBe(before['src/test-tool-a.json']);
  });

  it('두 파일이 다르면 원본 파일을 바이트 그대로 두고 다른 문항 번호만 보여 준다(답 값은 보여 주지 않음, 실제 Node 실행)', () => {
    const dir = dataDir();
    const path = writeExam(dir, testExam());
    const before = readFileSync(path);
    const other = SHEET.replace('2 5', '2 4').replace('5 608', '5 731').replace('3 2,4', '3 4,2');
    const [a, b] = sheets(dir, SHEET, other);
    const run = runTool(['answers', a, b, '--data', dir]);
    expect(run.status).toBe(1);
    expect(run.stdout).toBe('');
    expect(run.stderr.split(/\r?\n/)).toEqual(['두 정답 파일이 달라요. 다른 문항: 2번, 3번, 5번.', '아무것도 쓰지 않았어요.', '']);
    for (const value of ['608', '731', '42']) expect(run.stderr).not.toContain(value);
    expect(readFileSync(path).equals(before)).toBe(true);
  });

  it('이미 공개한 정답을 바꾸면 --note 가 있어야 하고, 있으면 answersRev 를 1 올리고 정정 안내를 넣는다', () => {
    const dir = dataDir();
    const path = writeExam(dir, releasedExam());
    markPublished(dir, [releasedExam()]);
    const fixed = SHEET.replace('2 5', '2 1');
    const files = sheets(dir, fixed, fixed);
    const before = readFileSync(path);
    const refused = answers(dir, files);
    expect(refused.code).toBe(1);
    expect(refused.err).toEqual([
      '발행한 정답과 채점이 다른 문항: 2번(정답). 정정이라 --note "<정정 안내>" 가 있어야 해요(형식 예시: 12번 정답이 정정됐어요.).',
      '아무것도 쓰지 않았어요.',
    ]);
    expect(readFileSync(path).equals(before)).toBe(true);

    const done = answers(dir, files, '테스트 전용 정정 안내예요.');
    expect(done.err).toEqual([]);
    expect(done.code).toBe(0);
    expect(done.out).toContain('  정정이에요. 발행한 정답과 채점이 다른 문항: 2번(정답). answersRev 를 2로 두고 정정 안내를 넣었어요.');
    expect(done.out).toContain('  rev 를 1에서 2로 올렸어요(발행한 판과 내용이 달라서).');
    const exam = readExam(dir);
    expect(exam.answersRev).toBe(2);
    expect(exam.answersNote).toBe('테스트 전용 정정 안내예요.');
    expect(exam.rev).toBe(2);
    expect(Object.keys(exam).slice(6, 9)).toEqual(['rev', 'answersRev', 'answersNote']);
    // 고친 원본은 exams:check 를 통과한다.
    expect(checkData(dir).errors).toEqual([]);
    // 같은 정정으로 다시 돌려도 발행한 판 + 1 에서 멈춘다.
    expect(answers(dir, files, '테스트 전용 정정 안내예요.').code).toBe(0);
    expect(readExam(dir).answersRev).toBe(2);
    // 발행한 정답으로 되돌리면 정답 판 번호와 정정 안내도 발행한 판의 값으로 돌린다.
    const back = answers(dir, sheets(dir, SHEET, SHEET));
    expect(back.code).toBe(0);
    expect(readExam(dir).answersRev).toBeUndefined();
    expect(readExam(dir).answersNote).toBeUndefined();
  });

  it('처음 공개하는 정답에는 --note 를 쓰지 않고, 정정 안내가 화면 문구 규칙에 어긋나면 쓰지 않는다', () => {
    const dir = dataDir();
    const path = writeExam(dir, testExam());
    const before = readFileSync(path);
    const first = answers(dir, sheets(dir, SHEET, SHEET), '테스트 전용 정정 안내예요.');
    expect(first.code).toBe(1);
    expect(first.err[0]).toBe('처음 공개하는 정답이라 정정 안내(--note)를 쓰지 않아요. 정정은 정답을 발행한 뒤에 해요.');
    expect(readFileSync(path).equals(before)).toBe(true);

    writeExam(dir, releasedExam());
    markPublished(dir, [releasedExam()]);
    const fixed = SHEET.replace('2 5', '2 1');
    const bad = answers(dir, sheets(dir, fixed, fixed), `테스트 전용 정정 안내예요${String.fromCodePoint(0x21)}`);
    expect(bad.code).toBe(1);
    expect(bad.err[0]).toBe('answersNote: 화면에 나오는 글자에는 느낌표를 쓰지 않아요.');
  });

  it('형식이 틀린 줄, 없는 문항, 겹친 문항, 범위 밖 답, 한 줄 안의 겹친 답, 빠진 문항을 줄 번호와 함께 거부한다', () => {
    const text = ['시험 test-tool-a', '1 3', '1 4', '2 다섯', '3 5', '7 1', '5 1000', '4 2,2', ''].join('\n');
    const { sheet, errors } = parseAnswerSheet(text, '가.txt', ITEMS);
    expect(sheet).toBeNull();
    expect(errors).toEqual([
      '가.txt 3번째 줄: 1번이 앞(2번째 줄)에도 있어요.',
      '가.txt 4번째 줄: "번호 답" 모양이 아니에요(형식 예시: 12 3, 복수 정답은 12 3,5, 모두 정답 처리는 12 *).',
      '가.txt 5번째 줄: 3번은 5지선다라 답은 1부터 4까지예요.',
      '가.txt 6번째 줄: 7번은 이 시험에 없는 문항이에요.',
      '가.txt 7번째 줄: 5번은 단답형이라 답은 0부터 999까지예요.',
      '가.txt 8번째 줄: 4번에 같은 답이 두 번 있어요.',
      // 줄 오류로 이미 알린 문항(3번, 4번, 5번)은 빠진 문항으로 다시 세지 않는다. 2번은 번호를 읽지 못한 줄이라 빠진 문항이다.
      '가.txt: 답을 적지 않은 문항이 있어요(2번, 6번). 모든 문항을 한 번씩 적어요.',
    ]);
    expect(parseAnswerSheet('12 3\n', '나.txt', ITEMS).errors[0]).toBe('나.txt 1번째 줄: 첫 줄은 "시험 <시험 id>" 모양이어야 해요.');
    expect(parseAnswerSheet('# 비어 있음\n', '나.txt', ITEMS).errors).toEqual(['나.txt: 정답 파일이 비어 있어요. 첫 줄은 "시험 <시험 id>" 예요.']);
    // 오류 문장에 답 값이 나오지 않는다(1000 은 범위 밖 값).
    expect(errors.join('\n')).not.toContain('1000');

    // 명령으로 돌리면 아무것도 쓰지 않는다.
    const dir = dataDir();
    const path = writeExam(dir, testExam());
    const before = readFileSync(path);
    const r = answers(dir, sheets(dir, SHEET, text));
    expect(r.code).toBe(1);
    expect(r.err[r.err.length - 1]).toBe('아무것도 쓰지 않았어요.');
    expect(readFileSync(path).equals(before)).toBe(true);
  });

  it('두 파일의 시험이 다르거나, 같은 파일을 두 번 주거나, 원본 시험 파일이 없으면 거부한다', () => {
    const dir = dataDir();
    writeExam(dir, testExam());
    const [a, b] = sheets(dir, SHEET, SHEET.replace('시험 test-tool-a', '시험 test-tool-b'));
    expect(answers(dir, [a, b]).err[0]).toBe('두 정답 파일의 시험이 달라요(가.txt: test-tool-a, 나.txt: test-tool-b).');
    expect(answers(dir, [a, a]).err[0]).toBe('같은 파일을 두 번 줬어요. 두 사람이 따로 적은 정답 파일 두 개가 필요해요.');
    const [c, d] = sheets(dir, SHEET.replace('test-tool-a', 'test-tool-z'), SHEET.replace('test-tool-a', 'test-tool-z'));
    expect(answers(dir, [c, d]).err[0]).toBe('src/test-tool-z.json: 파일이 없어요.');
  });

  it('diffSheets 는 복수 정답의 차례와 모두 정답 처리까지 견준다', () => {
    const a = parseAnswerSheet(SHEET, '가.txt', ITEMS).sheet;
    const b = parseAnswerSheet(SHEET.replace('3 2,4', '3 4,2').replace('4 *', '4 1'), '나.txt', ITEMS).sheet;
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    if (a && b) {
      expect(diffSheets(a, a)).toEqual([]);
      expect(diffSheets(a, b)).toEqual([3, 4]);
    }
  });
});
