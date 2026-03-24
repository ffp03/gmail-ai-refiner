import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { jest } from '@jest/globals';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('content.js utility functions', () => {
  let debounce, plainText, createPanel;

  beforeAll(() => {
    // Setup minimal DOM for content.js global context
    document.body.innerHTML = '<div></div>';

    // Mock MutationObserver before requiring content.js
    global.MutationObserver = class {
      constructor() {}
      observe() {}
      disconnect() {}
    };

    // Load content.js but capture functions (eval approach to test internal non-exported fns)
    const source = fs.readFileSync(path.resolve(__dirname, '../content.js'), 'utf8');
    
    // Mock chrome API that's accessed at the top level
    global.chrome = {
      runtime: {
        onMessage: { addListener: jest.fn() }
      }
    };
    
    // Evaluate in a function to extract internals
    const extract = new Function(`
      ${source}
      return { debounce, plainText, createPanel };
    `);
    
    const internals = extract();
    debounce = internals.debounce;
    plainText = internals.plainText;
    createPanel = internals.createPanel;
  });

  describe('debounce', () => {
    it('executes only once after delay', () => {
      jest.useFakeTimers();
      const fn = jest.fn();
      const debounced = debounce(fn, 100);

      debounced();
      debounced();
      debounced();

      expect(fn).not.toHaveBeenCalled();
      jest.advanceTimersByTime(100);
      expect(fn).toHaveBeenCalledTimes(1);
      
      jest.useRealTimers();
    });
  });

  describe('plainText', () => {
    it('trims and extracts text', () => {
      const el = document.createElement('div');
      el.innerText = '  \nHello World\n  ';
      expect(plainText(el)).toBe('Hello World');
    });
  });

  describe('createPanel', () => {
    it('creates correct DOM structure', () => {
      const panel = createPanel();
      expect(panel.className).toBe('gar-panel');
      expect(panel.querySelector('.gar-header')).toBeTruthy();
      expect(panel.querySelector('.gar-body')).toBeTruthy();
      expect(panel.querySelector('.gar-spinner')).toBeTruthy();
    });
  });
});

// For integration tests on content.js, we would need extensive mocking of the Gmail compose 
// box and keyboard events, which is outside the scope of unit testing utility pure functions.
// We'll trust the E2E verification for complex DOM interactions.
