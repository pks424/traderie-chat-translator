// Traderie 채팅 번역 확장 프로그램 - Content Script
// https://traderie.com/*/chat/* 지원
//
// [Traderie DOM 구조 - 2026-07 실측]
//   스크롤 컨테이너 : .messages-container
//   개별 메시지     : .message-container  (텍스트: .message-content, 작성자: .message-from)
//   발신/수신 구분  : 메시지 내 a[href*="/profile/{roomId}"] 있으면 수신, 없으면 발신(나)
//                     (roomId = URL /chat/{id} = 상대방 profile id)
//   입력창          : form.messages-chat-bar textarea[placeholder="Type a message..."]
//   전송            : 해당 form (submit) / button.app-btn[type=submit], form.requestSubmit()
//   입력 방식       : React controlled textarea → native value setter 주입 필요

let currentInputBox = null;
let isTranslating = false;
let isSendingTranslated = false; // 시뮬레이션 전송 재진입 방지
const attachedInputs = new WeakSet();
const processingMessages = new WeakSet(); // 중복 처리 방지

// ─── 채팅방별 번역 ON/OFF ───
const disabledRooms = new Set();

function getCurrentRoomId() {
  const m = location.pathname.match(/\/chat\/([^/?#]+)/);
  return m ? m[1] : location.href;
}

function isRoomTranslateEnabled() {
  return !disabledRooms.has(getCurrentRoomId());
}

function toggleRoomTranslate() {
  const roomId = getCurrentRoomId();
  if (disabledRooms.has(roomId)) {
    disabledRooms.delete(roomId);
    showToast('이 채팅방 번역 ON', 'info', 2000);
    observedElements = new WeakSet();
    processNewMessages();
  } else {
    disabledRooms.add(roomId);
    showToast('이 채팅방 번역 OFF', 'error', 2000);
    document.querySelectorAll('.tct-translation').forEach(el => el.remove());
    document.querySelectorAll('[data-tct-done]').forEach(el => delete el.dataset.tctDone);
  }
  updateToggleButton();
  try { chrome.storage?.local?.set({ disabledRooms: Array.from(disabledRooms) }); } catch (e) { /* context invalidated */ }
}

function updateToggleButton() {
  const btn = document.getElementById('tct-room-toggle');
  if (!btn) return;
  const enabled = isRoomTranslateEnabled();
  btn.textContent = enabled ? '🌐 번역 ON' : '🚫 번역 OFF';
  btn.style.background = enabled ? '#1a73e8' : '#5f6368';
}

// 현재 페이지가 채팅 화면인지 판별
function isChatContext() {
  return /\/chat\//.test(location.pathname);
}

// 플로팅 버튼: 설정에 따라 생성/제거
function syncToggleButton(show) {
  const existing = document.getElementById('tct-room-toggle');

  if (!isChatContext()) {
    if (existing) existing.remove();
    return;
  }
  if (!show) {
    if (existing) existing.remove();
    return;
  }
  if (existing) { updateToggleButton(); return; }

  const btn = document.createElement('button');
  btn.id = 'tct-room-toggle';
  btn.style.cssText = 'position:fixed;bottom:80px;right:20px;z-index:999999;padding:6px 12px;color:#fff;border:none;border-radius:20px;font-size:12px;font-family:sans-serif;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.3);transition:background 0.2s;';
  btn.onclick = toggleRoomTranslate;
  document.body.appendChild(btn);
  updateToggleButton();
}

// ─── 채팅방별 발신 언어: 상대 메시지에서 감지한 언어를 방(= 상대 프로필)마다 기억 ───
const ROOM_LANG_MAX = 200;
const ROOM_LANG_MIN_LATIN = 10; // 라틴 문자 메시지는 공백 제외 10자 이상일 때만 방 언어로 기억
const roomLangs = {};

// 발신 번역 언어: 방에서 기억한 언어 → 없으면 설정의 발신 언어
function getRoomOutLang(settings) {
  // 자동 OFF 이거나 발신 언어를 '번역 안 함'(내 언어)으로 둔 경우는 설정 그대로
  if (!settings.autoRoomLang || settings.outLang === settings.targetLang) return settings.outLang;
  return roomLangs[getCurrentRoomId()] || settings.outLang;
}

function rememberRoomLang(lang, settings) {
  if (!settings.autoRoomLang || !LANG_NAMES[lang] || lang === settings.targetLang) return;
  const roomId = getCurrentRoomId();
  if (roomLangs[roomId] === lang) return;
  delete roomLangs[roomId];          // 최근에 바뀐 방을 뒤로 보내 오래된 방부터 정리
  roomLangs[roomId] = lang;
  const keys = Object.keys(roomLangs);
  if (keys.length > ROOM_LANG_MAX) delete roomLangs[keys[0]];
  try { chrome.storage?.local?.set({ roomLangs }); } catch (e) { /* context invalidated */ }
  // 오류·대체 번역 알림이 떠 있으면 덮어쓰지 않음 (show 클래스는 다음 프레임에 붙으므로 표시 타이머로 판정)
  if (!(document.querySelector('.tct-toast.error') && toastTimer)) {
    showToast(`이 채팅방 발신 언어: ${LANG_NAMES[lang]}`, 'info', 2500);
  }
}

function ensureToggleButton() {
  try {
    chrome.storage?.local?.get(['showFloatingBtn', 'disabledRooms', 'roomLangs'], (r) => {
      if (r?.disabledRooms) r.disabledRooms.forEach(id => disabledRooms.add(id));
      if (r?.roomLangs) Object.assign(roomLangs, r.roomLangs);
      syncToggleButton(r?.showFloatingBtn !== false);
    });
  } catch (e) { /* context invalidated */ }
}

// SPA 라우팅 대응: URL 변경 시 버튼/관찰 상태 갱신
let lastHref = location.href;
function onUrlMaybeChanged() {
  if (location.href === lastHref) return;
  lastHref = location.href;
  observedElements = new WeakSet();
  ensureToggleButton();
  processNewMessages();
}

// 설정 불러오기
// glossary 기본값은 glossary-defaults.js의 DEFAULT_GLOSSARY (룬 33종)
const DEFAULT_SETTINGS = { targetLang: 'ko', outLang: 'en', autoTranslate: true, autoOutgoing: true, showOutgoingTranslation: false, cloudApiKey: '', aiProvider: 'google_free', aiApiKey: '', glossary: DEFAULT_GLOSSARY, translationTone: 'natural', showFloatingBtn: true, autoRoomLang: true, fallbackFree: false };
async function getSettings() {
  return new Promise((resolve) => {
    if (!chrome.runtime?.id) return resolve({ ...DEFAULT_SETTINGS });
    try {
      chrome.storage.local.get(['targetLang', 'outLang', 'autoTranslate', 'autoOutgoing', 'showOutgoingTranslation', 'cloudApiKey', 'aiProvider', 'aiApiKey', 'glossary', 'glossaryInitialized', 'translationTone', 'showFloatingBtn', 'autoRoomLang', 'fallbackFree'], (result) => {
        if (chrome.runtime.lastError) return resolve({ ...DEFAULT_SETTINGS });
        resolve({
          targetLang:               result.targetLang    || 'ko',
          outLang:                  result.outLang       || 'en',
          autoTranslate:            result.autoTranslate !== false,
          autoOutgoing:             result.autoOutgoing !== false,
          showOutgoingTranslation:  result.showOutgoingTranslation === true,
          cloudApiKey:              result.cloudApiKey   || '',
          aiProvider:               result.aiProvider    || 'google_free',
          aiApiKey:                 result.aiApiKey      || '',
          // 사전을 명시적으로 만진 적(glossaryInitialized) 없으면 기본 룬 사전 적용
          // — 룬 사전 도입 전에 저장된 빈 배열도 기본값으로 마이그레이션
          glossary:                 (result.glossary && result.glossary.length) ? result.glossary
                                      : (result.glossaryInitialized ? [] : DEFAULT_GLOSSARY),
          translationTone:          result.translationTone || 'natural',
          showFloatingBtn:          result.showFloatingBtn !== false,
          autoRoomLang:             result.autoRoomLang !== false,   // 기본 ON
          fallbackFree:             result.fallbackFree === true     // 기본 OFF (켜야만 Google 무료로 전송)
        });
      });
    } catch (e) {
      resolve({ ...DEFAULT_SETTINGS });
    }
  });
}

// ─── 언어 자동 감지 (스크립트/문자 기반) ───
function detectLanguageByScript(text) {
  const cleaned = text.replace(/[\s\d\p{P}\p{S}]/gu, '');
  if (!cleaned) return 'unknown';

  let ko = 0, ja = 0, zhSimp = 0, latin = 0, cyrillic = 0, arabic = 0, thai = 0;
  for (const ch of cleaned) {
    const code = ch.codePointAt(0);
    if (code >= 0xAC00 && code <= 0xD7AF) ko++;
    else if (code >= 0x3040 && code <= 0x30FF) ja++;
    else if (code >= 0x4E00 && code <= 0x9FFF) zhSimp++;
    else if (code >= 0x0041 && code <= 0x024F) latin++;
    else if (code >= 0x0400 && code <= 0x04FF) cyrillic++;
    else if (code >= 0x0600 && code <= 0x06FF) arabic++;
    else if (code >= 0x0E00 && code <= 0x0E7F) thai++;
  }
  const total = cleaned.length;
  if (ko / total > 0.3) return 'ko';
  if (ja / total > 0.2) return 'ja';
  if (zhSimp / total > 0.3) return 'zh-CN';
  if (latin / total > 0.5) return 'latin';
  if (cyrillic / total > 0.3) return 'ru';
  if (arabic / total > 0.3) return 'ar';
  if (thai / total > 0.3) return 'th';
  return 'unknown';
}

// 내가 쓴 문장이 이미 보낼 언어인지 (글자 종류로 판정 — API 호출 전 사전 확인)
// 라틴 문자 언어끼리는 글자로 구분할 수 없으므로, 보낼 언어가 영어일 때만 라틴 문장을 영어로 본다
function isAlreadyInLang(text, lang) {
  const script = detectLanguageByScript(text);
  return script === lang || (script === 'latin' && lang === 'en');
}

// 메시지 텍스트 추출 (번역 뱃지 제외)
function getMessageText(el) {
  if (!el.querySelector('.tct-translation')) {
    return (el.innerText || el.textContent || '').trim();
  }
  const clone = el.cloneNode(true);
  clone.querySelectorAll('.tct-translation').forEach(n => n.remove());
  return (clone.innerText || clone.textContent || '').trim();
}

// 컨텍스트 수집: 현재 메시지 주변의 최근 메시지 텍스트
function getConversationContext(msgElement, maxMessages = 3) {
  const msgs = Array.from(document.querySelectorAll('.messages-container .message-content'));
  const idx = msgs.indexOf(msgElement);
  if (idx <= 0) return '';
  const context = [];
  const start = Math.max(0, idx - maxMessages);
  for (let i = start; i < idx; i++) {
    const text = getMessageText(msgs[i]);
    if (text && text.length < 500) context.push(text);
  }
  return context.length > 0 ? context.join('\n') : '';
}

// ─── 번역 요청: 실제 API 호출·캐시·용어 사전·대체 번역은 background.js 가 처리 ───
// 반환 { translated, detectedLang }. 실패하면 background 의 오류 메시지 그대로 throw
// (rate limit / 401 / 403 등 문자열로 기존 오류 안내를 그대로 쓴다)
// interactive: 발신 번역 — 엔진 속도 제한 대기를 하지 않음
async function translate(text, targetLang = 'en', sourceLang = 'auto', msgElement = null, interactive = false) {
  const settings = await getSettings();
  // AI 엔진일 때만 화면에서 대화 맥락 수집 (DOM 은 content 에서만 읽을 수 있음)
  const isAI = ['gemini', 'claude', 'openai'].includes(settings.aiProvider);
  const context = (isAI && msgElement) ? getConversationContext(msgElement) : '';

  const res = await requestBackground({ type: 'translate', text, targetLang, sourceLang, context, interactive });
  if (res.fellBack) notifyFallback(settings.aiProvider, res.fallbackError);
  return { translated: res.translated, detectedLang: res.detectedLang };
}

const CONTEXT_INVALIDATED = 'Extension context invalidated';

function requestBackground(message) {
  return new Promise((resolve, reject) => {
    // 확장 재설치·새로고침 뒤 남은 옛 스크립트는 background 와 연결이 끊김
    if (!chrome.runtime?.id) return reject(new Error(CONTEXT_INVALIDATED));
    try {
      chrome.runtime.sendMessage(message, (res) => {
        const lastErr = chrome.runtime.lastError;
        if (lastErr) return reject(new Error(lastErr.message));
        if (!res) return reject(new Error('번역 응답 없음'));
        if (res.error) return reject(new Error(res.error));
        resolve(res);
      });
    } catch (e) {
      reject(e);
    }
  });
}

// 대체 번역 알림 (메시지마다 뜨지 않도록 1분에 한 번)
const PROVIDER_NAMES = { google_cloud: 'Google Cloud', gemini: 'Gemini', claude: 'Claude', openai: 'ChatGPT' };
let lastFallbackToastAt = 0;
function notifyFallback(provider, reason) {
  console.warn('[TCT] 번역 엔진 실패 → Google 무료 번역으로 대체:', reason);
  if (Date.now() - lastFallbackToastAt < 60000) return;
  lastFallbackToastAt = Date.now();
  showToast(`⚠️ ${PROVIDER_NAMES[provider] || provider} 번역 실패 → Google 무료 번역으로 대체 (${reason})`, 'error', 5000);
}

// ─────────────────────────────────────────
// [발신] 입력창 후킹
// ─────────────────────────────────────────

// React controlled textarea에 값 주입 (native setter → input 이벤트로 state 갱신)
function setInputValue(inputBox, newText) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(inputBox, newText);
  inputBox.dispatchEvent(new Event('input', { bubbles: true }));
}

// Alt+? 수동 번역 대신 여기서는 채팅방 토글에 Alt+T를 쓰므로,
// 수동 발신 번역은 별도 단축키 없이 자동 발신 번역으로 처리.

function isChatInput(el) {
  return el.tagName === 'TEXTAREA' && !!el.closest('form.messages-chat-bar');
}

function attachToInputBox(inputBox) {
  if (attachedInputs.has(inputBox)) return;
  attachedInputs.add(inputBox);

  inputBox.addEventListener('focus', () => { currentInputBox = inputBox; });

  // Enter 인터셉트: 언어 자동 감지 후 필요 시 번역 → 전송
  inputBox.addEventListener('keydown', async (e) => {
    if (isSendingTranslated) return;               // 우리가 직접 트리거한 전송은 무시
    if (e.key !== 'Enter' || e.shiftKey || isTranslating) return;
    if (!isRoomTranslateEnabled()) return;          // 채팅방 OFF면 원본 전송

    const text = (inputBox.value || '').trim();
    if (!text) return;

    // preventDefault는 반드시 동기적으로 먼저 (async 이후에는 효과 없음)
    e.preventDefault();
    e.stopImmediatePropagation();
    isTranslating = true;

    const sendMessage = () => {
      isSendingTranslated = true;
      const form = inputBox.closest('form.messages-chat-bar');
      try {
        if (form && typeof form.requestSubmit === 'function') {
          form.requestSubmit();
        } else {
          form?.querySelector('button.app-btn[type="submit"], button[type="submit"]')?.click();
        }
      } catch (err) {
        form?.querySelector('button.app-btn[type="submit"], button[type="submit"]')?.click();
      }
      setTimeout(() => { isSendingTranslated = false; }, 300);
    };

    try {
      const settings = await getSettings();
      if (!settings.autoOutgoing) { isTranslating = false; sendMessage(); return; }

      const outLang = getRoomOutLang(settings);
      // 이미 보낼 언어로 쓴 문장이면 API 호출 없이 그대로 전송
      if (!isAlreadyInLang(text, outLang)) {
        const { translated, detectedLang } = await translate(text, outLang, 'auto', null, true);
        if (detectedLang !== outLang && translated) {
          setInputValue(inputBox, translated);
        }
      }
    } catch (err) {
      console.error('[TCT] 발신 번역 오류:', err);
      showToast('⚠️ 발신 번역 실패 - 원문 그대로 전송했습니다', 'error', 4000);
    } finally {
      isTranslating = false;
      // React state 반영 대기 후 전송
      setTimeout(sendMessage, 120);
    }
  }, true);
}

// 토스트 알림
let toastTimer = null;
function showToast(message, type = 'info', duration = 3000) {
  let toast = document.querySelector('.tct-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'tct-toast';
    document.body.appendChild(toast);
  }
  if (toastTimer) clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = 'tct-toast' + (type === 'error' ? ' error' : '');
  requestAnimationFrame(() => toast.classList.add('show'));
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
    toastTimer = null;
  }, duration);
}

