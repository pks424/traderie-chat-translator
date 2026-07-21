const outLangSelect              = document.getElementById('outLang');
const targetLangSelect           = document.getElementById('targetLang');
const autoTranslateChk           = document.getElementById('autoTranslate');
const showOutgoingTranslationChk = document.getElementById('showOutgoingTranslation');
const cloudApiKeyInput           = document.getElementById('cloudApiKey');
const aiProviderSelect           = document.getElementById('aiProvider');
const aiApiKeyInput              = document.getElementById('aiApiKey');
const apiKeyField                = document.getElementById('apiKeyField');
const cloudKeyField              = document.getElementById('cloudKeyField');
const apiKeyLabel                = document.getElementById('apiKeyLabel');
const apiKeyHint                 = document.getElementById('apiKeyHint');
const saveBtn                    = document.getElementById('saveBtn');
const statusEl                   = document.getElementById('status');
const setupBanner                = document.getElementById('setupBanner');
const translationToneSelect      = document.getElementById('translationTone');
const toneField                  = document.getElementById('toneField');
const autoOutgoingChk            = document.getElementById('autoOutgoing');
const showFloatingBtnChk         = document.getElementById('showFloatingBtn');
const glossaryList               = document.getElementById('glossaryList');
const glossaryFromInput          = document.getElementById('glossaryFrom');
const glossaryToInput            = document.getElementById('glossaryTo');
const glossaryAddBtn             = document.getElementById('glossaryAddBtn');

// ─── 용어 사전 관리 ───
let glossary = [];
let editingIndex = -1; // 인라인 수정 중인 항목 인덱스 (-1 = 없음)

function renderGlossary() {
  const countEl = document.getElementById('glossaryCount');
  if (countEl) countEl.textContent = glossary.length ? `(${glossary.length})` : '';
  glossaryList.innerHTML = '';
  glossary.forEach((entry, i) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:4px;margin-bottom:4px;padding:4px 8px;background:#f8f9fa;border-radius:4px;font-size:12px;';

    if (editingIndex === i) {
      // ── 수정 모드: 인라인 입력 2개 + 확인/취소 ──
      const inputStyle = 'flex:1;min-width:0;padding:3px 6px;border:1px solid #1a73e8;border-radius:4px;font-size:12px;';
      const fromInput = document.createElement('input');
      fromInput.value = entry.from;
      fromInput.style.cssText = inputStyle;
      const toInput = document.createElement('input');
      toInput.value = entry.to || '';
      toInput.placeholder = '유지';
      toInput.style.cssText = inputStyle;

      const save = () => {
        const from = fromInput.value.trim();
        if (!from) return;
        glossary[i] = { from, to: toInput.value.trim() };
        editingIndex = -1;
        renderGlossary();
      };
      const cancel = () => { editingIndex = -1; renderGlossary(); };

      [fromInput, toInput].forEach(inp => inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') save();
        if (e.key === 'Escape') cancel();
      }));

      const okBtn = document.createElement('button');
      okBtn.textContent = '✓';
      okBtn.title = '수정 완료 (Enter)';
      okBtn.style.cssText = 'background:none;border:none;color:#137333;cursor:pointer;font-size:14px;padding:0 4px;';
      okBtn.onclick = save;

      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = '↩';
      cancelBtn.title = '취소 (Esc)';
      cancelBtn.style.cssText = 'background:none;border:none;color:#5f6368;cursor:pointer;font-size:14px;padding:0 4px;';
      cancelBtn.onclick = cancel;

      row.append(fromInput, toInput, okBtn, cancelBtn);
      glossaryList.appendChild(row);
      fromInput.focus();
      return;
    }

    // ── 표시 모드: 클릭하면 수정 ──
    const label = document.createElement('span');
    label.style.cssText = 'flex:1;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    label.title = '클릭하여 수정';
    const b = document.createElement('b');
    b.textContent = entry.from;
    label.appendChild(b);
    if (entry.to) {
      label.appendChild(document.createTextNode(' → ' + entry.to));
    } else {
      const keep = document.createElement('i');
      keep.textContent = ' → 유지';
      keep.style.color = '#5f6368';
      label.appendChild(keep);
    }
    label.onclick = () => { editingIndex = i; renderGlossary(); };

    const delBtn = document.createElement('button');
    delBtn.textContent = '✕';
    delBtn.title = '삭제';
    delBtn.style.cssText = 'background:none;border:none;color:#d93025;cursor:pointer;font-size:14px;padding:0 4px;';
    delBtn.onclick = () => { glossary.splice(i, 1); editingIndex = -1; renderGlossary(); };

    row.append(label, delBtn);
    glossaryList.appendChild(row);
  });
}

glossaryAddBtn.addEventListener('click', () => {
  const from = glossaryFromInput.value.trim();
  if (!from) return;
  glossary.push({ from, to: glossaryToInput.value.trim() });
  glossaryFromInput.value = '';
  glossaryToInput.value = '';
  renderGlossary();
});

