import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isValidYmdHm } from '../../src/logic/dates.ts';
import { runAnswers } from './answers.ts';
import { runCheck } from './check.ts';
import { runCuts } from './cuts.ts';
import { displayPath } from './data.ts';
import { consoleIo } from './io.ts';
import type { Io } from './io.ts';
import { runKeygen } from './keygen.ts';
import { runPublish } from './publish.ts';
import { SERVE_PORT, runServe } from './serve.ts';
import { PUBLIC_KEY_FILE, isInside } from './sign.ts';
import { TESTDATA_DIR, runTestdata } from './testdata.ts';
import { parseTarget, runVerify } from './verify.ts';

// 발행 도구의 명령과 인자(작업 지시서 3의 6-4). 진입점은 scripts/exams.mjs 이고 npm run exams:<명령> 으로 부른다.
//   node scripts/exams.mjs <명령> [인자] [--data <자료 폴더>] [--out <발행 폴더>]
// --data 의 기본값은 저장소의 exam-data, --out 의 기본값은 저장소의 dist-exams 다. 인자로 준 상대 경로는 명령을 친 폴더 기준이다
// (npm run 은 저장소 폴더에서 돌리므로 npm 이 알려 주는 INIT_CWD 를 쓴다).

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 선택지. 명령마다 쓸 수 있는 것이 다르다. FLAGS 에 든 것은 값을 받지 않는다. */
type OptionName = 'data' | 'out' | 'note' | 'issued-at' | 'dry-run' | 'allow-same' | 'key' | 'dir' | 'port';
const OPTION_NAMES: readonly OptionName[] = ['data', 'out', 'note', 'issued-at', 'dry-run', 'allow-same', 'key', 'dir', 'port'];
const FLAGS: readonly OptionName[] = ['dry-run', 'allow-same'];

interface CommandSpec {
  /** 위치 인자의 수(가장 적은 수와 가장 많은 수). */
  minArgs: number;
  maxArgs: number;
  /** 쓸 수 있는 선택지. */
  options: readonly OptionName[];
  usage: string;
}

const COMMON: readonly OptionName[] = ['data', 'out'];

const COMMANDS: Record<string, CommandSpec> = {
  check: { minArgs: 0, maxArgs: 0, options: COMMON, usage: 'check' },
  answers: { minArgs: 2, maxArgs: 2, options: [...COMMON, 'note'], usage: 'answers <정답 파일 1> <정답 파일 2> [--note "<정정 안내>"]' },
  cuts: { minArgs: 1, maxArgs: 1, options: COMMON, usage: 'cuts <기관별 추정 컷 파일>' },
  publish: {
    minArgs: 0,
    maxArgs: 0,
    options: [...COMMON, 'issued-at', 'dry-run', 'allow-same'],
    usage: 'publish [--issued-at YYYY-MM-DDTHH:mm] [--dry-run] [--allow-same]',
  },
  verify: { minArgs: 0, maxArgs: 1, options: ['data', 'key'], usage: 'verify [<발행 폴더 또는 http(s) 주소>] [--key <공개 키 파일>]' },
  keygen: { minArgs: 1, maxArgs: 1, options: ['data'], usage: 'keygen <비밀 키를 쓸 경로(저장소 밖)>' },
  serve: { minArgs: 0, maxArgs: 0, options: ['dir', 'port'], usage: 'serve [--dir <발행 폴더>] [--port <번호>]' },
  testdata: { minArgs: 0, maxArgs: 0, options: ['data'], usage: 'testdata [--data <자료 폴더>]' },
};

