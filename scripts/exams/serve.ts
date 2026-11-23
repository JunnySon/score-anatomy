import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join } from 'node:path';
import { commandHint } from './data.ts';
import type { Io } from './io.ts';
import { INDEX_FILE } from './release.ts';
import { isInside } from './sign.ts';

// exams:serve(작업 지시서 3의 6-4): 발행 폴더(기본 dist-exams)를 이 컴퓨터에서 내주는 서버. 리허설과 작업 지시서 4의 시뮬레이터 시험에 쓴다.
// node:http 만 쓰고, 127.0.0.1 에서만 연다(기본 포트 4180, 화면 테스트의 4173, 4174 와 vite 의 5173 을 피함).
// GET 과 HEAD 만 받고, 모든 응답에 Cache-Control: no-store 를 붙이고, 폴더 밖 경로(.. , 인코딩한 .., 역슬래시, 폴더 밖을 가리키는 링크)와
// 숨은 파일(점으로 시작하는 이름)은 404 로 거부한다. 폴더 목록은 보여 주지 않는다.
// 요청마다 방법, 경로, 상태만 적는다(접속한 곳과 머리글은 적지 않는다).

export const SERVE_HOST = '127.0.0.1';
export const SERVE_PORT = 4180;

const CONTENT_TYPES: Record<string, string> = {
  '.json': 'application/json; charset=utf-8',
  '.sig': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

/** 요청 경로(쿼리 뺀 것)를 내줄 파일의 실제 경로로 바꾼다. 내주지 않으면 path 가 null 이고 status 가 응답 상태다. */
export function requestFile(rootReal: string, rawPath: string): { path: string | null; status: number } {
  if (!rawPath.startsWith('/')) return { path: null, status: 400 };
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return { path: null, status: 400 };
  }
  const segments = decoded.slice(1).split('/');
  // 빈 조각('/', '//'), 점으로 시작하는 조각('.', '..', 숨은 파일), 역슬래시, 콜론(드라이브, 대체 스트림), NUL 은 받지 않는다.
  if (segments.some((s) => s === '' || s.startsWith('.') || /[\\:\0]/.test(s))) return { path: null, status: 404 };
  let real: string;
  try {
    real = realpathSync.native(join(rootReal, ...segments));
    if (!isInside(real, rootReal) || real === rootReal || !statSync(real).isFile()) return { path: null, status: 404 };
  } catch {
    return { path: null, status: 404 };
  }
  return { path: real, status: 200 };
}

