import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { sha256Hex } from './canonical.ts';

// 발행물의 서명(작업 지시서 3의 6-2, 6-4). Ed25519 와 SHA-256 은 Node 에 든 기능(node:crypto)만 쓴다.
// - 비밀 키는 환경 변수 SA_EXAM_KEY_FILE 이 가리키는 파일(PEM, PKCS#8)에서만 읽는다. 그 파일의 실제 경로가 저장소 폴더 안이면 거부한다.
//   테스트 전용 키(작업 지시서 3의 6-5, 아래 testOnlySigningKey)도 거부한다.
// - 서명은 index.json 파일의 바이트 그대로에 대한 Ed25519 서명 64바이트를 표준 base64(패딩 포함) 한 줄과 LF 로 적은 것이다.
// - 공개 키는 Ed25519 공개 키 32바이트(JWK 의 x)를 표준 base64(패딩 포함) 한 줄과 LF 로 적은 것이다.
// 키 내용과, 키 내용이 섞일 수 있는 오류 원문(OpenSSL 의 문장 등)은 어디에도 출력하지 않는다. 오류는 이 파일이 정한 한국어 문장만 돌려준다.

/** 비밀 키 파일의 경로를 넣는 환경 변수. */
export const KEY_ENV = 'SA_EXAM_KEY_FILE';

/** 공개 키 파일의 이름(자료 폴더 안). 진짜 공개 키는 사람이 exams:keygen 으로 만든다. */
export const PUBLIC_KEY_FILE = 'public-key.txt';

/** 비밀 키 파일로 받는 가장 큰 크기. Ed25519 PKCS#8 PEM 은 120바이트 안팎이다. */
const MAX_KEY_FILE_BYTES = 16 * 1024;

/**
 * 실제 경로: 심볼릭 링크, 연결 지점(junction), 상대 경로, 윈도우의 짧은 이름과 대소문자를 운영체제가 푼 경로다.
 * 아직 없는 경로는 있는 가장 가까운 상위 폴더까지 풀고 나머지 이름을 그대로 붙인다.
 */
export function realPath(path: string): string {
  let current = resolve(path);
  const rest: string[] = [];
  for (;;) {
    try {
      const real = realpathSync.native(current);
      return rest.length === 0 ? real : join(real, ...rest.reverse());
    } catch {
      const parent = dirname(current);
      if (parent === current) return resolve(path);
      rest.push(basename(current));
      current = parent;
    }
  }
}

/** 경로를 견줄 때 쓰는 글자. 윈도우는 대소문자를 가리지 않는다. */
function pathKey(path: string): string {
  return process.platform === 'win32' ? path.toLowerCase() : path;
}

/** child 가 parent 와 같거나 그 안에 있는지. 둘 다 실제 경로로 풀어서 견준다. */
export function isInside(child: string, parent: string): boolean {
  const rel = relative(pathKey(realPath(parent)), pathKey(realPath(child)));
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}

/** 비밀 키를 두면 안 되는 곳(저장소 폴더, 자료 폴더, 발행 폴더). name 은 출력에 쓰는 이름이다. */
export interface KeyPlace {
  dir: string;
  name: string;
}

/** 비밀 키 파일의 경로가 둘 수 없는 곳 안이면 그 이유를 돌려준다. 없으면 null. */
export function keyPlaceProblem(keyPath: string, places: readonly KeyPlace[]): string | null {
  for (const place of places) {
    if (isInside(keyPath, place.dir)) {
      return `비밀 키 파일이 ${place.name} 안에 있어요(실제 경로 ${realPath(keyPath)}). 비밀 키는 저장소 밖, 본인만 열 수 있는 곳에 둬요. 저장소나 자료 폴더, 발행 폴더 안의 파일은 실수로 커밋되거나 올라갈 수 있어요.`;
    }
  }
  return null;
}

const PKCS8_PEM_RE = /^-----BEGIN PRIVATE KEY-----\r?\n(?:[A-Za-z0-9+/=]+\r?\n)+-----END PRIVATE KEY-----$/;

/** PEM(PKCS#8) 글자를 Ed25519 비밀 키로 읽는다. 오류 문장에는 키 내용도 OpenSSL 의 오류 원문도 넣지 않는다. */
export function parsePrivateKeyPem(text: string): { key: KeyObject | null; error: string | null } {
  const body = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).trim();
  if (body === '') return { key: null, error: '비밀 키 파일이 비어 있어요.' };
  if (/-----BEGIN ENCRYPTED PRIVATE KEY-----/.test(body)) {
    return { key: null, error: '암호를 건 비밀 키(ENCRYPTED PRIVATE KEY)는 받지 않아요. 암호 없는 PKCS#8 PEM 이어야 해요.' };
  }
  if (!PKCS8_PEM_RE.test(body)) {
    return { key: null, error: '비밀 키 파일이 PEM 모양의 PKCS#8 비밀 키(-----BEGIN PRIVATE KEY----- 로 시작하는 한 덩어리)가 아니에요.' };
  }
  let key: KeyObject;
  try {
    key = createPrivateKey({ key: body, format: 'pem' });
  } catch {
    return { key: null, error: '비밀 키 파일을 비밀 키로 읽지 못했어요.' };
  }
  if (key.asymmetricKeyType !== 'ed25519') {
    return { key: null, error: `비밀 키가 Ed25519 가 아니에요(지금 키의 종류: ${key.asymmetricKeyType ?? '알 수 없음'}).` };
  }
  return { key, error: null };
}

