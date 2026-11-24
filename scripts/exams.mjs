// 시험 자료 발행 도구의 진입점(작업 지시서 3의 6-4). npm run exams:<명령> 이 이 파일을 부른다.
// 도구 본체는 scripts/exams 의 TypeScript 파일이고, Node 가 타입만 지우고 바로 읽는다(Node 22.18 이상에서 기본으로 켜짐).
// 검사 규칙은 src/exams/validate.ts 를 그대로 가져와 쓴다. 새 의존성은 없다.

if (!process.features?.typescript) {
  console.error(
    `Node 22.18 이상이 필요해요. 이 도구는 Node 가 TypeScript 파일을 바로 읽는 기능(타입 지우기)을 쓰는데, 지금 Node(${process.version})에서는 그 기능이 꺼져 있어요.`,
  );
  process.exit(1);
}

try {
  const { main } = await import('./exams/cli.ts');
  process.exitCode = await main(process.argv.slice(2));
} catch (e) {
  // 예상하지 못한 오류. 오류의 이름과 문장만 적는다(파일 내용을 그대로 옮겨 적지 않는다).
  console.error('도구가 예상하지 못한 오류로 멈췄어요. 원본 파일은 한 파일씩 통째로 바꿔 쓰므로 반쯤 쓴 파일은 없어요. git status 로 바뀐 파일을 확인해 주세요.');
  console.error(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
  process.exitCode = 1;
}
