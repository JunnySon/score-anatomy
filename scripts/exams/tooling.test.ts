import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateLocks } from '../../src/exams/validate.ts';
import { runAnswers } from './answers.ts';
import { canonicalJson } from './canonical.ts';
import { main, parseArgs } from './cli.ts';
import { commandHint, listSourceFiles, sourceJson, withKey } from './data.ts';
import { parseState, ro, stateText } from './state.ts';
import { ROOT, SHEET, collectIo, makeDataDir, removeDir, runTool, testExam, writeExam } from './testkit.ts';

// 발행 도구의 바탕(작업 지시서 3의 6-1, 6-4): 자료 폴더의 처음 모양, 키를 정렬한 JSON, 원본 시험 파일의 모양, 명령과 인자,
// 그리고 Node 가 타입 지우기로 바로 읽을 수 있는 TypeScript 인지(상대 경로는 '.ts' 까지, 타입만 가져올 때는 import type 문).

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) removeDir(dir);
});

const rel = (p: string) => relative(ROOT, p).split('\\').join('/');

/** 줄 머리가 주석인 줄을 뺀 글자(주석에 적은 설명이 검사에 걸리지 않게). */
function codeLines(text: string): string {
  return text
    .split('\n')
    .filter((line) => !/^\s*(?:\/\/|\/\*|\*)/.test(line))
    .join('\n');
}

interface ImportDecl {
  /** import type 문인지. */
  typeOnly: boolean;
  /** 중괄호 안의 이름들. 없으면 null(기본 가져오기, 이름공간, 부수 효과). */
  names: string[] | null;
  /** 중괄호 안에 "type X" 처럼 적은 것이 있는지. */
  inlineType: boolean;
  specifier: string;
}

/** 소스의 정적 import 와 export from, 동적 import 를 찾는다. */
function importsOf(source: string): ImportDecl[] {
  const code = codeLines(source);
  const out: ImportDecl[] = [];
  for (const m of code.matchAll(/^\s*(?:import|export)\s+(type\s+)?([^;]*?)\s*from\s*'([^']+)'/gm)) {
    const clause = m[2];
    const braces = /\{([^}]*)\}/.exec(clause);
    const parts = braces ? braces[1].split(',').map((s) => s.trim()).filter(Boolean) : null;
    out.push({
      typeOnly: Boolean(m[1]),
      names: parts ? parts.map((p) => p.replace(/^type\s+/, '').split(/\s+as\s+/)[0]) : null,
      inlineType: parts ? parts.some((p) => /^type\s/.test(p)) : false,
      specifier: m[3],
    });
  }
  for (const m of code.matchAll(/^\s*import\s+'([^']+)'/gm)) out.push({ typeOnly: false, names: null, inlineType: false, specifier: m[1] });
  for (const m of code.matchAll(/\bimport\(\s*'([^']+)'\s*\)/g)) out.push({ typeOnly: false, names: null, inlineType: false, specifier: m[1] });
  return out;
}

/** 타입을 지운 소스에서 실행할 때 있는 이름(내보낸 함수, 값, 클래스)을 찾는다. 인터페이스와 타입은 지워져서 없다. */
function runtimeExports(file: string): Set<string> {
  const js = stripTypeScriptTypes(readFileSync(file, 'utf8'));
  const names = new Set<string>();
  for (const m of js.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  for (const m of js.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop();
      if (name) names.add(name);
    }
  }
  return names;
}

/** 발행 도구가 Node 로 읽는 TypeScript 파일: scripts/exams 의 테스트가 아닌 파일과, 거기서 값으로 가져오는 파일을 따라간 것. */
function toolFiles(): string[] {
  const start = readdirSync(join(ROOT, 'scripts/exams'))
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => join(ROOT, 'scripts/exams', f));
  const seen = new Set<string>();
  const queue = [...start];
  while (queue.length > 0) {
    const file = queue.shift() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const d of importsOf(readFileSync(file, 'utf8'))) {
      if (!d.typeOnly && d.specifier.startsWith('.')) queue.push(resolve(dirname(file), d.specifier));
    }
  }
  return [...seen].sort();
}

