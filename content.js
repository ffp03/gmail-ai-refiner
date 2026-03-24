// content.js — Gmail AI Refiner
// Watches for compose windows, triggers AI refinement, shows inline suggestion

console.log('[GAR] Content script injected');

const DEBOUNCE_MS = 1800;       // ms of idle typing before triggering
const AUTO_MIN_CHARS = 20;      // minimum draft length to trigger auto string
const attachedBoxes = new WeakSet();

// ─── Utilities ────────────────────────────────────────────────────────────────

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function getSettings() {
  return new Promise(resolve =>
    chrome.storage.local.get({
      apiKey: '',
      systemPrompt: '',
      enabled: true,
      debug: false,
      provider: 'anthropic',
      triggerMode: 'shortcut'
    }, resolve)
  );
}

function plainText(el) {
  // Preserve line breaks from Gmail's contenteditable structure
  return el.innerText.trim();
}

// ─── Suggestion Panel ─────────────────────────────────────────────────────────

function createPanel() {
  const panel = document.createElement('div');
  panel.className = 'gar-panel';
  panel.innerHTML = `
    <div class="gar-header">
      <span class="gar-icon">✦</span>
      <span class="gar-label">AI Suggestion</span>
      <span class="gar-shortcuts">
        <kbd>Tab</kbd> accept &nbsp;·&nbsp; <kbd>Esc</kbd> dismiss
      </span>
      <span class="gar-spinner" aria-hidden="true"></span>
    </div>
    <div class="gar-body"></div>
  `;
  return panel;
}

// ─── Core: attach to a compose box ───────────────────────────────────────────

function attachToCompose(composeBox) {
  if (attachedBoxes.has(composeBox)) return;
  attachedBoxes.add(composeBox);
  composeBox.setAttribute('data-gar-attached', 'true');

  // Inject panel as next sibling of compose box
  const panel   = createPanel();
  const bodyEl  = panel.querySelector('.gar-body');
  const spinner = panel.querySelector('.gar-spinner');

  // Insert right below the compose area
  composeBox.parentNode.insertBefore(panel, composeBox.nextSibling);

  let currentSuggestion = '';

  // ── State helpers ──
  function hide() {
    panel.classList.remove('gar-visible', 'gar-loading', 'gar-ready', 'gar-err');
    currentSuggestion = '';
  }

  function showLoading() {
    bodyEl.textContent = '';
    panel.classList.remove('gar-ready', 'gar-err');
    panel.classList.add('gar-visible', 'gar-loading');
  }

  function showReady(text) {
    currentSuggestion = text;
    bodyEl.textContent = text;
    panel.classList.remove('gar-loading', 'gar-err');
    panel.classList.add('gar-visible', 'gar-ready');
  }

  function showError(msg) {
    bodyEl.textContent = msg;
    panel.classList.remove('gar-loading', 'gar-ready');
    panel.classList.add('gar-visible', 'gar-err');
  }

  // ── Trigger refinement ──
  const executeRefinement = async (isManual = false) => {
    const draft = plainText(composeBox);
    
    // Always ignore completely empty drafts, and enforce the auto limit for non-manual triggers
    if (draft.length === 0) return hide();
    if (!isManual && draft.length < AUTO_MIN_CHARS) return hide();

    const { apiKey, systemPrompt, enabled, debug, provider } = await getSettings();
    if (enabled === false) return hide();

    if (!apiKey) {
      showError('⚙ Add your API key in extension settings');
      return;
    }

    if (debug) {
      console.log('--- Gmail AI Refiner [DEBUG] ---');
      console.log('Provider:', provider);
      console.log('Draft length:', draft.length);
      console.log('Draft text:', draft);
      console.log('System Prompt override:', systemPrompt ? 'Yes' : 'No');
    }

    showLoading();
    const startTime = Date.now();

    chrome.runtime.sendMessage(
      { type: 'REFINE_EMAIL', draft, systemPrompt, apiKey, provider },
      (response) => {
        const latency = Date.now() - startTime;
        
        if (chrome.runtime.lastError) {
          console.error('[GAR] Runtime message error:', chrome.runtime.lastError);
          showError('⚠️ Extension background process failed to respond. Try reloading the extension.');
          return;
        }

        if (debug) {
          console.log('[GAR] Response received in', latency, 'ms');
          console.log('[GAR] Success:', response?.success);
          if (response?.success) console.log('[GAR] Refined text:', response.refined);
          if (!response?.success) console.error('[GAR] Error:', response.error);
        }

        if (response?.success) {
          const result = response.refined;
          const bodyText = (typeof result === 'object') ? result.body : result;
          
          if (debug && typeof result === 'object') {
            console.log('[GAR] Structured response received:');
            console.log('  - Subject:', result.subject);
            console.log('  - Signature (Discarded):', result.signature);
          }

          showReady(bodyText);
        } else {
          showError(`API Error: ${response?.error || 'Unknown error'}`);
        }
      }
    );
  };
  
  const triggerRefine = debounce(() => executeRefinement(false), DEBOUNCE_MS);

  // ── Keyboard handler (Triggering & Accepting) ──
  composeBox.addEventListener('keydown', async (e) => {
    // 1. Check for manual trigger (Ctrl+Space)
    if (e.ctrlKey && (e.code === 'Space' || e.key === ' ')) {
      console.log('[GAR] Ctrl+Space detected');
      e.preventDefault();
      e.stopPropagation();
      
      const { enabled, triggerMode } = await getSettings();
      if (enabled && triggerMode === 'shortcut') {
        console.log('[GAR] Triggering refinement');
        executeRefinement(true);
      }
      return;
    }

    // 2. Check for panel interaction (Tab / Esc)
    if (!panel.classList.contains('gar-ready')) return;

    if (e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();

      // Replace compose content with suggestion
      composeBox.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, currentSuggestion);

      // Move cursor to end
      const range = document.createRange();
      range.selectNodeContents(composeBox);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);

      hide();

    } else if (e.key === 'Escape') {
      hide();
    }
  }, true); // Use capture phase so we get the event before Gmail swallows it

  // ── Input: watch for typing, trigger auto-refinement if enabled ──
  composeBox.addEventListener('input', async () => {
    const text = plainText(composeBox);
    if (text.length < AUTO_MIN_CHARS) {
      hide();
      return;
    } 

    const { triggerMode, enabled } = await getSettings();
    if (!enabled || triggerMode !== 'auto') return;

    // Show a subtle "pending" state while debounce ticks
    if (!panel.classList.contains('gar-loading')) {
      panel.classList.add('gar-visible', 'gar-pending');
    }
    triggerRefine();
  });
}

// ─── Observer: watch for new compose windows ─────────────────────────────────

const observer = new MutationObserver(() => {
  document.querySelectorAll('div[aria-label="Message Body"]')
    .forEach(attachToCompose);
});

observer.observe(document.body, { childList: true, subtree: true });

// Initial scan (for compose windows already open on load)
document.querySelectorAll('div[aria-label="Message Body"]')
  .forEach(attachToCompose);