const USAGE = [
  '사용법: node scripts/exams.mjs <명령> [인자] [--data <자료 폴더>] [--out <발행 폴더>]',
  '  check                         원본 시험 파일과 잠금 달력을 검사하고 발행한 기록과 견줘요. 파일을 쓰지 않아요.',
  '  answers <파일 1> <파일 2>     두 사람이 따로 적은 정답 파일이 같을 때만 원본 시험 파일에 정답을 넣어요.',
  '                                발행한 정답을 고칠 때는 --note "<정정 안내>" 가 있어야 해요.',
  '  cuts <입력 파일>              기관별 추정 컷으로 원본 시험 파일의 등급컷을 써요.',
  '  publish                       검사를 통과하면 seq 를 올려 발행 폴더를 새로 만들고 서명하고 state.json 을 고쳐요.',
  '                                비밀 키는 환경 변수 SA_EXAM_KEY_FILE 이 가리키는 파일(저장소 밖)에서만 읽어요.',
  '                                --issued-at YYYY-MM-DDTHH:mm(한국 시간, 없으면 지금 시각), --dry-run(쓰지 않고 결과만 보여 줘요),',
  '                                --allow-same(바뀐 것이 없어도 새 seq 로 다시 발행해요).',
  '  verify [<폴더 또는 주소>]     발행물의 서명과 SHA-256 을 공개 키로 확인해요. 기본은 발행 폴더(dist-exams)예요.',
  `                                --key 의 기본값은 <자료 폴더>/${PUBLIC_KEY_FILE} 예요.`,
  `  keygen <비밀 키 경로>         키 쌍을 만들어요. 비밀 키는 저장소 밖 경로에, 공개 키는 <자료 폴더>/${PUBLIC_KEY_FILE} 에 써요.`,
  `  serve                         발행 폴더를 이 컴퓨터(127.0.0.1)에서 내줘요(리허설용). --dir 의 기본값은 dist-exams, --port 는 ${SERVE_PORT} 예요.`,
  `  testdata                      테스트 전용 키와 발행물 네 가지를 <자료 폴더>/${TESTDATA_DIR} 에 만들어요(작업 지시서 3의 6-5). 진짜 발행에는 쓰지 않아요.`,
  '--data 의 기본값은 exam-data, --out 의 기본값은 dist-exams 예요(저장소 폴더 기준).',
];

export interface ParsedArgs {
  command: string | null;
  args: string[];
  options: Partial<Record<OptionName, string>>;
  errors: string[];
}

/** 인자를 읽는다. "--이름 값" 과 "--이름=값" 을 받고, 값을 받지 않는 선택지(--dry-run 등)는 "--이름" 만 받는다. "--" 뒤는 모두 위치 인자다. */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const out: ParsedArgs = { command: null, args: [], options: {}, errors: [] };
  let rest = false;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!rest && a === '--') {
      rest = true;
      continue;
    }
    if (!rest && a.startsWith('--')) {
      const eq = a.indexOf('=');
      const name = eq >= 0 ? a.slice(2, eq) : a.slice(2);
      const option = OPTION_NAMES.find((o) => o === name);
      if (option === undefined) {
        out.errors.push(`모르는 선택지예요: --${name}`);
        continue;
      }
      let value: string | undefined;
      if (FLAGS.includes(option)) {
        if (eq >= 0) {
          out.errors.push(`--${name} 에는 값을 적지 않아요.`);
          continue;
        }
        value = '';
      } else if (eq >= 0) {
        value = a.slice(eq + 1);
      } else {
        value = argv[i + 1];
        i += 1;
      }
      if (value === undefined) out.errors.push(`--${name} 다음에 값을 적어 주세요.`);
      else if (out.options[option] !== undefined) out.errors.push(`--${name} 를 두 번 적었어요.`);
      else out.options[option] = value;
      continue;
    }
    if (out.command === null) out.command = a;
    else out.args.push(a);
  }
  return out;
}

/** 인자 수가 틀렸을 때의 문장. */
function argsText(spec: CommandSpec): string {
  return spec.minArgs === spec.maxArgs ? `${spec.minArgs}개` : `${spec.minArgs}개나 ${spec.maxArgs}개`;
}