const providerConfig = {
  google_free:  { showKey: false, showCloud: false },
  google_cloud: { showKey: false, showCloud: true },
  gemini:       { showKey: true, showCloud: false, label: 'Gemini API 키', placeholder: 'AIza...', hint: 'Google AI Studio에서 발급 (aistudio.google.com)' },
  claude:       { showKey: true, showCloud: false, label: 'Claude API 키', placeholder: 'sk-ant-...', hint: 'Anthropic Console에서 발급 (console.anthropic.com)' },
  openai:       { showKey: true, showCloud: false, label: 'OpenAI API 키', placeholder: 'sk-...', hint: 'OpenAI Platform에서 발급 (platform.openai.com)' }
};

function updateProviderUI() {
  const provider = aiProviderSelect.value;
  const config = providerConfig[provider];

  apiKeyField.style.display  = config.showKey   ? 'block' : 'none';
  cloudKeyField.style.display = config.showCloud ? 'block' : 'none';
  // AI 엔진일 때만 톤 설정 표시
  toneField.style.display = (provider === 'gemini' || provider === 'claude' || provider === 'openai') ? 'block' : 'none';

  if (config.showKey) {
    apiKeyLabel.textContent       = config.label;
    aiApiKeyInput.placeholder     = config.placeholder;
    apiKeyHint.textContent        = config.hint;
  }
}

aiProviderSelect.addEventListener('change', updateProviderUI);

// 저장된 설정 불러오기
chrome.storage.local.get(['outLang', 'targetLang', 'autoTranslate', 'autoOutgoing', 'showOutgoingTranslation', 'cloudApiKey', 'aiProvider', 'aiApiKey', 'glossary', 'glossaryInitialized', 'translationTone', 'showFloatingBtn', 'initialized'], (result) => {
  if (!result.initialized) {
    setupBanner.classList.add('visible');
  }
  outLangSelect.value              = result.outLang    || 'en';
  targetLangSelect.value           = result.targetLang || 'ko';
  autoTranslateChk.checked         = result.autoTranslate !== false;
  autoOutgoingChk.checked          = result.autoOutgoing !== false;
  showOutgoingTranslationChk.checked = result.showOutgoingTranslation === true;
  cloudApiKeyInput.value           = result.cloudApiKey || '';
  aiProviderSelect.value           = result.aiProvider  || 'google_free';
  aiApiKeyInput.value              = result.aiApiKey    || '';
  translationToneSelect.value      = result.translationTone || 'natural';
  showFloatingBtnChk.checked       = result.showFloatingBtn !== false;
  // 사전을 명시적으로 만진 적 없으면 기본 룬 사전 표시
  // — 룬 사전 도입 전에 저장된 빈 배열도 기본값으로 마이그레이션
  glossary = (result.glossary && result.glossary.length) ? result.glossary
               : (result.glossaryInitialized ? [] : DEFAULT_GLOSSARY.map(e => ({ ...e })));
  renderGlossary();
  updateProviderUI();
});

// 저장 버튼
saveBtn.addEventListener('click', () => {
  const provider = aiProviderSelect.value;

  // AI 프로바이더 선택 시 API 키 필수 체크
  if (provider !== 'google_free' && provider !== 'google_cloud' && !aiApiKeyInput.value.trim()) {
    showStatus('API 키를 입력해주세요.', 'error');
    return;
  }
  if (provider === 'google_cloud' && !cloudApiKeyInput.value.trim()) {
    showStatus('Google Cloud API 키를 입력해주세요.', 'error');
    return;
  }

  const settings = {
    outLang:                  outLangSelect.value,
    targetLang:               targetLangSelect.value,
    autoTranslate:            autoTranslateChk.checked,
    autoOutgoing:             autoOutgoingChk.checked,
    showOutgoingTranslation:  showOutgoingTranslationChk.checked,
    cloudApiKey:              cloudApiKeyInput.value.trim(),
    aiProvider:               provider,
    aiApiKey:                 aiApiKeyInput.value.trim(),
    translationTone:          translationToneSelect.value,
    showFloatingBtn:          showFloatingBtnChk.checked,
    glossary:                 glossary,
    glossaryInitialized:      true, // 이후 빈 배열 저장 = "전부 삭제" 의사로 존중
    initialized:              true
  };

  chrome.storage.local.set(settings, () => {
    setupBanner.classList.remove('visible');
    const providerNames = { google_free: 'Google 무료', google_cloud: 'Google Cloud', gemini: 'Gemini', claude: 'Claude', openai: 'ChatGPT' };
    showStatus(`✓ 저장 완료! 번역 엔진: ${providerNames[provider]}`, 'success');
  });
});

function showStatus(message, type) {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
  setTimeout(() => { statusEl.className = 'status'; }, 4000);
}
