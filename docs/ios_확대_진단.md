# iPhone 16에서 첫 두 번 누름의 확대를 잰 기록

2026-11-25, 웹 0.3.2 시험용 묶음(094e5f6), Xcode 26.4.1(17E202)이에요. 매회 앱을 새로 켜고 손가락 입력 없이 대상 화면을 열었어요. iOS 18.4(22E238)와 iOS 26.4 런타임(26.4.1, 23E254a)에 각각 새 iPhone 16을 만들었어요. 한 번의 시도는 한 기기에서 수행했어요. 사용자가 전원 연결 없이 진행하도록 정했어요.

## 경우별 결과

확대는 누르기 직전보다 안정된 뒤 visualViewport.scale이 0.01 넘게 증가한 횟수예요. 입력은 지정한 버튼에서 웹의 빠른 누름 보호를 통과해 창의 버블 단계까지 도달한 click을 셌어요. 로그 표식은 그 시각에 같은 기기의 com.apple.WebKit / ViewGestures 로그에서 읽은 "Identified a double tap"이에요.

| 경우 | 조건 | 시도 | 확대 | 해당 버튼 입력 수 (횟수) | 표식 있음 / 다른 줄만 / 구간 줄 없음 | 실제 누름 시작 간격, ms (최소 / 중앙 / 최대) |
| --- | --- | ---: | ---: | --- | --- | --- |
| A | 표시 칸 3, 아주 빠른 두 번 | 10 | 10 | 1 (2회), 2 (8회) | 0 / 10 / 0 | 41 / 63 / 74 |
| B | 같은 iPhone 16, iOS 26.4, 표시 칸 3 | 10 | 6 | 1 (3회), 2 (7회) | 0 / 10 / 0 | 56 / 66 / 78 |
| C | html과 body에 overflow-x: hidden | 10 | 10 | 1 (3회), 2 (6회), 3 (1회) | 0 / 10 / 0 | 39 / 61.5 / 83 |
| D | html에 touch-action: manipulation | 10 | 10 | 0 (9회), 1 (1회) | 0 / 10 / 0 | 59 / 68.5 / 82 |
| E | 빈 곳을 먼저 한 번 누르고 1초 뒤 표시 칸 | 10 | 0 | 2 (10회) | 0 / 10 / 0 | 67 / 73 / 85 |
| F | 표시 칸에 따로 보낸 두 번 누름 | 10 | 0 | 2 (10회) | 0 / 10 / 0 | 277 / 300 / 313 |
| Gkey | 답 키 3, 첫 누름 | 10 | 7 | 0 (1회), 1 (2회), 2 (7회) | 0 / 10 / 0 | 9 / 40.5 / 73 |
| Ggrade | 점수 해부 1등급, 첫 누름 | 10 | 8 | 1 (10회) | 0 / 10 / 0 | 11 / 62 / 75 |
| H | 버튼 mousedown 기본 동작 막기 | 10 | 0 | 2 (10회) | 0 / 10 / 0 | 10 / 63 / 76 |
| I | 버튼 click 기본 동작 막기 | 10 | 4 | 1 (2회), 2 (8회) | 0 / 10 / 0 | 22 / 56 / 73 |

## 출시 전에 확인할 것