describe('발행 도구 폴더와 바탕(작업 지시서 3의 6-1, 6-4)', () => {
  it('자료 폴더 exam-data 의 처음 모양: src(자리 파일), locks.json(검사 통과), state.json(처음 값의 정렬한 JSON), 발행 결과물은 커밋하지 않음', () => {
    const data = join(ROOT, 'exam-data');
    expect(existsSync(join(data, 'src/README.md'))).toBe(true);
    expect(listSourceFiles(data)).not.toBeNull();
    expect(validateLocks(JSON.parse(readFileSync(join(data, 'locks.json'), 'utf8')))).toEqual([]);
    const text = readFileSync(join(data, 'state.json'), 'utf8');
    const parsed = parseState(JSON.parse(text));
    expect(parsed.errors).toEqual([]);
    expect(parsed.state).not.toBeNull();
    if (parsed.state) expect(stateText(parsed.state)).toBe(text);
    const lines = (path: string) => readFileSync(join(ROOT, path), 'utf8').split(/\r?\n/);
    expect(lines('.gitignore')).toContain('dist-exams/');
    // 발행 폴더를 바꿔 넣을 때 옆에 잠깐 만드는 폴더(dist-exams.new-..., dist-exams.old-...)도 커밋하지 않는다.
    expect(lines('.gitignore')).toContain('dist-exams.*/');
    expect(lines('.gitattributes')).toContain('exam-data/testdata/** -text');
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    for (const cmd of ['check', 'answers', 'cuts', 'publish', 'verify', 'keygen', 'serve', 'testdata']) expect(pkg.scripts[`exams:${cmd}`]).toBe(`node scripts/exams.mjs ${cmd}`);
  });

  it('키를 정렬한 JSON 은 2칸 들여쓰기, LF, 끝 줄바꿈이고 키 차례가 달라도 같은 바이트다', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { z: true, y: null }], c: 'x' }, e: [], f: {}, g: undefined })).toBe(
      '{\n  "a": {\n    "c": "x",\n    "d": [\n      1,\n      {\n        "y": null,\n        "z": true\n      }\n    ]\n  },\n  "b": 1,\n  "e": [],\n  "f": {}\n}\n',
    );
    expect(canonicalJson({ x: 1, y: [2, 3] })).toBe(canonicalJson({ y: [2, 3], x: 1 }));
    // 숫자 모양의 키도 글자로 정렬한다("10" 이 "9" 앞).
    expect(canonicalJson({ 9: 'a', 10: 'b' })).toBe('{\n  "10": "b",\n  "9": "a"\n}\n');
    expect(() => canonicalJson({ a: Number.NaN })).toThrow();
    // 예시 시험 A로 견주면 키를 정렬해 2칸으로 적은 JSON.stringify 와 같다.
    const sample = JSON.parse(readFileSync(join(ROOT, 'src/exams/sample-a.json'), 'utf8')) as unknown;
    const sortDeep = (v: unknown): unknown =>
      Array.isArray(v)
        ? v.map(sortDeep)
        : typeof v === 'object' && v !== null
          ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortDeep((v as Record<string, unknown>)[k])]))
          : v;
    expect(canonicalJson(sample)).toBe(`${JSON.stringify(sortDeep(sample), null, 2)}\n`);
  });

  it('원본 시험 파일의 모양은 예시 시험 파일을 바이트 그대로 다시 쓰고, 새 칸은 정한 자리에 넣는다', () => {
    for (const name of ['sample-a', 'sample-b', 'sample-c']) {
      const text = readFileSync(join(ROOT, `src/exams/${name}.json`), 'utf8');
      expect(sourceJson(JSON.parse(text)), name).toBe(text);
    }
    const item = { no: 1, kind: 'mc', choices: 5, points: 2, typeId: 't01' };
    expect(Object.keys(withKey(item, 'answer', 3, ['no', 'kind', 'choices', 'points']))).toEqual(['no', 'kind', 'choices', 'points', 'answer', 'typeId']);
    expect(Object.keys(withKey({ ...item, answer: 3 }, 'answer', undefined, []))).toEqual(['no', 'kind', 'choices', 'points', 'typeId']);
    expect(withKey({ ...item, answer: 3 }, 'answer', 4, [])).toEqual({ ...item, answer: 4 });
    expect(Object.keys(withKey(item, 'x', 1, ['nothing']))).toEqual(['no', 'kind', 'choices', 'points', 'typeId', 'x']);
    expect(ro(1)).toBe('1로');
    expect(ro(3)).toBe('3으로');
    expect(ro(10)).toBe('10으로');
  });

  it('도구가 닿는 TypeScript 파일은 상대 경로를 .ts 까지 적고, 타입만 가져올 때는 import type 문을 쓰고, Node 의 타입 지우기로 읽힌다', () => {
    const files = toolFiles();
    const names = files.map(rel);
    // 앱의 검사 규칙을 두 벌로 만들지 않고 그대로 가져온다.
    expect(names).toContain('src/exams/validate.ts');
    expect(names).toContain('src/logic/dates.ts');
    expect(names).toContain('scripts/exams/cli.ts');
    const problems: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const at = rel(file);
      try {
        // enum, namespace, 생성자 매개변수 속성, <T>값 모양의 형 변환이 있으면 던진다.
        stripTypeScriptTypes(source);
      } catch (e) {
        problems.push(`${at}: 타입 지우기로 읽지 못해요(${(e as { code?: string }).code ?? '오류'}).`);
      }
      const code = codeLines(source);
      if (/__SA_TOOLS__/.test(code)) problems.push(`${at}: __SA_TOOLS__ 를 써요.`);
      if (/import\.meta\.env/.test(code)) problems.push(`${at}: import.meta.env 를 써요.`);
      for (const d of importsOf(source)) {
        if (d.specifier.startsWith('#')) problems.push(`${at}: 별칭 '${d.specifier}' 를 가져와요.`);
        if (d.specifier.endsWith('.json')) problems.push(`${at}: JSON 을 import 해요(${d.specifier}).`);
        if (!d.specifier.startsWith('.')) continue;
        if (!d.specifier.endsWith('.ts')) problems.push(`${at}: 상대 경로가 .ts 로 끝나지 않아요(${d.specifier}).`);
        if (d.inlineType) problems.push(`${at}: 중괄호 안에 type 을 적었어요. 타입은 import type 문으로 가져와요(${d.specifier}).`);
        if (d.typeOnly || d.names === null) continue;
        const target = resolve(dirname(file), d.specifier);
        if (!existsSync(target)) {
          problems.push(`${at}: 가져오는 파일이 없어요(${d.specifier}).`);
          continue;
        }
        const exported = runtimeExports(target);
        for (const name of d.names) if (!exported.has(name)) problems.push(`${at}: ${name} 은 ${d.specifier} 에서 실행할 때 있는 값이 아니에요(타입이면 import type 으로).`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('Node 가 타입 지우기를 하지 못하면 Node 22.18 이상이 필요하다고 알리고 끝낸다', () => {
    const run = runTool(['check'], ['--no-experimental-strip-types']);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('Node 22.18 이상이 필요해요.');
    expect(run.stdout).toBe('');
  });

  it('명령과 인자: 사용법, 모르는 명령과 선택지, 인자 수', async () => {
    const run = async (argv: string[]) => {
      const c = collectIo();
      const code = await main(argv, c.io);
      return { code, out: c.out, err: c.err };
    };
    const none = await run([]);
    expect(none.code).toBe(2);
    expect(none.err[0]).toBe('사용법: node scripts/exams.mjs <명령> [인자] [--data <자료 폴더>] [--out <발행 폴더>]');
    const help = await run(['help']);
    expect(help.code).toBe(0);
    // 사용법에 모든 명령이 있고, 아직 만들지 않은 명령은 없다(작업 지시서 3의 6-5 의 testdata 까지 만들었다).
    for (const cmd of ['check', 'answers', 'cuts', 'publish', 'verify', 'keygen', 'serve', 'testdata']) {
      expect(help.out.some((line) => line.startsWith(`  ${cmd} `)), cmd).toBe(true);
    }
    expect(help.out.join('\n')).not.toContain('아직 만들지 않았어요');
    // testdata 는 위치 인자를 받지 않고 --data 만 받는다.
    expect((await run(['testdata', 'x'])).err).toEqual(['인자가 0개여야 해요: node scripts/exams.mjs testdata [--data <자료 폴더>]']);
    expect((await run(['testdata', '--out', 'x'])).err).toEqual(['testdata 에는 --out 를 쓰지 않아요.']);
    expect((await run(['nope'])).err[0]).toBe('모르는 명령이에요: nope');
    expect((await run(['check', '--note', '테스트 전용 정정 안내예요.'])).err).toEqual(['check 에는 --note 를 쓰지 않아요.']);
    expect((await run(['check', '--bogus'])).err).toEqual(['모르는 선택지예요: --bogus']);
    expect((await run(['answers', 'a.txt'])).err).toEqual(['인자가 2개여야 해요: node scripts/exams.mjs answers <정답 파일 1> <정답 파일 2> [--note "<정정 안내>"]']);
    expect((await run(['check', '--data'])).err).toEqual(['--data 다음에 값을 적어 주세요.']);
    expect(parseArgs(['answers', '--data=d', 'a', '--', '--b'])).toEqual({ command: 'answers', args: ['a', '--b'], options: { data: 'd' }, errors: [] });
    // publish, verify, keygen, serve 의 선택지와 인자(작업 지시서 3의 6-4). 값을 받지 않는 선택지(--dry-run, --allow-same)는 다음 인자를 먹지 않는다.
    expect(parseArgs(['publish', '--dry-run', '--allow-same', '--issued-at', '2030-01-02T17:10'])).toEqual({
      command: 'publish',
      args: [],
      options: { 'dry-run': '', 'allow-same': '', 'issued-at': '2030-01-02T17:10' },
      errors: [],
    });
    expect((await run(['publish', '--dry-run=1'])).err).toEqual(['--dry-run 에는 값을 적지 않아요.']);
    expect((await run(['publish', '--issued-at', '2030-01-02T24:00'])).err).toEqual([
      '--issued-at 은 2030-01-02T17:10 같은, 실제로 있는 날짜와 시각(한국 시간)이어야 해요.',
    ]);
    expect((await run(['publish', 'x'])).err).toEqual(['인자가 0개여야 해요: node scripts/exams.mjs publish [--issued-at YYYY-MM-DDTHH:mm] [--dry-run] [--allow-same]']);
    expect((await run(['publish', '--note', 'x'])).err).toEqual(['publish 에는 --note 를 쓰지 않아요.']);
    expect((await run(['verify', 'a', 'b'])).err).toEqual([
      '인자가 0개나 1개여야 해요: node scripts/exams.mjs verify [<발행 폴더 또는 http(s) 주소>] [--key <공개 키 파일>]',
    ]);
    expect((await run(['verify', '--out', 'x'])).err).toEqual(['verify 에는 --out 를 쓰지 않아요.']);
    const ftp = await run(['verify', 'ftp://exams.invalid/']);
    expect(ftp.code).toBe(2);
    expect(ftp.err).toEqual(['주소는 http:// 나 https:// 로 시작해야 해요.']);
    expect((await run(['keygen'])).err).toEqual(['인자가 1개여야 해요: node scripts/exams.mjs keygen <비밀 키를 쓸 경로(저장소 밖)>']);
    expect((await run(['keygen', 'k.pem', '--out', 'x'])).err).toEqual(['keygen 에는 --out 를 쓰지 않아요.']);
    for (const port of ['abc', '65536', '-1', '1.5']) {
      const r = await run(['serve', '--port', port]);
      expect(r.code, port).toBe(2);
      expect(r.err, port).toContain('--port 는 0부터 65535 까지의 정수여야 해요.');
    }
    expect((await run(['serve', '--data', 'x'])).err).toEqual(['serve 에는 --data 를 쓰지 않아요.']);
    const dir = makeDataDir();
    dirs.push(dir);
    const ok = await run(['check', '--data', dir]);
    expect(ok.code).toBe(0);
    expect(ok.out[ok.out.length - 1]).toBe('결과: 검사를 통과했어요. 이 검사는 파일을 쓰지 않아요.');
  });

  it('다음 차례 안내는 기본이 아닌 자료 폴더와 발행 폴더를 붙여 적고, 기본 폴더면 지금처럼 적는다(리허설에서 그대로 쳐도 같은 폴더를 봄, 별도 검토 D5)', () => {
    expect(commandHint('check', [], [['--data', null]])).toBe('npm run exams:check');
    expect(commandHint('check', [], [['--data', 'data']])).toBe('npm run exams:check -- --data data');
    expect(commandHint('verify', ['out dir'], [['--data', 'C:\\data']])).toBe('npm run exams:verify -- "out dir" --data "C:\\data"');
    // 실제 Node: 임시 자료 폴더(--data)로 정답을 넣으면 다음 차례의 check 에 그 폴더를 붙인다.
    const dir = makeDataDir();
    dirs.push(dir);
    writeExam(dir, testExam());
    writeFileSync(join(dir, 'a.txt'), SHEET);
    writeFileSync(join(dir, 'b.txt'), SHEET);
    const run = runTool(['answers', join(dir, 'a.txt'), join(dir, 'b.txt'), '--data', dir]);
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    const q = (v: string) => (/^[A-Za-z0-9_./:-]+$/.test(v) ? v : `"${v}"`);
    expect(run.stdout).toContain(`다음 차례: npm run exams:check -- --data ${q(dir)} 로 검사해요.`);
    // 기본 자료 폴더(--data 를 주지 않음)면 지금처럼 붙이지 않는다. 함수로 불러 확인한다(저장소의 exam-data 를 쓰지 않게).
    const fresh = makeDataDir();
    dirs.push(fresh);
    writeExam(fresh, testExam());
    const c = collectIo();
    expect(runAnswers({ dataDir: fresh, files: [join(dir, 'a.txt'), join(dir, 'b.txt')], names: ['a.txt', 'b.txt'], note: null }, c.io)).toBe(0);
    expect(c.out).toContain('다음 차례: npm run exams:check 로 검사해요.');
  });

  it('다음 차례 안내의 경로에 큰따옴표 안에서도 셸이 바꾸는 글자가 들었으면 그대로 치지 말라는 말을 덧붙인다(2차 검토 T6)', () => {
    // 달러, 백틱, 퍼센트, 큰따옴표, 잇단 역슬래시 둘(공유 폴더 경로)은 파워셸, cmd, Git Bash 가 큰따옴표 안에서도 서로 다르게 바꾼다.
    const caution = '(경로에 셸이 바꿀 수 있는 글자가 있어요. 그대로 치지 말고 경로를 셸에 맞게 직접 넣어요)';
    for (const risky of ['C:\\Temp\\a$HOME\\data', 'C:\\Temp\\a`b', 'C:\\Temp\\%PATHEXT%', '\\\\srv\\share\\data', 'C:\\Temp\\a"b']) {
      expect(commandHint('check', [], [['--data', risky]]), risky).toBe(`npm run exams:check -- --data "${risky}"${caution}`);
    }
    for (const plain of ['C:\\Temp\\a b', 'C:\\Users\\학생\\data', 'data']) {
      expect(commandHint('check', [], [['--data', plain]]), plain).not.toContain(caution);
    }
  });

  it('npm run exams:check 와 같은 길(node scripts/exams.mjs)로 빈 자료 폴더를 검사하면 통과한다', () => {
    const dir = makeDataDir();
    dirs.push(dir);
    const run = runTool(['check', '--data', dir]);
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    expect(run.stdout.split(/\r?\n/)).toEqual([
      `시험 자료를 검사해요: ${dir}`,
      '아직 발행한 적이 없어요(seq 0).',
      'src 폴더에 시험 파일(*.json)이 없어요.',
      '잠금 달력(locks.json): 항목 0개, 아직 발행한 적이 없어요.',
      '알림 0개',
      '거부 0개',
      '결과: 검사를 통과했어요. 이 검사는 파일을 쓰지 않아요.',
      '',
    ]);
  });
});
