import { PROVIDERS } from './providers.js';

console.log('[GAR-BG] Service Worker loaded');

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'REFINE_EMAIL') {
    refineEmail(message.draft, message.systemPrompt, message.apiKey, message.provider)
      .then(refined => sendResponse({ success: true, refined }))
      .catch(err => {
        console.error('[GAR-BG] Refinement failed:', err);
        sendResponse({ success: false, error: err.message });
      });
    return true; // Keep channel open for async response
  }
});

async function refineEmail(draft, systemPrompt, apiKey, providerId = 'anthropic') {
  console.log(`[GAR-BG] Starting refinement with provider: ${providerId}`);
  const provider = PROVIDERS[providerId];
  if (!provider) {
    throw new Error(`Unknown provider: ${providerId}`);
  }

  const endpoint = provider.buildEndpoint ? provider.buildEndpoint(provider.endpoint, apiKey) : provider.endpoint;
  const headers = provider.buildHeaders(apiKey);
  const body = provider.buildBody(draft, systemPrompt);

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

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[GAR-BG] Error response body:`, errText);
      let errJson = {};
      try { errJson = JSON.parse(errText); } catch(e) {}
      throw new Error(errJson?.error?.message || `API error ${response.status}`);
    }

    const data = await response.json();
    console.log(`[GAR-BG] Data received:`, JSON.stringify(data, null, 2));
    const result = provider.extractText(data);
    console.log(`[GAR-BG] Extracted text:`, result);
    return result;
  } catch (error) {
    console.error(`[GAR-BG] Fetch error:`, error);
    throw error;
  }
}
