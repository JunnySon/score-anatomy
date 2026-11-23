import type { StorageBackend } from './types';

// 브라우저에서 쓰는 저장소와 복사. 일반 웹 빌드와, 브라우저에서 연 앱용 묶음이 함께 쓴다.

/** 이 기기의 브라우저 저장소(localStorage). 쓸 수 없으면 null. */
export function browserStorage(): StorageBackend | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** 클립보드에 넣는다. 클립보드 API를 쓸 수 없으면 숨긴 글상자를 골라 복사한다. */
export async function browserCopy(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 아래의 다른 방법으로 넘어간다.
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** 아무것도 하지 않고 듣기를 그만두는 함수를 돌려준다. */
export const noListen = (): (() => void) => () => undefined;
