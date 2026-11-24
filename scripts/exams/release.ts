import { revOf } from '../../src/exams/validate.ts';
import type { Exam, LockEntry } from '../../src/types.ts';
import { canonicalJson, sha256Hex } from './canonical.ts';
import { examFileText } from './state.ts';

// 발행물의 모양(작업 지시서 3의 6-2). exams:publish 가 만들고 exams:verify 가 확인한다.
//   index.json      { format: 1, seq, issuedAt, exams: [{ id, rev, file, sha256 }], locks } 를 키를 정렬한 JSON 으로 적은 것
//   index.json.sig  index.json 의 바이트 그대로에 대한 Ed25519 서명(sign.ts)
//   files/<id>.<rev>.json  검사를 통과한 시험을 키를 정렬한 JSON 으로 적은 것(state.ts 의 examFileText)
// 받는 쪽은 파일을 다시 직렬화하지 않고 받은 바이트 그대로 검사한다.

export const RELEASE_FORMAT = 1;
export const INDEX_FILE = 'index.json';
export const SIG_FILE = 'index.json.sig';
export const FILES_DIR = 'files';

/** index.json 의 시험 목록 한 줄. file 은 index.json 이 있는 곳 기준의 경로, sha256 은 그 파일 바이트의 SHA-256(16진수 소문자)이다. */
export interface ReleaseEntry {
  id: string;
  rev: number;
  file: string;
  sha256: string;
}

export interface ReleaseIndex {
  format: 1;
  seq: number;
  issuedAt: string;
  exams: ReleaseEntry[];
  locks: LockEntry[];
}

/** 발행물에 넣을 파일 하나(index.json.sig 빼고). bytes 는 쓸 바이트 그대로이고 sha256 도 이 바이트로 셈한다. */
export interface ReleaseFile {
  path: string;
  bytes: Uint8Array;
}

/** 발행 파일의 경로(형식 예시: files/test-only-exam.3.json). 시험 id 는 영어 소문자, 숫자, 붙임표만이라 그대로 파일 이름이 된다. */
export function releaseFilePath(exam: Exam): string {
  return `${FILES_DIR}/${exam.id}.${revOf(exam)}.json`;
}

/**
 * 발행물의 index.json 과 시험 파일을 만든다(서명은 따로, indexBytes 에 한다). 매번 원본의 모든 시험을 담는 전체 발행이다.
 * 시험은 id 차례로 적는다. 시험 객체와 잠금 달력은 검사를 통과한 것이어야 한다(exams:check 의 checkData).
 * 파일은 UTF-8 바이트로 만들어 두고, 그 바이트 그대로 SHA-256 을 셈하고 서명하고 쓴다.
 */
export function buildRelease(input: { seq: number; issuedAt: string; exams: readonly Exam[]; locks: readonly LockEntry[] }): {
  index: ReleaseIndex;
  indexBytes: Uint8Array;
  files: ReleaseFile[];
} {
  const sorted = [...input.exams].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const files: ReleaseFile[] = [];
  const entries: ReleaseEntry[] = sorted.map((exam) => {
    const path = releaseFilePath(exam);
    const bytes = Buffer.from(examFileText(exam), 'utf8');
    files.push({ path, bytes });
    return { id: exam.id, rev: revOf(exam), file: path, sha256: sha256Hex(bytes) };
  });
  const index: ReleaseIndex = { format: RELEASE_FORMAT, seq: input.seq, issuedAt: input.issuedAt, exams: entries, locks: [...input.locks] };
  return { index, indexBytes: Buffer.from(canonicalJson(index), 'utf8'), files };
}
