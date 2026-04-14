// settings.js

const providerEl    = document.getElementById('provider');
const triggerModeEl = document.getElementById('triggerMode');
const apiKeyEl      = document.getElementById('apiKey');
const systemPrompt1El = document.getElementById('systemPrompt1');
const systemPrompt2El = document.getElementById('systemPrompt2');
const systemPrompt3El = document.getElementById('systemPrompt3');
const enabledToggle = document.getElementById('enabledToggle');
const debugToggle   = document.getElementById('debugToggle');
const saveBtn       = document.getElementById('saveBtn');
const testBtn       = document.getElementById('testBtn');
const statusEl      = document.getElementById('status');

// ── Validation prefixes mapped by provider ID (matches providers.js)
const keyPrefixes = {
  anthropic: 'sk-ant-',
  gemini: null,
  deepseek: 'sk-'
};

// ── Load saved settings ──────────────────────────────────────────────────────
chrome.storage.local.get({
  provider: 'anthropic',
  triggerMode: 'shortcut',
  apiKey: '',
  systemPrompt1: '',
  systemPrompt2: '',
  systemPrompt3: '',
  enabled: true,
  debug: false
}, (data) => {
  providerEl.value = data.provider;
  triggerModeEl.value = data.triggerMode;
  apiKeyEl.value = data.apiKey;
  systemPrompt1El.value = data.systemPrompt1 || '';
  systemPrompt2El.value = data.systemPrompt2 || '';
  systemPrompt3El.value = data.systemPrompt3 || '';
  enabledToggle.checked = data.enabled;
  debugToggle.checked = data.debug;
  updatePlaceholder();
});

// Update placeholder when provider changes
providerEl.addEventListener('change', updatePlaceholder);

function updatePlaceholder() {
  const p = providerEl.value;
  if (p === 'anthropic') apiKeyEl.placeholder = 'sk-ant-api03-…';
  if (p === 'gemini') apiKeyEl.placeholder = 'AIzaSy…';
  if (p === 'deepseek') apiKeyEl.placeholder = 'sk-…';
}

// ── Test Connection ──────────────────────────────────────────────────────────
testBtn.addEventListener('click', () => {
  const provider = providerEl.value;
  const apiKey = apiKeyEl.value.trim();
  
  if (!apiKey) {
    showStatus('Enter an API key first.', 'err');
    return;
  }

  showStatus('Testing connection...', 'pending');
  
  chrome.runtime.sendMessage({
    type: 'REFINE_EMAIL',
    draft: 'Hello, this is a test connection from Gmail AI Refiner.',
    systemPrompt: '',
    apiKey,
    provider
  }, (response) => {
    if (chrome.runtime.lastError) {
      showStatus('Extension error: ' + chrome.runtime.lastError.message, 'err', true);
      return;
    }
    if (response?.success) {
      showStatus('Connection Successful! ✓', 'ok');
    } else {
      showStatus('API Error: ' + (response?.error || 'Unknown'), 'err', true);
    }
  });
});

// ── Save ─────────────────────────────────────────────────────────────────────
saveBtn.addEventListener('click', () => {
  const provider      = providerEl.value;
  const triggerMode   = triggerModeEl.value;
  const apiKey        = apiKeyEl.value.trim();
  const systemPrompt1 = systemPrompt1El.value.trim();
  const systemPrompt2 = systemPrompt2El.value.trim();
  const systemPrompt3 = systemPrompt3El.value.trim();
  const enabled       = enabledToggle.checked;
  const debug         = debugToggle.checked;

  if (!apiKey) {
    showStatus('API key is required.', 'err');
    return;
  }

  const prefix = keyPrefixes[provider];
  if (prefix && !apiKey.startsWith(prefix)) {
    showStatus(`Key should start with ${prefix}`, 'err');
    return;
  }

  chrome.storage.local.set({ 
    provider, triggerMode, apiKey, 
    systemPrompt1, systemPrompt2, systemPrompt3, 
    enabled, debug 
  }, () => {
    showStatus('Saved ✓', 'ok');
  });
});

function showStatus(msg, type, keep = false) {
  statusEl.textContent = msg;
  statusEl.className = `status ${type}`;
  if (!keep) {
    setTimeout(() => {
      if (statusEl.textContent === msg) {
        statusEl.textContent = '';
        statusEl.className = 'status';
      }
    }, 4000);
  }
}