- iOS 18에서 첫 누름 두 번 누름 확대: 출시 전에 고칠 것. A는 10회 모두 1.6배로 확대됐어요. 277~313ms 간격의 F는 10회 모두 확대 0, 입력 2개였어요. 실제 학생이나 실기기에서 같은 비율이 나오는지는 확인하지 못했어요.
- 문서 폭은 네 측정값 모두 393이었고 첫 배율은 JS와 네이티브 모두 1이었어요. 넘침을 가린 C와 루트 touch-action을 바꾼 D에서도 10회 모두 확대됐어요. 이 측정에서 가로 넘침으로 확대를 설명할 근거는 없어요. C는 10회 중 1회 두 번 누른 같은 칸에 입력이 세 번 들어갔어요. 웹 0.3.2에서 잰 결과예요.
- 100회 모두 해당 시간에 ViewGestures의 다른 기록이 있었고 "Identified a double tap"은 없었어요. "Potential tap may cause significant zoom. Wait."는 확대된 A와 확대되지 않은 E, F, H의 기록에 모두 있었어요. 이 줄 하나로 원인을 구별할 수 없어요. 빈 곳을 먼저 누른 E와 버튼의 mousedown 기본 동작을 막은 H에서 확대가 0이어서, 첫 누름의 처리를 기다리는 동안 확대가 일어난다는 부록 A 후보 2와 관찰이 더 잘 맞아요. 미처리 알림이 늦게 도착한 정확한 시각은 이 로그에서 확인하지 못했어요.
- 웹에서 다음에 검증할 후보는 H의 버튼 mousedown 처리예요. 포커스, 정상 누름, 스크롤, 길게 누름, 두 손가락 확대를 실기기에서 함께 확인해야 해요. click 기본 동작만 막은 I에서는 10회 중 4회 확대됐어요. 배포용 웹과 껍데기의 확대 동작에는 대책을 넣지 않았어요.
- B는 iPhone 16에서 런타임만 바꾼 비교이고 10회 중 6회 확대됐어요. 이 결과만으로 OS와 기기 폭 각각의 효과를 정할 수 없어요. B의 한 시도는 XCUITest가 doubleTap을 보냈지만 웹에 pointerdown이 하나만 관찰돼 간격을 확인하지 못했어요.
- 앱이 준비되기 전 /marks 이동이 시작 화면으로 돌아간 두 런타임의 초기 실행은 측정에서 뺐어요. iOS 18.4의 A 8회차와 I 9회차는 시작 시간 초과 뒤 새로 켜서 측정했어요. 각 경우와 회차에서 처음으로 입력까지 기록한 시도를 표에 넣었어요. I 9회차를 다시 실행할 때 I 10회차도 한 번 더 측정됐고, 추가 시도는 1.6배 확대와 입력 1개였어요. 이 추가 시도는 열 번에 넣지 않았어요.

## 누르기 직전의 크기

웹의 폭은 CSS px, 네이티브 스크롤 뷰의 크기는 pt예요. C와 D는 속성을 넣은 뒤의 값이에요. 화면 밖 요소는 좌우 경계를 넘은 요소를 열 개까지 적었어요.

| 경우 | 해당 횟수 | innerWidth / clientWidth / 루트 scrollWidth / body scrollWidth | visualViewport 폭 / 배율 | 네이티브 현재 / 최소 / 최대 | contentSize | bounds (x, y, 폭, 높이) | 화면 밖 요소 (왼쪽, 오른쪽) |
| --- | ---: | --- | --- | --- | --- | --- | --- |
| A | 10 | 393 / 393 / 393 / 393 | 393 / 1 | 1 / 1 / 5 | 393 x 852 | 0, 0, 393, 852 | 1개, div.sr-only (-1, 0) |
| B | 10 | 393 / 393 / 393 / 393 | 393 / 1 | 1 / 1 / 5 | 393 x 852 | 0, 0, 393, 852 | 1개, div.sr-only (-1, 0) |
| C | 10 | 393 / 393 / 393 / 393 | 393 / 1 | 1 / 1 / 5 | 393 x 852 | 0, 0, 393, 852 | 1개, div.sr-only (-1, 0) |
| D | 10 | 393 / 393 / 393 / 393 | 393 / 1 | 1 / 1 / 5 | 393 x 852 | 0, 0, 393, 852 | 1개, div.sr-only (-1, 0) |
| E | 10 | 393 / 393 / 393 / 393 | 393 / 1 | 1 / 1 / 5 | 393 x 852 | 0, 0, 393, 852 | 1개, div.sr-only (-1, 0) |
| F | 10 | 393 / 393 / 393 / 393 | 393 / 1 | 1 / 1 / 5 | 393 x 852 | 0, 0, 393, 852 | 1개, div.sr-only (-1, 0) |
| Gkey | 10 | 393 / 393 / 393 / 393 | 393 / 1 | 1 / 1 / 5 | 393 x 852 | 0, 0, 393, 852 | 2개, p.sr-only (-1, 0), div.sr-only (-1, 0) |
| Ggrade | 10 | 393 / 393 / 393 / 393 | 393 / 1 | 1 / 1 / 5 | 393 x 852 | 0, 0, 393, 852 | 1개, div.sr-only (-1, 0) |
| H | 10 | 393 / 393 / 393 / 393 | 393 / 1 | 1 / 1 / 5 | 393 x 852 | 0, 0, 393, 852 | 1개, div.sr-only (-1, 0) |
| I | 10 | 393 / 393 / 393 / 393 | 393 / 1 | 1 / 1 / 5 | 393 x 852 | 0, 0, 393, 852 | 1개, div.sr-only (-1, 0) |