// ─────────────────────────────────────────
// [수신] 상대방 메시지 자동 번역
// ─────────────────────────────────────────

function createTranslationBadge(translatedText, isError = false) {
  const badge = document.createElement('div');
  badge.className = 'tct-translation' + (isError ? ' tct-error' : '');
  badge.textContent = translatedText;
  const icon = document.createElement('span');
  icon.className = 'tct-translation-icon';
  icon.textContent = isError ? '⚠️ ' : '🌐 ';
  badge.prepend(icon);
  return badge;
}

async function translateIncomingMessage(msgElement, isOutgoing = false) {
  if (!isRoomTranslateEnabled()) return;
  if (msgElement.dataset.tctDone) return;
  if (processingMessages.has(msgElement)) return;
  if (msgElement.querySelector('.tct-translation')) return;

  const text = getMessageText(msgElement);
  if (!text || text.length < 2) return;

  processingMessages.add(msgElement);
  msgElement.dataset.tctDone = '1';

  try {
    const settings = await getSettings();
    if (!isOutgoing && !settings.autoTranslate) return;

    // 사전 언어 감지: 이미 목표 언어면 API 호출 스킵
    const preDetected = detectLanguageByScript(text);
    if (preDetected === settings.targetLang) return;

    const { translated, detectedLang } = await translate(text, settings.targetLang, 'auto', msgElement);

    if (detectedLang === settings.targetLang) return;
    if (!translated || translated.trim().toLowerCase() === text.toLowerCase()) return;

    msgElement.appendChild(createTranslationBadge(translated));

    // 상대 메시지 언어를 이 방의 발신 언어로 기억 (API 감지값 우선, 없으면 문자 기반 감지값)
    // 짧은 라틴 문장(ok, ty 등)은 언어 감지가 불안정해 제외
    const tooShortLatin = preDetected === 'latin' && text.replace(/\s/g, '').length < ROOM_LANG_MIN_LATIN;
    if (!isOutgoing && !tooShortLatin) rememberRoomLang(LANG_NAMES[detectedLang] ? detectedLang : preDetected, settings);
  } catch (err) {
    const msg = err.message || '';
    // 확장을 새로고침해 연결이 끊긴 옛 스크립트: 알림 없이 종료 (탭 새로고침 시 새 스크립트가 처리)
    if (msg.includes(CONTEXT_INVALIDATED)) return;
    if (msg.includes('rate limit') || msg.includes('429')) {
      showToast('⚠️ API 사용량 초과 - 잠시 후 자동 재시도됩니다', 'error', 3000);
      // 30초 뒤 표시를 지우고 다시 관찰 → 화면에 보이면 재번역 (unobserve 된 상태라 재등록 필요)
      setTimeout(() => {
        delete msgElement.dataset.tctDone;
        if (msgElement.isConnected) visibilityObserver.observe(msgElement);
      }, 30000);
    } else if (msg.includes('401') || msg.includes('403')) {
      showToast('⚠️ API 키 인증 실패 - 팝업에서 키를 확인하세요', 'error', 4000);
    } else {
      showToast(`⚠️ 번역 오류 발생 - ${msg}`, 'error', 5000);
      console.log('[TCT] 수신 번역 오류:', msg);
      delete msgElement.dataset.tctDone;
    }
  } finally {
    processingMessages.delete(msgElement);
  }
}

