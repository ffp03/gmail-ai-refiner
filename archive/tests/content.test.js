import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { jest } from '@jest/globals';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadContentInternals() {
  document.body.innerHTML = '<main></main>';
  global.MutationObserver = class {
    observe() {}
    disconnect() {}
  };
  global.chrome = {
    runtime: { id: 'test-extension' },
    storage: {
      local: {
        get: jest.fn((defaults, cb) => cb({ ...defaults, debug: false })),
        set: jest.fn()
      }
    }
  };

  const source = fs.readFileSync(path.resolve(__dirname, '../../content.js'), 'utf8');
  const extract = new Function(`
    ${source}
    return {
      debounce,
      getDraftAndContext,
      findProtectedBoundary,
      findContextBoundary,
      cloneWithoutProtectedContent,
      textToNodes
    };
  `);
  return extract();
}

describe('content.js compose boundary helpers', () => {
  let internals;

  beforeEach(() => {
    internals = loadContentInternals();
  });

  it('debounces repeated calls', () => {
    jest.useFakeTimers();
    const fn = jest.fn();
    const debounced = internals.debounce(fn, 100);

    debounced();
    debounced();
    debounced();

    expect(fn).not.toHaveBeenCalled();
    jest.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it('extracts draft and context from a standard Gmail quote', () => {
    const compose = document.createElement('div');
    compose.innerHTML = `
      <div>Please handle this.</div>
      <div class="gmail_quote">
        <div class="gmail_attr">On Wed, Sender &lt;sender@example.com&gt; wrote:</div>
        <blockquote>Original request</blockquote>
      </div>
    `;

    const result = internals.getDraftAndContext(compose);

    expect(result.draft).toBe('Please handle this.');
    expect(result.context).toContain('Original request');
    expect(result.senderName).toBe('Sender');
  });

  it('does not include a Gmail signature in the draft sent for refinement', () => {
    const compose = document.createElement('div');
    compose.innerHTML = `
      <div>Please handle this.</div>
      <div class="gmail_signature">Best,<br>Me</div>
    `;

    const result = internals.getDraftAndContext(compose);

    expect(result.draft).toBe('Please handle this.');
    expect(result.context).toBe('');
  });

  it('treats forwarded separators as protected context', () => {
    const compose = document.createElement('div');
    compose.innerHTML = `
      <div>Can you review this?</div>
      <div>---------- Forwarded message ---------</div>
      <div>From: Alice &lt;alice@example.com&gt;</div>
      <div>Subject: Original</div>
      <div>Forwarded body should stay untouched.</div>
    `;

    const result = internals.getDraftAndContext(compose);
    const boundary = internals.findProtectedBoundary(compose);

    expect(result.draft).toBe('Can you review this?');
    expect(result.context).toContain('Forwarded message');
    expect(result.context).toContain('Forwarded body should stay untouched.');
    expect(boundary.textContent).toContain('Forwarded message');
  });
});