## 회차별 입력과 확대

| 경우 / 회차 | 대상 누름 / 입력 | 전후 웹 배율 | 전후 스크롤 뷰 배율 | 실제 간격(ms) | 끝 상태 | 기본 동작 차단 호출 | 로그 줄 / 표식 |
| --- | --- | --- | --- | ---: | --- | ---: | --- |
| A / 1 | 2 / 2 | 1 → 1.6 | 1 → 1.6 | 57 | guess | 0 | 5 / 없음 |
| A / 2 | 2 / 2 | 1 → 1.6 | 1 → 1.6 | 65 | guess | 0 | 5 / 없음 |
| A / 3 | 2 / 1 | 1 → 1.6 | 1 → 1.6 | 65 | doubt | 0 | 5 / 없음 |
| A / 4 | 2 / 2 | 1 → 1.6 | 1 → 1.6 | 41 | guess | 0 | 5 / 없음 |
| A / 5 | 2 / 2 | 1 → 1.6 | 1 → 1.6 | 51 | guess | 0 | 5 / 없음 |
| A / 6 | 2 / 1 | 1 → 1.6 | 1 → 1.6 | 61 | doubt | 0 | 5 / 없음 |
| A / 7 | 2 / 2 | 1 → 1.6 | 1 → 1.6 | 74 | guess | 0 | 5 / 없음 |
| A / 8 | 2 / 2 | 1 → 1.6 | 1 → 1.6 | 57 | guess | 0 | 5 / 없음 |
| A / 9 | 2 / 2 | 1 → 1.6 | 1 → 1.6 | 67 | guess | 0 | 5 / 없음 |
| A / 10 | 2 / 2 | 1 → 1.6 | 1 → 1.6 | 74 | guess | 0 | 5 / 없음 |
| B / 1 | 2 / 2 | 1 → 1 | 1 → 1 | 56 | guess | 0 | 5 / 없음 |
| B / 2 | 2 / 2 | 1 → 1.6 | 1 → 1.6 | 66 | guess | 0 | 5 / 없음 |
| B / 3 | 2 / 2 | 1 → 1 | 1 → 1 | 69 | guess | 0 | 5 / 없음 |
| B / 4 | 2 / 2 | 1 → 1.6 | 1 → 1.6 | 75 | guess | 0 | 5 / 없음 |
| B / 5 | 2 / 1 | 1 → 1 | 1 → 1 | 57 | doubt | 0 | 5 / 없음 |
| B / 6 | 2 / 2 | 1 → 1.6 | 1 → 1.6 | 78 | guess | 0 | 5 / 없음 |
| B / 7 | 2 / 2 | 1 → 1.6 | 1 → 1.6 | 68 | guess | 0 | 5 / 없음 |
| B / 8 | 2 / 2 | 1 → 1.6 | 1 → 1.6 | 64 | guess | 0 | 5 / 없음 |
| B / 9 | 1 / 1 | 1 → 1 | 1 → 1 | 확인하지 못함 | doubt | 0 | 5 / 없음 |
| B / 10 | 2 / 1 | 1 → 1.6 | 1 → 1.6 | 57 | doubt | 0 | 5 / 없음 |
| C / 1 | 2 / 2 | 1 → 1.6 | 1 → 1.6 | 77 | guess | 0 | 5 / 없음 |
| C / 2 | 2 / 1 | 1 → 1.6 | 1 → 1.6 | 39 | doubt | 0 | 5 / 없음 |
| C / 3 | 2 / 3 | 1 → 1.6 | 1 → 1.6 | 44 | none | 0 | 5 / 없음 |
| C / 4 | 2 / 1 | 1 → 1.6 | 1 → 1.6 | 61 | doubt | 0 | 5 / 없음 |
| C / 5 | 2 / 2 | 1 → 1.6 | 1 → 1.6 | 74 | guess | 0 | 5 / 없음 |
| C / 6 | 2 / 2 | 1 → 1.6 | 1 → 1.6 | 75 | guess | 0 | 5 / 없음 |
| C / 7 | 2 / 2 | 1 → 1.6 | 1 → 1.6 | 56 | guess | 0 | 5 / 없음 |
| C / 8 | 2 / 1 | 1 → 1.6 | 1 → 1.6 | 83 | doubt | 0 | 4 / 없음 |
| C / 9 | 2 / 2 | 1 → 1.6 | 1 → 1.6 | 52 | guess | 0 | 5 / 없음 |
| C / 10 | 2 / 2 | 1 → 1.6 | 1 → 1.6 | 62 | guess | 0 | 5 / 없음 |
| D / 1 | 2 / 1 | 1 → 1.6 | 1 → 1.6 | 70 | doubt | 0 | 5 / 없음 |
| D / 2 | 2 / 0 | 1 → 1.6 | 1 → 1.6 | 68 | none | 0 | 5 / 없음 |
| D / 3 | 2 / 0 | 1 → 1.6 | 1 → 1.6 | 66 | none | 0 | 5 / 없음 |
| D / 4 | 2 / 0 | 1 → 1.6 | 1 → 1.6 | 59 | none | 0 | 5 / 없음 |
| D / 5 | 2 / 0 | 1 → 1.6 | 1 → 1.6 | 62 | none | 0 | 5 / 없음 |
| D / 6 | 2 / 0 | 1 → 1.6 | 1 → 1.6 | 69 | none | 0 | 5 / 없음 |
| D / 7 | 2 / 0 | 1 → 1.6 | 1 → 1.6 | 64 | none | 0 | 5 / 없음 |
| D / 8 | 2 / 0 | 1 → 1.6 | 1 → 1.6 | 82 | none | 0 | 5 / 없음 |
| D / 9 | 2 / 0 | 1 → 1.6 | 1 → 1.6 | 76 | none | 0 | 5 / 없음 |
| D / 10 | 2 / 0 | 1 → 1.6 | 1 → 1.6 | 77 | none | 0 | 5 / 없음 |
| E / 1 | 2 / 2 | 1 → 1 | 1 → 1 | 67 | guess | 0 | 5 / 없음 |
| E / 2 | 2 / 2 | 1 → 1 | 1 → 1 | 85 | guess | 0 | 5 / 없음 |
| E / 3 | 2 / 2 | 1 → 1 | 1 → 1 | 81 | guess | 0 | 5 / 없음 |
| E / 4 | 2 / 2 | 1 → 1 | 1 → 1 | 74 | guess | 0 | 5 / 없음 |
| E / 5 | 2 / 2 | 1 → 1 | 1 → 1 | 70 | guess | 0 | 5 / 없음 |
| E / 6 | 2 / 2 | 1 → 1 | 1 → 1 | 71 | guess | 0 | 5 / 없음 |
| E / 7 | 2 / 2 | 1 → 1 | 1 → 1 | 83 | guess | 0 | 5 / 없음 |
| E / 8 | 2 / 2 | 1 → 1 | 1 → 1 | 67 | guess | 0 | 5 / 없음 |
| E / 9 | 2 / 2 | 1 → 1 | 1 → 1 | 72 | guess | 0 | 5 / 없음 |
| E / 10 | 2 / 2 | 1 → 1 | 1 → 1 | 84 | guess | 0 | 5 / 없음 |
| F / 1 | 2 / 2 | 1 → 1 | 1 → 1 | 299 | guess | 0 | 8 / 없음 |
| F / 2 | 2 / 2 | 1 → 1 | 1 → 1 | 307 | guess | 0 | 7 / 없음 |
| F / 3 | 2 / 2 | 1 → 1 | 1 → 1 | 284 | guess | 0 | 8 / 없음 |
| F / 4 | 2 / 2 | 1 → 1 | 1 → 1 | 313 | guess | 0 | 8 / 없음 |
| F / 5 | 2 / 2 | 1 → 1 | 1 → 1 | 293 | guess | 0 | 8 / 없음 |
| F / 6 | 2 / 2 | 1 → 1 | 1 → 1 | 301 | guess | 0 | 8 / 없음 |
| F / 7 | 2 / 2 | 1 → 1 | 1 → 1 | 302 | guess | 0 | 8 / 없음 |
| F / 8 | 2 / 2 | 1 → 1 | 1 → 1 | 287 | guess | 0 | 8 / 없음 |
| F / 9 | 2 / 2 | 1 → 1 | 1 → 1 | 304 | guess | 0 | 8 / 없음 |
| F / 10 | 2 / 2 | 1 → 1 | 1 → 1 | 277 | guess | 0 | 7 / 없음 |
| Gkey / 1 | 2 / 2 | 1 → 1.6 | 1 → 1.6 | 32 | 답 2개 | 0 | 5 / 없음 |
| Gkey / 2 | 2 / 2 | 1 → 1 | 1 → 1 | 53 | 답 2개 | 0 | 5 / 없음 |
| Gkey / 3 | 2 / 0 | 1 → 1.6 | 1 → 1.6 | 59 | 답 0개 | 0 | 5 / 없음 |
| Gkey / 4 | 2 / 2 | 1 → 1 | 1 → 1 | 44 | 답 2개 | 0 | 5 / 없음 |
| Gkey / 5 | 2 / 2 | 1 → 1.6 | 1 → 1.6 | 36 | 답 2개 | 0 | 4 / 없음 |
| Gkey / 6 | 2 / 2 | 1 → 1 | 1 → 1 | 37 | 답 2개 | 0 | 5 / 없음 |
| Gkey / 7 | 2 / 1 | 1 → 1.6 | 1 → 1.6 | 9 | 답 1개 | 0 | 5 / 없음 |
| Gkey / 8 | 2 / 1 | 1 → 1.6 | 1 → 1.6 | 35 | 답 1개 | 0 | 5 / 없음 |
| Gkey / 9 | 2 / 2 | 1 → 1.6 | 1 → 1.6 | 73 | 답 2개 | 0 | 5 / 없음 |
| Gkey / 10 | 2 / 2 | 1 → 1.6 | 1 → 1.6 | 70 | 답 2개 | 0 | 5 / 없음 |
| Ggrade / 1 | 2 / 1 | 1 → 1.6 | 1 → 1.6 | 64 | grade-1 | 0 | 5 / 없음 |
| Ggrade / 2 | 2 / 1 | 1 → 1.6 | 1 → 1.6 | 20 | grade-1 | 0 | 5 / 없음 |
| Ggrade / 3 | 2 / 1 | 1 → 1.6 | 1 → 1.6 | 11 | grade-1 | 0 | 5 / 없음 |
| Ggrade / 4 | 2 / 1 | 1 → 1.6 | 1 → 1.6 | 49 | grade-1 | 0 | 5 / 없음 |
| Ggrade / 5 | 2 / 1 | 1 → 1 | 1 → 1 | 45 | grade-1 | 0 | 5 / 없음 |
| Ggrade / 6 | 2 / 1 | 1 → 1 | 1 → 1 | 68 | grade-1 | 0 | 5 / 없음 |
| Ggrade / 7 | 2 / 1 | 1 → 1.6 | 1 → 1.6 | 60 | grade-1 | 0 | 5 / 없음 |
| Ggrade / 8 | 2 / 1 | 1 → 1.6 | 1 → 1.6 | 65 | grade-1 | 0 | 5 / 없음 |
| Ggrade / 9 | 2 / 1 | 1 → 1.6 | 1 → 1.6 | 75 | grade-1 | 0 | 5 / 없음 |
| Ggrade / 10 | 2 / 1 | 1 → 1.6 | 1 → 1.6 | 67 | grade-1 | 0 | 5 / 없음 |
| H / 1 | 2 / 2 | 1 → 1 | 1 → 1 | 71 | guess | 2 | 5 / 없음 |
| H / 2 | 2 / 2 | 1 → 1 | 1 → 1 | 10 | guess | 2 | 5 / 없음 |
| H / 3 | 2 / 2 | 1 → 1 | 1 → 1 | 63 | guess | 2 | 5 / 없음 |
| H / 4 | 2 / 2 | 1 → 1 | 1 → 1 | 40 | guess | 2 | 5 / 없음 |
| H / 5 | 2 / 2 | 1 → 1 | 1 → 1 | 76 | guess | 2 | 5 / 없음 |
| H / 6 | 2 / 2 | 1 → 1 | 1 → 1 | 69 | guess | 2 | 5 / 없음 |
| H / 7 | 2 / 2 | 1 → 1 | 1 → 1 | 61 | guess | 2 | 5 / 없음 |
| H / 8 | 2 / 2 | 1 → 1 | 1 → 1 | 55 | guess | 2 | 5 / 없음 |
| H / 9 | 2 / 2 | 1 → 1 | 1 → 1 | 63 | guess | 2 | 5 / 없음 |
| H / 10 | 2 / 2 | 1 → 1 | 1 → 1 | 64 | guess | 2 | 5 / 없음 |
| I / 1 | 2 / 2 | 1 → 1 | 1 → 1 | 57 | guess | 2 | 5 / 없음 |
| I / 2 | 2 / 2 | 1 → 1.6 | 1 → 1.6 | 73 | guess | 2 | 5 / 없음 |
| I / 3 | 2 / 2 | 1 → 1.6 | 1 → 1.6 | 71 | guess | 2 | 5 / 없음 |
| I / 4 | 2 / 2 | 1 → 1 | 1 → 1 | 61 | guess | 2 | 5 / 없음 |
| I / 5 | 2 / 2 | 1 → 1 | 1 → 1 | 43 | guess | 2 | 5 / 없음 |
| I / 6 | 2 / 2 | 1 → 1 | 1 → 1 | 42 | guess | 2 | 5 / 없음 |
| I / 7 | 2 / 1 | 1 → 1.6 | 1 → 1.6 | 55 | doubt | 1 | 5 / 없음 |
| I / 8 | 2 / 1 | 1 → 1.6 | 1 → 1.6 | 48 | doubt | 1 | 5 / 없음 |
| I / 9 | 2 / 2 | 1 → 1 | 1 → 1 | 59 | guess | 2 | 5 / 없음 |
| I / 10 | 2 / 2 | 1 → 1 | 1 → 1 | 22 | guess | 2 | 3 / 없음 |

