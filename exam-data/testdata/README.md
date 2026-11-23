# 테스트 전용 발행물(작업 지시서 3의 6-5)

이 폴더의 키와 발행물은 모두 테스트 전용이에요. `npm run exams:testdata`(node scripts/exams.mjs testdata)가 만들어요.
손으로 고치지 않아요. 다시 만들어도 모든 파일이 같은 바이트로 나와요(키는 고정된 씨앗에서 만들고, Ed25519 서명은 같은 키와 같은 바이트면 같아요).

- 이 키는 진짜 발행에 절대 쓰지 않아요. 비밀 키를 일부러 저장소에 넣어 둬서 누구나 이 키로 서명할 수 있어요.
- `npm run exams:publish` 는 이 키를 받지 않아요. 저장소 안의 비밀 키를 거부하고, 저장소 밖으로 옮겨도 테스트 전용 키라 거부해요.
- 앱의 배포용 빌드에는 이 공개 키를 넣지 않아요. 진짜 공개 키는 키를 맡은 사람이 `npm run exams:keygen` 으로 만들어 exam-data/public-key.txt 에 둬요.
- 시험 test-only-exam 은 테스트용으로 지은 시험이에요. 예시 시험처럼 isSample 이 true 이고 제목이 "테스트 전용 시험"이에요. 정답과 배점은 실제 시험의 값이 아니에요.
- 날짜와 시각은 모두 작업 지시서의 형식 예시 값(2030년 1월 2일)이에요. 잠금 달력의 항목 하나(test-only-lock, 2030-01-02T08:40부터 2030-01-02T17:45까지)도 형식 예시 시각이에요.

## 키

| 파일 | 내용 |
| --- | --- |
| test-only-private-key.pem | 테스트 전용 Ed25519 비밀 키(PEM, PKCS#8) |
| test-only-public-key.txt | 그 공개 키 32바이트를 표준 base64(패딩 포함)로 적은 한 줄과 LF. 지문(공개 키 32바이트의 SHA-256 앞 16자)은 f7e7dc5cfc6ce2a0 예요 |

## 발행물 네 가지

폴더마다 발행 폴더(dist-exams)와 같은 모양이에요: index.json, index.json.sig, files/<시험 id>.<rev>.json. 받는 쪽 규칙은 작업 지시서 3의 6-3 이에요.

| 폴더 | index.json | 무엇이 다른지 | 받는 쪽이 할 일 |
| --- | --- | --- | --- |
| test-only-valid | seq 2, issuedAt 2030-01-02T17:10, 시험 rev 2 | 정상 발행물이에요. 시험은 정답을 공개한 판이에요. | 받아들여요. |
| test-only-bad-signature | seq 3, issuedAt 2030-01-02T20:10, 시험 rev 3 | index.json 과 시험 파일은 맞는데 서명을 다른 키로 했어요(서명 64바이트의 모양은 맞아요). | 서명이 맞지 않아 버리고 가지고 있던 자료를 그대로 써요. |
| test-only-changed-byte | seq 3, issuedAt 2030-01-02T20:10, 시험 rev 3 | 서명은 맞는데 files/test-only-exam.3.json 의 한 바이트(1번 문항의 정답 숫자)를 바꿨어요. 바뀐 파일도 JSON 이고 시험 파일 검사를 통과해요. | 시험 파일의 sha256 이 index.json 에 적힌 값과 달라 버리고 가지고 있던 자료를 그대로 써요. |
| test-only-older-seq | seq 1, issuedAt 2030-01-02T08:40, 시험 rev 1 | 서명과 sha256 은 맞는데 seq 가 test-only-valid 보다 작아요. 시험은 정답 공개 전 판이에요. | test-only-valid 를 받은 뒤라면 seq 가 작아 버려요. 아무것도 받지 않은 상태라면 받아들여요. |

시험 test-only-exam 의 판은 셋이에요. rev 1 은 정답 공개 전, rev 2 는 정답을 공개한 판, rev 3 은 2번 정답을 정정한 판(answersRev 2, 정정 안내 "테스트 전용 정정 안내예요.")이에요.
세 판 모두 앱의 시험 파일 검사(src/exams/validate.ts)를 통과해요. 받아들인 발행물은 다리 규격 2의 remote 로 웹에 넘길 수 있어요(exams 에는 시험 파일의 내용을, locks 에는 index.json 의 locks 를 넣어요. docs/앱_다리_규격.md 7장).
test-only-bad-signature 와 test-only-changed-byte 는 seq 3 이라 test-only-valid(seq 2)를 받은 뒤에 와도 seq 로는 버려지지 않아요.
서명이나 sha256 확인을 건너뛰는 결함이 있으면 받아들이게 되고, 그러면 시험이 정답 정정 판(rev 3)으로 바뀌어 화면에서도 알 수 있어요.

## 받는 쪽 시험 순서(작업 지시서 4)

1. 아무것도 받지 않은 상태에서 test-only-bad-signature 를 주면 버려요. 받은 자료가 없는 그대로예요.
2. 아무것도 받지 않은 상태에서 test-only-changed-byte 를 주면 버려요. 받은 자료가 없는 그대로예요.
3. test-only-valid 를 주면 받아들여요(seq 2, 시험 test-only-exam rev 2).
4. 이어서 test-only-valid 를 다시 주면 seq 가 같아 그대로 둬요.
5. 이어서 test-only-older-seq 를 주면 seq 가 작아 버려요(seq 2 그대로).
6. 이어서 test-only-bad-signature, test-only-changed-byte 를 주면 버려요(seq 2 그대로).
7. 처음 상태에서 test-only-older-seq 를 주면 받아들이고(seq 1, 정답 공개 전), 이어서 test-only-valid 를 주면 받아들여요(seq 2).

## 이 도구로 확인하기

저장소 폴더에서 이렇게 쳐요.

    node scripts/exams.mjs verify exam-data/testdata/test-only-valid --key exam-data/testdata/test-only-public-key.txt

test-only-valid 와 test-only-older-seq 는 통과하고(종료 코드 0), test-only-bad-signature 는 서명이, test-only-changed-byte 는 sha256 이 맞지 않아 실패해요(종료 코드 1).
exams:verify 는 받는 쪽이 가진 seq 를 모르니 seq 비교는 받는 쪽이 해요. `npm run verify` 의 13번 항목이 네 폴더를 이렇게 확인해요.