/**
 * 서명에 쓸 비밀 키를 SA_EXAM_KEY_FILE 이 가리키는 파일에서 읽는다(작업 지시서 3의 6-4).
 * 환경 변수가 없거나 비었거나, 파일이 없거나 파일이 아니거나, 그 파일의 실제 경로가 둘 수 없는 곳(places) 안이거나,
 * Ed25519 PKCS#8 PEM 이 아니면 거부한다. 상대 경로는 base(명령을 친 폴더) 기준으로 푼다.
 */
export function loadSigningKey(
  env: Readonly<Record<string, string | undefined>>,
  base: string,
  places: readonly KeyPlace[],
): { key: KeyObject | null; errors: string[] } {
  const raw = env[KEY_ENV];
  if (raw === undefined || raw.trim() === '') {
    return {
      key: null,
      errors: [`${KEY_ENV} 이 없어요. 비밀 키 파일(PEM, PKCS#8)의 경로를 이 환경 변수에 넣어 주세요. 비밀 키는 저장소 밖에 둬요.`],
    };
  }
  const path = resolve(base, raw.trim());
  if (!existsSync(path)) return { key: null, errors: [`${KEY_ENV} 이 가리키는 비밀 키 파일이 없어요(${path}).`] };
  const place = keyPlaceProblem(path, places);
  if (place !== null) return { key: null, errors: [place] };
  let bytes: Buffer;
  try {
    const st = statSync(path);
    if (!st.isFile()) return { key: null, errors: [`${KEY_ENV} 이 가리키는 곳이 파일이 아니에요(${path}).`] };
    if (st.size > MAX_KEY_FILE_BYTES) return { key: null, errors: ['비밀 키 파일이 너무 커요. PEM 모양의 PKCS#8 비밀 키 하나만 둬요.'] };
    bytes = readFileSync(path);
  } catch {
    return { key: null, errors: [`비밀 키 파일을 읽지 못했어요(${path}).`] };
  }
  const parsed = parsePrivateKeyPem(bytes.toString('utf8'));
  if (parsed.key === null) return { key: null, errors: [parsed.error ?? '비밀 키 파일을 비밀 키로 읽지 못했어요.'] };
  if (isTestOnlyKey(parsed.key)) {
    return {
      key: null,
      errors: [
        `${KEY_ENV} 이 가리키는 비밀 키가 테스트 전용 키예요(exam-data/testdata 의 test-only-private-key.pem 과 같은 키). 이 키는 저장소에 들어 있어 누구나 가질 수 있어서 진짜 발행에는 쓰지 않아요.`,
      ],
    };
  }
  return { key: parsed.key, errors: [] };
}

/** 새 Ed25519 키 쌍. 비밀 키는 PEM(PKCS#8) 글자로 돌려준다. */
export function generateSigningKey(): { key: KeyObject; pem: string } {
  const { privateKey } = generateKeyPairSync('ed25519');
  return { key: privateKey, pem: privateKeyPem(privateKey) };
}

/** 비밀 키의 PEM(PKCS#8) 글자. 줄바꿈은 LF 이고 끝에 줄바꿈이 하나 있다. */
export function privateKeyPem(key: KeyObject): string {
  return String(key.export({ type: 'pkcs8', format: 'pem' }));
}

// 테스트 전용 키(작업 지시서 3의 6-5). 고정된 이름의 SHA-256 을 씨앗(Ed25519 비밀 키 32바이트)으로 써서, 다시 만들어도 같은 키가 나온다.
// 테스트 전용 발행물(exam-data/testdata)을 만들 때만 쓴다(scripts/exams/testdata.ts). 그 비밀 키는 일부러 저장소에 두므로 누구나 가질 수 있다.
// 그래서 진짜 발행에는 쓰지 않는다: loadSigningKey 가 거부하고, exams:verify 는 이 공개 키로 확인할 때 테스트 전용이라고 알린다.

/** Ed25519 비밀 키의 PKCS#8 DER 에서 씨앗 32바이트 앞에 오는 머리(RFC 8410). */
const ED25519_PKCS8_HEAD = Buffer.from('302e020100300506032b657004220420', 'hex');

/** 테스트 전용 키를 만드는 이름. 첫째는 exam-data/testdata 에 두는 키, 둘째는 서명이 틀린 발행물에만 쓰는 다른 키(파일로 두지 않음)다. */
export const TEST_ONLY_KEY_NAMES: readonly string[] = ['score-anatomy/test-only-signing-key/v1', 'score-anatomy/test-only-other-key/v1'];