## 경우별 WebKit 기록

각 경우에서 한 회차를 골랐어요. 로거의 timestamp와 eventMessage를 그대로 옮겼어요. 시도 시작부터 마지막 누름 뒤 1.4초를 기다린 시각까지 같은 시뮬레이터에서 온 줄이에요.

### A, 1회차

```text
2026-11-25 15:13:36.868633+0900 Single tap identified. Request details on potential zoom. (0x105048e00, pageProxyID=11)
2026-11-25 15:13:36.873878+0900 Potential tap may cause significant zoom. Wait. (0x105048e00, pageProxyID=11)
2026-11-25 15:13:37.230184+0900 Ending potential tap. (0x105048e00, pageProxyID=11)
2026-11-25 15:13:37.230472+0900 Single tap recognized - commit potential tap (0x105048e00, pageProxyID=11)
2026-11-25 15:13:37.263849+0900 Synthetic click completed. (0x105048e00, pageProxyID=11)
```

### B, 1회차

```text
2026-11-25 15:15:17.718452+0900 Single tap identified. Request details on potential zoom. (0x106301400, pageProxyID=9)
2026-11-25 15:15:17.722101+0900 Potential tap may cause significant zoom. Wait. (0x106301400, pageProxyID=9)
2026-11-25 15:15:17.973826+0900 Ending potential tap. (0x106301400, pageProxyID=9)
2026-11-25 15:15:17.974040+0900 Single tap recognized - commit potential tap (0x106301400, pageProxyID=9)
2026-11-25 15:15:18.000492+0900 Synthetic click completed. (0x106301400, pageProxyID=9)
```

