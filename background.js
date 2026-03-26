import { PROVIDERS } from './providers.js';

console.log('[GAR-BG] Service Worker loaded');

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'REFINE_EMAIL') {
    refineEmail(message.draft, message.systemPrompt, message.apiKey, message.provider, message.context, message.senderName, message.recipientName)
      .then(({ result, rawRequestBody }) => sendResponse({ success: true, refined: result, rawRequestBody }))
      .catch(err => {
        console.error('[GAR-BG] Refinement failed:', err);
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

  const endpoint = provider.buildEndpoint ? provider.buildEndpoint(provider.endpoint, apiKey) : provider.endpoint;
  const headers = provider.buildHeaders(apiKey);
  const body = provider.buildBody(draft, systemPrompt, context, senderName, recipientName);

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

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[GAR-BG] Error response body:`, errText);
      let errJson = {};
      try { errJson = JSON.parse(errText); } catch(e) {}
      throw new Error(errJson?.error?.message || `API error ${response.status}`);
    }

    const data = await response.json();
    console.log(`[GAR-BG] Raw API Response:`, JSON.stringify(data, null, 2));
    const result = provider.extractText(data);
    console.log(`[GAR-BG] Final Extracted Result:`, JSON.stringify(result, null, 2));
    return { result, rawRequestBody: body };
  } catch (error) {
    console.error(`[GAR-BG] Fetch error:`, error);
    throw error;
  }
}