// 메시지가 발신(나)인지 판별: profile 링크가 상대(roomId)를 가리키지 않으면 발신
function isOutgoingContainer(container) {
  const link = container.querySelector('a[href*="/profile/"]');
  if (!link) return false; // 판별 불가 → 수신으로 간주(번역)
  const href = link.getAttribute('href') || '';
  return !href.includes('/profile/' + getCurrentRoomId());
}

// 수신 메시지 텍스트 요소 목록
function findMessageElements() {
  const results = [];
  document.querySelectorAll('.messages-container .message-container').forEach((container) => {
    if (isOutgoingContainer(container)) return; // 발신은 별도 처리
    const content = container.querySelector('.message-content');
    if (!content || content.dataset.tctDone) return;
    if (content.querySelector('.tct-translation')) return;
    if (getMessageText(content).length === 0) return;
    results.push(content);
  });
  return results;
}

// 발신 메시지(나) 텍스트 요소 목록
function findOutgoingElements() {
  const results = [];
  document.querySelectorAll('.messages-container .message-container').forEach((container) => {
    if (!isOutgoingContainer(container)) return;
    const content = container.querySelector('.message-content');
    if (!content || content.dataset.tctDone) return;
    if (content.querySelector('.tct-translation')) return;
    if (getMessageText(content).length === 0) return;
    results.push(content);
  });
  return results;
}