/** 도구를 돌리고 종료 코드를 돌려준다. 0 은 성공, 1 은 검사나 쓰기를 거부함, 2 는 인자가 틀림이다. */
export async function main(argv: readonly string[], io: Io = consoleIo): Promise<number> {
  const parsed = parseArgs(argv);
  const usage = (code: number) => {
    for (const line of USAGE) {
      if (code === 0) io.out(line);
      else io.err(line);
    }
    return code;
  };
  if (parsed.command === null) return usage(2);
  if (parsed.command === 'help' || parsed.command === '-h') return usage(0);
  const spec = Object.prototype.hasOwnProperty.call(COMMANDS, parsed.command) ? COMMANDS[parsed.command] : undefined;
  if (spec === undefined) {
    io.err(`모르는 명령이에요: ${parsed.command}`);
    return usage(2);
  }
  const errors = [...parsed.errors];
  for (const name of OPTION_NAMES) {
    if (parsed.options[name] !== undefined && !spec.options.includes(name)) errors.push(`${parsed.command} 에는 --${name} 를 쓰지 않아요.`);
  }
  if (parsed.args.length < spec.minArgs || parsed.args.length > spec.maxArgs) {
    errors.push(`인자가 ${argsText(spec)}여야 해요: node scripts/exams.mjs ${spec.usage}`);
  }
  const issuedAt = parsed.options['issued-at'] ?? null;
  if (issuedAt !== null && !isValidYmdHm(issuedAt)) errors.push('--issued-at 은 2030-01-02T17:10 같은, 실제로 있는 날짜와 시각(한국 시간)이어야 해요.');
  let port = SERVE_PORT;
  if (parsed.options.port !== undefined) {
    port = /^\d{1,5}$/.test(parsed.options.port) ? Number(parsed.options.port) : -1;
    if (port < 0 || port > 65535) errors.push('--port 는 0부터 65535 까지의 정수여야 해요.');
  }
  if (errors.length > 0) {
    for (const e of errors) io.err(e);
    return 2;
  }

  const base = process.env.INIT_CWD || process.cwd();
  const dataDir = parsed.options.data === undefined ? join(ROOT, 'exam-data') : resolve(base, parsed.options.data);
  const dataName = displayPath(dataDir, base);
  const outDir = parsed.options.out === undefined ? join(ROOT, 'dist-exams') : resolve(base, parsed.options.out);
  const outName = displayPath(outDir, base);
  const files = parsed.args.map((a) => resolve(base, a));
  const names = files.map((f) => displayPath(f, base));
  // 다음 차례 안내에 붙일 값: --data, --out 을 기본이 아닌 폴더로 줬을 때만(별도 검토 D5). 리허설에서 안내를 그대로 쳐도 같은 폴더를 보게 한다.
  const dataArg = isInside(dataDir, join(ROOT, 'exam-data')) && isInside(join(ROOT, 'exam-data'), dataDir) ? null : dataName;
  const outArg = isInside(outDir, join(ROOT, 'dist-exams')) && isInside(join(ROOT, 'dist-exams'), outDir) ? null : outName;
  switch (parsed.command) {
    case 'check':
      return runCheck({ dataDir, dataName }, io);
    case 'answers':
      return runAnswers({ dataDir, files: [files[0], files[1]], names: [names[0], names[1]], note: parsed.options.note ?? null, dataArg }, io);
    case 'cuts':
      return runCuts({ dataDir, file: files[0], name: names[0], dataArg }, io);
    case 'publish':
      return runPublish(
        {
          dataDir,
          dataName,
          outDir,
          outName,
          issuedAt,
          dryRun: parsed.options['dry-run'] !== undefined,
          allowSame: parsed.options['allow-same'] !== undefined,
          env: process.env,
          base,
          root: ROOT,
          dataArg,
          outArg,
        },
        io,
      );
    case 'verify': {
      const arg = parsed.args[0];
      const found = arg === undefined ? { target: { kind: 'folder' as const, path: outDir }, error: null } : parseTarget(arg, base);
      if (found.target === null) {
        io.err(found.error ?? '확인할 곳을 읽지 못했어요.');
        return 2;
      }
      const keyFile = parsed.options.key === undefined ? join(dataDir, PUBLIC_KEY_FILE) : resolve(base, parsed.options.key);
      const targetName = found.target.kind === 'url' ? found.target.url.href : displayPath(found.target.path, base);
      return runVerify({ target: found.target, targetName, keyFile, keyName: displayPath(keyFile, base), dataDir }, io);
    }
    case 'keygen':
      return runKeygen({ keyPath: files[0], keyName: names[0], dataDir, dataName, root: ROOT }, io);
    case 'serve': {
      const dir = parsed.options.dir === undefined ? join(ROOT, 'dist-exams') : resolve(base, parsed.options.dir);
      return runServe({ dir, dirName: displayPath(dir, base), port }, io);
    }
    case 'testdata':
      return runTestdata({ dataDir, dataName }, io);
    default:
      return usage(2);
  }
}
