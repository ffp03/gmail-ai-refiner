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
const exportLogBtn  = document.getElementById('exportLogBtn');
const clearLogBtn   = document.getElementById('clearLogBtn');
const statusEl      = document.getElementById('status');
const DEBUG_LOG_KEY = 'garDebugLog';
const DEBUG_LOG_LIMIT = 500;

// ── Validation prefixes mapped by provider ID (matches providers.js)
const keyPrefixes = {
  anthropic: 'sk-ant-',
  gemini: null,
  deepseek: 'sk-'
};

function redactForLog(value) {
  if (Array.isArray(value)) return value.map(redactForLog);
  if (typeof value === 'string') {
    return value
      .replace(/([?&]key=)[^&\s]+/gi, '$1[redacted]')
      .replace(/\bBearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
      .replace(/\b(sk-ant-[A-Za-z0-9._-]+|sk-[A-Za-z0-9._-]+|AIza[0-9A-Za-z_-]+)\b/g, '[redacted]');
  }
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, val] of Object.entries(value)) {
    out[key] = /apiKey|authorization|x-api-key/i.test(key) ? '[redacted]' : redactForLog(val);
  }
  return out;
}

function logDebug(event, details = {}) {
  chrome.storage.local.get({ debug: false, [DEBUG_LOG_KEY]: [] }, (data) => {
    if (!data.debug) return;
    const entry = {
      ts: new Date().toISOString(),
      source: 'settings',
      event,
      details: redactForLog(details)
    };
    const existing = Array.isArray(data[DEBUG_LOG_KEY]) ? data[DEBUG_LOG_KEY] : [];
    chrome.storage.local.set({ [DEBUG_LOG_KEY]: [...existing, entry].slice(-DEBUG_LOG_LIMIT) });
  });
}

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
  logDebug('test_connection_started', { provider });
  
  chrome.runtime.sendMessage({
    type: 'REFINE_EMAIL',
    draft: 'Hello, this is a test connection from Gmail AI Refiner.',
    systemPrompt: '',
    apiKey,
    provider
  }, (response) => {
    if (chrome.runtime.lastError) {
      logDebug('test_connection_runtime_error', { message: chrome.runtime.lastError.message });
      showStatus('Extension error: ' + chrome.runtime.lastError.message, 'err', true);
      return;
    }
    if (response?.success) {
      logDebug('test_connection_succeeded', { provider });
      showStatus('Connection Successful! ✓', 'ok');
    } else {
      logDebug('test_connection_failed', { provider, error: response?.error || 'Unknown' });
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
    logDebug('settings_saved', { provider, triggerMode, enabled, debug });
    showStatus('Saved ✓', 'ok');
  });
});

exportLogBtn.addEventListener('click', () => {
  chrome.storage.local.get({ [DEBUG_LOG_KEY]: [] }, (data) => {
    const log = Array.isArray(data[DEBUG_LOG_KEY]) ? data[DEBUG_LOG_KEY] : [];
    const payload = {
      exportedAt: new Date().toISOString(),
      extension: 'Gmail AI Refiner',
      entries: log
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gmail-ai-refiner-debug-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    logDebug('debug_log_exported', { entryCount: log.length });
    showStatus(`Exported ${log.length} log entries.`, 'ok');
  });
});

clearLogBtn.addEventListener('click', () => {
  chrome.storage.local.set({ [DEBUG_LOG_KEY]: [] }, () => {
    showStatus('Debug log cleared.', 'ok');
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
