import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCheck } from './check.ts';
import { displayPath } from './data.ts';
import { consoleIo } from './io.ts';
import type { Io } from './io.ts';

// 발행 도구의 명령과 인자(작업 지시서 3의 6-4). 진입점은 scripts/exams.mjs 이고 npm run exams:<명령> 으로 부른다.
//   node scripts/exams.mjs <명령> [인자] [--data <자료 폴더>] [--out <발행 폴더>]
// --data 의 기본값은 저장소의 exam-data, --out 의 기본값은 저장소의 dist-exams 다. 인자로 준 상대 경로는 명령을 친 폴더 기준이다
// (npm run 은 저장소 폴더에서 돌리므로 npm 이 알려 주는 INIT_CWD 를 쓴다).

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 값을 받는 선택지. 명령마다 쓸 수 있는 것이 다르다. */
type OptionName = 'data' | 'out' | 'note';
const OPTION_NAMES: readonly OptionName[] = ['data', 'out', 'note'];

interface CommandSpec {
  /** 위치 인자의 수. */
  args: number;
  /** 쓸 수 있는 선택지. */
  options: readonly OptionName[];
  usage: string;
}

const COMMON: readonly OptionName[] = ['data', 'out'];

const COMMANDS: Record<string, CommandSpec> = {
  check: { args: 0, options: COMMON, usage: 'check' },
};

/** 작업 지시서 3의 6-4 에 있지만 아직 만들지 않은 명령. */
const PLANNED = ['answers', 'cuts', 'publish', 'verify', 'keygen', 'serve'];

const USAGE = [
  '사용법: node scripts/exams.mjs <명령> [인자] [--data <자료 폴더>] [--out <발행 폴더>]',
  '  check                         원본 시험 파일과 잠금 달력을 검사하고 발행한 기록과 견줘요. 파일을 쓰지 않아요.',
  `  ${PLANNED.join(', ')}    아직 만들지 않았어요.`,
  '--data 의 기본값은 exam-data, --out 의 기본값은 dist-exams 예요(저장소 폴더 기준).',
];

export interface ParsedArgs {
  command: string | null;
  args: string[];
  options: Partial<Record<OptionName, string>>;
  errors: string[];
}

/** 인자를 읽는다. "--이름 값" 과 "--이름=값" 을 받는다. "--" 뒤는 모두 위치 인자다. */
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
      if (eq >= 0) {
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
  if (PLANNED.includes(parsed.command)) {
    io.err(`${parsed.command} 는 아직 만들지 않은 명령이에요(작업 지시서 3의 6-4, 다음 단계에서 더해요).`);
    return 2;
  }
  const spec = Object.prototype.hasOwnProperty.call(COMMANDS, parsed.command) ? COMMANDS[parsed.command] : undefined;
  if (spec === undefined) {
    io.err(`모르는 명령이에요: ${parsed.command}`);
    return usage(2);
  }
  const errors = [...parsed.errors];
  for (const name of OPTION_NAMES) {
    if (parsed.options[name] !== undefined && !spec.options.includes(name)) errors.push(`${parsed.command} 에는 --${name} 를 쓰지 않아요.`);
  }
  if (parsed.args.length !== spec.args) errors.push(`인자가 ${spec.args}개여야 해요: node scripts/exams.mjs ${spec.usage}`);
  if (errors.length > 0) {
    for (const e of errors) io.err(e);
    return 2;
  }

  const base = process.env.INIT_CWD || process.cwd();
  const dataDir = parsed.options.data === undefined ? join(ROOT, 'exam-data') : resolve(base, parsed.options.data);
  const dataName = displayPath(dataDir, base);
  switch (parsed.command) {
    case 'check':
      return runCheck({ dataDir, dataName }, io);
    default:
      return usage(2);
  }
}
