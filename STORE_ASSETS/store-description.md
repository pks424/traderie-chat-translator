# Chrome Web Store 등록 자료

## Extension 이름
Traderie Chat Translator

---

## 단기 설명 (Short Description) — 132자 이내
Auto-translate Traderie chat in real time. Type in your language, send in theirs. Incoming messages translated instantly.

---

## 상세 설명 (Full Description)

**Traderie Chat Translator** automatically translates chat messages on traderie.com so you can trade effortlessly across language barriers — without ever leaving the chat window.

Perfect for Diablo II: Resurrected, Animal Crossing, and every other game community on Traderie where you negotiate with traders from all over the world.

### Key Features

**📤 Outgoing Message Translation**
Type your message in your native language and press Enter. The extension automatically detects the language and translates it into your chosen target language before sending.

**📥 Incoming Message Translation**
Incoming messages from other traders are automatically translated and displayed beneath the original text, so you can read them in your language instantly.

**🤖 Multiple Translation Engines**
Works out of the box with no API key needed (free Google Translate endpoint). For higher-quality AI translation, you can optionally use your own API key with Gemini, Claude (Anthropic), or ChatGPT (OpenAI) — including tone control (formal / casual / business / friendly).

**📖 Glossary for Game Terms**
Keep item names like "Vex", "Ohm", "Enigma" untranslated — or map them to your own custom translations.

**⚡ Efficient by Design**
Only messages visible on screen are translated (viewport-based), identical texts are served from cache, and messages already in your language are skipped — minimizing API usage.

**⌨️ Per-Chat Toggle**
Press **Alt+T** or use the floating button to turn translation on/off for each chat room individually.

### How It Works
1. Install the extension and open a chat on traderie.com.
2. Click the extension icon to configure your outgoing and incoming language settings.
3. Start chatting — translation happens automatically!

### Privacy
The extension sends message text only to the translation service you select. No personal data is collected or stored by the extension itself. User preferences (language settings, glossary, API keys) are saved locally in your browser only.

---

## 카테고리
Productivity

## 언어
English, 한국어

## 태그 (검색 키워드)
traderie, translate, translator, auto translate, chat translation, diablo 2 resurrected, trading, language, multilingual, korean, japanese, chinese

---

## 스크린샷 촬영 가이드 (1280×800 또는 640×400)

1. **스크린샷 1** – 수신 메시지 번역 표시 화면 (`screenshot1-incoming-translation.html` → Chrome에서 열어 1280×800 캡처)
2. **스크린샷 2** – 팝업 설정 화면 (`screenshot2-popup.html` → 1280×800 캡처)
3. **스크린샷 3** – (선택) 실제 traderie 채팅 화면 캡처 — 상대 아이디/개인정보는 가리고 사용

> 목업 HTML은 Chrome에서 열고 DevTools로 뷰포트를 1280×800으로 맞춘 뒤 캡처하세요.

---

## 개인정보처리방침 URL
https://pks424.github.io/traderie-chat-translator/privacy-policy.html

> ⚠️ GitHub Pages 활성화 필요: 저장소 Settings → Pages → Branch `main` / root 선택 후 Save.
> 활성화 후 위 URL이 열리는지 확인하고 스토어에 등록.

---

## 스토어 등록 체크리스트

- [ ] 아이콘 확인 (16px, 48px, 128px PNG — traderie 로고 마크)
- [ ] 스크린샷 업로드 (STORE_ASSETS/screenshot*.html → Chrome에서 열어 1280×800 캡처)
- [ ] GitHub Pages 활성화 후 개인정보처리방침 URL 등록
- [ ] 배포 zip 업로드 (`traderie-chat-translator.zip` — 스토어 필수 파일만 포함)
- [ ] 개발자 계정: 기존 GChat Auto Translator 배포에 사용한 계정 그대로 사용 (등록비 재결제 불필요)
- [ ] 검토 기간 대기 (보통 1-3 영업일)

## 배포 zip 만들기

```
# 프로젝트 루트에서 (PowerShell)
Compress-Archive -Force -Path manifest.json,content.js,background.js,popup.html,popup.js,styles.css,icons -DestinationPath traderie-chat-translator.zip
```

포함 파일: manifest.json, content.js, background.js, popup.html, popup.js, styles.css, icons/
(README, STORE_ASSETS, privacy-policy.html은 zip에 포함하지 않음)