function handle(rootReal: string, req: IncomingMessage, res: ServerResponse, log: ((line: string) => void) | undefined): void {
  const method = req.method ?? '';
  const rawPath = (req.url ?? '').split(/[?#]/)[0] ?? '';
  const finish = (status: number, body: Buffer, type: string) => {
    const headers: Record<string, string> = {
      'Content-Type': type,
      'Content-Length': String(body.length),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    };
    if (status === 405) headers.Allow = 'GET, HEAD';
    res.writeHead(status, headers);
    res.end(method === 'HEAD' ? undefined : body);
    log?.(`${method} ${rawPath} ${status}`);
  };
  const text = (status: number, message: string) => finish(status, Buffer.from(`${message}\n`, 'utf8'), 'text/plain; charset=utf-8');
  if (method !== 'GET' && method !== 'HEAD') return text(405, 'GET 과 HEAD 만 받아요.');
  const found = requestFile(rootReal, rawPath);
  if (found.path === null) return text(found.status, found.status === 400 ? '요청 경로를 읽지 못했어요.' : '없어요.');
  let body: Buffer;
  try {
    body = readFileSync(found.path);
  } catch {
    return text(404, '없어요.');
  }
  finish(200, body, CONTENT_TYPES[extname(found.path).toLowerCase()] ?? 'application/octet-stream');
}

export interface ServeHandle {
  /** 서버 주소(끝이 /). */
  url: string;
  port: number;
  close(): Promise<void>;
}

/** 서버를 띄운다. port 가 0 이면 빈 포트를 쓴다(테스트). log 는 요청마다 한 줄(방법, 경로, 상태)을 받는다. */
export function startServer(opts: { dir: string; port: number; log?: (line: string) => void }): Promise<ServeHandle> {
  const rootReal = realpathSync.native(opts.dir);
  const server = createServer((req, res) => handle(rootReal, req, res, opts.log));
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(opts.port, SERVE_HOST, () => {
      server.off('error', reject);
      const port = (server.address() as AddressInfo).port;
      resolvePromise({
        url: `http://${SERVE_HOST}:${port}/`,
        port,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}

export interface ServeOptions {
  dir: string;
  dirName: string;
  port: number;
  /**
   * 확인 안내에 붙일 것(별도 검토 2차 T5). default: 기본 발행 폴더(dist-exams)라 붙이지 않음.
   * testdata: 테스트 전용 발행물이라 테스트 전용 공개 키(keyArg)를 붙임. other: 기본이 아닌 발행 폴더라 발행할 때 쓴 자료 폴더를 붙이라고 적음.
   */
  verifyWith?: { kind: 'default' } | { kind: 'testdata'; keyArg: string } | { kind: 'other' };
}

/** exams:serve 를 돌린다. Ctrl+C(SIGINT)나 SIGTERM 을 받으면 서버를 끄고 0을 돌려준다. 띄우지 못하면 1이다. */
export async function runServe(opts: ServeOptions, io: Io): Promise<number> {
  if (!existsSync(opts.dir) || !statSync(opts.dir).isDirectory()) {
    io.err(`발행 폴더가 없어요(${opts.dirName}). 먼저 npm run exams:publish 로 발행해요.`);
    return 1;
  }
  if (!existsSync(join(opts.dir, INDEX_FILE))) {
    io.err(`발행 폴더에 ${INDEX_FILE} 가 없어요(${opts.dirName}). 먼저 npm run exams:publish 로 발행해요.`);
    return 1;
  }
  let server: ServeHandle;
  try {
    server = await startServer({ dir: opts.dir, port: opts.port, log: (line) => io.out(line) });
  } catch (e) {
    const code = (e as { code?: unknown }).code;
    io.err(
      code === 'EADDRINUSE'
        ? `포트 ${opts.port} 를 이미 다른 프로그램이 쓰고 있어요. --port 로 다른 번호를 줘요.`
        : `서버를 띄우지 못했어요${typeof code === 'string' ? `(${code})` : ''}.`,
    );
    return 1;
  }
  io.out(`발행 폴더 ${opts.dirName} 를 내줘요: ${server.url}`);
  io.out('리허설과 작업 지시서 4의 시뮬레이터 시험용 서버예요. 이 컴퓨터(127.0.0.1)에서만 열리고, GET 과 HEAD 만 받고, 캐시를 쓰지 않게(Cache-Control: no-store) 내줘요.');
  io.out('요청마다 방법, 경로, 상태만 적어요(접속한 곳은 적지 않아요).');
  // 확인 안내는 그대로 쳤을 때 같은 자료 폴더와 공개 키를 보게 적는다. 리허설의 임시 발행 폴더는 자료 폴더를 알 수 없어서
  // 붙이라고 적는다(그대로 치면 저장소의 진짜 자료 폴더로 확인하게 된다, 별도 검토 2차 T5).
  const verifyWith = opts.verifyWith ?? { kind: 'default' };
  if (verifyWith.kind === 'testdata') io.out(`확인: ${commandHint('verify', [server.url], [['--key', verifyWith.keyArg]])}`);
  else if (verifyWith.kind === 'other') {
    io.out(`확인: npm run exams:verify -- ${server.url} --data <발행할 때 쓴 자료 폴더>`);
    io.out('  기본이 아닌 발행 폴더라서 발행할 때 쓴 자료 폴더를 --data 로 붙여요. 테스트 전용 발행물이면 --data 대신 --key <테스트 전용 공개 키 파일> 을 붙여요.');
  } else io.out(`확인: npm run exams:verify -- ${server.url}`);
  io.out('끄기: Ctrl+C');
  return new Promise<number>((resolvePromise) => {
    const stop = () => {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
      void server.close().then(() => {
        io.out('서버를 껐어요.');
        resolvePromise(0);
      });
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  });
}
