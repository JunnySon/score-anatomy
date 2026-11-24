import { createPublicKey } from 'node:crypto';
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import type { IncomingHttpHeaders, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { startServer } from './serve.ts';
import { TOO_BIG_WHILE_FETCHING, fetchBytes, parseTarget, verifyUrl } from './verify.ts';
import { makeDataDir, makeOutDir, makeTempKey, publishTo, releasedExam, removeDir, runToolAsync, startTool, verifyWith, writeExam } from './testkit.ts';
import type { TempKey } from './testkit.ts';

// exams:serve(작업 지시서 3의 6-4)와 주소로 하는 exams:verify. 서버는 모두 이 컴퓨터의 127.0.0.1 에 빈 포트(0)로 띄운다
// (verify 의 화면 테스트 서버나 기본 포트 4180 과 부딪히지 않게). 바깥 사이트에는 접속하지 않는다.

const dirs: string[] = [];
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
  for (const dir of dirs.splice(0)) removeDir(dir);
});
function tempKey(): TempKey {
  const k = makeTempKey();
  dirs.push(k.dir);
  return k;
}

/** 테스트 전용 시험 하나를 임시 키로 발행한 자료 폴더와 발행 폴더. */
function published(key: TempKey): { dir: string; parent: string; out: string } {
  const dir = makeDataDir();
  dirs.push(dir);
  const o = makeOutDir();
  dirs.push(o.parent);
  writeExam(dir, releasedExam());
  if (publishTo(dir, o.out, key.keyFile).code !== 0) throw new Error('테스트 발행이 실패했어요.');
  return { dir, ...o };
}

async function serve(dir: string, log?: (line: string) => void) {
  const server = await startServer({ dir, port: 0, log });
  closers.push(() => server.close());
  return server;
}