### C, 1회차

```text
2026-11-25 15:17:18.389251+0900 Single tap identified. Request details on potential zoom. (0x105825c00, pageProxyID=11)
2026-11-25 15:17:18.392499+0900 Potential tap may cause significant zoom. Wait. (0x105825c00, pageProxyID=11)
2026-11-25 15:17:18.546329+0900 Ending potential tap. (0x105825c00, pageProxyID=11)
2026-11-25 15:17:18.546495+0900 Single tap recognized - commit potential tap (0x105825c00, pageProxyID=11)
2026-11-25 15:17:18.588278+0900 Synthetic click completed. (0x105825c00, pageProxyID=11)
```

### D, 1회차

```text
2026-11-25 15:19:26.539753+0900 Single tap identified. Request details on potential zoom. (0x10700ea00, pageProxyID=11)
2026-11-25 15:19:26.544332+0900 Potential tap may cause significant zoom. Wait. (0x10700ea00, pageProxyID=11)
2026-11-25 15:19:26.705953+0900 Ending potential tap. (0x10700ea00, pageProxyID=11)
2026-11-25 15:19:26.714444+0900 Single tap recognized - commit potential tap (0x10700ea00, pageProxyID=11)
2026-11-25 15:19:26.734436+0900 Synthetic click completed. (0x10700ea00, pageProxyID=11)
```

