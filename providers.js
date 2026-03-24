// providers.js — Registry for LLM providers
// Handles request construction and response parsing specifically for JSON output

const baseSystemPrompt = `Act as my professional executive assistant. When I submit a draft email for refinement, your goal is to improve grammar, flow, and readability while strictly maintaining my original intention and information.

Guidelines:
- Context: Understand that my drafts may be written in a rush and lack introductions, outros, or smooth transitions.
- Logic & Gaps: Meaningfully fill in missing logic, smooth out transitions, and add standard professional pleasantries (intro/outro) yourself.
- Writing Style: Keep the writing simple, natural, and easy to follow.`;

const jsonRules = `1. You MUST output ONLY valid JSON.
2. The JSON object must have these exactly three keys:
   - "subject": A concise subject line for the email.
   - "refined_email": The improved email body text (do NOT include the signature here).
   - "signature": Any professional signature, sign-off, or placeholder the AI generates (kept separate from the body).
3. Do NOT include markdown code blocks (like \`\`\`json). Just output the raw JSON string.
4. Do NOT include any conversational text or preambles.`;

const defaultSystemPrompt = `${baseSystemPrompt}\nRULES:\n${jsonRules}`;

export function enforceJsonRules(customPrompt) {
  if (!customPrompt || !customPrompt.trim()) return defaultSystemPrompt;
  const trimmed = customPrompt.trim();
  // If the user already wrote their own JSON rules, don't double append
  if (trimmed.includes('valid JSON') && trimmed.includes('refined_email')) {
    return trimmed;
  }
  return `${trimmed}\n\nRULES:\n${jsonRules}`;
}

export function extractJson(text) {
  // Strip potential markdown wrappers like ```json\n...\n```
  let cleanText = text.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
  
  try {
    const parsed = JSON.parse(cleanText);
    return {
      subject: parsed.subject?.trim() || '',
      body: parsed.refined_email?.trim() || '',
      signature: parsed.signature?.trim() || ''
    };
  } catch (e) {
    // Fallback: If JSON parsing fails, treat the whole body as 'body'
    const body = cleanText.replace(/^(Here('s| is).*:|Sure[!,]|Refined.*:)\s*\n/i, '').trim();
    return { subject: '', body, signature: '' };
  }
}

export const PROVIDERS = {
  anthropic: {
    name: 'Anthropic',
    endpoint: 'https://api.anthropic.com/v1/messages',
    keyPrefix: 'sk-ant-',
    buildHeaders: (apiKey) => ({
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    }),
    buildBody: (draft, systemPrompt) => ({
      model: 'claude-3-7-sonnet-latest',
      max_tokens: 2000,
      system: enforceJsonRules(systemPrompt),
      messages: [
        { role: 'user', content: `Refine this email draft and return JSON:\n\n${draft}` },
        // Pre-fill assistant response to force JSON
        { role: 'assistant', content: '{' }
      ]
    }),
    extractText: (responseData) => {
      if (!responseData.content || !responseData.content[0]) {
         throw new Error('Invalid Anthropic response');
      }
      // Since we pre-filled '{', the response will just be the rest of the JSON. Make sure to prepend '{'.
      const rawText = '{' + responseData.content[0].text;
      return extractJson(rawText);
    }
  },

  gemini: {
    name: 'Google Gemini',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
    keyPrefix: null,
    buildEndpoint: (endpoint, apiKey) => `${endpoint}?key=${apiKey}`,
    buildHeaders: () => ({
      'Content-Type': 'application/json'
    }),
    buildBody: (draft, systemPrompt) => ({
      system_instruction: {
        parts: [{ text: enforceJsonRules(systemPrompt) }]
      },
      contents: [{
        parts: [{ text: `Refine this email draft and return JSON:\n\n${draft}` }]
      }],
      generationConfig: {
        temperature: 0.2, // Lower temp for strict JSON adherence
        response_mime_type: 'application/json' // Force JSON response
      }
    }),
    extractText: (responseData) => {
      if (!responseData.candidates || !responseData.candidates[0] || !responseData.candidates[0].content) {
         throw new Error('Invalid Gemini response');
      }
      const rawText = responseData.candidates[0].content.parts[0].text;
      return extractJson(rawText);
    }
  },

  deepseek: {
    name: 'DeepSeek',
    endpoint: 'https://api.deepseek.com/chat/completions',
    keyPrefix: 'sk-',
    buildHeaders: (apiKey) => ({
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    }),
    buildBody: (draft, systemPrompt) => ({
      model: 'deepseek-chat',
      response_format: { type: 'json_object' }, // Enforce JSON mode
      messages: [
        { role: 'system', content: enforceJsonRules(systemPrompt) },
        { role: 'user', content: `Refine this email draft and return JSON:\n\n${draft}` }
      ],
      temperature: 0.1
    }),
    extractText: (responseData) => {
      if (!responseData.choices || !responseData.choices[0] || !responseData.choices[0].message) {
         throw new Error('Invalid DeepSeek response');
      }
      const rawText = responseData.choices[0].message.content;
      return extractJson(rawText);
    }
  }
};

