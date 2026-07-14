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

function ensureToggleButton() {
  try {
    chrome.storage?.local?.get(['showFloatingBtn', 'disabledRooms'], (r) => {
      if (r?.disabledRooms) r.disabledRooms.forEach(id => disabledRooms.add(id));
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

// ─── 번역 캐시 (메모리 내, 최대 500건) ───
const translationCache = new Map();
const CACHE_MAX_SIZE = 500;

function getCacheKey(text, targetLang, sourceLang) {
  return `${targetLang}|${sourceLang}|${text}`;
}
function getCachedTranslation(text, targetLang, sourceLang) {
  return translationCache.get(getCacheKey(text, targetLang, sourceLang)) || null;
}
function setCachedTranslation(text, targetLang, sourceLang, result) {
  const key = getCacheKey(text, targetLang, sourceLang);
  if (translationCache.size >= CACHE_MAX_SIZE) {
    translationCache.delete(translationCache.keys().next().value);
  }
  translationCache.set(key, result);
}

// 설정 불러오기
const DEFAULT_SETTINGS = { targetLang: 'ko', outLang: 'en', autoTranslate: true, autoOutgoing: true, showOutgoingTranslation: false, cloudApiKey: '', aiProvider: 'google_free', aiApiKey: '', glossary: [], translationTone: 'natural', showFloatingBtn: true };
async function getSettings() {
  return new Promise((resolve) => {
    if (!chrome.runtime?.id) return resolve({ ...DEFAULT_SETTINGS });
    try {
      chrome.storage.local.get(['targetLang', 'outLang', 'autoTranslate', 'autoOutgoing', 'showOutgoingTranslation', 'cloudApiKey', 'aiProvider', 'aiApiKey', 'glossary', 'translationTone', 'showFloatingBtn'], (result) => {
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
          glossary:                 result.glossary      || [],
          translationTone:          result.translationTone || 'natural',
          showFloatingBtn:          result.showFloatingBtn !== false
        });
      });
    } catch (e) {
      resolve({ ...DEFAULT_SETTINGS });
    }
  });
}

// ─── 용어 사전: 번역 전 치환 → 번역 후 복원 ───
function applyGlossary(text, glossary) {
  if (!glossary || glossary.length === 0) return { text, placeholders: [] };
  const placeholders = [];
  let processed = text;
  glossary.forEach((entry, i) => {
    const regex = new RegExp(entry.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const placeholder = `§§${i}§§`;
    if (regex.test(processed)) {
      placeholders.push({ placeholder, to: entry.to || entry.from });
      processed = processed.replace(regex, placeholder);
    }
  });
  return { text: processed, placeholders };
}
function restoreGlossary(translated, placeholders) {
  let result = translated;
  placeholders.forEach(({ placeholder, to }) => {
    result = result.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), to);
  });
  return result;
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

// 톤 프롬프트 생성
function getToneInstruction(tone) {
  const toneMap = {
    natural: '',
    formal: 'Use formal, polite language (존댓말/경어). ',
    informal: 'Use casual, informal language (반말). ',
    business: 'Use professional business tone. ',
    friendly: 'Use friendly, warm conversational tone. '
  };
  return toneMap[tone] || '';
}

// Google Cloud Translation API (공식)
async function googleTranslateCloud(text, targetLang, sourceLang, apiKey) {
  const url = `https://translation.googleapis.com/language/translate/v2?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: text, target: targetLang, source: sourceLang === 'auto' ? undefined : sourceLang, format: 'text' })
  });
  if (!response.ok) throw new Error('Cloud 번역 요청 실패');
  const data = await response.json();
  return {
    translated: data.data.translations[0].translatedText,
    detectedLang: data.data.translations[0].detectedSourceLanguage || sourceLang
  };
}

// Google 번역 (무료 API)
async function googleTranslateFree(text, targetLang = 'en', sourceLang = 'auto') {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang}&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error('번역 요청 실패');
  const data = await response.json();
  return {
    translated: data[0].map(chunk => chunk[0]).join(''),
    detectedLang: data[2] || 'auto'
  };
}

const LANG_NAMES = { ko: '한국어', en: 'English', ja: '日本語', 'zh-CN': '简体中文', 'zh-TW': '繁體中文', de: 'Deutsch', fr: 'Français', es: 'Español' };

// AI 번역 공통: rate limit 자동 재시도 (최대 3회, 지수 백오프)
async function fetchWithRetry(fetchFn, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const response = await fetchFn();
    if (response.ok) return response;
    if (response.status === 429 || response.status === 529 || response.status >= 500) {
      const waitMs = Math.min(2000 * Math.pow(2, attempt), 10000);
      await new Promise(r => setTimeout(r, waitMs));
      continue;
    }
    throw new Error(`API 요청 실패: ${response.status}`);
  }
  throw new Error('API rate limit 초과 - 최대 재시도 횟수 도달');
}

function detectLangFromResult(text, translated, targetLang, sourceLang) {
  return translated.toLowerCase() === text.toLowerCase() ? targetLang : (sourceLang === 'auto' ? 'unknown' : sourceLang);
}

// Gemini API 번역
async function geminiTranslate(text, targetLang, sourceLang, apiKey, tone = 'natural', context = '') {
  const targetName = LANG_NAMES[targetLang] || targetLang;
  const toneInst = getToneInstruction(tone);
  const contextInst = context ? `Previous messages for context:\n${context}\n\nNow translate this message:\n` : '';
  const prompt = `Translate the following text to ${targetName}. ${toneInst}Return ONLY the translated text, nothing else.\n\n${contextInst}${text}`;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  const response = await fetchWithRetry(() => fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
  }));
  const data = await response.json();
  const translated = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!translated) throw new Error('Gemini 응답 없음');
  return { translated, detectedLang: detectLangFromResult(text, translated, targetLang, sourceLang) };
}

// Claude API 번역
async function claudeTranslate(text, targetLang, sourceLang, apiKey, tone = 'natural', context = '') {
  const targetName = LANG_NAMES[targetLang] || targetLang;
  const toneInst = getToneInstruction(tone);
  const contextInst = context ? `Previous messages for context:\n${context}\n\nNow translate this message:\n` : '';
  const prompt = `Translate the following text to ${targetName}. ${toneInst}Return ONLY the translated text, nothing else.\n\n${contextInst}${text}`;
  const response = await fetchWithRetry(() => fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }]
    })
  }));
  const data = await response.json();
  const translated = data.content?.[0]?.text?.trim();
  if (!translated) throw new Error('Claude 응답 없음');
  return { translated, detectedLang: detectLangFromResult(text, translated, targetLang, sourceLang) };
}

// OpenAI API 번역
async function openaiTranslate(text, targetLang, sourceLang, apiKey, tone = 'natural', context = '') {
  const targetName = LANG_NAMES[targetLang] || targetLang;
  const toneInst = getToneInstruction(tone);
  const contextInst = context ? ` Use this conversation context for better translation:\n${context}` : '';
  const response = await fetchWithRetry(() => fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: `You are a translator. Translate the user's text to ${targetName}. ${toneInst}Return ONLY the translated text, nothing else.${contextInst}` },
        { role: 'user', content: text }
      ],
      max_tokens: 1024
    })
  }));
  const data = await response.json();
  const translated = data.choices?.[0]?.message?.content?.trim();
  if (!translated) throw new Error('OpenAI 응답 없음');
  return { translated, detectedLang: detectLangFromResult(text, translated, targetLang, sourceLang) };
}