// ─── IntersectionObserver: 뷰포트에 보이는 메시지만 번역 ───
const translateQueue = [];
let isQueueProcessing = false;
let observedElements = new WeakSet();

const visibilityObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (entry.isIntersecting && !entry.target.dataset.tctDone) {
      translateQueue.push(entry.target);
      visibilityObserver.unobserve(entry.target);
      processTranslateQueue();
    }
  }
}, { threshold: 0.1 });

async function processTranslateQueue() {
  if (isQueueProcessing) return;
  isQueueProcessing = true;
  try {
    // 엔진 속도 제한 대기는 background 가 탭 공통으로 처리 (성공한 엔진 호출 기준)
    while (translateQueue.length > 0) {
      const el = translateQueue.shift();
      if (el.dataset.tctDone) continue;
      const isOutgoing = el.dataset.tctOutgoing === '1';
      await translateIncomingMessage(el, isOutgoing);
    }
  } finally {
    isQueueProcessing = false;
  }
}

function processNewMessages() {
  for (const el of findMessageElements()) {
    if (!observedElements.has(el)) {
      observedElements.add(el);
      visibilityObserver.observe(el);
    }
  }
  getSettings().then(settings => {
    if (settings.showOutgoingTranslation) {
      for (const el of findOutgoingElements()) {
        if (!observedElements.has(el)) {
          observedElements.add(el);
          el.dataset.tctOutgoing = '1';
          visibilityObserver.observe(el);
        }
      }
    }
  });
}