/** 이 테스트가 직접 띄우는 서버(머리글을 모으거나, 응답하지 않거나, 다른 주소로 넘김). */
async function listen(handler: Parameters<typeof createServer>[1]): Promise<{ server: Server; url: string }> {
  const server = createServer(handler);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', () => done()));
  closers.push(
    () =>
      new Promise<void>((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  );
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/` };
}

/** 경로를 고치지 않고 그대로 보내는 요청(fetch 는 '..' 를 미리 풀어 버려서 쓰지 않는다). */
function rawRequest(port: number, method: string, path: string): Promise<{ status: number; headers: IncomingHttpHeaders; body: string }> {
  return new Promise((resolveRequest, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d: string) => {
        body += d;
      });
      res.on('end', () => resolveRequest({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('발행 도구 exams:serve(작업 지시서 3의 6-4)', () => {
  it('빈 포트(0)로 띄운 서버의 주소로 verify 가 통과한다', async () => {
    const key = tempKey();
    const { dir, out } = published(key);
    const log: string[] = [];
    const server = await serve(out, (line) => log.push(line));
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    const r = await verifyWith({ kind: 'url', url: new URL(server.url) }, key.publicFile, dir);
    expect(r.err).toEqual([]);
    expect(r.code).toBe(0);
    expect(r.out).toContain('서명이 맞아요(index.json.sig).');
    expect(r.out).toContain('결과: 발행물이 맞아요. 서명, 시험 파일의 SHA-256 과 검사, 잠금 달력이 모두 맞아요.');
    // 서버는 요청마다 방법, 경로, 상태만 적는다.
    expect(log).toEqual(['GET /index.json 200', 'GET /index.json.sig 200', 'GET /files/test-tool-a.1.json 200']);
    // 끝이 index.json 인 주소를 줘도 같은 곳(발행물이 있는 폴더)을 확인한다.
    const target = parseTarget(`${server.url}index.json`, dir).target;
    expect(target?.kind === 'url' ? target.url.href : null).toBe(server.url);
    if (target?.kind === 'url') expect((await verifyUrl(target.url, createPublicKey(key.key))).ok).toBe(true);
    // 다른 키의 공개 키로는 실패한다.
    const other = tempKey();
    expect((await verifyWith({ kind: 'url', url: new URL(server.url) }, other.publicFile, dir)).code).toBe(1);
  }, 60000);

  it('GET 과 HEAD 만 받고, 폴더 밖 경로와 숨은 파일을 거부하고, Cache-Control: no-store 와 content-type 을 붙인다', async () => {
    const key = tempKey();
    const { parent, out } = published(key);
    const secret = 'TEST-ONLY-OUTSIDE-MARKER';
    writeFileSync(join(parent, 'outside-secret.txt'), `${secret}\n`);
    writeFileSync(join(out, '.hidden.txt'), `${secret}\n`);
    const outside = join(parent, 'outside');
    mkdirSync(outside);
    writeFileSync(join(outside, 'secret.txt'), `${secret}\n`);
    // 폴더 안의 연결 지점(junction)이 폴더 밖을 가리킨다.
    symlinkSync(outside, join(out, 'link'), 'junction');
    const server = await serve(out);

    const index = await rawRequest(server.port, 'GET', '/index.json');
    expect(index.status).toBe(200);
    expect(index.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(index.headers['cache-control']).toBe('no-store');
    expect(index.headers['x-content-type-options']).toBe('nosniff');
    expect(index.body).toBe(readFileSync(join(out, 'index.json'), 'utf8'));
    const sig = await rawRequest(server.port, 'GET', '/index.json.sig');
    expect(sig.status).toBe(200);
    expect(sig.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(sig.headers['cache-control']).toBe('no-store');
    expect(sig.body).toBe(readFileSync(join(out, 'index.json.sig'), 'utf8'));
    const exam = await rawRequest(server.port, 'GET', '/files/test-tool-a.1.json');
    expect(exam.status).toBe(200);
    expect(exam.headers['content-type']).toBe('application/json; charset=utf-8');
    // 쿼리는 보지 않는다.
    expect((await rawRequest(server.port, 'GET', '/index.json?x=1')).status).toBe(200);
    // HEAD 는 머리글만
    const head = await rawRequest(server.port, 'HEAD', '/index.json');
    expect(head.status).toBe(200);
    expect(head.body).toBe('');
    expect(head.headers['content-length']).toBe(String(readFileSync(join(out, 'index.json')).length));
    expect(head.headers['cache-control']).toBe('no-store');

    // GET 과 HEAD 가 아니면 405
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
      const r = await rawRequest(server.port, method, '/index.json');
      expect(r.status, method).toBe(405);
      expect(r.headers.allow, method).toBe('GET, HEAD');
      expect(r.headers['cache-control'], method).toBe('no-store');
    }
    // 폴더 밖, 숨은 파일, 폴더, 인코딩을 이용한 경로는 모두 거부하고 폴더 밖 파일의 내용을 내주지 않는다.
    const refused = [
      '/../outside-secret.txt',
      '/files/../../outside-secret.txt',
      '/%2e%2e/outside-secret.txt',
      '/files/%2e%2e%2f%2e%2e%2foutside-secret.txt',
      '/..%5coutside-secret.txt',
      '/..\\outside-secret.txt',
      '/.hidden.txt',
      '/%2ehidden.txt',
      '/link/secret.txt',
      '/files/',
      '/',
      '//outside-secret.txt',
      '/index.json%00',
      '/%E0%A4%A',
      'http://127.0.0.1/index.json',
      `/${join(parent, 'outside-secret.txt').split('\\').join('/')}`,
    ];
    for (const path of refused) {
      const r = await rawRequest(server.port, 'GET', path);
      expect(r.status >= 400 && r.status < 500, path).toBe(true);
      expect(r.body.includes(secret), path).toBe(false);
      expect(r.headers['cache-control'], path).toBe('no-store');
    }
  }, 60000);

  it('실제 Node 로 띄운 exams:serve 의 주소로 exams:verify 가 통과한다(리허설 안내를 출력)', async () => {
    const key = tempKey();
    const { dir, out } = published(key);
    const server = startTool(['serve', '--dir', out, '--port', '0']);
    closers.push(async () => {
      server.child.kill();
      await server.done;
    });
    const m = await server.waitFor(/http:\/\/127\.0\.0\.1:\d+\//);
    const url = m[0];
    const verified = await runToolAsync(['verify', url, '--data', dir, '--key', key.publicFile]);
    expect(verified.stderr).toBe('');
    expect(verified.status).toBe(0);
    expect(verified.stdout).toContain(`발행물을 확인해요: ${url}`);
    expect(verified.stdout).toContain('결과: 발행물이 맞아요. 서명, 시험 파일의 SHA-256 과 검사, 잠금 달력이 모두 맞아요.');
    // 끝이 index.json 인 주소도 받는다.
    expect((await runToolAsync(['verify', `${url}index.json`, '--data', dir, '--key', key.publicFile])).status).toBe(0);
    await server.waitFor(/GET \/files\/test-tool-a\.1\.json 200[\s\S]*GET \/files\/test-tool-a\.1\.json 200/);
    const lines = server.output().stdout.split(/\r?\n/);
    expect(lines[0]).toBe(`발행 폴더 ${out} 를 내줘요: ${url}`);
    expect(lines).toContain(
      '리허설과 작업 지시서 4의 시뮬레이터 시험용 서버예요. 이 컴퓨터(127.0.0.1)에서만 열리고, GET 과 HEAD 만 받고, 캐시를 쓰지 않게(Cache-Control: no-store) 내줘요.',
    );
    expect(lines).toContain('요청마다 방법, 경로, 상태만 적어요(접속한 곳은 적지 않아요).');
    // 기본이 아닌 발행 폴더(리허설의 임시 폴더)라서 발행할 때 쓴 자료 폴더를 붙이라고 적는다(그대로 치면 저장소의 진짜 자료 폴더를 본다, 2차 검토 T5).
    expect(lines).toContain(`확인: npm run exams:verify -- ${url} --data <발행할 때 쓴 자료 폴더>`);
    expect(lines).toContain(
      '  기본이 아닌 발행 폴더라서 발행할 때 쓴 자료 폴더를 --data 로 붙여요. 테스트 전용 발행물이면 --data 대신 --key <테스트 전용 공개 키 파일> 을 붙여요.',
    );
    expect(lines.filter((line) => line.startsWith('GET '))).toEqual([
      'GET /index.json 200',
      'GET /index.json.sig 200',
      'GET /files/test-tool-a.1.json 200',
      'GET /index.json 200',
      'GET /index.json.sig 200',
      'GET /files/test-tool-a.1.json 200',
    ]);
    // 발행 폴더가 없으면 띄우지 않는다.
    const none = await runToolAsync(['serve', '--dir', join(dir, 'no-such-folder'), '--port', '0']);
    expect(none.status).toBe(1);
    expect(none.stderr).toContain('발행 폴더가 없어요');
  }, 60000);

  it('커밋된 테스트 전용 발행물을 내주면 확인 안내에 테스트 전용 공개 키를 붙이고, 그 안내 그대로 확인하면 통과한다(2차 검토 T2, T5)', async () => {
    const server = startTool(['serve', '--dir', join('exam-data', 'testdata', 'test-only-valid'), '--port', '0']);
    closers.push(async () => {
      server.child.kill();
      await server.done;
    });
    const url = (await server.waitFor(/http:\/\/127\.0\.0\.1:\d+\//))[0];
    await server.waitFor(/확인: [^\r\n]+/);
    const lines = server.output().stdout.split(/\r?\n/);
    expect(lines).toContain(`확인: npm run exams:verify -- ${url} --key exam-data/testdata/test-only-public-key.txt`);
    // 안내 그대로(자료 폴더는 기본인 저장소의 exam-data): 테스트 전용 키라서 자료 폴더의 마지막 발행과 견주지 않고 통과한다.
    const verified = await runToolAsync(['verify', url, '--key', join('exam-data', 'testdata', 'test-only-public-key.txt')]);
    expect(verified.stderr).toBe('');
    expect(verified.status).toBe(0);
    expect(verified.stdout).toContain('공개 키가 테스트 전용 키라서 자료 폴더의 마지막 발행과 견주지 않았어요.');
  }, 60000);

  it('verify 는 주소에서 캐시를 쓰지 않고, 기기나 사용자를 가리키는 값을 붙이지 않고 받는다', async () => {
    const key = tempKey();
    const { dir, out } = published(key);
    const seen: { method: string; url: string; headers: IncomingHttpHeaders }[] = [];
    const files = new Map<string, Buffer>(['index.json', 'index.json.sig', 'files/test-tool-a.1.json'].map((f) => [`/${f}`, readFileSync(join(out, ...f.split('/')))]));
    const { url } = await listen((req, res) => {
      seen.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers });
      const body = files.get(req.url ?? '');
      res.writeHead(body ? 200 : 404).end(body);
    });
    const r = await verifyWith({ kind: 'url', url: new URL(url) }, key.publicFile, dir);
    expect(r.code).toBe(0);
    // 받는 주소에는 쿼리나 조각이 없고, 발행물의 파일만 GET 으로 받는다.
    expect(seen.map((s) => `${s.method} ${s.url}`)).toEqual(['GET /index.json', 'GET /index.json.sig', 'GET /files/test-tool-a.1.json']);
    const allowed = ['host', 'connection', 'cache-control', 'pragma', 'accept', 'accept-language', 'accept-encoding', 'sec-fetch-mode', 'user-agent'];
    for (const s of seen) {
      // 캐시를 쓰지 않는다(fetch 의 cache 'no-store' 와 Cache-Control: no-cache).
      expect(s.headers['cache-control'], s.url).toBe('no-cache');
      // 쿠키, 계정, 기기 이름 같은 값을 붙이지 않는다. 머리글은 fetch 의 기본 머리글과 Cache-Control 뿐이다.
      expect(Object.keys(s.headers).filter((h) => !allowed.includes(h)), s.url).toEqual([]);
      const host = hostname();
      if (host.length >= 4) expect(Object.values(s.headers).some((v) => String(v).includes(host)), s.url).toBe(false);
    }
  });

  it('verify 는 주소의 파일이 5MB 를 넘으면 다 받기 전에 끊는다(길이 머리글, 길이 머리글 없음, gzip, 별도 검토 C5)', async () => {
    const total = 64 * 1024 * 1024;
    const chunk = Buffer.alloc(64 * 1024, 0x61);
    /** 64MB 를 흐름으로 보내는 서버. 받는 쪽이 끊으면 그때까지 보낸 바이트 수를 적는다. */
    const streaming = async (withLength: boolean) => {
      const state = { sent: 0, closed: false };
      const { url } = await listen((_req, res) => {
        res.writeHead(200, withLength ? { 'Content-Length': String(total) } : {});
        res.on('close', () => {
          state.closed = true;
        });
        const write = () => {
          while (!state.closed && state.sent < total) {
            state.sent += chunk.length;
            if (!res.write(chunk)) {
              res.once('drain', write);
              return;
            }
          }
          if (!state.closed) res.end();
        };
        write();
      });
      return { url, state };
    };
    // 길이 머리글이 5MB 를 넘으면 본문을 받지 않는다.
    const declared = await streaming(true);
    const a = await fetchBytes(new URL(`${declared.url}index.json`), 15000);
    expect(a).toEqual({ bytes: null, error: TOO_BIG_WHILE_FETCHING });
    expect(TOO_BIG_WHILE_FETCHING).toBe('파일이 너무 커요. 5MB 를 넘으면 다 받기 전에 끊어요.');
    // 길이 머리글이 없으면 받는 도중에 5MB 를 넘는 자리에서 끊는다(서버가 64MB 를 다 보내지 못한다).
    const chunked = await streaming(false);
    const b = await fetchBytes(new URL(`${chunked.url}index.json`), 15000);
    expect(b).toEqual({ bytes: null, error: TOO_BIG_WHILE_FETCHING });
    await expect.poll(() => chunked.state.closed).toBe(true);
    expect(chunked.state.sent).toBeLessThan(total / 2);
    // gzip 으로 줄여 보내도 푼 크기로 센다(64MB 를 푼 뒤에 견주지 않는다).
    const zipped = gzipSync(Buffer.alloc(total, 0x61));
    expect(zipped.length).toBeLessThan(1024 * 1024);
    const gz = await listen((_req, res) => {
      res.writeHead(200, { 'Content-Encoding': 'gzip', 'Content-Length': String(zipped.length) }).end(zipped);
    });
    const c = await fetchBytes(new URL(`${gz.url}index.json`), 15000);
    expect(c).toEqual({ bytes: null, error: TOO_BIG_WHILE_FETCHING });
    // 5MB 안쪽의 파일은 지금처럼 받는다.
    const small = await listen((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
    });
    const d = await fetchBytes(new URL(`${small.url}index.json`), 15000);
    expect(d.error).toBeNull();
    expect(Buffer.from(d.bytes!).toString('utf8')).toBe('{"ok":true}');
  }, 60000);

  it('verify 는 주소의 응답이 없으면 제한 시간 뒤에 실패하고, 다른 주소로 넘기는 응답을 따라가지 않는다', async () => {
    const key = tempKey();
    const { dir, out } = published(key);
    // 응답하지 않는 서버: 제한 시간(여기서는 0.3초) 뒤에 실패한다.
    const silent = await listen(() => undefined);
    const started = Date.now();
    const slow = await verifyWith({ kind: 'url', url: new URL(silent.url) }, key.publicFile, dir, 300);
    expect(slow.code).toBe(1);
    expect(slow.err).toContain('  - index.json: 제한 시간(0.3초) 안에 받지 못했어요.');
    expect(slow.err).toContain('  - index.json.sig: 제한 시간(0.3초) 안에 받지 못했어요.');
    expect(Date.now() - started).toBeLessThan(10000);

    // 다른 주소로 넘기는 서버: 따라가지 않고 실패한다. 넘겨받을 서버에는 요청이 가지 않는다.
    const good = await serve(out);
    const hits: string[] = [];
    const target = await listen((req, res) => {
      hits.push(req.url ?? '');
      res.writeHead(404).end();
    });
    const moved = await listen((req, res) => {
      res.writeHead(302, { Location: `${target.url}${(req.url ?? '/').slice(1)}` }).end();
    });
    const r = await verifyWith({ kind: 'url', url: new URL(moved.url) }, key.publicFile, dir);
    expect(r.code).toBe(1);
    expect(r.err).toContain('  - index.json: 받지 못했어요(HTTP 상태 302). 다른 주소로 넘기는 응답은 따라가지 않아요. 정해진 주소를 그대로 줘요.');
    expect(hits).toEqual([]);
    // 없는 파일(404)과 연결할 수 없는 곳
    const missing = await listen((_req, res) => {
      res.writeHead(404).end();
    });
    expect((await verifyWith({ kind: 'url', url: new URL(missing.url) }, key.publicFile, dir)).err).toContain('  - index.json: 받지 못했어요(HTTP 상태 404).');
    await good.close();
    const refused = await verifyWith({ kind: 'url', url: new URL(good.url) }, key.publicFile, dir, 5000);
    expect(refused.code).toBe(1);
    expect(refused.err.some((line) => line.startsWith('  - index.json: 받지 못했어요(연결 오류'))).toBe(true);
  }, 60000);
});
