import { PROVIDERS } from './providers.js';

console.log('[GAR-BG] Service Worker loaded');

const DEBUG_LOG_KEY = 'garDebugLog';
const DEBUG_LOG_LIMIT = 500;

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
  try {
    chrome.storage.local.get({ debug: false, [DEBUG_LOG_KEY]: [] }, (data) => {
      if (!data.debug) return;
      const entry = {
        ts: new Date().toISOString(),
        source: 'background',
        event,
        details: redactForLog(details)
      };
      const existing = Array.isArray(data[DEBUG_LOG_KEY]) ? data[DEBUG_LOG_KEY] : [];
      chrome.storage.local.set({ [DEBUG_LOG_KEY]: [...existing, entry].slice(-DEBUG_LOG_LIMIT) });
    });
  } catch (e) {
    console.warn('[GAR-BG] Failed to write debug log:', e);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'REFINE_EMAIL') {
    logDebug('message_received', {
      type: message.type,
      provider: message.provider,
      draftLength: message.draft?.length || 0,
      contextLength: message.context?.length || 0
    });
    refineEmail(message.draft, message.systemPrompt, message.apiKey, message.provider, message.context, message.senderName, message.recipientName)
      .then(({ result, rawRequestBody }) => sendResponse({ success: true, refined: result, rawRequestBody }))
      .catch(err => {
        console.error('[GAR-BG] Refinement failed:', err);
        logDebug('message_failed', { type: message.type, error: err.message });
        sendResponse({ success: false, error: err.message });
      });
    return true; // Keep channel open for async response
  }
});

async function refineEmail(draft, systemPrompt, apiKey, providerId = 'anthropic', context = '', senderName = '', recipientName = '') {
  console.log(`[GAR-BG] Starting refinement with provider: ${providerId}`);
  const provider = PROVIDERS[providerId];
  if (!provider) {
    throw new Error(`Unknown provider: ${providerId}`);
  }
  logDebug('refine_started', {
    provider: providerId,
    draftLength: draft?.length || 0,
    contextLength: context?.length || 0
  });

  const endpoint = provider.buildEndpoint ? provider.buildEndpoint(provider.endpoint, apiKey) : provider.endpoint;
  const headers = provider.buildHeaders(apiKey);
  const body = provider.buildBody(draft, systemPrompt, context, senderName, recipientName);
  logDebug('provider_request_built', {
    provider: providerId,
    endpoint,
    headers,
    body
  });

  console.log(`[GAR-BG] Full Request Body:`, JSON.stringify(body, null, 2));
  console.log(`[GAR-BG] Fetching from: ${endpoint}`);
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);

    console.log(`[GAR-BG] Response status: ${response.status}`);
    logDebug('provider_response_status', { provider: providerId, status: response.status });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[GAR-BG] Error response body:`, errText);
      logDebug('provider_error_response', { provider: providerId, status: response.status, body: errText });
      let errJson = {};
      try { errJson = JSON.parse(errText); } catch(e) {}
      throw new Error(errJson?.error?.message || `API error ${response.status}`);
    }

    const data = await response.json();
    console.log(`[GAR-BG] Raw API Response:`, JSON.stringify(data, null, 2));
    const result = provider.extractText(data);
    console.log(`[GAR-BG] Final Extracted Result:`, JSON.stringify(result, null, 2));
    logDebug('refine_completed', {
      provider: providerId,
      resultLength: result?.body?.length || 0,
      hasSubject: Boolean(result?.subject),
      hasSignature: Boolean(result?.signature)
    });
    return { result, rawRequestBody: body };
  } catch (error) {
    console.error(`[GAR-BG] Fetch error:`, error);
    logDebug('refine_exception', { provider: providerId, error: error.message });
    throw error;
  }
}
