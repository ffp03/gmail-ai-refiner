// providers.js — Registry for LLM providers
// Handles request construction and response parsing specifically for JSON output

const baseSystemPrompt = `Act as my professional executive assistant. When I submit a draft email for refinement, your goal is to improve grammar, flow, and readability while strictly maintaining my original intention and information.

Guidelines:
- Context: Understand that my drafts may be written in a rush and lack introductions, outros, or smooth transitions.
- Logic & Gaps: Meaningfully fill in missing logic, smooth out transitions, and add standard professional pleasantries yourself — a greeting, and a closing sentence such as "Please let me know if you have any questions." Never add a valediction/sign-off (e.g. "Best regards,", "Sincerely,", "Thanks,") or a name — those always go in the separate signature field, see RULES.
- Writing Style: Keep the writing simple, natural, and easy to follow.`;

const jsonRules = `1. You MUST output ONLY valid JSON.
2. The JSON object must have these exactly three keys:
   - "subject": A concise subject line for the email.
   - "refined_email": The improved email body text.
   - "signature": Any sign-off, valediction, closing line, or name/placeholder.
3. "refined_email" must NEVER end with a valediction (e.g. "Best regards,", "Best,", "Sincerely,", "Thanks,", "Regards,") or a name/placeholder — not even as a natural-sounding pleasantry. Every closing of that kind belongs only in "signature", with nothing left behind in "refined_email".
4. Do NOT include markdown code blocks (like \`\`\`json). Just output the raw JSON string.
5. Do NOT include any conversational text or preambles.`;

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

// Canonical email sign-off phrases. Matched only when a line consists of
// ONLY the phrase (plus optional punctuation) — never mid-sentence — so a
// closing sentence like "Thank you so much for your help." is left alone.
const VALEDICTION_RE = /^(best regards|warm regards|warmest regards|kind regards|regards|sincerely|sincerely yours|yours sincerely|yours truly|yours faithfully|best wishes|respectfully|many thanks|thank you|thanks|best|cheers|take care)[,.!]?$/i;

// A line that looks like a name or a placeholder for one: "[Your Name]",
// "Sarah", "John Smith" — short, no sentence punctuation.
const NAME_PLACEHOLDER_RE = /^(\[[^\]]{1,40}\]|[A-Z][a-zA-Z.'-]*(\s[A-Z][a-zA-Z.'-]*){0,3})$/;

// Models are told to keep the signature/sign-off out of "refined_email", but
// don't always comply (they treat a valediction as part of the "add a
// pleasant outro" instruction). This is a deterministic safety net: strip a
// trailing valediction line, optionally followed by a name/placeholder line,
// off the body — regardless of what the model put in the JSON's own
// "signature" field.
function stripTrailingSignOff(body) {
  const lines = body.split('\n');
  let end = lines.length;
  while (end > 0 && lines[end - 1].trim() === '') end--;
  if (end === 0) return { body, signOff: '' };

  const lastLine = lines[end - 1].trim();
  let cutFrom = -1;

  if (VALEDICTION_RE.test(lastLine)) {
    cutFrom = end - 1;
  } else if (end - 2 >= 0 && NAME_PLACEHOLDER_RE.test(lastLine) && VALEDICTION_RE.test(lines[end - 2].trim())) {
    cutFrom = end - 2;
  }

  if (cutFrom === -1) return { body, signOff: '' };

  const signOff = lines.slice(cutFrom, end).join('\n').trim();
  const cleanedBody = lines.slice(0, cutFrom).join('\n').trim();
  return { body: cleanedBody, signOff };
}

export function extractJson(text) {
  // Strip potential markdown wrappers like ```json\n...\n```
  let cleanText = text.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();

  try {
    const parsed = JSON.parse(cleanText);
    const { body, signOff } = stripTrailingSignOff(parsed.refined_email?.trim() || '');
    const signature = [parsed.signature?.trim(), signOff].filter(Boolean).join('\n');
    return {
      subject: parsed.subject?.trim() || '',
      body,
      signature
    };
  } catch (e) {
    // Fallback: If JSON parsing fails, treat the whole body as 'body'
    const rawBody = cleanText.replace(/^(Here('s| is).*:|Sure[!,]|Refined.*:)\s*\n/i, '').trim();
    const { body, signOff } = stripTrailingSignOff(rawBody);
    return { subject: '', body, signature: signOff };
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
    buildBody: (draft, systemPrompt, context, senderName, recipientName) => ({
      model: 'claude-3-7-sonnet-latest',
      max_tokens: 2000,
      system: enforceJsonRules(systemPrompt),
      messages: [
        { 
          role: 'user', 
          content: `--- PREVIOUS EMAIL ---
FROM: ${senderName || 'Sender'}
TO: ${recipientName || 'Receiver'}
CONTENT:
${context || '(No content found)'}

--- MY NEW DRAFT (TO BE REFINED) ---
FROM: Me
TO: ${senderName || 'Recipient'}
CONTENT:
${draft}

Refine my draft based on the context above and return JSON.` 
        },
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
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent',
    keyPrefix: null,
    buildEndpoint: (endpoint, apiKey) => `${endpoint}?key=${apiKey}`,
    buildHeaders: () => ({
      'Content-Type': 'application/json'
    }),
    buildBody: (draft, systemPrompt, context, senderName, recipientName) => ({
      system_instruction: {
        parts: [{ text: enforceJsonRules(systemPrompt) }]
      },
      contents: [{
        parts: [{ text: `--- PREVIOUS EMAIL ---
FROM: ${senderName || 'Sender'}
TO: ${recipientName || 'Receiver'}
CONTENT:
${context || '(No content found)'}

--- MY NEW DRAFT (TO BE REFINED) ---
FROM: Me
TO: ${senderName || 'Recipient'}
CONTENT:
${draft}

Refine my draft based on the context above and return JSON.` }]
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
    buildBody: (draft, systemPrompt, context, senderName, recipientName) => ({
      model: 'deepseek-chat',
      response_format: { type: 'json_object' }, // Enforce JSON mode
      messages: [
        { role: 'system', content: enforceJsonRules(systemPrompt) },
        { 
          role: 'user', 
          content: `--- PREVIOUS EMAIL ---
FROM: ${senderName || 'Sender'}
TO: ${recipientName || 'Receiver'}
CONTENT:
${context || '(No content found)'}

--- MY NEW DRAFT (TO BE REFINED) ---
FROM: Me
TO: ${senderName || 'Recipient'}
CONTENT:
${draft}

Refine my draft based on the context above and return JSON.` 
        }
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

