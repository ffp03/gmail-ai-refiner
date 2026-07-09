// content.js — Gmail AI Refiner
console.log('[GAR] Content script loaded');

const DEBOUNCE_MS = 1800;
const AUTO_MIN_CHARS = 20;
const DEBUG_LOG_KEY = 'garDebugLog';
const DEBUG_LOG_LIMIT = 500;
const uiMap = new WeakMap(); // Maps compose boxes to their UI controllers

// ─── Constants & Selectors ───────────────────────────────────────────────────

const COMPOSE_SELECTORS = [
  'div[aria-label="Message Body"]',
  'div[aria-label="Compose email"]',
  'div[g_editable="true"]',
  'div[contenteditable="true"][aria-multiline="true"]',
  '.Am.Al.editable' // Gmail's common classes
];

// ─── Utilities ───────────────────────────────────────────────────────────────

function getSettings() {
  if (!chrome.runtime?.id) {
    console.warn('[GAR] Extension context invalidated. Please refresh Gmail.');
    return Promise.resolve({ enabled: false });
  }
  return new Promise(resolve => {
    try {
      chrome.storage.local.get({
        apiKey: '',
        systemPrompt1: '',
        systemPrompt2: '',
        systemPrompt3: '',
        enabled: true,
        debug: false,
        provider: 'anthropic',
        triggerMode: 'shortcut'
      }, resolve);
    } catch (e) {
      console.error('[GAR] Failed to get settings:', e);
      resolve({ enabled: false });
    }
  });
}

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

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
  if (!chrome.runtime?.id) return;
  try {
    chrome.storage.local.get({ debug: false, [DEBUG_LOG_KEY]: [] }, (data) => {
      if (!data.debug) return;
      const entry = {
        ts: new Date().toISOString(),
        source: 'content',
        event,
        details: redactForLog(details)
      };
      const existing = Array.isArray(data[DEBUG_LOG_KEY]) ? data[DEBUG_LOG_KEY] : [];
      chrome.storage.local.set({ [DEBUG_LOG_KEY]: [...existing, entry].slice(-DEBUG_LOG_LIMIT) });
    });
  } catch (e) {
    console.warn('[GAR] Failed to write debug log:', e);
  }
}

function findActiveComposeBox() {
  const active = document.activeElement;
  if (!active) return null;
  for (const sel of COMPOSE_SELECTORS) {
    const match = active.closest(sel) || (active.matches(sel) ? active : null);
    if (match) return match;
  }
  return null;
}

const PROTECTED_SELECTORS = [
  '.gmail_quote',
  '.gmail_attr',
  '.gmail_signature',
  '.gmail_default',
  'blockquote[type="cite"]',
  'div[aria-label="Show trimmed content"]',
  '.gj'
];

const PROTECTED_SELECTOR = PROTECTED_SELECTORS.join(',');
const CONTEXT_SELECTORS = PROTECTED_SELECTORS.filter(sel => sel !== '.gmail_signature' && sel !== '.gmail_default');
const CONTEXT_SELECTOR = CONTEXT_SELECTORS.join(',');
const FORWARDED_MARKER_RE = /^\s*(-{2,}\s*)?(Forwarded message|Original Message|Begin forwarded message)\s*(-{2,}\s*)?$/i;