### E, 1회차

```text
2026-11-25 15:20:56.856569+0900 Single tap identified. Request details on potential zoom. (0x106829800, pageProxyID=11)
2026-11-25 15:20:56.859808+0900 Potential tap may cause significant zoom. Wait. (0x106829800, pageProxyID=11)
2026-11-25 15:20:56.860114+0900 Ending potential tap. (0x106829800, pageProxyID=11)
2026-11-25 15:20:56.860319+0900 Single tap recognized - commit potential tap (0x106829800, pageProxyID=11)
2026-11-25 15:20:56.860980+0900 Synthetic click completed. (0x106829800, pageProxyID=11)
```

### F, 1회차

```text
2026-11-25 15:22:36.057008+0900 Single tap identified. Request details on potential zoom. (0x10702b600, pageProxyID=11)
2026-11-25 15:22:36.058462+0900 Potential tap may cause significant zoom. Wait. (0x10702b600, pageProxyID=11)
2026-11-25 15:22:36.222915+0900 Ending potential tap. (0x10702b600, pageProxyID=11)
2026-11-25 15:22:36.223300+0900 Single tap recognized - commit potential tap (0x10702b600, pageProxyID=11)
2026-11-25 15:22:36.268840+0900 Synthetic click completed. (0x10702b600, pageProxyID=11)
2026-11-25 15:22:36.494970+0900 Single tap identified. Request details on potential zoom. (0x10702b600, pageProxyID=11)
2026-11-25 15:22:36.498661+0900 Potential tap may cause significant zoom. Wait. (0x10702b600, pageProxyID=11)
2026-11-25 15:22:36.499962+0900 Ending potential tap. (0x10702b600, pageProxyID=11)
```