// ─────────────────────────────────────────
// MutationObserver: 입력창 + 메시지 통합 감지
// ─────────────────────────────────────────

function scanInputs() {
  document.querySelectorAll('form.messages-chat-bar textarea').forEach((el) => {
    if (isChatInput(el)) attachToInputBox(el);
  });
}

// DOM 변경이 연달아 와도 150ms에 한 번만 검사 (변경마다 메시지 전체를 순회하던 부하 제거)
const SCAN_INTERVAL_MS = 150;
let scanScheduled = false;
function observeChat() {
  const observer = new MutationObserver(() => {
    if (scanScheduled) return;
    scanScheduled = true;
    setTimeout(() => {
      scanScheduled = false;
      onUrlMaybeChanged();
      scanInputs();
      processNewMessages();
    }, SCAN_INTERVAL_MS);
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

// 초기화
observeChat();
setTimeout(() => { scanInputs(); processNewMessages(); }, 1500);
console.log('[TCT] Traderie 채팅 번역기 활성화');
ensureToggleButton();

// 단축키 메시지 수신 (background → content)
chrome.runtime?.onMessage?.addListener((msg) => {
  if (msg.action === 'toggleRoomTranslate') toggleRoomTranslate();
});

// 설정 변경 실시간 반영 (플로팅 버튼 표시/숨김)
try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.showFloatingBtn) {
      syncToggleButton(changes.showFloatingBtn.newValue !== false);
    }
    // 다른 탭에서 기억한 방 언어도 합침 (덮어써서 잃지 않도록)
    if (area === 'local' && changes.roomLangs?.newValue) {
      Object.assign(roomLangs, changes.roomLangs.newValue);
    }
  });
} catch (e) { /* extension context invalidated */ }