function textOf(node) {
  const raw = node?.innerText || node?.textContent || '';
  return raw
    .replace(/\u00a0/g, ' ')
    .split(/\r?\n/)
    .map(line => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

function nodeContainsProtectedMarker(node, selector = PROTECTED_SELECTOR) {
  if (node.nodeType === Node.ELEMENT_NODE) {
    if (node.matches(selector)) return true;
    if (node.querySelector(selector)) return true;
  }
  const lines = textOf(node).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  return lines.some(line => FORWARDED_MARKER_RE.test(line));
}

function describeBoundary(node) {
  if (!node) return '';
  if (node.nodeType === Node.ELEMENT_NODE) {
    for (const sel of PROTECTED_SELECTORS) {
      if (node.matches(sel) || node.querySelector(sel)) return sel;
    }
  }
  return 'forwarded-marker';
}

function findProtectedBoundary(composeBox) {
  return findBoundary(composeBox, PROTECTED_SELECTOR);
}

function findContextBoundary(composeBox) {
  return findBoundary(composeBox, CONTEXT_SELECTOR);
}

function findBoundary(composeBox, selector) {
  const protectedEl = composeBox.querySelector(selector);
  const children = Array.from(composeBox.childNodes);
  const markerChild = children.find(node => nodeContainsProtectedMarker(node, selector)) || null;
  if (protectedEl && markerChild) {
    const protectedTop = directChildFor(composeBox, protectedEl);
    return children.indexOf(protectedTop) <= children.indexOf(markerChild) ? protectedEl : markerChild;
  }
  return protectedEl || markerChild;
}

function directChildFor(root, node) {
  let child = node;
  while (child && child.parentNode !== root) {
    child = child.parentNode;
  }
  return child;
}

function cloneWithoutProtectedContent(composeBox, boundaryFinder = findProtectedBoundary) {
  const clone = composeBox.cloneNode(true);
  const boundary = boundaryFinder(clone);
  let protectedText = '';
  let draftText = textOf(clone);

  if (boundary) {
    const draftRange = document.createRange();
    draftRange.setStart(clone, 0);
    draftRange.setEndBefore(boundary);
    const draftFragment = draftRange.cloneContents();
    draftFragment.querySelectorAll?.('div[aria-label="Show trimmed content"], .gj, .gmail_signature, .gmail_default').forEach(node => node.remove());
    draftText = textOf(draftFragment);

    const protectedRange = document.createRange();
    protectedRange.setStartBefore(boundary);
    protectedRange.setEnd(clone, clone.childNodes.length);
    protectedText = textOf(protectedRange.cloneContents());
  }

  return { draftText, protectedText, boundaryType: describeBoundary(boundary) };
}

function removeContentBeforeBoundary(root, boundary) {
  const topChild = directChildFor(root, boundary);
  if (!topChild) return 0;

  let removedCount = 0;
  while (root.firstChild && root.firstChild !== topChild) {
    root.firstChild.remove();
    removedCount += 1;
  }

  let childOnPath = boundary;
  let parent = boundary.parentNode;
  while (parent && parent !== root) {
    while (parent.firstChild && parent.firstChild !== childOnPath) {
      parent.firstChild.remove();
      removedCount += 1;
    }
    childOnPath = parent;
    parent = parent.parentNode;
  }

  return removedCount;
}

function getDraftAndContext(composeBox) {
  const boundary = findContextBoundary(composeBox);
  
  // Try to find the trimmed content button inside or near the compose box
  let trimmedBtn = composeBox.querySelector('div[aria-label="Show trimmed content"], .gj');
  if (!trimmedBtn) {
    // Look in the broader compose window container
    // Gmail uses many container classes; searching nearby ancestors is safest.
    const container = composeBox.closest('.M9, .ip, .AD, .nH, [role="main"]');
    trimmedBtn = container?.querySelector('div[aria-label="Show trimmed content"], .gj');
  }
  
  // Last resort: search document-wide if only one compose is active
  if (!trimmedBtn) {
    const btns = Array.from(document.querySelectorAll('div[aria-label="Show trimmed content"], .gj'));
    if (btns.length === 1) trimmedBtn = btns[0];
  }
  
  let draft = '';
  let context = '';
  let senderName = '';
  let recipientName = '';

  if (boundary) {
    const attr = boundary.querySelector?.('.gmail_attr') || (boundary.matches?.('.gmail_attr') ? boundary : null);
    
    if (attr) {
      // Try to extract name from "Sender <email> wrote:"
      const match = textOf(attr).match(/On .+, (.+?) <.+> wrote:/);
      if (match) senderName = match[1];
    }

    const extracted = cloneWithoutProtectedContent(composeBox, findContextBoundary);
    draft = extracted.draftText;
    context = extracted.protectedText;
    logDebug('draft_context_extracted', {
      mode: 'protected-boundary',
      boundaryType: extracted.boundaryType,
      draftLength: draft.length,
      contextLength: context.length
    });
  } else if (trimmedBtn) {
    // It's a folded reply. Draft is just the box content.
    draft = textOf(composeBox);
    // Try to get context from the last thread message (scoped to this thread)
    const res = findLastMessageInThread(composeBox);
    context = res.context;
    senderName = res.senderName;
    recipientName = res.recipientName;
    logDebug('draft_context_extracted', {
      mode: 'folded-thread',
      draftLength: draft.length,
      contextLength: context.length
    });
  } else {
    // Probably a new email or unfolded without a clear .gmail_quote (unlikely for replies)
    const extracted = cloneWithoutProtectedContent(composeBox);
    draft = extracted.draftText;
    logDebug('draft_context_extracted', {
      mode: 'plain-compose',
      draftLength: draft.length,
      contextLength: 0
    });
  }
  
  return { draft, context, senderName, recipientName };
}

function findLastMessageInThread(composeBox) {
  // Scope the search to the current thread container to avoid reading a previous thread.
  // Walk up from the compose box to find the nearest thread/conversation root.
  const threadRoot = composeBox
    ? (composeBox.closest('.nH, [role="main"], .aeF, .h7') || document)
    : document;

  // Gmail thread messages are marked with role="listitem" or classes like 'adn'
  const messages = Array.from(threadRoot.querySelectorAll('div[role="listitem"], div.adn, .aeu'));
  if (messages.length > 0) {
    // The last message in the list is usually the one being replied to
    const lastMsg = messages[messages.length - 1];
    
    // Extract sender name if possible
    const senderEl = lastMsg.querySelector('span[email], .gD, .zF');
    const senderName = senderEl ? (senderEl.getAttribute('name') || senderEl.innerText.trim()) : 'Sender';

    // Extract recipient name if possible
    const recipientEl = lastMsg.querySelector('.hb'); // Common for recipient list
    const recipientName = recipientEl ? recipientEl.innerText.trim() : 'Receiver';

    // Attempt to get the actual message body, avoiding headers/signatures
    const body = lastMsg.querySelector('div[dir="ltr"], .a3s, .ii.gt') || lastMsg;
    return { context: body.innerText.trim(), senderName, recipientName };
  }
  return { context: '', senderName: '', recipientName: '' };
}

// ─── UI Factory ──────────────────────────────────────────────────────────────

/**
 * Convert plain text (with \n line breaks) into a DocumentFragment of Gmail-
 * style <div> nodes. Each line becomes its own <div>; blank lines become
 * <div><br></div> — exactly how Gmail's contenteditable represents text so
 * that line breaks display and copy correctly.
 */
function textToNodes(text) {
  const lines = text.split('\n');
  const frag = document.createDocumentFragment();
  for (const line of lines) {
    const div = document.createElement('div');
    if (line === '') {
      div.innerHTML = '<br>';
    } else {
      div.textContent = line;
    }
    frag.appendChild(div);
  }
  return frag;
}

function attachUI(composeBox) {
  if (uiMap.has(composeBox)) return uiMap.get(composeBox);

  console.log('[GAR] Attaching UI to box:', composeBox.getAttribute('aria-label') || 'unlabeled');
  
  const panel = document.createElement('div');
  panel.className = 'gar-panel';
  panel.innerHTML = `
    <div class="gar-header">
      <span class="gar-icon">✦</span>
      <span class="gar-label">AI Suggestion</span>
      <span class="gar-shortcuts"><kbd>Tab</kbd> accept · <kbd>Esc</kbd> dismiss</span>
      <span class="gar-spinner" aria-hidden="true"></span>
    </div>
    <div class="gar-body"></div>
  `;
  
  // Insert ABOVE the compose area so the panel shows at the top of the compose
  // window (between the To/Subject fields and the typing area).
  // Use a safe helper to avoid NotFoundError when Gmail re-parents elements.
  function safeInsertPanel() {
    try {
      const parent = composeBox.parentNode;
      if (!parent) return; // compose box detached
      // insertBefore(panel, composeBox) places the panel just above the body
      if (composeBox.parentNode === parent) {
        parent.insertBefore(panel, composeBox);
      } else {
        parent.appendChild(panel);
      }
    } catch (err) {
      console.warn('[GAR] Could not insert panel, falling back to append:', err);
      try { composeBox.parentNode?.appendChild(panel); } catch (_) {}
    }
  }
  safeInsertPanel();
  composeBox.setAttribute('data-gar-attached', 'true');

  const bodyEl = panel.querySelector('.gar-body');
  let currentSuggestion = '';
  let requestCounter = 0;

  const hide = () => {
    panel.classList.remove('gar-visible', 'gar-loading', 'gar-ready', 'gar-err');
    currentSuggestion = '';
  };

  const showLoading = () => {
    bodyEl.textContent = '';
    panel.classList.remove('gar-ready', 'gar-err');
    panel.classList.add('gar-visible', 'gar-loading');
  };

  const showReady = (text) => {
    currentSuggestion = text;
    bodyEl.textContent = text;
    panel.classList.remove('gar-loading', 'gar-err');
    panel.classList.add('gar-visible', 'gar-ready');
  };

  const showError = (msg) => {
    bodyEl.textContent = msg;
    panel.classList.remove('gar-loading', 'gar-ready');
    panel.classList.add('gar-visible', 'gar-err');
  };

  const executeRefinement = async (isManual = false, promptIndex = 1) => {
    const requestId = ++requestCounter;
    const { draft, context, senderName, recipientName } = getDraftAndContext(composeBox);
    if (draft.length === 0) return hide();
    if (!isManual && draft.length < AUTO_MIN_CHARS) return hide();

    const settings = await getSettings();
    const { apiKey, enabled, debug, provider } = settings;
    const systemPrompt = settings[`systemPrompt${promptIndex}`] || settings.systemPrompt1;
    
    if (!enabled) return hide();
    if (!apiKey) return showError('⚙ Add API Key in extension settings');

    if (debug) {
      console.log('--- [GAR] Extraction Results ---');
      console.log('User Draft:', draft);
      console.log('Previous Context:', context || '(No context found)');
      console.log('Context Sender:', senderName || '(Unknown)');
      console.log('Context Recipient:', recipientName || '(Unknown)');
      console.log('-------------------------------');
    }
    logDebug('refine_requested', {
      requestId,
      isManual,
      promptIndex,
      provider,
      draftLength: draft.length,
      contextLength: context.length
    });
    
    showLoading();
    try {
      chrome.runtime.sendMessage(
        { type: 'REFINE_EMAIL', draft, context, senderName, recipientName, systemPrompt, apiKey, provider },
        (response) => {
          if (chrome.runtime.lastError) {
            logDebug('refine_runtime_error', { requestId, message: chrome.runtime.lastError.message });
            showError('⚠️ Context invalidated. Refresh Gmail tab.');
            return;
          }
          if (requestId !== requestCounter) {
            logDebug('refine_stale_response_ignored', { requestId, activeRequestId: requestCounter });
            return;
          }
          if (response.success) {
            if (debug && response.rawRequestBody) {
              console.log('--- [GAR] Raw LLM Input ---');
              console.log(JSON.stringify(response.rawRequestBody, null, 2));
              console.log('---------------------------');
            }
            const res = response.refined;
            const refinedBody = (typeof res === 'object') ? (res.body || res.refined_email) : res;
            if (debug && typeof res === 'object') console.log('[GAR] Discarded signature:', res.signature);
            logDebug('refine_succeeded', {
              requestId,
              refinedLength: refinedBody?.length || 0,
              hasSubject: Boolean(res?.subject),
              hasSignature: Boolean(res?.signature)
            });
            showReady(refinedBody);
          } else {
            logDebug('refine_failed', { requestId, error: response.error });
            showError(response.error);
          }
        }
      );
    } catch (e) {
      logDebug('refine_exception', { requestId, message: e.message });
      showError('⚠️ Extension reloaded. Please refresh the page.');
    }
  };

  const triggerAuto = debounce(() => executeRefinement(false, 1), DEBOUNCE_MS);

  const controller = {
    executeRefinement,
    triggerAuto,
    accept: () => {
      if (!currentSuggestion) return;
      composeBox.focus();

      const boundary = findProtectedBoundary(composeBox);
      if (boundary) {
        // ── Targeted replacement: only overwrite nodes BEFORE the gmail_quote ──
        // Collect all direct child nodes that precede the quote block
        const removedNodeCount = removeContentBeforeBoundary(composeBox, boundary);
        const insertionParent = boundary.parentNode || composeBox;
        // Insert the refined text (preserving line breaks) before the quote
        insertionParent.insertBefore(textToNodes(currentSuggestion), boundary);
        // Add a blank line between draft and quote for readability
        const spacer = document.createElement('div');
        spacer.innerHTML = '<br>';
        insertionParent.insertBefore(spacer, boundary);
        logDebug('suggestion_accepted', {
          mode: 'protected-boundary',
          boundaryType: describeBoundary(boundary),
          removedNodeCount,
          suggestionLength: currentSuggestion.length
        });
      } else {
        // No quoted section — replace the user-typed content but preserve Gmail's
        // default signature block (.gmail_signature) which sits below the cursor.
        const sigEl = composeBox.querySelector('.gmail_signature, .gmail_default');
        if (sigEl) {
          // Remove all nodes before the signature, then prepend the refined text
          const nodesToRemove = [];
          for (const node of composeBox.childNodes) {
            if (node === sigEl) break;
            nodesToRemove.push(node);
          }
          nodesToRemove.forEach(n => n.remove());
          // Insert lines as proper <div> nodes so newlines render correctly
          composeBox.insertBefore(textToNodes(currentSuggestion), sigEl);
          // Blank line between refined text and signature
          const spacer = document.createElement('div');
          spacer.innerHTML = '<br>';
          composeBox.insertBefore(spacer, sigEl);
          logDebug('suggestion_accepted', {
            mode: 'signature-boundary',
            removedNodeCount: nodesToRemove.length,
            suggestionLength: currentSuggestion.length
          });
        } else {
          // Truly no signature — safe to replace everything
          document.execCommand('selectAll', false, null);
          document.execCommand('insertText', false, currentSuggestion);
          logDebug('suggestion_accepted', {
            mode: 'replace-all',
            suggestionLength: currentSuggestion.length
          });
        }
      }

      hide();
    },
    dismiss: hide
  };

  uiMap.set(composeBox, controller);
  return controller;
}

// ─── Listeners ───────────────────────────────────────────────────────────────

// 1. Unified Document Listener for Shortcut & Panel Interaction
document.addEventListener('keydown', async (e) => {
  const isShortcut1 = e.ctrlKey && e.key === '1';
  const isShortcut2 = e.ctrlKey && e.key === '2';
  const isShortcut3 = e.ctrlKey && e.key === '3';
  const isShortcut = isShortcut1 || isShortcut2 || isShortcut3;
  const isTab = e.key === 'Tab';
  const isEsc = e.key === 'Escape';

  if (!isShortcut && !isTab && !isEsc) return;

  const box = findActiveComposeBox();
  if (!box) return;

  const ui = attachUI(box);

  if (isShortcut) {
    const promptIndex = isShortcut1 ? 1 : (isShortcut2 ? 2 : 3);
    console.log(`[GAR] Ctrl+${promptIndex} shortcut detected`);
    e.preventDefault();
    e.stopPropagation();
    const { enabled, triggerMode } = await getSettings();
    if (enabled && triggerMode === 'shortcut') ui.executeRefinement(true, promptIndex);
  } else if (isTab || isEsc) {
    // Check if panel is showing a suggestion.
    // Use querySelector to find the panel robustly — nextSibling is fragile
    // when Gmail re-orders DOM siblings.
    const panel = box.parentNode?.querySelector('.gar-panel.gar-ready');
    if (panel) {
      e.preventDefault();
      e.stopPropagation();
      if (isTab) ui.accept();
      else ui.dismiss();
    }
  }
}, true); // Use capture phase to intercept Tab/Esc from Gmail

// 2. Observer & Input (for Auto-Refine)
const observer = new MutationObserver(() => {
  const box = findActiveComposeBox();
  if (box) attachUI(box);
});
observer.observe(document.body, { childList: true, subtree: true });

document.addEventListener('input', async (e) => {
  const box = findActiveComposeBox();
  if (!box) return;
  
  const { enabled, triggerMode } = await getSettings();
  if (!enabled || triggerMode !== 'auto') return;

  const ui = attachUI(box);
  ui.triggerAuto();
});