### Gkey, 1회차

```text
2026-11-25 15:24:13.607294+0900 Single tap identified. Request details on potential zoom. (0x106814c00, pageProxyID=11)
2026-11-25 15:24:13.610384+0900 Potential tap may cause significant zoom. Wait. (0x106814c00, pageProxyID=11)
2026-11-25 15:24:13.971842+0900 Ending potential tap. (0x106814c00, pageProxyID=11)
2026-11-25 15:24:13.972234+0900 Single tap recognized - commit potential tap (0x106814c00, pageProxyID=11)
2026-11-25 15:24:14.003989+0900 Synthetic click completed. (0x106814c00, pageProxyID=11)
```

### Ggrade, 1회차

```text
2026-11-25 15:25:55.990932+0900 Single tap identified. Request details on potential zoom. (0x102021600, pageProxyID=11)
2026-11-25 15:25:55.993938+0900 Potential tap may cause significant zoom. Wait. (0x102021600, pageProxyID=11)
2026-11-25 15:25:56.124310+0900 Ending potential tap. (0x102021600, pageProxyID=11)
2026-11-25 15:25:56.124460+0900 Single tap recognized - commit potential tap (0x102021600, pageProxyID=11)
2026-11-25 15:25:56.138812+0900 Synthetic click completed. (0x102021600, pageProxyID=11)
```

### H, 1회차

```text
2026-11-25 15:27:40.058000+0900 Single tap identified. Request details on potential zoom. (0x107031000, pageProxyID=11)
2026-11-25 15:27:40.062016+0900 Potential tap may cause significant zoom. Wait. (0x107031000, pageProxyID=11)
2026-11-25 15:27:40.287353+0900 Ending potential tap. (0x107031000, pageProxyID=11)
2026-11-25 15:27:40.287541+0900 Single tap recognized - commit potential tap (0x107031000, pageProxyID=11)
2026-11-25 15:27:40.334643+0900 Synthetic click completed. (0x107031000, pageProxyID=11)
```

### I, 1회차

```text
2026-11-25 15:29:22.108186+0900 Single tap identified. Request details on potential zoom. (0x104036400, pageProxyID=11)
2026-11-25 15:29:22.111585+0900 Potential tap may cause significant zoom. Wait. (0x104036400, pageProxyID=11)
2026-11-25 15:29:22.266454+0900 Ending potential tap. (0x104036400, pageProxyID=11)
2026-11-25 15:29:22.266638+0900 Single tap recognized - commit potential tap (0x104036400, pageProxyID=11)
2026-11-25 15:29:22.315338+0900 Synthetic click completed. (0x104036400, pageProxyID=11)
```
