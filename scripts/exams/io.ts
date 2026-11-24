// 발행 도구의 출력. 명령은 글자를 여기로만 내보내서 테스트가 출력을 모아 볼 수 있다.

/** 명령이 쓰는 출력 두 갈래. out 은 결과와 요약, err 는 거부와 오류다. 한 번에 한 줄씩 받는다. */
export interface Io {
  out(line: string): void;
  err(line: string): void;
}

/** 터미널에 그대로 적는 출력. */
export const consoleIo: Io = {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
};
