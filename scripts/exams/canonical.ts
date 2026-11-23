import { createHash } from 'node:crypto';

// 발행 파일과 state.json 의 글자 모양(작업 지시서 3의 6-2, 6-4).
// 키를 정렬한 JSON 이고, 2칸 들여쓰기, 줄바꿈은 LF, 끝에 줄바꿈 하나다. 같은 값이면 실행하는 곳과 상관없이 늘 같은 바이트가 나와서
// 파일의 SHA-256 하나로 내용이 같은지 견줄 수 있다. 키 차례는 UTF-16 코드 단위 순서(배열 sort 의 기본 차례)다.
// 숫자 모양의 키("1", "2")도 글자로 정렬한다. 객체에 넣은 차례에 기대지 않고 정렬한 차례대로 직접 적는다.

/** 값을 키를 정렬한 JSON 글자로 적는다. undefined 인 칸은 빼고(JSON.stringify 와 같음), NaN 과 무한대는 던진다. */
export function canonicalJson(value: unknown): string {
  return `${write(value, '')}\n`;
}

function write(value: unknown, indent: string): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new Error('JSON 에 적을 수 없는 수예요(NaN 이나 무한대).');
      return JSON.stringify(value);
    case 'string':
      return JSON.stringify(value);
    case 'object': {
      const inner = `${indent}  `;
      if (Array.isArray(value)) {
        if (value.length === 0) return '[]';
        const parts = value.map((v: unknown) => `${inner}${write(isSkipped(v) ? null : v, inner)}`);
        return `[\n${parts.join(',\n')}\n${indent}]`;
      }
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj)
        .filter((k) => !isSkipped(obj[k]))
        .sort();
      if (keys.length === 0) return '{}';
      const parts = keys.map((k) => `${inner}${JSON.stringify(k)}: ${write(obj[k], inner)}`);
      return `{\n${parts.join(',\n')}\n${indent}}`;
    }
    default:
      throw new Error(`JSON 에 적을 수 없는 값이에요(${typeof value}).`);
  }
}

/** JSON 에 적지 않는 값. 객체에서는 그 칸을 빼고, 배열에서는 null 로 적는다(JSON.stringify 와 같음). */
function isSkipped(v: unknown): boolean {
  return v === undefined || typeof v === 'function' || typeof v === 'symbol';
}

/** SHA-256 을 16진수 소문자로 적는다. 글자는 UTF-8 바이트로 셈한다. */
export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}
