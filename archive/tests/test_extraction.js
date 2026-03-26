// test_extraction.js
function getDraftAndContext(composeBox) {
  const quoteEl = composeBox.querySelector('.gmail_quote');
  
  // Try to find the trimmed content button inside or near the compose box
  let trimmedBtn = composeBox.querySelector('div[aria-label="Show trimmed content"], .gj');
  if (!trimmedBtn) {
    const container = composeBox.closest('table.cf.An')?.parentElement || composeBox.parentElement;
    trimmedBtn = container?.querySelector('div[aria-label="Show trimmed content"], .gj');
  }
  
  let draft = '';
  let context = '';

  if (quoteEl) {
    const clone = composeBox.cloneNode(true);
    const q = clone.querySelector('.gmail_quote');
    const b = clone.querySelector('div[aria-label="Show trimmed content"], .gj');
    
    if (q) {
      context = q.innerText.trim();
      q.remove();
    }
    if (b) b.remove();
    
    draft = clone.innerText.trim();
  } else if (trimmedBtn) {
    draft = composeBox.innerText.trim();
    context = findLastMessageInThread();
  } else {
    draft = composeBox.innerText.trim();
  }
  
  return { draft, context };
}

function findLastMessageInThread() {
  const messages = Array.from(document.querySelectorAll('div[role="listitem"]'));
  if (messages.length > 0) {
    const lastMsg = messages[messages.length - 1];
    const body = lastMsg.querySelector('div[dir="ltr"]') || lastMsg;
    return body.innerText.trim();
  }
  return '';
}

function runTests() {
    const scenarios = [
        { id: 'test-unfolded', name: 'Unfolded Reply' },
        { id: 'test-folded', name: 'Folded Reply' },
        { id: 'test-new', name: 'New Compose' },
        { id: 'test-folded-alt', name: 'Folded with Quoted Content' },
        { id: 'test-real-complex', name: 'Real Gmail Complex (Folded)' }
    ];

    scenarios.forEach(s => {
        const el = document.getElementById(s.id);
        if (!el) {
            console.error(`Missing element for scenario: ${s.name}`);
            return;
        }
        const result = getDraftAndContext(el);
        console.log(`--- ${s.name} ---`);
        console.log(`DRAFT:   [${result.draft}]`);
        console.log(`CONTEXT: [${result.context}]`);
        console.log('------------------');
    });
}

runTests();
