# Traderie Chat Translator

[traderie.com](https://traderie.com) 채팅에서 외국어로 거래할 때 자동으로 번역해주는 Chrome 확장 프로그램입니다.
기존 [google-chat-translator](../google-chat-translator)의 번역 엔진을 재사용하고, traderie 채팅 DOM에 맞게 화면 후킹 부분만 새로 구현했습니다.

---

## 주요 기능

| 기능 | 설명 |
|------|------|
| **발신 자동 번역** | 한글로 입력 후 Enter → 자동으로 설정 언어로 번역하여 전송 |
| **수신 자동 번역** | 상대방 메시지를 받으면 원문 아래에 🌐 번역 뱃지 표시 |
| **언어 자동 감지** | 이미 목표 언어인 메시지는 번역 스킵 (API 호출 최소화) |
| **AI 번역 엔진** | Google 무료 / Google Cloud / Gemini / Claude / ChatGPT 선택 |
| **번역 캐시** | 동일 텍스트 재번역 방지 (최대 500건) |
| **용어 사전** | 게임 용어 번역 방지 또는 커스텀 번역. **디아블로2 룬 33종 기본 내장** |
| **채팅방별 ON/OFF** | 플로팅 버튼 또는 `Alt+T`로 토글 |
| **AI 톤 설정** | 자연스러운/격식체/비격식체/비즈니스/친근한 (AI 엔진 전용) |
| **뷰포트 기반 번역** | 화면에 보이는 메시지만 번역 |

---

## 지원 번역 엔진

| 엔진 | API 키 | 비용 |
|------|--------|------|
| **Google 번역 (무료)** | 불필요 | 무료 (기본값) |
| **Google Cloud Translation** | 필요 | 유료 |
| **Gemini (Google AI)** | 필요 | 무료 티어 있음 |
| **Claude (Anthropic)** | 필요 | 유료 |
| **ChatGPT (OpenAI)** | 필요 | 유료 |

---

## 설치 방법 (개발자 모드)

1. Chrome 주소창에 `chrome://extensions` 입력
2. 우측 상단 **개발자 모드** 토글 ON
3. **압축 해제된 확장 프로그램을 로드합니다** 클릭
4. 이 폴더(`traderie-chat-translator`) 선택
5. `traderie.com` 채팅 탭이 열려 있으면 새로고침

---

## 초기 설정

1. Chrome 우측 상단 퍼즐 아이콘(🧩) → **Traderie Chat Translator** 클릭
2. 번역 엔진 선택 (기본: Google 무료)
3. AI 엔진 선택 시 해당 API 키 입력
4. 발신/수신 언어 설정 → **저장하기**

---

## 사용 방법

- **보내기**: 입력창에 한글로 입력 후 `Enter` → 자동 번역되어 전송 (이미 목표 언어면 그대로 전송)
- **받기**: 상대 메시지 아래에 🌐 번역이 자동 표시
- **토글**: `Alt+T` 또는 우측 하단 플로팅 버튼으로 채팅방별 번역 ON/OFF

---

## Traderie DOM 연동 정보 (유지보수용)

> traderie는 styled-components(해시 클래스 `sc-*`)를 쓰므로, **의미 있는 고정 클래스명**만 셀렉터로 사용합니다.
> 아래는 2026-07 기준 실측 구조입니다. 사이트 개편 시 이 부분만 점검하면 됩니다.

| 용도 | 셀렉터 / 규칙 |
|------|------|
| 메시지 스크롤 컨테이너 | `.messages-container` |
| 개별 메시지 | `.message-container` (텍스트: `.message-content`, 작성자: `.message-from`) |
| 발신/수신 구분 | 메시지 내 `a[href*="/profile/{roomId}"]` 있으면 **수신**, 없으면 **발신(나)**. `roomId` = URL `/chat/{id}` = 상대방 profile id |
| 입력창 | `form.messages-chat-bar textarea[placeholder="Type a message..."]` |
| 전송 | `form.messages-chat-bar` submit (`requestSubmit()`) / `button.app-btn[type="submit"]` |
| 입력 방식 | **React controlled textarea** → native value setter + `input` 이벤트로 값 주입 |

### 검증된 동작 (실측)
- ✅ 수신 메시지 탐지 + 발신/수신 분류 (실제 대화 데이터로 확인)
- ✅ 수신 메시지 번역 뱃지 부착 (실제 무료 API로 "HI" → "안녕" end-to-end 확인)
- ✅ React textarea 값 주입 (native setter 방식으로 값 유지 확인)
- ⚠️ **발신 전송(Enter → 번역 → requestSubmit)**: 실제 상대에게 메시지가 전송되므로 자동 검증에서 제외.
  최초 사용 시 본인 계정 간 테스트 등으로 한 번 확인 권장. 만약 Enter가 전송이 아닌 줄바꿈으로 동작한다면
  `content.js`의 keydown 인터셉트 로직을 조정해야 함.

---

## 기본 용어 사전 (디아블로2 룬 33종)

[glossary-defaults.js](glossary-defaults.js)에 정의되어 있으며 최초 설치 시 자동 적용됩니다 (팝업에서 개별 삭제 가능).

- **영문 룬 이름 33종** (El ~ Zod): 번역하지 않고 원문 유지 — `vex`가 "성가시게 하다"로 오역되는 것 방지. 단어 경계 매칭이라 `Hello` 속 `El`, `drum` 속 `Um`은 건드리지 않음
- **한글 룬 이름(2음절 이상) 16종** (엘드, 티르, 네프, 에드, 아이드, 오르트, 주울, 샤엘, 이오, 아이스트, 벡스, 오움, 수르, 베르, 우움, 조드): 발신 시 영문 룬 이름으로 변환 — "벡스로 살게요" → "Vex로 살게요" → 번역
- **1음절 한글 이름(로·말·돌·솔 등)은 기본 등록 제외** — 한국어 조사/일반 단어와 충돌하기 때문. 해당 룬은 영문명으로 입력 (예: "Lo 팔아요")

---

## 변경 이력

### v1.1.0
- 디아블로2 룬 33종 기본 용어 사전 내장 (`glossary-defaults.js`)
- 용어 사전 영문 단어 경계 매칭 — 짧은 룬 이름이 일반 단어 내부에 매칭되던 문제 방지

### v1.0.0
- 최초 릴리스

---

## 크롬 웹스토어 배포

배포 절차·등록 자료·체크리스트는 [STORE_ASSETS/store-description.md](STORE_ASSETS/store-description.md) 참조.

- 배포 zip 생성: `python -c` 스크립트 또는 store-description.md의 명령 참조 (스토어 필수 파일만 포함)
- 개인정보처리방침: [privacy-policy.html](privacy-policy.html) → GitHub Pages로 호스팅
  (`https://pks424.github.io/traderie-chat-translator/privacy-policy.html`)
- 스크린샷: `STORE_ASSETS/screenshot*.html`을 Chrome에서 열어 1280×800 캡처

---

## 개인정보 및 보안

- 입력/수신 텍스트는 선택한 번역 엔진으로만 전송됩니다.
- 별도 서버로 데이터를 수집·저장하지 않습니다.
- API 키를 포함한 모든 설정은 `chrome.storage.local`에만 저장됩니다.

---

## 라이선스

MIT License
