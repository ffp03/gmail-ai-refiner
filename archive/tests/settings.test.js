import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { jest } from '@jest/globals';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('settings.js', () => {
  let originalHtml;

  beforeAll(() => {
    // Load the HTML into jsdom
    originalHtml = fs.readFileSync(path.resolve(__dirname, '../settings.html'), 'utf8');
  });

  beforeEach(async () => {
    document.body.innerHTML = originalHtml;
    
    // Mock Chrome Storage API
    global.chrome = {
      storage: {
        local: {
          get: jest.fn((defaults, cb) => {
            if (cb) cb({
              provider: 'anthropic',
              triggerMode: 'shortcut',
              apiKey: '',
              systemPrompt: '',
              enabled: true,
              debug: false
            });
            return Promise.resolve();
          }),
          set: jest.fn((data, cb) => {
            if (cb) cb();
            return Promise.resolve();
          })
        }
      }
    };
    
    // Mock timers for status toast
    jest.useFakeTimers();

    // Isolate settings.js execution using a cache-busting import
    await import('../settings.js?t=' + Date.now());
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('loads default settings from chrome.storage', () => {
    expect(chrome.storage.local.get).toHaveBeenCalled();
    expect(document.getElementById('provider').value).toBe('anthropic');
    expect(document.getElementById('apiKey').value).toBe('');
    expect(document.getElementById('apiKey').placeholder).toBe('sk-ant-api03-…');
  });

  it('updates placeholder when provider changes', () => {
    const providerEl = document.getElementById('provider');
    const apiKeyEl = document.getElementById('apiKey');

    providerEl.value = 'gemini';
    providerEl.dispatchEvent(new Event('change'));
    expect(apiKeyEl.placeholder).toBe('AIzaSy…');

    providerEl.value = 'deepseek';
    providerEl.dispatchEvent(new Event('change'));
    expect(apiKeyEl.placeholder).toBe('sk-…');
  });

  it('requires API key on save', () => {
    const saveBtn = document.getElementById('saveBtn');
    const statusEl = document.getElementById('status');

    saveBtn.click();
    expect(statusEl.textContent).toBe('API key is required.');
    expect(statusEl.className).toBe('status err');
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it('validates Anthropic key prefix', () => {
    document.getElementById('apiKey').value = 'invalid-key';
    document.getElementById('saveBtn').click();
    
    expect(document.getElementById('status').textContent).toBe('Key should start with sk-ant-');
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it('validates DeepSeek key prefix', () => {
    document.getElementById('provider').value = 'deepseek';
    document.getElementById('apiKey').value = 'invalid-key';
    document.getElementById('saveBtn').click();
    
    expect(document.getElementById('status').textContent).toBe('Key should start with sk-');
  });

  it('accepts valid save and shows success toast', () => {
    document.getElementById('provider').value = 'anthropic';
    document.getElementById('apiKey').value = 'sk-ant-12345';
    document.getElementById('systemPrompt').value = 'Be concise';
    document.getElementById('enabledToggle').checked = false;
    document.getElementById('triggerMode').value = 'auto';
    document.getElementById('debugToggle').checked = true;
    
    document.getElementById('saveBtn').click();

    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      provider: 'anthropic',
      triggerMode: 'auto',
      apiKey: 'sk-ant-12345',
      systemPrompt: 'Be concise',
      enabled: false,
      debug: true
    }, expect.any(Function));

    expect(document.getElementById('status').textContent).toBe('Saved ✓');
    
    jest.advanceTimersByTime(3000);
    expect(document.getElementById('status').textContent).toBe('');
  });
});