/** 이름의 SHA-256 을 씨앗으로 만든 Ed25519 비밀 키. 같은 이름이면 늘 같은 키다. 테스트 전용 키에만 쓴다. */
export function seededSigningKey(name: string): KeyObject {
  const seed = createHash('sha256').update(name, 'utf8').digest();
  return createPrivateKey({ key: Buffer.concat([ED25519_PKCS8_HEAD, seed]), format: 'der', type: 'pkcs8' });
}

/** exam-data/testdata 에 두는 테스트 전용 비밀 키. */
export function testOnlySigningKey(): KeyObject {
  return seededSigningKey(TEST_ONLY_KEY_NAMES[0]);
}

/** 서명이 틀린 테스트 전용 발행물에 쓰는 다른 키. */
export function otherTestOnlyKey(): KeyObject {
  return seededSigningKey(TEST_ONLY_KEY_NAMES[1]);
}

/** 테스트 전용 키(비밀 키나 공개 키)인지. 공개 키 32바이트로 견준다. */
export function isTestOnlyKey(key: KeyObject): boolean {
  const pub = publicKeyBytes(key);
  return TEST_ONLY_KEY_NAMES.some((name) => publicKeyBytes(seededSigningKey(name)).equals(pub));
}

/** Ed25519 공개 키 32바이트. 비밀 키를 주면 그 짝의 공개 키다. */
export function publicKeyBytes(key: KeyObject): Buffer {
  const pub = key.type === 'private' ? createPublicKey(key) : key;
  const jwk = pub.export({ format: 'jwk' });
  if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || typeof jwk.x !== 'string') throw new Error('Ed25519 공개 키가 아니에요.');
  return Buffer.from(jwk.x, 'base64url');
}

/** 공개 키 파일의 글자: 공개 키 32바이트의 표준 base64(패딩 포함) 한 줄과 LF. */
export function publicKeyText(key: KeyObject): string {
  return `${publicKeyBytes(key).toString('base64')}\n`;
}

/** 공개 키의 지문: 공개 키 32바이트의 SHA-256 앞 16자. 어느 키로 서명했고 어느 키로 확인하는지 사람이 견줄 때 쓴다(비밀이 아님). */
export function keyFingerprint(key: KeyObject): string {
  return sha256Hex(publicKeyBytes(key)).slice(0, 16);
}

/** 한 줄 파일의 글자에서 끝의 줄바꿈 하나(LF 나 CRLF)를 뺀다. 그 밖의 빈칸이나 줄은 그대로 둬서 모양 검사에 걸리게 한다. */
function oneLine(text: string): string {
  if (text.endsWith('\r\n')) return text.slice(0, -2);
  if (text.endsWith('\n')) return text.slice(0, -1);
  return text;
}

const PUBLIC_KEY_RE = /^[A-Za-z0-9+/]{43}=$/;
const SIGNATURE_RE = /^[A-Za-z0-9+/]{86}==$/;

/** 표준 base64 를 바이트로. 다시 적었을 때 같은 글자가 되는 것만 받는다(남는 비트가 0이 아닌 글자 등은 받지 않음). */
function strictBase64(body: string, re: RegExp): Buffer | null {
  if (!re.test(body)) return null;
  const bytes = Buffer.from(body, 'base64');
  return bytes.toString('base64') === body ? bytes : null;
}

/** 공개 키 파일의 글자를 Ed25519 공개 키로 읽는다. 32바이트를 표준 base64 로 적은 한 줄이어야 한다(끝의 줄바꿈 하나는 괜찮음). */
export function parsePublicKeyText(text: string): { key: KeyObject | null; error: string | null } {
  const bytes = strictBase64(oneLine(text), PUBLIC_KEY_RE);
  const error = '공개 키 파일은 Ed25519 공개 키 32바이트를 표준 base64(패딩 포함)로 적은 한 줄이어야 해요.';
  if (bytes === null) return { key: null, error };
  try {
    const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: bytes.toString('base64url') }, format: 'jwk' });
    return key.asymmetricKeyType === 'ed25519' ? { key, error: null } : { key: null, error };
  } catch {
    return { key: null, error };
  }
}

/** index.json 의 바이트 그대로에 대한 서명 파일(index.json.sig)의 글자: Ed25519 서명 64바이트의 표준 base64 한 줄과 LF. */
export function signatureText(bytes: Uint8Array, key: KeyObject): string {
  return `${sign(null, bytes, key).toString('base64')}\n`;
}

/** 서명 파일의 글자를 읽어 서명이 맞는지 본다. 모양이 틀리면 error 에 이유가 있다. */
export function checkSignature(bytes: Uint8Array, signature: string, publicKey: KeyObject): { ok: boolean; error: string | null } {
  const sig = strictBase64(oneLine(signature), SIGNATURE_RE);
  if (sig === null) return { ok: false, error: 'index.json.sig 는 Ed25519 서명 64바이트를 표준 base64(패딩 포함)로 적은 한 줄이어야 해요.' };
  let ok = false;
  try {
    ok = verify(null, bytes, publicKey, sig);
  } catch {
    ok = false;
  }
  return ok ? { ok: true, error: null } : { ok: false, error: '서명이 맞지 않아요(index.json.sig). index.json 이 바뀌었거나 다른 키로 서명했어요.' };
}
