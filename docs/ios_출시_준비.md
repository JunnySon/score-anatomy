# iOS 출시 준비

모고칸(저장소 score-anatomy)을 TestFlight 와 App Store 에 올리기 전에 할 일과 그 근거를 모았어요. 기준일은 2026년 11월 24일이에요. 법률 자문이 아니에요.

## 1. 결론

- 11월 28일 웹 0.3.4에서 iPhone 16(iOS 18.4와 26.4.1), iPhone 17(iOS 26.4.1) 시뮬레이터로 첫 누름 여섯 조건을 각각 10회씩 확인했어요. 180회 모두 시작과 최고 배율이 1이었고, 누른 횟수보다 입력을 많이 받은 요소는 없었어요. 앞서 iPhone 16 / iOS 18.4에서 웹 0.3.2와 0.3.3의 표시 칸을 처음 아주 빠르게 두 번 누르면 각각 10회 모두 1.6배가 됐어요. [버전별 원본과 0.3.4의 기기별 표](ios_확대_진단.md#웹-034-재측정2026-11-28)

- 0.3.4에서 표시 칸을 처음 두 번 눌렀을 때 iPhone 16 / iOS 18.4에서는 10회 중 2회가 입력 0개, 2회가 1개였어요. iPhone 17 / iOS 26.4.1도 1회가 입력 1개였어요. 11월 26일 웹 0.3.3의 전체 검증에서는 누르지 않은 지우기 버튼 입력, 마지막 빈칸의 답 4 미저장, HTML에 닿은 누름이 4번 표시 칸의 입력으로 기록되는 사례가 있었어요. 이 세 사례의 0.3.4 판정은 전체 verify에서 확인할 일이에요. [0.3.3 지우기 원본](ios_누름기록/검증-0.3.3-2026-11-26-1226/iphone16-ios18.4-key-triple-first-04.txt), [답 미저장과 4번 칸 원본](ios_확대_진단.md#1407에-다시-시작한-전체-검증)

- 세 시뮬레이터에서 0.3.4의 두 손가락 확대는 1.72~1.75배였고, 표시 칸에서 스크롤하면 본문이 330~341px 움직이며 입력은 0회였어요. 9번 칸을 0.7초 누르면 0.3.3과 0.3.4 모두 “고민”이 한 번 들어가 저장됐고, 0.3.4의 진행자 화면은 자판으로 입력한 `P01`을 표시했어요. 두 버전을 합쳐 XCTest 15건이 통과했어요. 출시 전에는 실제 아이폰에서 첫 두 번 누름, 두 손가락 확대, 버튼 위 스크롤, 길게 누름, VoiceOver로 선택한 요소의 실행을 확인해요. [기기별 제스처 결과](ios_확대_진단.md#확대-스크롤-길게-누름과-진행자-글-입력), [실기기 확인표 29~33번](ios_실기기_확인표.md#2-확인표)

- TestFlight 전: 유료 Apple Developer Program 회원이어야 TestFlight 를 쓸 수 있어요. 개인 등록은 거주 지역의 성년이어야 하고 한국의 성년은 만 19세라서, 개발자가 만 19세 미만이면 보호자 명의 등록 방법을 Apple 에 먼저 물어야 해요. https://developer.apple.com/programs/enroll/, https://www.law.go.kr/법령/민법/제4조 (확인: 2026-11-24)
- TestFlight 전: 고등학생은 외부 테스터로 초대하고, 첫 빌드는 TestFlight App Review 를 받아요. 사용권 계약에 '앱이 주로 아동 대상이면 테스터가 성년인지 확인하라'는 조항이 있어서, 이 앱이 여기에 해당하는지 테스트 전에 Apple 에 확인해야 해요. https://developer.apple.com/support/terms/apple-developer-program-license-agreement/ (확인: 2026-11-24)
- App Store 전: 개인정보 처리방침 URL 과 앱 안 처리방침, 지원 URL, 앱 개인정보 답변, 연령 등급 설문, 스크린샷이 있어야 해요. '예시' 시험만 든 빌드는 TestFlight 로만 보내고, 실제 시험의 정답과 등급컷은 출처의 이용 조건을 사람이 확인한 뒤에 넣어요. https://developer.apple.com/app-store/review/guidelines/ (확인: 2026-11-24)
- 시기: 2027년 4월부터(정확한 날짜는 아직 없음) iOS 27 SDK 로 빌드해야 해서, 그 뒤의 업데이트에는 Xcode 27 과 macOS Tahoe 26.6 이상이 필요해요. https://developer.apple.com/app-store/submitting/, https://developer.apple.com/xcode/system-requirements (확인: 2026-11-24)
- 정하지 않은 것 하나: 시험 당일 정답과 등급컷을 앱 업데이트로만 넣을지(A), 고정 주소에서 시험 데이터 파일만 받을지(B)예요. 15절에 비교만 적었어요.

## 2. 확인 방법

- **결론:** 공식 출처만 사실의 근거로 썼고, 모든 사실은 2026년 11월 24일에 확인했어요. 줄 끝의 주소가 근거예요.
- 출처는 Apple 개발자 사이트(뉴스, 도움말, 문서, 약관), apple.com 의 법률과 지원 페이지, App Store 페이지, 국가법령정보센터, 한국교육과정평가원(이하 평가원)과 대학수학능력시험 누리집, 서울특별시교육청, 인천광역시교육청, 경기도교육청 누리집, 문화체육관광부, 공공누리 누리집이에요.
- EBSi 와 메가스터디 페이지는 그 회사가 자기 등급컷과 약관에 대해 밝힌 내용에만 썼어요.
- Apple Developer Forums 의 글은 사실로 쓰지 않았어요. 16절에 '비공식 보고'로만 적었어요.
- 조사한 뒤 별도 검증을 한 번 더 했어요. 검증에서 고친 항목은 고친 내용으로 적었고, 끝내 확인하지 못한 것은 16절에 모았어요.
- '추론'이라고 표시한 부분은 출처의 사실과 앱 설명을 합친 판단이에요. '제안'이라고 표시한 부분은 이 문서의 제안이에요. 둘 다 사실이 아니에요.
- 이 문서에서 PLA 는 Apple Developer Program 사용권 계약(Apple Developer Program License Agreement)을, Beta App Review 는 Apple 도움말의 'TestFlight App Review'를 말해요.

### 전제로 한 앱 상태(앱 설명, 조사 대상 아님)

- 이름은 '모고칸'이에요(2026-11-24 에 정함. 처음 조사할 때는 '점수 해부'였어요. 웹 묶음 0.3.2 부터 시작 화면 제목과 문서 제목도 '모고칸'이고, '점수 해부'는 앱 안의 화면 이름으로 남아요). App Store Connect 에서 같은 이름이 이미 쓰이고 있는지는 확인하지 못했어요. iPhone 전용, 한국어 전용이에요.
- 고등학생(대부분 17세, 미성년)이 종이 수학 모의고사의 답을 넣고 점수를 나눠 봐요.
- Swift, SwiftUI, WKWebView 로 만든 얇은 네이티브 껍데기가 번들 안의 오프라인 단일 파일 웹 UI 를 띄워요.
- 웹뷰의 바깥 요청과 번들 밖 이동을 막아요. 규격 2 껍데기는 받는 주소와 공개 키를 설정한 빌드에서만 서명된 시험 자료를 받아요. 지금 Release에는 두 값이 없어요.
- 계정, 분석, 광고, 권한 요청이 없어요. 기록은 기기 안 파일에 남고 일반 기기 백업에 들어가며, 서버로 가지 않아요.
- 최소 iOS 18.0 이고(작업 지시서 4에서 17.0 에서 올렸어요. iOS 17 런타임을 이 Xcode 로 받을 수 없어 확인할 방법이 없었고, iOS 18 은 iOS 17 이 돌던 기종 전부에서 돌아요), Xcode 26.4.1 과 iOS 26.4 SDK 로 빌드해요.
- 지금 빌드에는 '예시' 표시가 붙은 가짜 정답의 샘플 시험만 있어요. 개인정보 처리방침 화면은 없어요.
- 첫 실제 사용(2027년 3월 모의고사) 전에 고등학생 8~10명과 사용성 테스트를 할 계획이에요.

### 다시 확인하는 법

- 업로드할 때마다 Upcoming Requirements, Submitting 페이지, 개발자 뉴스를 열어 2027년 4월 요건의 정확한 날짜가 올라왔는지 봐요. https://developer.apple.com/news/upcoming-requirements/, https://developer.apple.com/app-store/submitting/ (확인: 2026-11-24)
- App Review Guidelines 하단의 Last Updated(지금 2026년 10월 16일)와 PLA 하단의 날짜(지금 2026년 10월 29일)가 바뀌었는지 봐요. 바뀌었으면 이 문서에서 그 조항을 인용한 줄을 다시 읽어요. https://developer.apple.com/app-store/review/guidelines/, https://developer.apple.com/support/terms/apple-developer-program-license-agreement/ (확인: 2026-11-24)
- 가이드라인 개정 뉴스에는 바뀐 조항 목록이 있어요. 2026년 10월 16일 개정에서는 Before You Submit, 1.2, 2.3.14, 2.5.19, 3.1.1(a), 5, After You Submit 이 바뀌었고, 이 문서가 많이 인용한 5.1.1, 1.5, 2.1(a)는 목록에 없어요. https://developer.apple.com/news/?id=92th7e5i (확인: 2026-11-24)
- App Store Connect 화면과 도움말이 다르면 화면을 따르고, 다른 점을 이 문서에 적어요.
- 법령은 국가법령정보센터 현행 본문의 시행일을 봐요. 저작권법은 2026년 10월 29일 시행본(법률 제21595호), 민법은 2026년 3월 17일 시행본(법률 제21454호)으로 확인했어요. https://www.law.go.kr/법령/저작권법/제7조, https://www.law.go.kr/법령/민법/제4조 (확인: 2026-11-24)
- 평가원과 교육청 게시판은 시험마다 고지 문구와 공공누리 표시를 다시 봐요.
- 다시 확인한 줄은 끝의 확인 날짜를 그날로 고쳐요.

## 3. 올릴 때 필요한 Xcode 와 SDK

- **결론:** 지금 환경(Xcode 26.4.1, iOS 26.4 SDK, 최소 iOS 18.0)은 현재 업로드 요건을 충족해요(추론). 2027년 4월부터는 iOS 27 SDK 가 필요해요. https://developer.apple.com/news/upcoming-requirements/, https://developer.apple.com/app-store/submitting/ (확인: 2026-11-24)

### 지금 요건

- 2026년 4월 28일부터 App Store Connect 에 올리는 앱은 Xcode 26 이상과 iOS 26 SDK 로 빌드해야 해요. 2026년 9월 9일부터 iOS 앱의 최소 배포 대상은 iOS 13 이상이어야 해요. https://developer.apple.com/news/upcoming-requirements/ (확인: 2026-11-24)
- 같은 페이지에는 2027년 요건이 아직 없어요. https://developer.apple.com/news/upcoming-requirements/ (확인: 2026-11-24)
- 함께 적용되는 요건도 있어요. 2024년 5월 1일부터 required reason API 를 쓰면 승인된 사유를 매니페스트에 적어야 올릴 수 있고, 2026년 1월 31일부터는 새 연령 등급 질문에 답해야 업데이트 제출이 끊기지 않아요. https://developer.apple.com/news/upcoming-requirements/ (확인: 2026-11-24)
- 추론: TestFlight 빌드도 App Store Connect 에 올려서 배포하므로 같은 요건이 적용돼요. https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview (확인: 2026-11-24)

### 2027년 4월 요건

- 2027년 4월부터 올리는 iOS, iPadOS 앱은 iOS & iPadOS 27 SDK 이상으로 빌드하고 iOS 15 이상을 대상으로 해야 해요. 정확한 날짜는 없고, Xcode 27 로 빌드하고 테스트하라고 권해요. https://developer.apple.com/app-store/submitting/ (확인: 2026-11-24)
- 2026년 9월 9일 개발자 뉴스도 같은 2027년 4월 SDK 요건을 적었어요. 이 뉴스에는 iOS 15 대상 문구가 없어요. https://developer.apple.com/news/?id=k1mtkt1k (확인: 2026-11-24)
- 2026년 10월 5일 뉴스는 2027년 4월부터 제출하는 모든 앱과 게임에 iPhone Duo 스크린샷이 필요하다고 공지했어요. 스크린샷 사양 도움말은 같은 시기부터 'iOS 27.1 SDK 이상을 쓰는 앱'에 필요하다고 적어서 범위가 달라요. https://developer.apple.com/news/?id=kkphp5qo, https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications (확인: 2026-11-24)

### Xcode 와 Mac

- Xcode 26.4.1 은 iOS 26.4 SDK 를 포함하고, macOS Tahoe 26.2~26.x 에서 돌아가며, 배포 대상 iOS 15~26.4 를 지원해요. https://developer.apple.com/xcode/system-requirements (확인: 2026-11-24)
- Xcode 27 은 iOS 27 SDK 를 포함하고 macOS Tahoe 26.6 이상이 필요해요. 배포 대상은 iOS 15~27 이고, 실기기 설치와 디버깅은 iOS 17 이상이에요. https://developer.apple.com/xcode/system-requirements (확인: 2026-11-24)
- 같은 표의 최신은 Xcode 27.2(정식)와 Xcode 27.3 beta 2 이고, 26 계열의 최신은 Xcode 26.6(iOS 26.5 SDK)이에요. https://developer.apple.com/xcode/system-requirements (확인: 2026-11-24)
- 2026년 9월 9일 뉴스는 macOS 26 이 Intel Mac 을 지원하는 마지막 버전이고 macOS 27 은 Apple silicon 전용이라고 적었어요. https://developer.apple.com/news/?id=k1mtkt1k (확인: 2026-11-24)
- App Store Connect 릴리스 노트에는 Xcode 27.x 로 만든 빌드의 TestFlight 업로드를 받는다는 공지가 있어요(2026년 11월 16일 등). https://developer.apple.com/help/app-store-connect/release-notes/ (확인: 2026-11-24)

### iOS 27 SDK 로 다시 빌드하면 바뀌는 것

- 최신 SDK 로 빌드한 앱은 scene 기반 생명주기(UIScene)를 채택하지 않으면 실행되지 않아요. https://developer.apple.com/documentation/ios-ipados-release-notes/ios-ipados-27-release-notes.md, https://developer.apple.com/videos/play/wwdc2026/278/ (확인: 2026-11-24)
- iOS 27 의 크기 조절 환경에서는 지원 방향 설정이 무시되고, UIRequiresFullScreen 은 크기 조절을 끄지 않고 단계적 크기 조절로 바뀌어요. https://developer.apple.com/documentation/ios-ipados-release-notes/ios-ipados-27-release-notes.md, https://developer.apple.com/videos/play/wwdc2026/278/ (확인: 2026-11-24)
- iOS 26 SDK 이하로 빌드한 앱도 iPhone Duo 에서 돌아가지만, 펼친 화면에서는 가운데에 놓이고 둘레가 비어요. iOS 27 SDK 빌드는 안쪽 화면 대부분을 채우고, iOS 27.1 SDK 이상은 iPhone Duo 에 맞춰져요. https://developer.apple.com/iphone-duo/prepare/ (확인: 2026-11-24)

### 이 앱에 적용하면

- 추론: 2027년 3월 말까지 올리는 빌드는 지금 환경으로 돼요. 2027년 4월 이후의 업데이트와 새 TestFlight 빌드에는 Xcode 27 계열이 필요하고, Mac 이 macOS Tahoe 26.6 이상을 돌려야 해요. https://developer.apple.com/app-store/submitting/, https://developer.apple.com/xcode/system-requirements (확인: 2026-11-24)
- 추론: 최소 iOS 18.0 은 2027년 4월의 iOS 15 대상 조건과 Xcode 27 의 실기기 지원(iOS 17 이상) 안에 있어요. https://developer.apple.com/xcode/system-requirements (확인: 2026-11-24)
- 제안: Xcode 27 로 언제 옮길지는 사람이 정해요. 옮기기 전에 앱이 UIScene 생명주기를 쓰는지, 방향 고정 같은 설정이 있는지 확인해요.

## 4. 개발자 계정 조건

- **결론:** TestFlight 와 App Store 배포에는 유료 Apple Developer Program 이 필요해요. 개인 등록은 거주 지역의 성년이어야 하고, 한국의 성년은 만 19세예요. https://developer.apple.com/help/account/basics/about-your-developer-account/, https://developer.apple.com/programs/enroll/, https://www.law.go.kr/법령/민법/제4조 (확인: 2026-11-24)

### 나이와 명의

- 개인(또는 1인 사업자)으로 등록하려면 이중 인증이 켜진 Apple 계정이 있어야 하고 거주 지역의 법적 성년이어야 해요. https://developer.apple.com/programs/enroll/ (확인: 2026-11-24)
- 성년 미만이면 부모나 보호자가 자기 Apple 계정으로 등록한 뒤 그 계정을 공유해 줄 수 있다고 하고, 자세한 것은 Apple 에 문의하라고 해요. https://developer.apple.com/programs/enroll/ (확인: 2026-11-24)
- PLA 3.1 도 거주 지역의 법적 성년(많은 국가에서 18세 이상)을 요구해요. PLA 하단의 최종 개정일은 2026년 10월 29일이에요. https://developer.apple.com/support/terms/apple-developer-program-license-agreement/ (확인: 2026-11-24)
- 민법 제4조는 사람은 19세로 성년이 된다고 정해요(법률 제21454호, 2026년 3월 17일 시행). https://www.law.go.kr/법령/민법/제4조 (확인: 2026-11-24)
- 민법 제158조는 나이를 출생일을 넣어 만 나이로 세요. 그래서 성년은 만 19세예요. https://www.law.go.kr/LSW/lsInfoR.do?lsiSeq=284415 (확인: 2026-11-24)
- 추론: 개발자가 만 19세 미만이면 본인 명의 개인 등록은 안 되고 보호자 등록 경로가 필요해요. https://developer.apple.com/programs/enroll/ (확인: 2026-11-24)
- 개인으로 등록하면 법적 이름이 App Store 의 판매자 이름으로 보여요. 별칭, 닉네임, 회사명을 쓰면 승인이 늦어질 수 있어요. 법적 이름이 한국어면 로마자 표기도 내야 해요. https://developer.apple.com/kr/programs/enroll/ (확인: 2026-11-24)
- 추론: 보호자 명의로 등록하면 보호자의 법적 이름이 판매자로 보여요. https://developer.apple.com/kr/programs/enroll/ (확인: 2026-11-24)
- 개인 계정은 App Store Connect 접근 권한을 추가 사용자 최대 50명에게 줄 수 있지만, 이들은 App Store Connect 에만 들어가고 팀 구성원 혜택은 받지 않아요. https://developer.apple.com/help/app-store-connect/manage-your-team/add-and-edit-users (확인: 2026-11-24)
- 조직으로 등록하려면 Apple 과 계약할 수 있는 법인, D-U-N-S 번호, 법적 구속 권한, 조직 도메인의 업무용 이메일, 공개 웹사이트가 필요하고, 조직명이 판매자로 보여요. 1인 사업자는 개인으로 등록해요. https://developer.apple.com/help/account/membership/program-enrollment/ (확인: 2026-11-24)

### 비용과 결제

- 회비는 멤버십 1년에 미화 99달러예요. 지역마다 가격이 다를 수 있고 등록하는 중에 현지 통화로 보여요. https://developer.apple.com/programs/enroll/ (확인: 2026-11-24)
- 대한민국 App Store 의 Apple Developer 앱 페이지에는 앱 내 구입 'Apple Developer Program'이 129,000원으로 보여요. 이 앱은 iOS 26.0 이상이 필요해요. https://apps.apple.com/kr/app/apple-developer/id640199958 (확인: 2026-11-24)
- 웹 등록은 해당되면 지역 세율로 과세되고, 지역 Apple Store Online 이 개발자 상품을 팔지 않으면 USD 로 결제하는 신용카드 양식이 나와요. 웹 등록의 원화 가격과 부가세 포함 여부는 공식 페이지에 없어요. https://developer.apple.com/help/account/membership/program-enrollment/ (확인: 2026-11-24)
- 학생 전용 개발자 프로그램은 없고, 학생 할인을 묻는 질문의 답에도 할인은 없어요. 회비 면제는 비영리 단체, 인가된 교육기관, 정부 기관이 신청하는 거예요. https://developer.apple.com/help/account/membership/program-enrollment/, https://developer.apple.com/programs/enroll/ (확인: 2026-11-24)
- 웹에서 개인으로 등록하며 신용카드로 내면 본인 명의 카드를 써야 해요. 아니면 등록이 늦어지고 정부 발급 사진 신분증 사본을 요구받아요. https://developer.apple.com/help/account/membership/program-enrollment/ (확인: 2026-11-24)
- 추론: 보호자 명의로 등록하면 보호자 본인 카드로 내야 해요. https://developer.apple.com/help/account/membership/program-enrollment/ (확인: 2026-11-24)
- Apple Developer 앱으로 등록하면 취소할 때까지 매년 자동 갱신되는 구독이 돼요. 일부 지역에서만 되고, Touch ID, Face ID 또는 암호가 켜진 iPhone, iPad(또는 T2 칩이 있는 Mac 이나 Apple silicon Mac)와 운전면허증이나 정부 발급 사진 신분증 촬영 인증이 필요해요(대부분 지역은 여권도 돼요). https://developer.apple.com/help/account/membership/enrolling-in-the-app/ (확인: 2026-11-24)
- 앱 등록은 Apple 계정 잔액(기프트 카드)으로 낼 수 없어요. 갱신일 하루 전까지 해지할 수 있고, 해지한 해의 회비는 환불되지 않아요. https://developer.apple.com/help/account/membership/enrolling-in-the-app/ (확인: 2026-11-24)
- 웹 등록의 자동 갱신은 일부 지역에서만 되는데, 그 목록(30곳)에 대한민국이 없어요. 웹으로 등록하면 만료 30일 전부터 직접 갱신해야 해요. https://developer.apple.com/help/account/membership/renewal/ (확인: 2026-11-24)
- 멤버십이 끝나면 App Store 에서 앱을 더 내려받을 수 없고, 새 앱과 업데이트를 낼 수 없으며, Certificates, Identifiers & Profiles 에도 들어갈 수 없어요. 이미 설치한 앱은 계속 돌아가요. 갱신하면 무료 앱은 24시간 안에 다시 제공되고 다시 제출할 필요는 없어요. https://developer.apple.com/help/account/membership/renewal/ (확인: 2026-11-24)

### 무료 계정의 한계

- 멤버십 없이 Apple 계정만으로 Xcode, 문서, 샘플 코드, 포럼, Feedback Assistant 를 쓰고 내 기기에서 앱을 테스트할 수 있어요. 앱 배포, 베타 소프트웨어, Siri, Apple Pay, iCloud 같은 기능에는 등록이 필요해요. https://developer.apple.com/help/account/membership/program-enrollment/ (확인: 2026-11-24)
- 무료 등록 계정은 App Store Connect, TestFlight, Xcode Cloud 를 쓸 수 없어요. https://developer.apple.com/help/account/basics/about-your-developer-account/ (확인: 2026-11-24)
- 무료 계정은 Xcode 에서 Personal Team 으로 보여요. 앱 ID 최대 10개(7일 뒤 만료), 기기 최대 3대(7일 뒤 만료), 기기당 앱 최대 3개이고, 기기 설치용 프로비저닝 프로파일은 발급 7일 뒤 만료돼서 다시 빌드하고 설치해야 해요. https://developer.apple.com/help/account/basics/about-your-developer-account/ (확인: 2026-11-24)
- 무료 계정은 Push notifications, iCloud(CloudKit), Sign in with Apple, In-App Purchase 같은 기능을 쓸 수 없어요. https://developer.apple.com/help/account/reference/supported-capabilities-ios (확인: 2026-11-24)
- 개인으로 등록하면 Personal Team 이 개인 팀(individual team)으로 바뀌고, 프로그램을 떠나면 다시 Personal Team 으로 돌아가요. https://help.apple.com/xcode/mac/current/en.lproj/dev17411c009.html (확인: 2026-11-24)
- 무료 Apple Developer 등록(Apple Developer Agreement)은 13세 이상이면 돼요. 개발자 프로필과 베타(사전 출시) 소프트웨어 접근은 성년이어야 하고, 13세 이상 성년 미만은 부모나 법정 보호자의 감독 아래 그 계정을 공유받아 베타에 접근할 수 있어요. https://developer.apple.com/support/downloads/terms/apple-developer-agreement/Apple-Developer-Agreement-20250318-English.pdf (확인: 2026-11-24)
- 같은 계약 1조는 개발자 계정의 Apple 계정과 비밀번호를 누구와도 공유하지 말라고도 적어요. https://developer.apple.com/support/downloads/terms/apple-developer-agreement/Apple-Developer-Agreement-20250318-English.pdf (확인: 2026-11-24)
- Xcode 로 iPhone 에서 실행하려면 기기의 개발자 모드를 켜야 해요(설정의 개인정보 보호 및 보안에서 켜고 재시동). 이 스위치는 Mac 과 페어링을 시작했거나 페어링한 적이 있는 기기에만 보여요. 개발자 모드는 App Store 설치나 TestFlight 참여에는 영향이 없어요. https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device (확인: 2026-11-24)
- 회원은 Ad Hoc 배포용 기기를 제품군마다 멤버십 연도당 100대까지 등록할 수 있어요. 비활성화해도 한도는 늘지 않아요. https://developer.apple.com/help/account/devices/devices-overview/ (확인: 2026-11-24)
- PLA 7.3 은 Ad Hoc 배포를 회사, 조직, 교육기관, 그룹 안이나 이와 관련된 개인의 등록 기기로 한정해요. https://developer.apple.com/support/terms/apple-developer-program-license-agreement/ (확인: 2026-11-24)
- 추론: 학생 8~10명 사용성 테스트를 Personal Team 으로 하면 기기 3대 한도와 7일 만료에 걸리고, 학생 기기마다 Mac 페어링과 개발자 모드가 필요해요. https://developer.apple.com/help/account/basics/about-your-developer-account/ (확인: 2026-11-24)

## 5. TestFlight 조건

- **결론:** 고등학생은 외부 테스터로 초대하고, 첫 빌드는 TestFlight App Review 를 받아요. 미성년 테스터에 관한 가장 중요한 질문, 곧 이 앱이 PLA 7.4 의 '주로 아동 대상'인지는 확인되지 않았어요. https://developer.apple.com/support/terms/apple-developer-program-license-agreement/, https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview (확인: 2026-11-24)

### 내부 테스터와 외부 테스터

- 내부 테스터는 내 App Store Connect 계정에 속한 사용자만 될 수 있고 최대 100명이에요. 이메일 초대를 TestFlight 앱에서 수락하고, 모든 빌드를 90일 동안 테스트해요. 내부 테스터 도움말에는 심사 이야기가 없어요. https://developer.apple.com/help/app-store-connect/test-a-beta-version/add-internal-testers (확인: 2026-11-24)
- App Store Connect 사용자 초대는 보내고 3일이 지나면 만료되고, 다시 보낼 수 있어요. https://developer.apple.com/help/app-store-connect/manage-your-team/add-and-edit-users (확인: 2026-11-24)
- PLA 7.4 는 TestFlight 내부 배포를 승인된 개발자나 '회사나 조직의 구성원인' App Store Connect 사용자에게, 내부 테스트, 평가, 개발 목적으로만 허용해요. https://developer.apple.com/support/terms/apple-developer-program-license-agreement/ (확인: 2026-11-24)
- 추론: 학생을 App Store Connect 사용자로 넣어 내부 테스터로 쓰는 방식은 이 조건과 맞지 않을 수 있어요. 학생은 외부 테스터로 초대하는 쪽이 약관에 맞아요. https://developer.apple.com/support/terms/apple-developer-program-license-agreement/ (확인: 2026-11-24)
- 외부 테스터는 App Store Connect 사용자가 아닌 사람이고, 앱당 최대 10,000명을 이메일이나 공개 링크로 초대해요. 외부 그룹을 만들려면 내부 그룹이 먼저 있어야 해요. Xcode 에서 'TestFlight Internal Only'로 올린 빌드는 내부 그룹에만 넣을 수 있어요. https://developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers (확인: 2026-11-24)

### TestFlight App Review

- 외부 그룹에 처음 넣는 빌드는 App Review 로 가서 가이드라인 준수를 확인받고, 승인돼야 테스트를 시작할 수 있어요. 심사는 첫 빌드(한국어 도움말은 '버전의 첫 번째 빌드')에만 필수이고, 같은 버전의 이후 빌드는 전체 심사가 필요 없을 수 있어요. https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview (확인: 2026-11-24)
- 24시간 안에 최대 6개 빌드를 TestFlight App Review 에 낼 수 있고, 버전마다 한 번에 한 빌드만 심사 중일 수 있어요. 거절되면 빌드 상태가 Rejected 가 돼요. https://developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers (확인: 2026-11-24)
- 가이드라인 2.2 는 베타 빌드의 중요한 업데이트를 테스터에게 주기 전에 TestFlight App Review 에 내라고 해요. PLA 6.5 도 중대한 변경이 있으면 Apple 에 알리고 다시 심사를 받으라고 하고, Apple 은 언제든 TestFlight 배포 중단을 요구할 수 있어요. https://developer.apple.com/app-store/review/guidelines/, https://developer.apple.com/support/terms/apple-developer-program-license-agreement/ (확인: 2026-11-24)
- 외부 배포에는 테스트 정보가 필요해요. 베타 앱 설명은 필수이고, 피드백 이메일은 테스터가 TestFlight 앱에서 연락하는 주소이자 초대 메일의 회신 주소예요. App Store 정보와 달라도 되고 언제든 고칠 수 있어요. https://developer.apple.com/help/app-store-connect/test-a-beta-version/provide-test-information (확인: 2026-11-24)
- 베타 앱 설명과 베타 앱 심사 정보가 있어야 외부 테스터와 공유할 수 있어요. https://developer.apple.com/testflight/ (확인: 2026-11-24)
- TestFlight App Review 에 걸리는 시간은 읽은 공식 페이지 어디에도 없어요(16절). https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview (확인: 2026-11-24)

### 설치와 빌드 유효 기간

- 테스터는 먼저 무료 TestFlight 앱을 설치하고, 초대 이메일이나 공개 링크로 수락해 앱을 설치해요. 피드백과 업데이트도 TestFlight 에서 해요. https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview (확인: 2026-11-24)
- 각 빌드는 올린 날부터 최대 90일 동안 테스트할 수 있고, 그 뒤에는 열 수 없어요. 남은 날짜는 TestFlight 앱의 앱 이름 아래에 보여요. https://testflight.apple.com/ (확인: 2026-11-24)
- 개발자가 Expire Build 를 누르면 내부, 외부 테스터 모두 그 빌드를 설치할 수 없어요. https://developer.apple.com/help/app-store-connect/test-a-beta-version/stop-testing-a-build (확인: 2026-11-24)
- 테스터는 최대 30대 기기에 설치할 수 있고, iPhone 은 iOS 16 이상이어야 해요. https://testflight.apple.com/ (확인: 2026-11-24)
- 한국 App Store 의 TestFlight 앱은 무료, 연령 등급 12+, iOS 16.0 이상이에요. 이것은 앱의 등급이지 테스터 자격 요건이 아니에요. https://apps.apple.com/kr/app/testflight/id899247664 (확인: 2026-11-24)
- 추론: 이 앱의 최소 iOS 가 18.0 이라서 테스터 iPhone 은 iOS 18 이상이어야 해요. 사용성 테스트는 빌드를 올린 날부터 90일 안에 끝내야 해요. https://testflight.apple.com/ (확인: 2026-11-24)

### 공개 링크

- 공개 링크는 '누구나 참여(Open to Anyone)'나 '기준으로 필터(Filter by Criteria)'로 만들고, 들어올 인원을 1~10,000명으로 제한할 수 있어요. 링크는 누구나 다시 공유할 수 있어서 직접 초대하지 않은 사람도 들어올 수 있고, 언제든 끌 수 있어요. https://developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers (확인: 2026-11-24)
- 공개 링크로 들어온 테스터는 App Store Connect 에 이름과 이메일 없이 익명으로 보이고, 설치일, 세션, 충돌 정보는 보여요. https://developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers (확인: 2026-11-24)

### 미성년 테스터: 확인된 것

- TestFlight 약관(표시 날짜 2023년 6월 21일)은 13세 미만, 또는 해당 지역의 최소 연령 미만은 TestFlight 를 쓸 수 없다고 해요. 13세 이상 18세 미만은 부모나 보호자와 약관을 함께 검토해 둘 다 이해하고 동의하는지 확인해야 한다(영문은 should)고 적지만, 따로 정한 동의 절차는 없어요. https://www.apple.com/legal/internet-services/itunes/testflight/ (확인: 2026-11-24)
- 한국어판 TestFlight 약관도 같은 연령 문구를 쓰고, 13~18세 부분을 '이해하고 동의하여야 합니다'로 옮겨 영문보다 강해요. 한국의 연령 숫자를 따로 정하지는 않아요. https://www.apple.com/legal/internet-services/itunes/testflight/kr/terms.html (확인: 2026-11-24)
- TestFlight 약관은 해당 지역의 Apple 미디어 서비스 약관을 참조로 넣어요. 대한민국 Apple 미디어 서비스 이용 약관(최종 업데이트 2026년 9월 14일)은 계정을 만들고 Apple 서비스를 쓰려면 14세 이상이어야 한다고 적어요. 같은 문단에 13세 기준 문장도 섞여 있어요. https://www.apple.com/legal/internet-services/itunes/kr/terms.html (확인: 2026-11-24)
- 대한민국에서 만 14세 미만은 부모나 보호자의 도움과 동의 없이 Apple 계정을 만들 수 없고 가족 공유 그룹에 속해야 해요. https://support.apple.com/ko-kr/126787 (확인: 2026-11-24)
- 예약된 도메인에서 만든 관리형 Apple 계정(Apple School Manager, Apple Business)으로는 빌드를 테스트할 수 없어요. https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview (확인: 2026-11-24)
- PLA 7.4 는 앱이 주로 아동을 대상으로 하면 개발자가 베타 테스터가 해당 지역의 성년인지 확인해야 한다고 정해요. 테스터에게 어떤 요금도 받을 수 없어요. https://developer.apple.com/support/terms/apple-developer-program-license-agreement/ (확인: 2026-11-24)
- PLA 7.4 는 이메일이나 공개 링크로 초대하고 연락하는 데 필요한 동의를 받을 책임을 개발자에게 두고, 테스터 이메일을 쓸 적법한 근거를 보증하게 하며, 연락 중단 요청에는 바로 따르라고 해요. https://developer.apple.com/support/terms/apple-developer-program-license-agreement/ (확인: 2026-11-24)
- TestFlight 개발자 문서, testflight.apple.com, TestFlight 개인정보 페이지에는 테스터 최소 연령, 미성년자, 부모 동의, 가족 공유 자녀 계정에 관한 규정이 없어요. https://testflight.apple.com/, https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview (확인: 2026-11-24)
- TestFlight 로 테스트하면 충돌 로그와 사용 정보가 Apple 에 자동 수집돼 개발자와 공유되고, 이름과 이메일이 들어갈 수 있으며, 테스터는 이 수집을 거부할 수 없어요. 공개 링크로만 수락하면 이름과 이메일은 개발자에게 보이지 않아요. 개발자는 이 정보를 제3자와 공유할 수 없고, Apple 은 베타 피드백을 1년 보관해요. https://www.apple.com/legal/privacy/data/ko/test-flight/, https://www.apple.com/legal/privacy/data/en/test-flight/ (확인: 2026-11-24)
- TestFlight 약관상 테스터는 베타 앱 평가나 의견에 대한 보상을 받지 않는 데 동의하고, 공개되지 않은 베타 앱과 그 사용 내용을 베타 앱이 없는 사람과 공유하지 않는 데 동의해요. https://www.apple.com/legal/internet-services/itunes/testflight/ (확인: 2026-11-24)
- 가이드라인 2.2 는 TestFlight 를 쓰는 앱을 어떤 종류의 대가와 교환하는 방식으로도 테스터에게 배포할 수 없다고 해요. 한국어판은 '그 어떤 종류의 보상이나 대가도 제공해서는 안 됩니다'로 옮겨 뉘앙스가 달라요. https://developer.apple.com/app-store/review/guidelines/, https://developer.apple.com/kr/app-store/review/guidelines/ (확인: 2026-11-24)

### 미성년 테스터: 확인되지 않은 것

- 고등학생 대상인 이 앱이 PLA 7.4 의 '주로 아동 대상'인지 판단할 기준이 약관에 없어요. 해당한다면 테스터가 한국 성년(만 19세)이어야 하므로 17세 학생은 테스터가 될 수 없어요(추론). https://developer.apple.com/support/terms/apple-developer-program-license-agreement/ (확인: 2026-11-24)
- TestFlight 에 대한 한국의 최소 연령 숫자(13세인지 14세인지)를 직접 적은 공식 문구는 없어요. 17세 학생은 어느 기준이든 넘어요. https://www.apple.com/legal/internet-services/itunes/testflight/kr/terms.html (확인: 2026-11-24)
- 미성년자가 App Store Connect 사용자(내부 테스터)가 될 수 있는지는 사용자 추가 도움말에 연령 언급이 없어요. https://developer.apple.com/help/app-store-connect/manage-your-team/add-and-edit-users (확인: 2026-11-24)
- 테스트에 참가한 학생에게 간식이나 상품권 같은 사례를 주는 것이 2.2 의 대가에 해당하는지 Apple 의 공식 설명이 없어요. https://developer.apple.com/app-store/review/guidelines/ (확인: 2026-11-24)
- 제안: 테스트 전에 PLA 7.4 해석을 Apple 에 묻고 답을 보관해요. 학생과 보호자에게는 TestFlight 약관의 보호자 검토, Apple 의 충돌 로그와 사용 정보 수집, 베타 비공개 의무, 연락 동의를 알리는 안내문을 줘요. 사례를 줄지는 그 답을 본 뒤 사람이 정해요.
- 제안: 공개 링크는 개발자가 학생 이름과 이메일을 받지 않는 장점이 있고, 링크가 퍼질 수 있는 단점이 있어요. 인원을 10명 안팎으로 제한하고 테스트 뒤 끄는 방법이 있어요. 이메일 초대와 공개 링크 중 무엇을 쓸지는 사람이 정해요.

## 6. 개인정보 처리방침 링크

- **결론:** 데이터를 모으지 않아도 처리방침이 필요해요. App Store Connect 에 URL 을 넣고, 앱 안에서도 쉽게 볼 수 있어야 해요. 지금 앱에는 처리방침 화면이 없어요(앱 설명). https://developer.apple.com/app-store/review/guidelines/ (확인: 2026-11-24)

### 규칙

- 가이드라인 5.1.1(i)은 모든 앱이 처리방침 링크를 App Store Connect 메타데이터 필드와 앱 안, 두 곳에 쉽게 찾을 수 있게 넣어야 한다고 해요. 데이터를 모으지 않는 앱의 예외 문구는 없어요. https://developer.apple.com/app-store/review/guidelines/ (확인: 2026-11-24)
- 처리방침에는 모으는 데이터가 있다면 무엇인지, 어떻게 모으는지, 모든 용도를 적어요. 데이터를 공유하는 제3자가 같은 수준으로 보호하는지, 보존과 삭제 정책, 동의 철회나 삭제 요청 방법도 적어요. https://developer.apple.com/app-store/review/guidelines/ (확인: 2026-11-24)
- 가이드라인 5.1.4 는 미성년자에게서 개인정보를 모으거나 보내거나 공유할 수 있는 앱에 처리방침과 아동 개인정보 법령 준수를 요구해요. https://developer.apple.com/app-store/review/guidelines/ (확인: 2026-11-24)
- Privacy Policy URL 은 iOS 와 macOS 앱에 필수예요. 다른 도움말은 '모든 앱에 필수'라고 적어요. https://developer.apple.com/help/app-store-connect/reference/app-information/app-and-compliance-information, https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy/ (확인: 2026-11-24)
- 처리방침 URL 은 누구나 열 수 있는 공개 주소여야 해요. https://developer.apple.com/app-store/app-privacy-details/ (확인: 2026-11-24)
- Privacy Policy URL 은 필수이고 현지화할 수 있지만, 새 버전 없이 언제든 고칠 수 있는 항목은 아니에요. URL 을 바꾸면 다음 앱 버전과 함께 반영돼요. https://developer.apple.com/help/app-store-connect/reference/app-information/required-localizable-and-editable-properties, https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy/ (확인: 2026-11-24)
- 넣는 곳은 Apps 에서 앱 선택, 사이드바 App Privacy, Privacy Policy 옆 Edit 이에요. 필요한 역할은 Account Holder, Admin, App Manager, Marketing 이에요. https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy/ (확인: 2026-11-24)
- 가이드라인 2.1(a)는 URL 이 모두 제대로 작동해야 하고 빈 웹사이트는 제출 전에 없애라고 해요. https://developer.apple.com/app-store/review/guidelines/ (확인: 2026-11-24)
- 확인하지 못함: 네트워크를 막은 앱에서 앱 안 처리방침 화면(웹 주소가 아닌 글)만으로 '앱 안 링크'가 채워지는지 공식 문구가 없어요. https://developer.apple.com/app-store/review/guidelines/ (확인: 2026-11-24)

### 제안

- 제안 1(스토어용): 오래 바꾸지 않을 주소에 정적 처리방침 페이지를 올려요. 예를 들면 이 저장소의 GitHub Pages 페이지예요. 이 주소를 Privacy Policy URL 에 넣어요. 주소를 바꾸면 다음 앱 버전이 나와야 반영되니(위 규칙) 처음부터 오래 쓸 주소를 골라요.
- 제안 2(앱 안): 같은 글을 앱 안에서 네트워크 없이 보여 줘요. 길은 둘이에요.
  - 웹 번들 안 화면: 단일 파일 웹 UI 에 '개인정보 처리방침' 화면을 더해요. 웹 쪽 변경이에요. 화면과 디자인이 한곳에 모여요.
  - 껍데기의 네이티브 화면: SwiftUI 화면을 더하고 껍데기에서 열어요. 웹 UI 와 따로 관리할 수 있고, 10절의 4.2 대응에서 작은 네이티브 기능이 돼요(추론).
  - 어느 쪽이든 정적 페이지와 같은 글, 같은 시행일을 쓰고, 둘을 함께 고치는 규칙을 둬요.
- 제안 3(앱에서 Safari 로 열기)의 장단점:
  - 장점: 늘 최신 글을 보여 주고, '링크'라는 문구에 가장 가까워요.
  - 단점: 그 순간 인터넷이 필요해요. 사용자가 앱 밖으로 나가요. 지금 껍데기는 번들 밖 이동을 취소하므로, 링크를 Safari 로 넘기는 네이티브 처리를 새로 만들어야 해요. '네트워크가 전혀 없다'는 설명을 '앱 스스로는 네트워크를 쓰지 않는다'로 고쳐야 할 수 있어요(추론).
  - 함께 쓰는 방법: 앱 안에 전문을 보여 주고, 그 아래에 주소를 글자로 적어 둬요. Safari 버튼을 둘지는 사람이 정해요.
- 제안: 처리방침에 넣을 내용
  - 개인정보를 모으거나 보내지 않는다는 것.
  - 기록은 기기 안 파일에만 있고, 일반 기기 백업에 들어갈 수 있다는 것.
  - 기록을 지우는 방법(실기기에서 확인한 방법).
  - 제3자 SDK, 분석, 광고, 계정이 없다는 것.
  - TestFlight 기간에는 Apple 이 충돌 로그와 사용 정보를 모아 개발자와 공유한다는 것(5절 참고).
  - 연락처와 시행일.
- 제안: 처리방침 페이지를 호스팅하는 곳이 방문 기록을 남기는지는 그 서비스의 정책을 사람이 확인해요.

## 7. 지원 주소

- **결론:** Support URL 은 필수예요. 실제 연락처로 이어져야 하고, 앱 안에도 쉽게 연락할 방법을 둬야 해요. https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information, https://developer.apple.com/app-store/review/guidelines/ (확인: 2026-11-24)
- Support URL 은 필수이고 현지화할 수 있어요. 앱을 내려받은 사용자에게 App Store 에서 보이고, 현지 법이 요구할 수 있는 실제 연락처(법적 주소, 이메일 주소, 전화번호)로 이어져 문제, 피드백, 기능 요청을 받을 수 있어야 해요. 프로토콜까지 넣은 전체 URL 로 적어요. https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information (확인: 2026-11-24)
- Support URL 도 새 버전 없이 언제든 고칠 수 있는 항목이 아니에요. https://developer.apple.com/help/app-store-connect/reference/app-information/required-localizable-and-editable-properties (확인: 2026-11-24)
- 가이드라인 1.5 는 앱과 Support URL 에 쉽게 연락할 방법을 넣으라고 하고, 교실에서 쓰일 수 있는 앱은 특히 중요하다고 해요. 정확한 최신 연락처가 없으면 일부 국가나 지역에서 법 위반이 될 수 있다고도 해요. https://developer.apple.com/app-store/review/guidelines/ (확인: 2026-11-24)
- TestFlight 의 피드백 이메일은 이와 따로 테스트 정보에 넣어요. https://developer.apple.com/help/app-store-connect/test-a-beta-version/provide-test-information (확인: 2026-11-24)
- 확인하지 못함: 한국의 학생 개인 개발자가 주소와 전화번호까지 공개해야 하는지는 '현지 법이 요구할 수 있는'이라는 단서 때문에 이 페이지만으로 정할 수 없어요. https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information (확인: 2026-11-24)
- 제안: 처리방침과 같은 정적 사이트에 지원 페이지를 둬요. 앱 이름, 지원 기기(iPhone), 자주 묻는 질문, 문의 이메일, 처리방침 링크를 적어요.
- 제안: 문의 전용 이메일 주소를 만들어요. 개발자가 미성년이라면 주소와 전화번호 공개 범위는 보호자와 정하고, 법적 판단이 필요하면 전문가에게 물어요.
- 제안: 앱 안 처리방침 화면 아래에 문의 이메일을 글자로 보여 줘요. 메일 앱을 여는 버튼을 둘지는 6절의 Safari 와 같은 장단점을 따져 정해요.
- 제안: 보호자 명의로 등록하면 판매자 이름이 보호자 이름이 돼요(4절의 추론). 지원 페이지의 운영자 표기를 그에 맞춰요.

## 8. 앱 개인정보 답변

- **결론:** 지금 앱에는 'No, we do not collect data from this app'(데이터를 수집하지 않음)이 맞아요(추론). 앱이 무언가를 기기 밖으로 보내기 시작하면 다시 판단해요. https://developer.apple.com/app-store/app-privacy-details/ (확인: 2026-11-24)

### 맞는 이유

- '수집'은 데이터를 기기 밖으로 보내, 요청을 실시간으로 처리하는 데 필요한 시간보다 오래 개발자나 제3자 파트너가 접근할 수 있게 하는 거예요. https://developer.apple.com/app-store/app-privacy-details/ (확인: 2026-11-24)
- 기기에서만 처리하고 서버로 보내지 않는 데이터는 수집이 아니라서 답변에 적지 않아요. 그 데이터에서 만든 것을 기기 밖으로 보내면 따로 판단해요. https://developer.apple.com/app-store/app-privacy-details/ (확인: 2026-11-24)
- 앱에 웹 뷰가 있으면 웹 트래픽으로 모으는 데이터는 신고해야 해요(사용자가 열린 웹을 돌아다니게 하는 경우는 예외). https://developer.apple.com/app-store/app-privacy-details/ (확인: 2026-11-24)
- 분석이나 광고가 아니라 앱 기능만을 위해 모아도 신고해야 하고, 앱에 넣은 제3자 파트너 코드의 관행도 포함해요. https://developer.apple.com/app-store/app-privacy-details/ (확인: 2026-11-24)
- 추론: 이 앱은 기록을 기기 안 파일에만 두고, 웹 뷰는 번들 안 내용만 열며 http, https, ws, wss 를 막고, 제3자 SDK, 분석, 광고, 계정이 없어요. 그래서 위 정의의 '수집'이 없어요. https://developer.apple.com/app-store/app-privacy-details/ (확인: 2026-11-24)
- Apple 이 만든 앱 중 데이터를 모으지 않는 앱(Chess, Terminal 등)은 'Data Not Collected'와 'The developer does not collect any data from this app.'으로 보여요. https://www.apple.com/privacy/labels/ (확인: 2026-11-24)

### 입력 방법

- 앱 선택, 사이드바 App Privacy, Get Started 를 누르고, 'No, we do not collect data from this app'을 고른 뒤 Save 를 눌러요. 추가 질문은 없어요. https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy/ (확인: 2026-11-24)
- 안내 절차의 끝은 페이지 오른쪽 위 Publish 와, 응답이 정확하고 관행이 바뀌면 바로 고치겠다는 확인 대화상자의 Publish 예요. 제품 페이지가 아직 공개 전이면 공개될 때 게시돼요. 'No'를 고른 경우에도 Publish 가 필요한지는 따로 적혀 있지 않아요. https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy/ (확인: 2026-11-24)
- 필요한 역할은 Account Holder, Admin, App Manager 예요. 응답은 앱 단위로 모든 플랫폼의 관행을 담아요. https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy/ (확인: 2026-11-24)
- 개인정보 관행 정보는 신규 앱과 업데이트 제출에 필요해요. 정확하게 유지할 책임은 개발자에게 있고, 답변은 앱 업데이트 없이 언제든 고칠 수 있어요. https://developer.apple.com/app-store/app-privacy-details/ (확인: 2026-11-24)

### 애매한 점

- App Privacy Details 에는 기기 백업에 대한 언급이 없어요. 가장 가까운 공식 설명은 Apple 자체 앱 FAQ 예요. 설정의 iCloud 백업으로 백업되는 사진, 메시지는 레이블에 적지 않고, 앱 안에서 백업을 제공하는 iMovie 는 적는다고 해요. 개발자 규칙은 아니에요. https://support.apple.com/en-us/102399 (확인: 2026-11-24)
- App Privacy Details 는 Apple 이 모으는 데이터는 개발자가 공개할 책임이 없다고 해요. 다만 MapKit, CloudKit, App Analytics 같은 Apple 프레임워크나 서비스에서 앱에 관한 데이터를 개발자가 모으면 표시해야 한다고도 해요. https://developer.apple.com/app-store/app-privacy-details/ (확인: 2026-11-24)
- 확인하지 못함: App Store Connect 의 앱 분석 화면을 보는 것이 위 문장의 '모음'에 해당하는지 공식 설명을 찾지 못했어요. https://developer.apple.com/app-store/app-privacy-details/ (확인: 2026-11-24)

### 답이 바뀌는 경우

- 15절 B 처럼 고정 주소에서 파일을 받으면, 서버나 호스팅이 IP 주소 같은 요청 정보를 실시간 처리보다 오래 남기는지에 따라 판단이 달라져요(추론). 보관하지 않으면 공개하지 않아도 된다는 예(인증 토큰, IP 주소)가 있어요. https://developer.apple.com/app-store/app-privacy-details/ (확인: 2026-11-24)
- 분석, 충돌 보고, 광고 SDK 를 넣으면 그 코드의 관행도 답변에 들어가요. https://developer.apple.com/app-store/app-privacy-details/ (확인: 2026-11-24)
- 사용자 데이터나 사용 데이터를 모으게 되면 익명이라도 동의를 받고 쉽게 철회할 방법을 줘야 해요(5.1.1(ii)). 계정 만들기를 넣으면 앱 안에서 계정 삭제도 줘야 해요(5.1.1(v)). https://developer.apple.com/app-store/review/guidelines/ (확인: 2026-11-24)
- 점수나 기록을 서버나 클라우드로 보내거나, 앱 안에서 문의 내용을 직접 보내는 기능을 넣으면 다시 판단해요(추론).
- 웹 뷰가 외부 웹 내용을 불러오게 바꾸면 웹 트래픽 규칙을 다시 봐요. https://developer.apple.com/app-store/app-privacy-details/ (확인: 2026-11-24)
- 데이터 유형 답변은 필수이고 새 버전 없이 고칠 수 있지만, 처리방침 URL 은 다음 버전과 함께 바뀌어요. https://developer.apple.com/help/app-store-connect/reference/app-information/required-localizable-and-editable-properties, https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy/ (확인: 2026-11-24)

### 함께 볼 것: 개인정보 매니페스트

- 개인정보 매니페스트(PrivacyInfo.xcprivacy)는 수집 데이터 유형과 required reason API 사용 이유를 적는 파일이에요. 최상위 키는 NSPrivacyTracking, NSPrivacyTrackingDomains, NSPrivacyCollectedDataTypes, NSPrivacyAccessedAPITypes 예요. Xcode 의 File > New File > Resource > App Privacy File 로 만들어요. https://developer.apple.com/documentation/bundleresources/privacy-manifest-files (확인: 2026-11-24)
- 앱 코드가 required reason API 를 쓰면 앱 매니페스트에 승인된 이유를 적어야 해요. 2024년 5월 1일부터 적지 않은 앱은 App Store Connect 가 받지 않아요. https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api (확인: 2026-11-24)
- 범주는 파일 타임스탬프(creationDate, modificationDate, stat 등), 시스템 부팅 시간, 디스크 공간, 활성 키보드, UserDefaults 의 5개예요. 앱만 읽는 UserDefaults 는 CA92.1, 앱 컨테이너 안 파일의 타임스탬프나 크기 같은 메타데이터는 C617.1 이에요. https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacyaccessedapitypes/nsprivacyaccessedapitype (확인: 2026-11-24)
- UserDefaults 문서는 이 API 를 쓰면 매니페스트에 사용과 이유를 적으라고 해요. SwiftUI AppStorage 문서는 AppStorage 를 UserDefaults 값을 반영하는 속성 래퍼라고 설명하지만 매니페스트 언급은 없어요. https://developer.apple.com/documentation/foundation/userdefaults, https://developer.apple.com/documentation/swiftui/appstorage (확인: 2026-11-24)
- TN3181 에는 '2024년 11월 12일부터 심사에 제출하는 앱은 유효한 개인정보 매니페스트를 포함해야 한다'는 문장이 있어요(무효 매니페스트를 다루는 문맥). 빈 배열, NSPrivacyTracking 과 도메인 목록이 맞지 않는 경우는 무효이고, 쓰지 않는 키는 빼고 plutil -lint 로 검사하라고 해요. https://developer.apple.com/documentation/technotes/tn3181-debugging-invalid-privacy-manifest (확인: 2026-11-24)
- 무효 매니페스트가 든 제출은 거부돼요. iOS 앱은 매니페스트를 번들 루트에 두고, Xcode 에서 타깃에 넣으면 자리를 잡아 줘요. https://developer.apple.com/documentation/bundleresources/adding-a-privacy-manifest-to-your-app-or-third-party-sdk (확인: 2026-11-24)
- Product > Archive 뒤 Organizer 에서 아카이브를 Control-클릭해 Generate Privacy Report 를 고르면 개인정보 보고서가 나와요. App Store Connect 답변 때 참고하라고 해요. https://developer.apple.com/documentation/bundleresources/describing-data-use-in-privacy-manifests (확인: 2026-11-24)
- 제안: 껍데기 코드가 UserDefaults(@AppStorage 포함), 파일 생성일이나 수정일, 디스크 공간 API 를 쓰는지 사람이 확인해요. 쓰면 맞는 이유 코드를 적어요. 필수 여부가 애매하므로(16절) 유효한 매니페스트를 넣어 두는 쪽이 안전해요. 이미 넣었다면 위 규칙과 맞는지 확인해요.

## 9. 연령 등급 설문과 카테고리

- **결론:** Kids 카테고리가 아니에요. 연령 범주는 'Not Applicable', 주 카테고리는 Education(교육)을 제안해요. 등급은 설문에 정직하게 답해 나온 값을 써요. https://developer.apple.com/app-store/categories/, https://developer.apple.com/help/app-store-connect/manage-app-information/set-an-app-age-rating (확인: 2026-11-24)

### 연령 등급 설문

- 연령 등급은 필수 앱 정보예요. 앱 선택, 사이드바 General 아래 App Information, Age Ratings 아래 Set Up Age Ratings 에서 해요. 필요한 역할은 Account Holder, Admin, App Manager, Marketing 이에요. https://developer.apple.com/help/app-store-connect/manage-app-information/set-an-app-age-rating (확인: 2026-11-24)
- 글로벌 등급은 4+, 9+, 13+, 16+, 18+, Unrated 이고, Unrated 앱은 App Store 에 올릴 수 없어요. 설문 범주는 In-App Controls, Capabilities, Mature Themes, Medical or Wellness, Sexuality or Nudity, Violence, Chance-Based Activities 이고, 빈도나 포함 여부에 답하면 Apple 이 등급을 계산해요. https://developer.apple.com/help/app-store-connect/reference/age-ratings-values-and-definitions (확인: 2026-11-24)
- 2025년 7월 24일 공지로 13+, 16+, 18+ 가 생겼고 새 필수 질문(앱 내 제어, 기능, 의료나 웰니스, 폭력적 주제)이 더해졌어요. 2026년 1월 31일까지 답하지 않으면 업데이트 제출이 끊길 수 있다고 안내했어요. https://developer.apple.com/news/?id=ks775ehf (확인: 2026-11-24)
- 2026년 9월부터 신규 앱과 업데이트를 낼 때 소셜 미디어 기능 질문에 답해야 해요. https://developer.apple.com/news/?id=tlur8uvi (확인: 2026-11-24)
- 새 콘텐츠 기술자 Shared Location 과 Dating and Relationships 가 생겼고, 모든 앱은 2027년 1월 12일까지 답해야 해요. 시작일은 뉴스가 2026년 11월 16일, 릴리스 노트가 11월 19일로 달라요. https://developer.apple.com/news/?id=yxkh08us, https://developer.apple.com/help/app-store-connect/release-notes/ (확인: 2026-11-24)
- 가이드라인 2.3.6 은 등급 질문에 정직하게 답하라고 하고, 2.3.8 은 아이콘, 스크린샷, 미리보기가 4+ 기준에 맞아야 한다고 해요. https://developer.apple.com/app-store/review/guidelines/ (확인: 2026-11-24)
- Unrestricted Web Access 는 '앱 안에서 아무 웹페이지로 이동하거나 자유롭게 웹을 탐색'하는 것이고 글로벌 16+(한국 15+)예요. Contests 는 '사용자끼리 순위, 보상, 개인 목표 달성을 두고 겨루는 이벤트'이고 드물면 4+, 잦으면 13+ 예요. https://developer.apple.com/help/app-store-connect/reference/age-ratings-values-and-definitions (확인: 2026-11-24)
- 추론: 이 앱의 웹 뷰는 번들 안만 열고 외부 이동을 막으므로 Unrestricted Web Access 에 해당하지 않을 가능성이 커요. 혼자 쓰는 점수 분석이 Contests 인지는 문서에 기준이 없어요. 실제 등급은 설문을 해 봐야 알아요. https://developer.apple.com/help/app-store-connect/reference/age-ratings-values-and-definitions (확인: 2026-11-24)
- iOS 26 미만 기기(iOS 17, 18 등)에는 이전 체계 등급(4+, 9+, 12+, 17+)이 보여요. App Store Connect 의 'Operating Systems Earlier than Version 26' 섹션에서 확인해요. https://developer.apple.com/help/app-store-connect/reference/age-ratings-values-and-definitions (확인: 2026-11-24)
- 한국 지역 등급은 All, 12+, 15+, 19+ 예요. 26 이상 표는 '한국에서 제공되는 모든 앱'에 보인다고 적지만, 2026년 8월 12일 뉴스와 26 미만 섹션은 Games, Entertainment 카테고리 앱 중심으로 적어서 Education 앱에 어떻게 보일지는 불분명해요. https://developer.apple.com/help/app-store-connect/reference/age-ratings-values-and-definitions, https://developer.apple.com/news/?id=oj3r9pvw (확인: 2026-11-24)

### Kids 카테고리가 아닌 이유

- 'Age Categories and Override'에서 Made for Kids, Override to Higher Age Rating, Not Applicable 중 하나를 골라요. Made for Kids 는 계산 등급이 4+ 또는 9+ 인 경우에만 고를 수 있고, 승인 뒤에는 바꿀 수 없으며, 이후 모든 업데이트가 Kids 가이드라인을 따라야 해요. https://developer.apple.com/help/app-store-connect/manage-app-information/set-an-app-age-rating (확인: 2026-11-24)
- Kids 카테고리는 11세 이하 어린이를 위해 특별히 설계된 앱용이고, 5세 이하, 6~8세, 9~11세 중 하나에 넣어요. https://developer.apple.com/app-store/categories/ (확인: 2026-11-24)
- 추론: 고등학생 대상 앱은 Kids 대상 연령이 아니므로 Made for Kids 가 아니라 Not Applicable 이 맞아요. https://developer.apple.com/help/app-store-connect/manage-app-information/set-an-app-age-rating (확인: 2026-11-24)
- Kids 카테고리가 아닌 앱은 이름, 부제, 아이콘, 스크린샷, 설명에 주 사용자가 아동임을 암시하는 말('For Kids', 'For Children' 등)을 쓸 수 없어요. https://developer.apple.com/app-store/review/guidelines/ (확인: 2026-11-24)

### 카테고리

- 카테고리는 27개이고 주 카테고리와 보조 카테고리를 골라요. 맞지 않는 카테고리를 고르면 가이드라인 위반이에요. https://developer.apple.com/app-store/categories/ (확인: 2026-11-24)
- Education 은 '특정 기술이나 과목에 대한 상호작용형 학습 경험을 주는 앱'이고, 예시에 표준화 시험 준비와 학교 포털이 있어요. https://developer.apple.com/app-store/categories/ (확인: 2026-11-24)
- Entertainment 나 Games 를 주 또는 보조로 고르면 해당 Time Allowance 카테고리에 표시돼요. https://developer.apple.com/app-store/categories/ (확인: 2026-11-24)
- 제안: Education 을 주 카테고리로 해요. 이유는 셋이에요.
  - 수학 모의고사 답을 채점하고 나눠 보는 학습 도구라서 Education 정의와 '시험 준비' 예시에 가까워요.
  - Kids 는 11세 이하용이라 맞지 않아요.
  - Entertainment, Games 를 고르면 Time Allowance 분류와 한국 지역 등급 표시 범위가 달라질 수 있어요.
- 제안: 보조 카테고리는 정의를 읽고 사람이 정해요.

### 한국 밖 배포

- 한국 밖에도 배포하면 지역 규정이 더 붙어요. 예를 들어 텍사스는 2026년 6월 4일부터 새 계정의 18세 미만 다운로드에 보호자 동의가 필요하고, 호주, 브라질, 싱가포르는 18+ 앱을 성인 확인된 사용자만 받을 수 있어요. https://developer.apple.com/news/?id=sg176nne, https://developer.apple.com/news/?id=f5zj08ey (확인: 2026-11-24)
- 제안: 한국어 전용 앱이므로 제공 국가를 대한민국만으로 둘지 사람이 정해요.

## 10. 심사 지침 4.2 와 이 앱의 대응

- **결론:** WKWebView 로 웹 UI 를 띄우는 구조라서 '다시 포장한 웹사이트'로 보일 위험이 있어요. 승인은 약속할 수 없어요. https://developer.apple.com/app-store/review/guidelines/ (확인: 2026-11-24)

### 규칙

- 4.2 는 앱이 다시 포장한 웹사이트를 넘어서는 기능, 콘텐츠, UI 를 갖춰야 한다(should)고 해요. 특별히 유용하거나 독특하거나 앱다운 것이 아니면 App Store 에 맞지 않고, 지속적인 가치나 충분한 효용이 없으면 승인되지 않을 수 있어요. https://developer.apple.com/app-store/review/guidelines/ (확인: 2026-11-24)
- 4.2.2 는 카탈로그를 빼면 앱이 주로 마케팅 자료, 광고, 웹 클리핑, 콘텐츠 모음, 링크 모음이어서는 안 된다고 해요. 4.2.3(i)은 다른 앱 없이 혼자 작동해야 한다고 해요. https://developer.apple.com/app-store/review/guidelines/ (확인: 2026-11-24)
- App Review 안내는 앱 안에서 웹사이트를 보여 주는 것, iOS 에 맞게 다듬지 않은 웹 콘텐츠, 제한된 웹 상호작용으로는 좋은 앱이 되지 않는다고 하고, iOS 고유 기능을 최대한 쓰라고 해요. 기능이나 콘텐츠가 적거나 작은 틈새 시장에만 맞는 앱은 승인되지 않을 수 있어요. https://developer.apple.com/distribute/app-review/ (확인: 2026-11-24)
- 4.2 본문에는 '웹사이트 이상'을 판단하는 구체 목록이 없어요. https://developer.apple.com/app-store/review/guidelines/ (확인: 2026-11-24)
- 2.5.6 은 웹을 탐색하는 앱이 WebKit 프레임워크와 WebKit JavaScript 를 써야 한다고 해요. https://developer.apple.com/app-store/review/guidelines/ (확인: 2026-11-24)

### 솔직한 위험

- 추론: 겉으로는 웹 UI 로 보일 수 있어요. 대응하는 웹사이트가 따로 없고 오프라인으로만 작동한다는 점은 심사 메모에 적어야 심사자가 알아요.
- 추론: 앱이 하는 일이 '답 넣기와 점수 나눠 보기'로 좁아서 기능이 적다고 볼 여지도 있어요.
- 2026년 3월 학력평가에는 전국 1,948개교 약 122만명이 응시했어요. https://enews.sen.go.kr/news/view.do?bbsSn=190882&step1=3&step2=1 (확인: 2026-11-24)
- 추론: 대상 학생 수가 작지 않다는 근거로 심사 메모에 쓸 수 있어요. 다만 '작은 틈새 시장'인지는 Apple 이 판단해요.

### 지금 있는 네이티브 요소(앱 설명 기준)

- SwiftUI 껍데기가 번들 안 웹 UI 를 WKWebView 로 띄워요.
- WebKit 콘텐츠 규칙으로 http, https, ws, wss 를 막고, 번들 밖 이동을 취소해요.
- 기록을 기기 안 파일에 저장해요.
- 계정, 분석, 광고, 권한 요청이 없어요.

### 더할 수 있는 것(약속 아님)

- 아래는 이미 있으면 심사 메모에 적고, 없으면 더할지 사람이 고르는 목록이에요. 무엇을 더해도 4.2 통과를 보장하지 않아요.
  - 네이티브 처리방침, 문의 화면(6, 7절).
  - 시스템 글자 크기를 따르거나 앱 안에서 글자 크기를 바꾸는 기능(14절 Larger Text 와 연결).
  - 시스템 다크 모드 따르기(14절 Dark Interface 와 연결).
  - VoiceOver 로 답 넣기와 결과 읽기가 되도록 웹 UI 의 의미 구조와 레이블 다듬기(웹 쪽 작업).
  - 결과를 이미지나 PDF 로 저장하거나 공유 시트로 보내기(네트워크 없이).
  - 답을 넣을 때 햅틱 피드백.
  - iPhone 화면 크기에 맞춘 답 입력 배치(웹 쪽 작업).
- 심사 메모(App Review Information)에는 앱 개념과 대상, 테스트한 기기 모델과 OS 버전, 핵심 기능에 쓰는 외부 서비스를 적으라고 해요. 불완전한 제출은 거절돼요. https://developer.apple.com/help/app-review/before-submitting-for-review/complete-review (확인: 2026-11-24)
- 제안: 심사 메모에 오프라인 전용이라는 것, 네트워크를 막는 방식, 웹 UI 를 쓰는 이유, 대상 학생, 기록이 기기에만 있다는 것, 처리방침 화면 위치, 테스트한 iPhone 과 iOS 버전을 적어요.
- App Review 1:1 상담(30분 Webex, 현지 업무 시간의 화요일과 목요일, 가용성에 따름)을 신청해 특정 가이드라인이 내 앱에 어떻게 적용되는지 물을 수 있어요. 정보 제공용이라 심사를 대신하거나 결과를 보장하지 않아요. https://developer.apple.com/help/app-review/before-submitting-for-review/app-review-appointment (확인: 2026-11-24)

## 11. 심사 지침 2.1 과 2.2

- **결론:** '예시' 샘플 시험만 든 빌드는 TestFlight 로 보내고, App Store 에는 내지 않아요. https://developer.apple.com/app-store/review/guidelines/ (확인: 2026-11-24)
- 2.1(a) 앱 완전성: 심사 제출물은 필요한 메타데이터와 제대로 작동하는 URL 을 갖춘 최종 버전이어야 하고, 플레이스홀더 텍스트, 빈 웹사이트, 그 밖의 임시 콘텐츠는 제출 전에 없애야 해요. 제출 전에 실제 기기에서 버그와 안정성을 테스트해야 하고, 충돌하거나 명백한 기술 문제가 있는 바이너리는 거절돼요. https://developer.apple.com/app-store/review/guidelines/ (확인: 2026-11-24)
- 한국어판(최종 수정일 2026년 10월 16일)은 2.1 을 '앱 완전성', 2.2 를 '베타 테스트'로 옮기고, 임시 콘텐츠는 '제출하기 전에 삭제해야 합니다'라고 적어요. https://developer.apple.com/kr/app-store/review/guidelines/ (확인: 2026-11-24)
- App Review 안내는 플레이스홀더 콘텐츠가 있는 항목은 배포 준비가 안 된 것이라 승인될 수 없다고 하고, 해결되지 않은 이슈의 평균 40% 이상이 2.1 관련이라고 해요. https://developer.apple.com/distribute/app-review/ (확인: 2026-11-24)
- 2.2 베타 테스트: 데모, 베타, 체험판은 App Store 가 아니라 TestFlight 를 써야 해요. TestFlight 로 내는 앱은 공개 배포를 목적으로 해야 하고 가이드라인을 지켜야 해요. https://developer.apple.com/app-store/review/guidelines/ (확인: 2026-11-24)
- 외부 TestFlight 의 첫 빌드도 가이드라인 준수 심사를 받아요. https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview (확인: 2026-11-24)
- TestFlight 빌드는 올린 날부터 최대 90일 동안만 테스트할 수 있어요. https://testflight.apple.com/ (확인: 2026-11-24)
- 확인하지 못함: '예시' 표시 가짜 정답 시험이 2.1 의 임시 콘텐츠나 2.2 의 데모로 판단되는지 공식 기준이 없어요. https://developer.apple.com/app-store/review/guidelines/ (확인: 2026-11-24)
- 추론: 샘플만 든 빌드는 2.2 가 말하는 베타에 가까워요. 공개 배포를 목표로 한 베타라는 점을 베타 앱 설명에 적어요. https://developer.apple.com/app-store/review/guidelines/ (확인: 2026-11-24)
- 추론: App Store 에 낼 버전은 실제 시험 데이터로 핵심 기능이 작동해야 2.1 에 맞아요. 실제 데이터를 넣으려면 13절의 확인이 먼저예요.
- 제안: 2027년 3월의 첫 실제 사용을 TestFlight 로 할지 App Store 로 할지 사람이 정해요. TestFlight 는 공개 배포를 목표로 한 베타용이고 빌드가 90일 뒤 만료된다는 점을 함께 봐요.
- 제안: 베타 앱 설명에는 '예시' 데이터가 가짜이고 실제 시험 정답은 없다는 것, 테스트할 화면, 피드백 방법을 적어요.

## 12. iPad 실행

- **결론:** iPhone 전용 앱도 iPad 에서 호환 모드로 내려받아 쓸 수 있어요. iPad 실기기에서 같은 기능이 되는지 확인하고 제출해요. Mac 과 Vision Pro 제공은 기본으로 켜져 있어서 사람이 정해요. https://developer.apple.com/help/app-review/before-submitting-for-review/test-compatible-devices (확인: 2026-11-24)

### iPad 호환 모드

- 2.4.1 은 iPhone 앱이 가능하면(whenever possible) iPad 에서도 실행되어야 한다(should)고 해요. https://developer.apple.com/app-store/review/guidelines/ (확인: 2026-11-24)
- iPhone 기기 기능에 의존하지 않는 iPhone 앱은 iPad 에서 호환 모드로 실행될 수 있고, iPad 에서 App Store 로 내려받을 수 있어요. Xcode 의 Supported Destinations 에서 iPad 를 넣거나 빼도 iPad 제공 여부는 바뀌지 않아요. https://developer.apple.com/help/app-review/before-submitting-for-review/test-compatible-devices (확인: 2026-11-24)
- UIRequiredDeviceCapabilities 는 진짜 하드웨어 의존에만 쓰고 배포 선호를 나타내는 데 쓰면 안 돼요. 호환 모드 동작을 테스트하지 않고 제출하지 말라고 하고, App Review 는 실제 기기에 설치해 사용자처럼 평가해요. https://developer.apple.com/help/app-review/before-submitting-for-review/test-compatible-devices (확인: 2026-11-24)
- PLA 3.3.1 E 는 iOS 앱이 iPadOS 호환 모드에서도 적어도 같은 기능을 가져야 하고, 호환 모드 동작을 막으면 안 된다고 해요(하드웨어가 없는 기능은 예외). https://developer.apple.com/support/terms/apple-developer-program-license-agreement/ (확인: 2026-11-24)
- WWDC26 에서 Apple 은 올해 릴리스부터 iPad 에서 iOS 앱 크기 조절을 지원하고, 최신 SDK 로 다시 빌드하면 자동으로 적용된다고 했어요. iPad 의 iPhone 전용 앱은 완전히 크기 조절되지만 phone 사용자 인터페이스 idiom 으로 실행돼요. https://developer.apple.com/videos/play/wwdc2026/102/, https://developer.apple.com/videos/play/wwdc2026/278/ (확인: 2026-11-24)
- 확인하지 못함: iOS 26.4 SDK 로 빌드한 지금 앱이 iPadOS 27 에서 크기 조절 창으로 열리는지는 자료에 없어요. https://developer.apple.com/documentation/ios-ipados-release-notes/ios-ipados-27-release-notes.md (확인: 2026-11-24)
- 제안: iPad 실기기에서 첫 실행, 답 넣기, 결과 보기, 처리방침 보기, 기록 저장과 다시 열기를 모두 해 봐요. 창 크기와 방향이 바뀔 때도 봐요.

### 스크린샷

- 스크린샷 사양의 요약은 iPhone 에 'Dynamic Island 탑재 iPhone(중간 디스플레이)' 최소 1장을 요구해요. 허용 크기는 세로 1179x2556 또는 1206x2622, 가로 2556x1179 또는 2622x1206 이에요. https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications (확인: 2026-11-24)
- 같은 페이지의 상세 표는 'Face ID 탑재 iPhone(큰 디스플레이)'(1284x2778, 1242x2688)를 'Dynamic Island 큰 디스플레이 스크린샷이 없으면 필수'로 적어서 요약과 표현이 달라요. 실제 업로드 화면에서 필수 등급을 확인해요. https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications (확인: 2026-11-24)
- iPad 는 '앱이 iPadOS 를 지원하면' 13인치 iPad 최소 1장이고, 상세 표는 'iPad 에서 실행되면 필수'라고 적어요. 호환 모드로 도는 iPhone 전용 앱이 여기에 해당하는지는 적혀 있지 않아요. https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications (확인: 2026-11-24)
- UI 가 같으면 가장 높은 필수 해상도만 내면 작은 크기로 자동 축소돼요. 기기 크기마다 최대 10장, .jpeg, .jpg, .png 이고, 알파 채널과 투명도는 안 돼요. https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications (확인: 2026-11-24)
- iPhone Duo 스크린샷은 바깥 화면 1398x2034, 안쪽 화면 2007x2853 이고, 내면 제품 페이지에 iPhone Duo 용 배지가 붙어요(필수 범위는 3절). https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications (확인: 2026-11-24)
- 스크린샷은 실제로 앱을 쓰는 모습이어야 하고, 기기별 세트에서 절반 넘게 사용 화면이어야 승인돼요. 사용 화면이면 기기당 1장도 돼요. https://developer.apple.com/help/app-review/guideline-reference/2-3-3-screenshots (확인: 2026-11-24)
- 'Waiting for Review' 상태에서는 스크린샷과 앱 미리보기를 올리거나 고칠 수 없어요. https://developer.apple.com/help/app-review/after-submitting-for-review/review-status (확인: 2026-11-24)
- 제안: 스크린샷에 쓰는 시험 데이터의 권리도 13절 기준으로 확인해요.

### Mac 과 Vision Pro

- Apple silicon Mac(macOS 11 이상) 사용자는 개발자가 바꾸지 않으면 Mac App Store 에서 iPhone, iPad 앱을 쓸 수 있어요. 설정은 앱 단위이고 모든 버전에 적용돼요. 끄려면 Pricing and Availability 의 'iPhone and iPad Apps on Apple Silicon Mac'에서 'Make this app available'을 해제하고 Save 를 눌러요. https://developer.apple.com/help/app-store-connect/manage-your-apps-availability/manage-availability-of-iphone-and-ipad-apps-on-macs-with-apple-silicon (확인: 2026-11-24)
- Mac 에서 iPhone 앱은 늘 고정 크기 창으로 열려요. https://developer.apple.com/documentation/apple-silicon/running-your-ios-apps-in-macos.md (확인: 2026-11-24)
- iPhone, iPad 앱은 바꾸지 않으면 Apple Vision Pro 에도 제공돼요. 끄려면 'iPhone and iPad Apps on Apple Vision Pro'에서 'Make this app available on Apple Vision Pro'를 해제하고 Save 를 눌러요. https://developer.apple.com/help/app-store-connect/manage-your-apps-availability/manage-availability-of-iphone-and-ipad-apps-on-apple-vision-pro (확인: 2026-11-24)
- 호환 기기 도움말은 키보드로 대신하기 어려운 터치 입력에 크게 의존하는 앱은 macOS 에, 내비게이션이나 카메라 기반 앱은 visionOS 에 잘 맞지 않는다며 제공 제한을 고려하라고 해요. https://developer.apple.com/help/app-review/before-submitting-for-review/test-compatible-devices (확인: 2026-11-24)
- 확인하지 못함: iPhone 전용 앱을 Mac, Vision Pro 에 제공할 때 그 기기용 스크린샷이 따로 필요한지는 적혀 있지 않아요. https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications (확인: 2026-11-24)
- 제안: Mac 에서 직접 써 보고 제공 여부를 정해요. 시험해 볼 기기가 없으면 끄는 것도 선택지예요. Vision Pro 도 같아요. 결정은 사람이 해요.

## 13. 실제 시험의 정답과 등급컷을 쓰는 근거

- **결론:** 정답과 등급컷은 공식 기관이 공개하지만, 확인한 게시판들은 문제의 무단 복제를 금하는 고지를 달고 있고, 확인한 파일에는 공공누리 표시가 없었어요. 숫자만 쓰는 것이 허용되는지는 확인되지 않았어요. 사람이 기관에 확인해야 해요. https://www.kice.re.kr/sub/info.do?m=0703&s=kice, https://www.suneung.re.kr/boardCnts/list.do?boardID=1500234&m=0403&s=suneung&searchStr= (확인: 2026-11-24)
- 이 절은 법률 자문이 아니에요. 공식 출처의 사실과 확인되지 않은 것을 나눠 적었어요.

### 정답이 나오는 곳과 시점

- 수능 문제지와 정답표는 시험 당일 교시마다 시험이 끝나는 시점(중증 시각장애 수험생 기준)에 공개돼요. 이의신청은 평가원 홈페이지 전용 게시판으로만 받고, 심사한 뒤 정답을 확정 발표해요. https://www.suneung.re.kr/boardCnts/fileDown.do?fileSeq=d752e093523e565f856944085b40db1e (확인: 2026-11-24)
- 2027학년도 수능(2026년 11월 19일 시행)은 이의신청 11월 19일~23일 18시, 심사 11월 24일~12월 1일, 정답 확정 발표 12월 1일 17시, 성적 통보 12월 11일 예정이에요. 오늘(11월 24일)은 심사 기간이라 정답이 아직 확정 전이에요. https://www.suneung.re.kr/boardCnts/fileDown.do?fileSeq=d752e093523e565f856944085b40db1e (확인: 2026-11-24)
- 2026년 11월 24일 기준 기출문제 게시판에 2027학년도 수능 게시물은 0건이에요. 2026학년도분은 시험 4일 뒤인 2025년 11월 17일에 올라왔어요. https://www.suneung.re.kr/main.do?s=suneung (확인: 2026-11-24)
- 평가원 모의평가도 정답(가안), 이의신청, 심사, 확정 순서예요. 2027학년도 9월 모의평가는 9월 2일 가안, 9월 5일 18시까지 이의신청, 9월 15일 확정이었고, 심사 대상 68문항 모두 이상 없음이었어요. https://www.suneung.re.kr/boardCnts/fileDown.do?fileSeq=7db01be0a86f976a1bbf7252bc610e95 (확인: 2026-11-24)
- 서울특별시교육청 학력평가자료실은 전국연합학력평가의 정답 및 해설(정답표 포함)을 모든 과목이 끝난 오후 6시 이후 올려요. 기출문제는 EBSi, 6월과 9월 모의평가는 평가원 홈페이지에서 보라고 안내해요. https://www.sen.go.kr/user/bbs/BD_selectBbsList.do?q_bbsSn=1036 (확인: 2026-11-24)
- 전국연합학력평가는 서울, 부산, 인천, 경기 교육청이 번갈아 출제하고 서울특별시교육청이 총주관청이에요. 2025년 6월 보도자료 기준으로 3월은 서울이 맡았어요. https://enews.sen.go.kr/news/view.do?bbsSn=189012&step1=3&step2=1 (확인: 2026-11-24)
- 2026년 3월 학력평가는 서울특별시교육청 주관이었고, 평가원에 성적 전산처리를 맡겨 4월 9일~24일에 학교에서 성적표를 출력했어요. https://enews.sen.go.kr/news/view.do?bbsSn=190882&step1=3&step2=1 (확인: 2026-11-24)
- 확인하지 못함: 2027년 3월 학력평가를 어느 교육청이 출제, 주관하는지(16절). https://enews.sen.go.kr/news/view.do?bbsSn=189012&step1=3&step2=1 (확인: 2026-11-24)

### 정답표의 모양

- 평가원 수능 정답표 PDF 는 문항번호, 정답, 배점 열의 표예요. 2026학년도 수학은 홀수형과 짝수형 정답표가 따로 있고 공통 7번, 8번의 정답이 문형마다 달라요. 공통은 1~22번, 선택(확률과 통계, 미적분, 기하)은 23~30번이에요. https://www.suneung.re.kr/boardCnts/fileDown.do?fileSeq=970fb683af8df94b36d29efe00741532 (확인: 2026-11-24)
- 홀수형과 짝수형 2개 문형은 국어, 수학, 영어, 한국사이고, 탐구와 제2외국어/한문은 단일 문형이에요. https://www.goe.go.kr/resource/goe/na/bbs_2675/2026/07/bac64b95-ce7b-467c-9295-8c7913876356.pdf (확인: 2026-11-24)
- 2027학년도 9월 모의평가 수학 정답표는 홀짝 구분이 없는 1쪽 표였어요. https://www.suneung.re.kr/boardCnts/fileDown.do?fileSeq=4261f4b4b9f510e5468295e6e4db0ec6 (확인: 2026-11-24)
- 고1, 고2 학력평가는 국어, 수학, 탐구에 선택과목이 없고 고2 탐구에 통합사회, 통합과학이 나와서 고3 시험과 구조가 달라요. https://enews.sen.go.kr/news/view.do?bbsSn=190882&step1=3&step2=1 (확인: 2026-11-24)
- 추론: 앱은 시험마다 학년, 문형(홀짝), 공통과 선택 구분을 따로 다뤄야 할 수 있어요. https://www.suneung.re.kr/boardCnts/fileDown.do?fileSeq=970fb683af8df94b36d29efe00741532 (확인: 2026-11-24)
- 확인하지 못함: 교육청 학력평가 정답표의 형식(서울 자료는 zip 이라 열지 않았어요). https://www.sen.go.kr/user/bbs/BD_selectBbsList.do?q_bbsSn=1036 (확인: 2026-11-24)

### 등급컷이 나오는 곳과 시점

- 수능과 평가원 모의평가의 공식 등급 구분 점수는 채점 결과 보도자료 게시물에 첨부 파일로 나와요. 2026학년도 수능은 2025년 12월 4일(성적 통지 12월 5일), 2027학년도 6월 모의평가는 2026년 6월 30일, 9월 모의평가는 2026년 9월 28일에 올라왔어요. https://www.suneung.re.kr/boardCnts/view.do?boardID=1500230&boardSeq=5094275&lev=0&m=0302&searchType=S&statusYN=W&page=1&s=suneung (확인: 2026-11-24)
- 공식 파일의 국어, 수학, 탐구 등급컷은 표준점수 기준이에요(2026학년도 수능 수학 1등급 128). 원점수 기준은 절대평가 영역(영어 90점부터 10점 간격, 한국사 40점부터 5점 간격, 제2외국어/한문 45점부터 5점 간격)뿐이에요. https://www.suneung.re.kr/boardCnts/view.do?boardID=1500230&boardSeq=5094275&lev=0&m=0302&searchType=S&statusYN=W&page=1&s=suneung (확인: 2026-11-24)
- 국어와 수학은 공통과목 점수를 활용한 선택과목 점수 조정을 거쳐 표준점수를 내요. https://www.goe.go.kr/resource/goe/na/bbs_2675/2026/07/bac64b95-ce7b-467c-9295-8c7913876356.pdf (확인: 2026-11-24)
- 학력평가 공식 등급컷은 교육청 학력평가자료실의 통계자료 xlsx 안 '영역별 등급구분점수' 시트에 있어요. 국어, 수학, 탐구는 표준점수, 영어, 한국사, 제2외국어/한문은 원점수 기준이에요(2026학년도 10월 자료로 확인). https://www.sen.go.kr/user/bbs/BD_selectBbsList.do?q_bbsSn=1036 (확인: 2026-11-24)
- 인천광역시교육청은 2026학년도 10월 학력평가 성적 분석 및 통계 자료를 2026년 11월 16일에 올렸어요. https://www.ice.go.kr/ice/na/ntt/selectNttList.do?mi=10910&bbsId=1703 (확인: 2026-11-24)
- 추론: 공식 등급컷은 성적 발표 무렵에 나와서 시험 당일에는 없어요. 수학 공식 등급컷은 표준점수 기준이라 원점수만으로 공식 등급을 바로 계산할 수 없어요. https://www.suneung.re.kr/boardCnts/view.do?boardID=1500230&boardSeq=5094275&lev=0&m=0302&searchType=S&statusYN=W&page=1&s=suneung (확인: 2026-11-24)
- 업체 등급컷은 성적 발표 전에는 업체 이용자 데이터로 만들어요. EBSi 는 자사 등급컷이 풀서비스 이용자 데이터 기반이고, '적중률'은 등급컷 오차합 기준이라고 밝혀요. https://www.ebsi.co.kr/ebs/pot/evt/fullService202609Evt.ebs (확인: 2026-11-24)
- 메가스터디는 성적 발표 뒤 '성적 발표 확정' 등급컷을 국어, 수학은 표준점수로 주고, 같은 원점수도 공통과 선택 조합에 따라 등급이 다를 수 있으며, 발표 뒤에는 국어, 수학 원점수 범위를 주지 않는다고 안내해요. https://www.megastudy.net/Entinfo/2027_jungsi/exam/rank_cut/jungsi_real.asp?seq=363 (확인: 2026-11-24)
- 메가스터디 이용약관 제24조는 회사 콘텐츠의 저작권이 회사에 있고 사전 승낙 없는 복제, 배포를 막아요. EBS 이용약관 제21조 제2항은 서비스로 얻은 정보의 상업적 사용과 제3자 이용을 막아요. https://www.megastudy.net/member/member_new/member_personsecure.asp?TabNo=2, https://sso.ebs.co.kr/policy/termsInfo (확인: 2026-11-24)

### 권리 고지와 공공누리

- 평가원 저작권보호정책은 홈페이지 자료가 저작권법으로 보호되는 저작물이라고 해요. 평가원이 저작재산권 전부를 가진 저작물은 제24조의2 에 따라 자유이용할 수 있고 공공누리 제1유형 표시를 붙여 열어요. 표시가 없는 자료는 담당자와 미리 협의한 뒤 쓰라고 해요. https://www.kice.re.kr/sub/info.do?m=0703&s=kice (확인: 2026-11-24)
- 대학수학능력시험 누리집 기출문제 게시판은 문제지 저작권이 평가원에 있고, 허락 없이 문제의 일부 또는 전부를 복제, 배포, 출판, 전자출판하지 말라고 고지해요. https://www.suneung.re.kr/boardCnts/list.do?boardID=1500234&m=0403&s=suneung&searchStr= (확인: 2026-11-24)
- 같은 누리집 이용약관 제10조는 사이트가 제공하는 서비스, 정보의 지적재산권이 사이트에 있고, 명시적 승인 없이 수정, 판매, 배포, 상업적 이용을 할 수 없다고 정해요. https://www.suneung.re.kr/sub/info.do?m=0601&s=suneung (확인: 2026-11-24)
- 서울특별시교육청 학력평가자료실은 자료 저작권이 시도교육청 또는 평가원에 있고, 허락 없이 문제의 일부 또는 전부를 복제, 배포, 출판, 전자출판하지 말라고 고지해요. https://www.sen.go.kr/user/bbs/BD_selectBbsList.do?q_bbsSn=1036 (확인: 2026-11-24)
- 서울특별시교육청 저작권정책은 제24조의2 에 따라 공공누리를 붙여 열고, 표시가 없는 자료는 게시물 담당부서와 미리 협의하라고 해요. https://www.sen.go.kr/www/useinfo/guide.jsp (확인: 2026-11-24)
- 인천광역시교육청은 저작권 문제로 학력평가 문제지 파일을 올릴 수 없다고 밝히고 EBSi 를 안내해요. https://www.ice.go.kr/ice/na/ntt/selectNttList.do?mi=10910&bbsId=1703 (확인: 2026-11-24)
- 확인한 평가원 정답표 PDF(2026학년도 수학, 국어, 생활과 윤리, 2027학년도 9월 모의평가 수학), 평가원 등급컷 xlsx, 학력평가 통계 xlsx 에는 공공누리 표시가 없었어요. https://www.suneung.re.kr/boardCnts/fileDown.do?fileSeq=970fb683af8df94b36d29efe00741532, https://www.suneung.re.kr/boardCnts/view.do?boardID=1500230&boardSeq=5094275&lev=0&m=0302&searchType=S&statusYN=W&page=1&s=suneung, https://www.sen.go.kr/user/bbs/BD_selectBbsList.do?q_bbsSn=1036 (확인: 2026-11-24)
- 평가원 9월 모의평가 이의신청 결과 보도자료에는 공공누리 표시(출처표시, 상업용금지)가 있지만, 이것은 보도자료 자체의 이용 조건이에요. https://www.suneung.re.kr/boardCnts/fileDown.do?fileSeq=7db01be0a86f976a1bbf7252bc610e95 (확인: 2026-11-24)
- 공공누리는 모든 유형에서 출처 표시가 필요하고, 제2유형은 상업적 이용 금지, 제3유형은 변경 금지, 제4유형은 둘 다 금지예요. 통계수치 등을 고쳐 착오를 일으키는 변경 이용을 저작인격권 침해 예로 들어요. https://www.kogl.or.kr/info/license.do (확인: 2026-11-24)

### 법령과 판례(사실만)

- 저작권법 제2조 제1호는 저작물을 인간의 사상 또는 감정을 표현한 창작물로 정해요. 제7조의 보호받지 못하는 저작물 5가지(법령, 고시 등, 판결 등, 그 편집물이나 번역물, 사실의 전달에 불과한 시사보도)에 시험 문제나 정답은 따로 없어요. https://www.law.go.kr/법령/저작권법/제7조 (확인: 2026-11-24)
- 제2조 제17호~제20호와 제93조는 편집저작물과 데이터베이스를 따로 정하고, 데이터베이스제작자에게 전부 또는 상당한 부분의 복제 등 권리를 줘요. 개별 소재도 반복적, 체계적으로 복제하면 상당한 부분으로 보고, 보호는 소재 자체에는 미치지 않아요. https://www.law.go.kr/법령/저작권법/제93조 (확인: 2026-11-24)
- 제94조 제2항 제1호는 비영리 교육, 학술, 연구 목적의 데이터베이스 이용을 허용하되 일반적 이용과 충돌하면 빼고, 제95조는 데이터베이스제작자의 권리를 제작을 마친 다음 해부터 5년 동안 보호해요. https://www.law.go.kr/법령/저작권법/제93조 (확인: 2026-11-24)
- 제24조의2 제1항은 국가나 지방자치단체가 업무상 작성해 공표한 저작물을 허락 없이 이용할 수 있게 해요(예외 있음). 제2항은 공공기관 저작물에 대해 국가가 이용 활성화 시책을 펼 수 있다고 해요. https://www.law.go.kr/법령/저작권법/제24조의2 (확인: 2026-11-24)
- 제32조는 시험 목적의 정당한 범위 안 복제를 허용하되 영리 목적은 빼고, 제35조의5 는 공정이용을 판단할 때 볼 것(목적과 성격, 저작물 종류와 용도, 이용 비중, 시장 영향)을 정해요. https://www.law.go.kr/법령/저작권법/제24조의2 (확인: 2026-11-24)
- 대법원 1997. 11. 25. 선고 97도2227 판결은 입시문제도 표현에 최소한의 창작성이 있으면 저작물일 수 있고, 아이디어나 사실 자체는 보호되지 않으며, 영리적 교육목적 이용은 자유이용 범위가 상당히 좁다고 봤어요. https://www.law.go.kr/판례/(97도2227) (확인: 2026-11-24)
- 대법원 2024. 7. 11. 선고 2021다272001 판결은 평가원이 신탁관리 저작물이 든 평가문제를 시험 뒤 수년간 게시한 것이 공정이용도, 시험문제를 위한 복제(구 저작권법 제32조)도 아니라는 원심을 수긍했어요. 문제지 속 제3자 저작물에 관한 판결이고, 정답이나 배점만 쓰는 경우를 다룬 판결은 아니에요. https://www.law.go.kr/판례/(2021다272001) (확인: 2026-11-24)
- 문화체육관광부 안내는 사실 정보인 소재 자체는 저작물이 아니고, 선택, 배열에 창작성이 있으면 편집저작물이 될 수 있다고 설명해요. https://www.mcst.go.kr/kor/s_policy/copyright/netizen/netizen02.jsp (확인: 2026-11-24)

### Apple 쪽 조건

- 가이드라인 5.2, 5.2.1 은 직접 만들었거나 허락받은 콘텐츠만 넣고, 허락 없는 제3자 보호 자료는 쓰지 말라고 해요. 5.2.2 는 제3자 서비스의 콘텐츠를 쓰면 그 서비스 약관이 허용하는지 확인하고, 요청이 오면 권한 증빙을 내라고 해요. https://developer.apple.com/app-store/review/guidelines/ (확인: 2026-11-24)
- App Store Connect 의 Content Rights 는 필수 항목이에요. 제3자 콘텐츠를 담는 앱은 필요한 권리를 갖거나, 앱을 내는 국가나 지역의 법에 따라 사용이 허용되어야 해요. https://developer.apple.com/help/app-store-connect/reference/app-information/app-information/, https://developer.apple.com/help/app-store-connect/reference/app-information/required-localizable-and-editable-properties (확인: 2026-11-24)

### 확인되지 않은 것

- 정답 번호, 배점, 등급 구분 점수 같은 숫자만 앱에 넣는 것이 '문제의 일부 또는 전부' 복제 금지 고지에 해당하는지 평가원과 교육청의 공식 설명이 없어요. https://www.suneung.re.kr/boardCnts/list.do?boardID=1500234&m=0403&s=suneung&searchStr= (확인: 2026-11-24)
- 교육청 학력평가 저작물이 제24조의2 제1항에, 평가원 저작물이 제2항에 해당하는지 공식 해석이 없어요. 평가원의 공공기관 지정 여부도 확인하지 못했어요. https://www.law.go.kr/법령/저작권법/제24조의2, https://www.mcst.go.kr/kor/s_policy/subPolicy/contents/contents04.jsp?pSeq=20 (확인: 2026-11-24)
- 업체 추정 등급컷이 저작권법상 저작물이나 데이터베이스 보호 대상인지 공식 판단을 찾지 못했어요. https://www.megastudy.net/member/member_new/member_personsecure.asp?TabNo=2 (확인: 2026-11-24)

### 사람이 확인할 일

- 쓸 시험마다 정답표와 등급컷 파일에 공공누리 표시가 있는지 봐요.
- 표시가 없으면 평가원은 지식재산권 관리담당자, 교육청은 게시물 담당부서에 쓰려는 범위(정답 번호, 배점, 등급컷 숫자만, 무료 앱, 출처 표시)를 적어 미리 협의하고 답을 보관해요.
- 문제 본문, 그림, 해설은 넣지 않아요.
- 업체 등급컷은 약관 제한이 있으니 쓰지 않거나 서면 허락을 받아요.
- 앱 안에 출처(기관 이름, 시험 이름, 공개일)를 적어요.
- 가안 정답과 확정 정답을 구분하고, 확정 발표 뒤 다시 맞춰 봐요.
- 화면의 등급 표시가 공식 기준(수학은 표준점수)과 어긋나지 않는지 봐요.
- App Store Connect 의 Content Rights 에 정직하게 답하고, 협의 기록을 권한 증빙으로 준비해요.
- 법적 판단이 필요하면 전문가에게 물어요.

## 14. 접근성 표시

- **결론:** 접근성 영양 라벨은 아직 자발적이에요. 이 앱이 정직하게 표시할 수 있는 항목은 사람이 실제 iPhone 에서 모든 공통 작업을 해 본 뒤에만 정해요. 게시는 App Store 출시 뒤에 할 수 있어요. https://developer.apple.com/help/app-store-connect/manage-app-accessibility/overview-of-accessibility-nutrition-labels, https://developer.apple.com/help/app-store-connect/manage-app-accessibility/manage-accessibility-nutrition-labels (확인: 2026-11-24)

### 규칙

- 라벨은 제품 페이지에서 VoiceOver 같은 기능으로 앱의 공통 작업을 끝낼 수 있는지 알려 줘요. 기능은 VoiceOver, Voice Control, Larger Text, Dark Interface, Differentiate Without Color Alone, Sufficient Contrast, Reduced Motion, Captions, Audio Descriptions 의 9개이고, 기기별로 답해요. 26 이상 OS 기기에서만 보이고, 검색 관련성에도 반영돼요. https://developer.apple.com/help/app-store-connect/manage-app-accessibility/overview-of-accessibility-nutrition-labels (확인: 2026-11-24)
- 처음에는 자발적이고, 시간이 지나면 신규 앱과 업데이트 제출에 필수가 될 예정이에요. 날짜는 없어요. 답하지 않아도 섹션이 '아직 표시하지 않음'으로 보여요. https://developer.apple.com/help/app-store-connect/manage-app-accessibility/overview-of-accessibility-nutrition-labels (확인: 2026-11-24)
- 지원을 표시하려면 그 기능으로 공통 작업을 모두 끝낼 수 있어야 해요. 공통 작업은 주요 기능, 첫 실행, 로그인, 구매, 설정 같은 기본 기능이에요. 결과를 바꿀 만큼 심각한 버그가 있으면 표시하지 않고, 오해를 부르는 라벨은 App Review 가 고치라고 할 수 있어요. https://developer.apple.com/help/app-store-connect/manage-app-accessibility/overview-of-accessibility-nutrition-labels (확인: 2026-11-24)
- VoiceOver 와 Voice Control 은 네이티브로 지원하고 자체 구현으로 대신하지 말라고 해요. 제3자 웹사이트를 띄우는 웹 뷰에서는 WebKit 이 HTML, CSS, ARIA 로 대부분을 기본 지원한다고 설명해요. https://developer.apple.com/help/app-store-connect/manage-app-accessibility/overview-of-accessibility-nutrition-labels (확인: 2026-11-24)
- 추론: 이 앱은 번들된 자체 웹 UI 가 곧 공통 작업이라서, 제3자 웹사이트에 대한 WebKit 설명에 기대지 말고 직접 평가해야 해요. https://developer.apple.com/help/app-store-connect/manage-app-accessibility/overview-of-accessibility-nutrition-labels (확인: 2026-11-24)
- 게시는 앱 선택, App Accessibility, Get Started, 기기별 Yes 또는 No 와 기능 선택, 초안 저장, Publish 순서예요. App Store 에 라이브 버전이 있는 기기만 게시할 수 있고, 모두에게 보이기까지 최대 24시간이 걸려요. 언제든 고칠 수 있어요. https://developer.apple.com/help/app-store-connect/manage-app-accessibility/manage-accessibility-nutrition-labels (확인: 2026-11-24)
- iPhone 앱이 Apple silicon Mac 이나 Vision Pro 에서 호환 실행되면 그 기기용 응답은 필요 없고 iPhone 라벨이 보여요. https://developer.apple.com/help/app-store-connect/manage-app-accessibility/overview-of-accessibility-nutrition-labels (확인: 2026-11-24)

### 실기기 확인 뒤에만 표시할 수 있는 것

- 제안: 이 앱의 공통 작업은 첫 실행, 시험 고르기, 모든 문항의 답 넣기, 점수 분석 보기, 처리방침과 문의 보기, 기록 다시 열기로 잡아요.
- VoiceOver: 화면을 보지 않고 VoiceOver 만으로 공통 작업을 끝내야 해요. 모든 컨트롤의 간결한 레이블, 장식 이미지 숨김, 차트의 텍스트 대안, 빠짐없는 탐색 순서, 화면이 바뀔 때 포커스 이동을 봐요. https://developer.apple.com/help/app-store-connect/manage-app-accessibility/voiceover-evaluation-criteria (확인: 2026-11-24)
- Voice Control: 화면을 만지지 않고 음성만으로 공통 작업을 끝내야 해요. 'Show numbers', 'Show names'에 모든 버튼이 나오고, 레이블이 보이는 글자와 같아야 하며, 텍스트 필드에서 받아쓰기가 돼야 해요. https://developer.apple.com/help/app-store-connect/manage-app-accessibility/voice-control-evaluation-criteria (확인: 2026-11-24)
- Larger Text: 글자를 최소 200% 또는 시스템 최대까지 키워도 겹치거나 심하게 잘리지 않아야 해요. Dynamic Type 이나 그만큼 키우는 앱 안 조절 중 어느 것이든 되지만 시스템 Zoom 에 기대면 안 돼요. 웹 뷰를 쓰는 앱은 글자 크기 조절기를 주거나 Safari 에 맡기라고 해요. https://developer.apple.com/help/app-store-connect/manage-app-accessibility/larger-text-evaluation-criteria (확인: 2026-11-24)
- Dark Interface: 기본이 어둡거나, 시스템 다크 모드나 자체 다크 색 구성으로 계속 어둡게 둘 수 있어야 해요. 잠깐 밝은 화면이 번쩍이는 것도 불편을 줄 수 있어요. https://developer.apple.com/help/app-store-connect/manage-app-accessibility/dark-interface-evaluation-criteria (확인: 2026-11-24)
- Differentiate Without Color Alone: 정보를 색만으로 전하면 안 돼요(이 앱이라면 맞음과 틀림 표시). 위치, 모양, 아이콘, 글자를 함께 쓰고 회색조(Grayscale) 필터로 확인해요. https://developer.apple.com/help/app-store-connect/manage-app-accessibility/differentiate-without-color-alone-evaluation-criteria (확인: 2026-11-24)
- Sufficient Contrast: 기본 상태에서 대부분 글자는 4.5:1, 비텍스트 요소는 3:1(권장)을 넘어야 하고, 다크 모드가 있으면 둘 다 확인해요. https://developer.apple.com/help/app-store-connect/manage-app-accessibility/sufficient-contrast-evaluation-criteria (확인: 2026-11-24)
- Reduced Motion: 문제 되는 모션이 없으면 표시할 수 있어요. 있으면 Reduce Motion 설정에 따라 패럴랙스, 회전 같은 효과를 끄거나 바꿔야 해요. https://developer.apple.com/help/app-store-connect/manage-app-accessibility/reduced-motion-evaluation-criteria (확인: 2026-11-24)

### 표시하지 않을 것

- Captions 와 Audio Descriptions 는 자막이나 설명이 달린 콘텐츠가 거의 없거나 없으면 지원을 표시하지 말라고 해요. https://developer.apple.com/help/app-store-connect/manage-app-accessibility/captions-evaluation-criteria, https://developer.apple.com/help/app-store-connect/manage-app-accessibility/audio-descriptions-evaluation-criteria (확인: 2026-11-24)
- App Store Connect API 의 접근성 선언에는 기능별 참, 거짓 값만 있고 '해당 없음' 값은 없어요. https://developer.apple.com/documentation/appstoreconnectapi/accessibilitydeclaration/attributes-data.dictionary (확인: 2026-11-24)
- 추론: 동영상이나 오디오가 없다면 Captions 와 Audio Descriptions 는 고르지 않는 구조로 보여요. https://developer.apple.com/documentation/appstoreconnectapi/accessibilitydeclaration/attributes-data.dictionary (확인: 2026-11-24)
- 제안: 지금 미리 '표시할 수 있다'고 말할 수 있는 항목은 없어요. 위 7개를 실기기 점검표로 쓰고 통과한 것만 골라요. 출시 전에는 초안까지만 만들어 둬요.

## 15. 아직 정하지 않은 것: 시험 당일 정답과 등급컷을 앱에 넣는 길

- **결론:** 정하지 않았어요. 아래는 비교만 해요. 결정은 사람이 해요.

### 먼저 알 사실

- 학력평가 정답은 시험 당일 오후 6시 이후 교육청 자료실에 올라와요(서울 자료실 기준). https://www.sen.go.kr/user/bbs/BD_selectBbsList.do?q_bbsSn=1036 (확인: 2026-11-24)
- 평가원 시험의 정답은 가안 뒤 이의신청 심사를 거쳐 확정돼요. 2027학년도 9월 모의평가는 9월 2일 가안, 9월 15일 확정이었어요. https://www.suneung.re.kr/boardCnts/fileDown.do?fileSeq=7db01be0a86f976a1bbf7252bc610e95 (확인: 2026-11-24)
- 추론: 공식 등급컷은 성적 발표 무렵에 나와요(13절). 그래서 시험 당일에 넣을 수 있는 공식 자료는 정답과 배점이고, 당일 등급컷은 업체 추정치뿐이에요. https://www.suneung.re.kr/boardCnts/view.do?boardID=1500230&boardSeq=5094275&lev=0&m=0302&searchType=S&statusYN=W&page=1&s=suneung (확인: 2026-11-24)
- 확인하지 못함: 학력평가 정답의 이의신청이나 정정 절차는 이번에 확인하지 않았어요. https://www.sen.go.kr/user/bbs/BD_selectBbsList.do?q_bbsSn=1036 (확인: 2026-11-24)

### 두 길

- A, 앱 업데이트만: 정답(나중에 등급컷)을 번들 데이터에 넣고 새 버전을 심사에 내요. 앱은 계속 네트워크를 쓰지 않아요.
- B, 데이터 파일만 받기: 앱이 고정된 주소 하나에서 시험 데이터 파일(코드가 아님)만 받아요. 앱 코드와 웹 UI 는 번들에 그대로 둬요.

### 심사 시간

- 공통: App Review 는 제출물의 50%를 24시간 안에, 90%를 48시간 안에 심사하는 것이 목표예요. 심사 이력이 적은 앱, 복잡하거나 새로운 문제가 있는 앱은 더 걸릴 수 있어요. 평균 심사 시간은 공개하지 않아요. https://developer.apple.com/help/app-review/after-submitting-for-review/review-status (확인: 2026-11-24)
- 공통: 신속 심사는 치명적 버그 수정이나 이벤트에 맞춘 출시 같은 사정이 있을 때, 이미 제출한 건에 한해 요청할 수 있어요. 가용성과 수요에 따라 처리하고, 정말 급할 때만 요청하라고 해요. https://developer.apple.com/help/app-review/after-submitting-for-review/request-expedited-review (확인: 2026-11-24)
- 공통: App Review 안내는 이벤트 사유를 '개발자가 직접 관련된 이벤트'로 적어요. 외부 모의고사 일정이 여기에 해당하는지는 확인하지 못했어요. https://developer.apple.com/distribute/app-review/ (확인: 2026-11-24)
- 공통: 승인 뒤 모든 스토어프런트에 보이기까지 최대 24시간이 걸릴 수 있어요. https://developer.apple.com/app-store/review/guidelines/ (확인: 2026-11-24)
- A: 시험마다 심사를 거쳐요. 오후 6시 이후 정답을 넣어 내면 학생이 받는 때는 다음 날 이후가 될 수 있어요(추론). 정답이 바뀌면 또 심사를 받아요. https://developer.apple.com/help/app-review/after-submitting-for-review/review-status (확인: 2026-11-24)
- A: 2027년 4월 이후의 업데이트는 iOS 27 SDK 로 빌드해야 해요(3절). https://developer.apple.com/app-store/submitting/ (확인: 2026-11-24)
- B: 데이터 파일을 바꿀 때마다 앱 심사를 받지는 않아요(추론). 다만 받기 기능을 처음 넣는 버전은 심사를 받고, 새 기능과 변경은 심사 메모에 구체적으로 적어야 하며(2.3.1(a)), 심사 중 기능을 숨기면 안 돼요. https://developer.apple.com/app-store/review/guidelines/, https://developer.apple.com/help/app-review/after-submitting-for-review/review-status (확인: 2026-11-24)
- B 의 변형: Apple 이 호스팅하는 에셋 팩은 앱 빌드와 따로 내려받지만, 외부 TestFlight 나 App Store 에 내기 전에 App Review 심사를 받아요. https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/submit-apple-hosted-asset-packs (확인: 2026-11-24)
- Background Assets 프레임워크로 개발자 서버나 CDN 에서 추가 콘텐츠를 백그라운드로 받도록 예약할 수 있고, iOS 26 이상을 대상으로 하는 앱은 시스템이 관리하는 Managed Background Assets 를 쓸 수 있어요. 최소 iOS 18.0 인 이 앱에 어떤 방식이 맞는지는 확인하지 못했어요(작업 지시서 4는 뒤에서 받지 않기로 했어요). https://developer.apple.com/help/app-store-connect/manage-asset-packs/overview-of-apple-hosted-asset-packs (확인: 2026-11-24)

### 사용자 수고

- A: 학생이 App Store 에서 새 버전을 받아야 새 시험이 보여요(추론).
- B: 학생이 인터넷이 될 때 한 번 받아야 해요(추론). 첫 실행에 추가 리소스를 받아야 작동한다면 크기를 알리고 받기 전에 확인을 받아야 해요(4.2.3(ii)). https://developer.apple.com/app-store/review/guidelines/ (확인: 2026-11-24)

### '네트워크 없음' 원칙

- A: 원칙을 그대로 지켜요. 콘텐츠 규칙과 처리방침 문구를 바꿀 필요가 없어요(추론).
- B: 원칙이 깨져요. 주소 하나만 여는 예외를 껍데기나 콘텐츠 규칙에 만들어야 하고, 처리방침과 안내 문구도 바꿔야 해요(추론).

### 앱 개인정보 답변

- A: '데이터를 수집하지 않음'이 그대로 맞아요(8절의 추론).
- B: 요청에는 IP 주소 같은 정보가 따라가요. 서버나 호스팅이 이를 실시간 처리보다 오래 남겨 개발자나 제3자가 볼 수 있으면 '수집'이 될 수 있어요(추론). 남기지 않으면 공개하지 않아도 된다는 안내가 있어요. 호스팅의 기록 정책은 사람이 확인해야 해요. https://developer.apple.com/app-store/app-privacy-details/ (확인: 2026-11-24)

### 지침 2.5.2 와 관련 조항

- 2.5.2 는 앱이 번들 안에서 자기완결적이어야 하고, 지정된 컨테이너 밖 데이터를 읽거나 쓸 수 없으며, 앱 기능을 넣거나 바꾸는 코드를 다운로드, 설치, 실행할 수 없다고 해요. https://developer.apple.com/app-store/review/guidelines/ (확인: 2026-11-24)
- 가이드라인에는 '코드가 아닌 데이터 파일 다운로드는 허용된다'는 명시 문장이 없고, 받은 데이터가 언제 '기능 변경'이 되는지 기준도 없어요. https://developer.apple.com/app-store/review/guidelines/ (확인: 2026-11-24)
- 4.7 은 바이너리에 없는 HTML5, JavaScript 미니 앱 등을 4.7.1~4.7.5 조건 아래 허용해요. https://developer.apple.com/app-store/review/guidelines/ (확인: 2026-11-24)
- PLA 3.3.1 B 는 실행 코드 다운로드를 막고, 해석형 코드는 앱의 주된 목적을 바꾸지 않고 OS 보안 기능을 우회하지 않으며 다른 앱 스토어를 만들지 않을 때만 받게 해요. https://developer.apple.com/support/terms/apple-developer-program-license-agreement/ (확인: 2026-11-24)
- PLA 3.3.1 C 는 Apple 의 사전 서면 승인이나 인앱 구입이 아니면 App Store, Custom App Distribution, TestFlight 밖의 경로로 추가 기능을 주거나 잠금 해제할 수 없다고 해요. https://developer.apple.com/support/terms/apple-developer-program-license-agreement/ (확인: 2026-11-24)
- A: 데이터가 번들에 들어가 앱과 함께 심사되므로 이 조항들과 부딪칠 일이 적어요(추론).
- B: 받는 파일은 순수 데이터(예: 정답 번호와 배점만 든 JSON)로 두고, 웹 UI 가 그 내용을 코드로 실행하지 않게 해야 해요(추론). 심사 메모에 받기 기능, 주소, 파일 형식을 적어요(제안).
- 제안: B 를 검토한다면 App Review 1:1 상담으로 먼저 물어보는 방법이 있어요(10절). https://developer.apple.com/help/app-review/before-submitting-for-review/app-review-appointment (확인: 2026-11-24)

### 보안

- A: 외부 서버가 없어서 데이터가 바뀌는 경로가 앱 배포뿐이에요(추론).
- B: 호스팅 계정을 잃거나 남에게 넘어가면 학생에게 틀린 정답이 갈 수 있고, 시험 날 서버가 멈추면 받을 수 없어요(추론).
- B 를 고른다면 생각할 대책(제안): HTTPS 만 허용, 호스트 하나만 허용, 앱에 넣은 공개키로 데이터 서명 확인, 형식과 크기 검사, 받은 내용은 실행하지 않기, 실패하면 번들 데이터로 돌아가기.
- 공통: 정답은 공식 공개 전에는 다루지 않아요. 2025학년도 6월 고1 학력평가 영어는 정답 유출 정황으로 17개 시도교육청이 공동으로 수사를 의뢰했어요. https://enews.sen.go.kr/news/view.do?bbsSn=189012&step1=3&step2=1 (확인: 2026-11-24)
- B: 공식 공개 전에 파일을 미리 올려 두면 주소를 아는 사람이 먼저 볼 수 있어요(추론).

### 정하기 전에 답할 질문

- 학생이 시험 당일 저녁에 바로 채점해야 하나요, 다음 날도 괜찮나요?
- '네트워크 없음'을 사용자에게 약속으로 내세울 건가요?
- 등급은 당일 보여 줄 건가요, 공식 등급컷이 나온 뒤에만 보여 줄 건가요(13절)?
- 시험마다 심사 일정을 감당할 수 있나요? 2027년 4월 이후 Xcode 27 환경을 갖출 수 있나요?
- 서버(호스팅)를 계속 관리할 사람이 있나요?

## 16. 확인하지 못한 것

### 계정과 SDK

- 확인하지 못함: 2027년 4월 SDK 요건의 정확한 날짜. 이유: Submitting 페이지와 2026년 9월 9일 뉴스는 'April 2027'만 적고, Upcoming Requirements 에는 아직 없어요. https://developer.apple.com/app-store/submitting/, https://developer.apple.com/news/upcoming-requirements/ (확인: 2026-11-24)
- 확인하지 못함: 웹 등록의 원화 가격과 부가세 포함 여부. 이유: 공식 페이지에 없어요. 확인한 원화 금액은 Apple Developer 앱의 앱 내 구입 129,000원뿐이에요. https://developer.apple.com/help/account/membership/program-enrollment/ (확인: 2026-11-24)
- 확인하지 못함: 미성년자를 위한 보호자 계정 공유 등록의 구체 절차(판매자 이름, 이중 인증 기기, 공유 범위)와 Apple Developer Agreement 1조의 공유 금지 문구와의 관계. 이유: Apple 이 문의하라고만 안내해요. https://developer.apple.com/programs/enroll/, https://developer.apple.com/support/downloads/terms/apple-developer-agreement/Apple-Developer-Agreement-20250318-English.pdf (확인: 2026-11-24)
- 확인하지 못함: 무료 계정의 베타 소프트웨어 접근 범위. 이유: 계정 개요는 무료 등록으로 베타 Xcode 와 OS 를 받을 수 있다고 하고, 등록 FAQ 는 베타 접근에 등록이 필요하다고 하며, Agreement 는 성년을 요구해요. https://developer.apple.com/help/account/basics/about-your-developer-account/, https://developer.apple.com/help/account/membership/program-enrollment/ (확인: 2026-11-24)
- 확인하지 못함: iPhone Duo 스크린샷이 필수인 범위. 이유: 뉴스는 '모든 앱', 스크린샷 사양은 'iOS 27.1 SDK 이상을 쓰는 앱'이라고 달리 적어요. https://developer.apple.com/news/?id=kkphp5qo, https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications (확인: 2026-11-24)
- 확인하지 못함: Xcode 26.4.1 의 실제 메뉴 이름. 이유: 확인한 Xcode 문서는 최신 Xcode 용어(Device Hub 등)를 써요. https://developer.apple.com/documentation/xcode/running-your-app-on-simulated-or-physical-devices (확인: 2026-11-24)

### TestFlight

- 확인하지 못함: 이 앱이 PLA 7.4 의 '주로 아동 대상'인지. 이유: 약관에 정의와 기준이 없어요. Apple 에 물어야 해요. https://developer.apple.com/support/terms/apple-developer-program-license-agreement/ (확인: 2026-11-24)
- 확인하지 못함: TestFlight 의 한국 최소 연령 숫자. 이유: 약관은 '해당 지역의 최소 연령'만 적고, 대한민국 Apple 미디어 서비스 약관은 14세와 13세 문장이 섞여 있어요. https://www.apple.com/legal/internet-services/itunes/testflight/kr/terms.html, https://www.apple.com/legal/internet-services/itunes/kr/terms.html (확인: 2026-11-24)
- 확인하지 못함: 미성년자가 App Store Connect 사용자(내부 테스터)가 될 수 있는지. 이유: 사용자 추가 도움말에 연령 언급이 없고, Apple Developer Agreement 가 App Store Connect 전용 사용자에게 적용되는지 명시가 없어요. https://developer.apple.com/help/app-store-connect/manage-your-team/add-and-edit-users (확인: 2026-11-24)
- 확인하지 못함: 테스트 참가 학생에게 주는 사례가 2.2 의 '대가'인지. 이유: 공식 설명이 없고, 영어 원문과 한국어 번역의 뉘앙스가 달라요. https://developer.apple.com/app-store/review/guidelines/, https://developer.apple.com/kr/app-store/review/guidelines/ (확인: 2026-11-24)
- 확인하지 못함: TestFlight App Review 에 걸리는 시간. 이유: 읽은 공식 페이지에 없어요. https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview (확인: 2026-11-24)
- 확인하지 못함: 외부 테스트용 테스트 정보의 전체 필수 항목. 이유: 참조 링크가 App Store 버전 정보 페이지로 넘어가요. App Store Connect 화면에서 확인해야 해요. https://developer.apple.com/help/app-store-connect/test-a-beta-version/provide-test-information (확인: 2026-11-24)
- 확인하지 못함(비공식 보고): Apple Developer Forums 에 TestFlight 에서 'must be at least 13' 류 메시지로 막혔다는 글(2017~2022년, 성인 사례 포함)이 있어요. Apple 직원 답변은 없어요. https://developer.apple.com/forums/thread/86297, https://developer.apple.com/forums/thread/703620 (확인: 2026-11-24)
- 확인하지 못함(비공식 보고): 2026년 10~11월 포럼에 TestFlight 초대 메일이 가지 않고 외부 심사 제출이 HTTP 422 오류로 실패한다는 글이 여럿 있어요. 공식 공지는 찾지 못했고, Apple 개발자 시스템 상태에는 2026년 11월 24일 현재 TestFlight 의 진행 중 이벤트가 없었어요. https://developer.apple.com/forums/thread/857429, https://www.apple.com/support/systemstatus/data/developer/system_status_en_US.js (확인: 2026-11-24)

### 개인정보

- 확인하지 못함: 앱 안 처리방침 글만으로 5.1.1(i)의 '앱 안 링크'를 채우는지. 이유: 공식 문구가 없어요. https://developer.apple.com/app-store/review/guidelines/ (확인: 2026-11-24)
- 확인하지 못함: 'No' 응답이 제품 페이지에 'Data Not Collected'로 보인다는 직접 문장. 이유: 개발자 문서에 둘을 잇는 문장이 없고, Apple 앱의 표시 예만 있어요. https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy/, https://www.apple.com/privacy/labels/ (확인: 2026-11-24)
- 확인하지 못함: 'No'를 고른 뒤에도 Publish 가 필요한지. 이유: 절차에 따로 구분해 적혀 있지 않아요. https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy/ (확인: 2026-11-24)
- 확인하지 못함: 기기 백업에 들어가는 것이 '수집'인지. 이유: App Privacy Details 에 언급이 없어요. 가장 가까운 것은 Apple 자체 앱 FAQ 예요. https://developer.apple.com/app-store/app-privacy-details/, https://support.apple.com/en-us/102399 (확인: 2026-11-24)
- 확인하지 못함: App Store Connect 의 앱 분석을 보는 것이 'Apple 서비스에서 앱 데이터를 모으는 것'인지. 이유: 공식 설명을 찾지 못했어요. https://developer.apple.com/app-store/app-privacy-details/ (확인: 2026-11-24)
- 확인하지 못함: required reason API 를 쓰지 않고 데이터도 모으지 않는 앱이 매니페스트를 꼭 넣어야 하는지. 이유: 문서는 '포함할 수 있다'고 하고, TN3181 은 무효 매니페스트 문맥에서 '유효한 매니페스트 포함'을 적어요. https://developer.apple.com/documentation/bundleresources/privacy-manifest-files, https://developer.apple.com/documentation/technotes/tn3181-debugging-invalid-privacy-manifest (확인: 2026-11-24)
- 확인하지 못함: SwiftUI @AppStorage 나 WKWebView 내부 저장이 앱 매니페스트 신고 대상인지. 이유: 문서는 '앱 코드에서 API 를 쓰면 보고'라고만 해요. https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api, https://developer.apple.com/documentation/swiftui/appstorage (확인: 2026-11-24)
- 확인하지 못함: 한국의 학생 개인 개발자가 Support URL 에 어디까지 연락처를 공개해야 하는지. 이유: '현지 법이 요구할 수 있는'이라는 단서뿐이에요. https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information (확인: 2026-11-24)

### 등급, 카테고리, 접근성

- 확인하지 못함: Education 앱에 보이는 한국 지역 등급. 이유: 도움말 표와 뉴스의 적용 범위가 달라요. https://developer.apple.com/help/app-store-connect/reference/age-ratings-values-and-definitions, https://developer.apple.com/news/?id=oj3r9pvw (확인: 2026-11-24)
- 확인하지 못함: 혼자 쓰는 점수 분석이 Contests 인지와 실제 계산 등급. 이유: 문서에 기준이 없고, 설문을 해야 등급이 나와요. https://developer.apple.com/help/app-store-connect/reference/age-ratings-values-and-definitions (확인: 2026-11-24)
- 확인하지 못함: 새 연령 등급 기술자의 시작일. 이유: 뉴스는 2026년 11월 16일, 릴리스 노트는 11월 19일로 달라요. 두 날짜 모두 지났어요. https://developer.apple.com/news/?id=yxkh08us, https://developer.apple.com/help/app-store-connect/release-notes/ (확인: 2026-11-24)
- 확인하지 못함: 가이드라인 5.1.4 의 '주로 아동을 위한 앱'에서 아동의 나이. 이유: 가이드라인에 정의가 없어요(Kids 카테고리만 11세 이하로 정의). https://developer.apple.com/app-store/review/guidelines/, https://developer.apple.com/app-store/categories/ (확인: 2026-11-24)
- 확인하지 못함: 접근성 라벨이 필수가 되는 날짜. 이유: 개요 페이지에 날짜가 없고 Upcoming Requirements 에도 없어요. https://developer.apple.com/help/app-store-connect/manage-app-accessibility/overview-of-accessibility-nutrition-labels, https://developer.apple.com/news/upcoming-requirements/ (확인: 2026-11-24)
- 확인하지 못함: 동영상, 오디오가 없는 앱의 Captions, Audio Descriptions 가 제품 페이지에 어떻게 보이는지. 이유: 관리 페이지는 기기별 Yes, No 와 기능 선택만 설명해요. https://developer.apple.com/help/app-store-connect/manage-app-accessibility/manage-accessibility-nutrition-labels (확인: 2026-11-24)
- 확인하지 못함: 번들된 자체 웹 UI 에 대한 접근성 평가 기준. 이유: WebKit 기본 지원 설명은 제3자 웹사이트 맥락이에요. https://developer.apple.com/help/app-store-connect/manage-app-accessibility/overview-of-accessibility-nutrition-labels (확인: 2026-11-24)

### 심사와 iPad

- 확인하지 못함: '예시' 샘플 시험이 2.1 의 임시 콘텐츠나 2.2 의 데모인지. 이유: 공식 기준이 없어요. https://developer.apple.com/app-store/review/guidelines/ (확인: 2026-11-24)
- 확인하지 못함: 코드가 아닌 데이터 파일 다운로드의 명시적 허용과 '기능 변경' 판단 기준. 이유: 가이드라인에 없어요. https://developer.apple.com/app-store/review/guidelines/ (확인: 2026-11-24)
- 확인하지 못함: 최소 iOS 18.0 앱에서 Apple 호스팅 에셋 팩을 쓸 수 있는지. 이유: 이번 자료에 없어요. https://developer.apple.com/help/app-store-connect/manage-asset-packs/overview-of-apple-hosted-asset-packs (확인: 2026-11-24)
- 확인하지 못함: iPhone 스크린샷의 필수 등급. 이유: 요약과 상세 표의 표현이 달라요. 업로드 화면에서 확인해야 해요. https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications (확인: 2026-11-24)
- 확인하지 못함: iPhone 전용 앱에 13인치 iPad 스크린샷이나 Mac, Vision Pro 스크린샷이 필요한지. 이유: 사양 페이지에 명시가 없어요. https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications (확인: 2026-11-24)
- 확인하지 못함: iOS 26.4 SDK 빌드가 iPadOS 27 에서 크기 조절 창으로 열리는지. 이유: 자료는 최신 SDK 로 다시 빌드하면 자동 적용된다고만 해요. https://developer.apple.com/videos/play/wwdc2026/102/ (확인: 2026-11-24)
- 확인하지 못함: 외부 모의고사 일정이 신속 심사의 '직접 관련된 이벤트'인지. 이유: 문서에 명시가 없어요. https://developer.apple.com/distribute/app-review/ (확인: 2026-11-24)
- 확인하지 못함: 신속 심사 요청 양식의 항목. 이유: 양식 주소가 Apple 계정 로그인 페이지로 넘어가요. https://developer.apple.com/contact/app-store/?topic=expedite (확인: 2026-11-24)
- 확인하지 못함: Apple 의 평균 심사 시간. 이유: 목표치(50%는 24시간, 90%는 48시간)만 공개해요. https://developer.apple.com/help/app-review/after-submitting-for-review/review-status (확인: 2026-11-24)

### 시험 자료

- 확인하지 못함: 정답 번호, 배점, 등급컷 숫자만 쓰는 것이 복제 금지 고지에 해당하는지. 이유: 평가원, 교육청의 공식 설명이 없어요. https://www.suneung.re.kr/boardCnts/list.do?boardID=1500234&m=0403&s=suneung&searchStr= (확인: 2026-11-24)
- 확인하지 못함: 다른 영역, 연도, 시험 자료의 공공누리 표시. 이유: 몇 개 파일만 열어 봤어요. https://www.suneung.re.kr/boardCnts/fileDown.do?fileSeq=970fb683af8df94b36d29efe00741532 (확인: 2026-11-24)
- 확인하지 못함: 교육청, 평가원 저작물에 제24조의2 가 적용되는지와 평가원의 공공기관 지정 여부. 이유: 공식 해석을 찾지 못했어요. https://www.law.go.kr/법령/저작권법/제24조의2, https://www.mcst.go.kr/kor/s_policy/subPolicy/contents/contents04.jsp?pSeq=20 (확인: 2026-11-24)
- 확인하지 못함: 업체 추정 등급컷의 법적 성격. 이유: 약관만 있고 공식 판단이 없어요. https://www.megastudy.net/member/member_new/member_personsecure.asp?TabNo=2, https://sso.ebs.co.kr/policy/termsInfo (확인: 2026-11-24)
- 확인하지 못함: 2027학년도 수능 채점 결과(등급컷) 공개 날짜. 이유: 성적 통지 예정일(12월 11일)만 확인했어요. https://www.suneung.re.kr/boardCnts/fileDown.do?fileSeq=d752e093523e565f856944085b40db1e (확인: 2026-11-24)
- 확인하지 못함: 2026학년도 전체 월별 출제 교육청 분담표, 2027년 3월 학력평가 출제 교육청, 부산과 경기 누리집의 저작권 안내. 이유: 서울, 인천 안내와 2025년 보도자료의 분담만 확인했어요. https://enews.sen.go.kr/news/view.do?bbsSn=189012&step1=3&step2=1 (확인: 2026-11-24)
- 확인하지 못함: 2027학년도 수능 시행기본계획과 채점 결과 보도자료 본문. 이유: hwp 파일이라 열지 못했어요. https://www.suneung.re.kr/main.do?s=suneung (확인: 2026-11-24)
- 확인하지 못함: 인천 게시물에 첨부된 통계자료 xlsx 의 내용. 이유: 파일 요청이 403 으로 거부됐어요. https://www.ice.go.kr/ice/na/ntt/selectNttInfo.do?mi=10910&bbsId=1703&nttSn=3388884 (확인: 2026-11-24)
- 확인하지 못함: 학력평가 정답의 이의신청이나 정정 절차, 교육청 정답표의 형식. 이유: 이번에 확인하지 않았어요. https://www.sen.go.kr/user/bbs/BD_selectBbsList.do?q_bbsSn=1036 (확인: 2026-11-24)

## 17. 사람이 할 일 체크리스트

### 지금(2026년 12월 전)

- [ ] 등록할 사람(본인 또는 보호자)을 정해요. 만 19세 미만이면 보호자와 상의하고, Apple 에 보호자 등록과 계정 공유 방법을 물어요(4절).
- [ ] 등록 방법(웹 또는 Apple Developer 앱)을 골라요. 웹 등록이면 만료일을 달력에 적어요(4절).
- [ ] 등록자 본인 명의 카드와 법적 이름의 로마자 표기를 준비해요(4절).
- [ ] Mac 이 macOS Tahoe 26.6 이상을 돌릴 수 있는지 봐요(3절).
- [ ] PLA 7.4 해석(고등학생 대상 앱이 '주로 아동 대상'인지)을 Apple 에 묻고 답을 보관해요(5절).
- [ ] 15절의 질문에 답하기 시작해요.

### TestFlight 전

- [ ] 처리방침 글을 쓰고 오래 쓸 주소에 정적 페이지로 공개해요(6절).
- [ ] 앱 안 처리방침과 문의 화면의 방식(웹 번들 화면 또는 네이티브 화면)을 정하고 넣어요(6, 7절).
- [ ] 개인정보 매니페스트를 점검해요. 껍데기 코드의 UserDefaults, 파일 시각, 디스크 공간 API 사용 여부를 보고, plutil -lint 와 Generate Privacy Report 로 확인해요(8절).
- [ ] App Store Connect 에 앱을 만들었다면 2027년 1월 12일 전에 연령 등급 설문(새 항목 포함)을 끝내요(9절).
- [ ] 베타 앱 설명, 피드백 이메일, 베타 앱 심사 정보를 써요. '예시' 데이터가 가짜라는 점을 적어요(5, 11절).
- [ ] 내부 그룹을 만들고 내 기기에서 먼저 받아 봐요. 그다음 외부 그룹을 만들어요(5절).
- [ ] 외부 테스트용 빌드는 'TestFlight Internal Only'로 올리지 않아요(5절).
- [ ] 이메일 초대와 공개 링크(인원 제한) 중 하나를 골라요(5절).
- [ ] 학생과 보호자용 안내문을 만들어요. TestFlight 약관의 보호자 검토, Apple 의 충돌 로그와 사용 정보 수집, 베타 비공개 의무, 연락 동의를 담아요(5절).
- [ ] 사례를 줄지 2.2 와 약관 해석을 본 뒤 정해요(5절).
- [ ] 학생 기기 1대로 TestFlight 설치를 미리 해 봐요. 학교 관리형 계정은 안 되고 iOS 18 이상이어야 해요(5절).
- [ ] 빌드를 올린 날부터 90일 안에 사용성 테스트 날짜를 잡아요(5절).

### App Store 제출 전

- [ ] Privacy Policy URL 과 Support URL 을 넣어요(6, 7절).
- [ ] App Privacy 에서 'No, we do not collect data from this app'을 고르고 Publish 단계까지 끝내요(8절).
- [ ] 연령 범주는 Not Applicable 로 하고 등급 설문을 정직하게 끝내요(9절).
- [ ] 주 카테고리, 보조 카테고리, 제공 국가를 정해요(9절).
- [ ] 쓸 시험 자료마다 공공누리 표시를 보고, 없으면 평가원이나 교육청과 미리 협의해 기록을 남겨요(13절).
- [ ] Content Rights 에 정직하게 답하고 권한 증빙을 준비해요(13절).
- [ ] 화면의 등급 표시가 공식 기준(수학은 표준점수)과 어긋나지 않는지 봐요(13절).
- [ ] '예시' 샘플만 든 빌드는 App Store 에 내지 않아요(11절).
- [ ] iPad 실기기에서 호환 모드로 모든 기능을 확인해요(12절).
- [ ] Mac, Vision Pro 제공 여부를 정해요(12절).
- [ ] 업로드 화면에서 필수 스크린샷 등급을 확인하고, 사용 화면 위주로 만들어요(12절).
- [ ] 심사 메모를 써요. 오프라인 전용, 네트워크 차단 방식, 웹 UI 를 쓰는 이유, 대상, 테스트한 기기와 iOS 버전, 처리방침 위치를 적어요(10절).
- [ ] 4.2 대응으로 더할 네이티브 기능을 골라요(10절).
- [ ] 필요하면 App Review 1:1 상담을 신청해요(10, 15절).
- [ ] 15절의 A 와 B 중 하나를 정해요.
- [ ] 제출 직전에 Upcoming Requirements 와 가이드라인 날짜를 다시 봐요(2절).

### 출시 뒤

- [ ] 실제 iPhone 에서 접근성 항목을 하나씩 점검하고, 통과한 것만 라벨로 게시해요(14절).
- [ ] 멤버십이 끝나기 전에 갱신해요(4절).

### 2027년 4월 전후

- [ ] iOS 27 SDK 요건의 정확한 날짜를 다시 봐요(3절).
- [ ] Xcode 27 로 옮기기 전에 UIScene 생명주기와 방향 설정을 확인해요(3절).
- [ ] iPhone Duo 스크린샷 요건이 이 앱에 걸리는지 다시 봐요(3, 12절).