// Google Cloud Translation 재시도 버전
async function googleTranslateCloudRetry(text, targetLang, sourceLang, apiKey) {
  const url = `https://translation.googleapis.com/language/translate/v2?key=${apiKey}`;
  const response = await fetchWithRetry(() => fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: text, target: targetLang, source: sourceLang === 'auto' ? undefined : sourceLang, format: 'text' })
  }));
  const data = await response.json();
  return {
    translated: data.data.translations[0].translatedText,
    detectedLang: data.data.translations[0].detectedSourceLanguage || sourceLang
  };
}

// 번역 통합 함수: 캐시 → 용어 사전 → 프로바이더 분기
async function translate(text, targetLang = 'en', sourceLang = 'auto', msgElement = null) {
  const cached = getCachedTranslation(text, targetLang, sourceLang);
  if (cached) return cached;

  const settings = await getSettings();
  const { text: processedText, placeholders } = applyGlossary(text, settings.glossary);
  const tone = settings.translationTone || 'natural';
  const isAI = ['gemini', 'claude', 'openai'].includes(settings.aiProvider);
  const context = (isAI && msgElement) ? getConversationContext(msgElement) : '';

  let result;
  switch (settings.aiProvider) {
    case 'gemini':
      if (settings.aiApiKey) result = await geminiTranslate(processedText, targetLang, sourceLang, settings.aiApiKey, tone, context);
      break;
    case 'claude':
      if (settings.aiApiKey) result = await claudeTranslate(processedText, targetLang, sourceLang, settings.aiApiKey, tone, context);
      break;
    case 'openai':
      if (settings.aiApiKey) result = await openaiTranslate(processedText, targetLang, sourceLang, settings.aiApiKey, tone, context);
      break;
    case 'google_cloud':
      if (settings.cloudApiKey) result = await googleTranslateCloudRetry(processedText, targetLang, sourceLang, settings.cloudApiKey);
      break;
  }
  if (!result) result = await googleTranslateFree(processedText, targetLang, sourceLang);

  if (placeholders.length > 0) {
    result = { ...result, translated: restoreGlossary(result.translated, placeholders) };
  }
  setCachedTranslation(text, targetLang, sourceLang, result);
  return result;
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

      const { translated, detectedLang } = await translate(text, settings.outLang, 'auto');
      if (detectedLang !== settings.outLang && translated) {
        setInputValue(inputBox, translated);
      }
    } catch (err) {
      console.error('[TCT] 발신 번역 오류:', err);
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
  } catch (err) {
    const msg = err.message || '';
    if (msg.includes('rate limit') || msg.includes('429')) {
      showToast('⚠️ API 사용량 초과 - 잠시 후 자동 재시도됩니다', 'error', 3000);
      setTimeout(() => { delete msgElement.dataset.tctDone; }, 30000);
    } else if (msg.includes('401') || msg.includes('403')) {
      showToast('⚠️ API 키 인증 실패 - 팝업에서 키를 확인하세요', 'error', 4000);
    } else {
      showToast('⚠️ 번역 오류 발생', 'error', 2000);
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
    const settings = await getSettings();
    const isAI = ['gemini', 'claude', 'openai'].includes(settings.aiProvider);
    const delay = settings.aiProvider === 'gemini' ? 4000 : (isAI ? 1000 : 0);
    while (translateQueue.length > 0) {
      const el = translateQueue.shift();
      if (el.dataset.tctDone) continue;
      const isOutgoing = el.dataset.tctOutgoing === '1';
      await translateIncomingMessage(el, isOutgoing);
      if (delay && translateQueue.length > 0) await new Promise(r => setTimeout(r, delay));
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

function observeChat() {
  const observer = new MutationObserver(() => {
    onUrlMaybeChanged();
    scanInputs();
    processNewMessages();
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
  });
} catch (e) { /* extension context invalidated */ }
