// content.js — Gmail AI Refiner
console.log('[GAR] Content script loaded');

const DEBOUNCE_MS = 1800;
const AUTO_MIN_CHARS = 20;
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

function findActiveComposeBox() {
  const active = document.activeElement;
  if (!active) return null;
  for (const sel of COMPOSE_SELECTORS) {
    const match = active.closest(sel) || (active.matches(sel) ? active : null);
    if (match) return match;
  }
  return null;
}

function getDraftAndContext(composeBox) {
  const quoteEl = composeBox.querySelector('.gmail_quote');
  
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

  if (quoteEl) {
    const clone = composeBox.cloneNode(true);
    const q = clone.querySelector('.gmail_quote');
    const b = clone.querySelector('div[aria-label="Show trimmed content"], .gj');
    const attr = q?.querySelector('.gmail_attr'); // e.g. "On Wed, ..."
    
    if (attr) {
      // Try to extract name from "Sender <email> wrote:"
      const match = attr.innerText.match(/On .+, (.+?) <.+> wrote:/);
      if (match) senderName = match[1];
    }
    
    if (q) {
      context = q.innerText.trim();
      q.remove();
    }
    if (b) b.remove();
    
    draft = clone.innerText.trim();
  } else if (trimmedBtn) {
    // It's a folded reply. Draft is just the box content.
    draft = composeBox.innerText.trim();
    // Try to get context from the last thread message (scoped to this thread)
    const res = findLastMessageInThread(composeBox);
    context = res.context;
    senderName = res.senderName;
    recipientName = res.recipientName;
  } else {
    // Probably a new email or unfolded without a clear .gmail_quote (unlikely for replies)
    draft = composeBox.innerText.trim();
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
    
    showLoading();
    try {
      chrome.runtime.sendMessage(
        { type: 'REFINE_EMAIL', draft, context, senderName, recipientName, systemPrompt, apiKey, provider },
        (response) => {
          if (chrome.runtime.lastError) {
            showError('⚠️ Context invalidated. Refresh Gmail tab.');
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
            showReady(refinedBody);
          } else {
            showError(response.error);
          }
        }
      );
    } catch (e) {
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

      const quoteEl = composeBox.querySelector('.gmail_quote');
      if (quoteEl) {
        // ── Targeted replacement: only overwrite nodes BEFORE the gmail_quote ──
        // Collect all direct child nodes that precede the quote block
        const nodesToRemove = [];
        for (const node of composeBox.childNodes) {
          if (node === quoteEl) break;
          nodesToRemove.push(node);
        }
        // Remove them
        nodesToRemove.forEach(n => n.remove());
        // Insert the refined text (preserving line breaks) before the quote
        composeBox.insertBefore(textToNodes(currentSuggestion), quoteEl);
        // Add a blank line between draft and quote for readability
        const spacer = document.createElement('div');
        spacer.innerHTML = '<br>';
        composeBox.insertBefore(spacer, quoteEl);
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
        } else {
          // Truly no signature — safe to replace everything
          document.execCommand('selectAll', false, null);
          document.execCommand('insertText', false, currentSuggestion);
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
