import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { jest } from '@jest/globals';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('settings.js', () => {
  let originalHtml;
  let store;

  beforeAll(() => {
    originalHtml = fs.readFileSync(path.resolve(__dirname, '../../settings.html'), 'utf8');
  });

  beforeEach(async () => {
    const parsed = new DOMParser().parseFromString(originalHtml, 'text/html');
    document.head.innerHTML = parsed.head.innerHTML;
    document.body.innerHTML = parsed.body.innerHTML;
    store = {
      provider: 'anthropic',
      triggerMode: 'shortcut',
      apiKey: '',
      systemPrompt1: '',
      systemPrompt2: '',
      systemPrompt3: '',
      enabled: true,
      debug: false,
      garDebugLog: []
    };

    global.URL.createObjectURL = jest.fn(() => 'blob:debug-log');
    global.URL.revokeObjectURL = jest.fn();
    HTMLAnchorElement.prototype.click = jest.fn();
    global.chrome = {
      runtime: { lastError: null, sendMessage: jest.fn() },
      storage: {
        local: {
          get: jest.fn((defaults, cb) => cb({ ...defaults, ...store })),
          set: jest.fn((data, cb) => {
            store = { ...store, ...data };
            if (cb) cb();
          })
        }
      }
    };

    jest.useFakeTimers();
    const source = fs.readFileSync(path.resolve(__dirname, '../../settings.js'), 'utf8');
    new Function(source)();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('loads default settings from chrome.storage', () => {
    expect(chrome.storage.local.get).toHaveBeenCalled();
    expect(document.getElementById('provider').value).toBe('anthropic');
    expect(document.getElementById('apiKey').value).toBe('');
    expect(document.getElementById('systemPrompt1').value).toBe('');
  });

  it('updates placeholder when provider changes', () => {
    const providerEl = document.getElementById('provider');
    const apiKeyEl = document.getElementById('apiKey');

    providerEl.value = 'gemini';
    providerEl.dispatchEvent(new window.Event('change'));
    expect(apiKeyEl.placeholder).toContain('AIzaSy');

    providerEl.value = 'deepseek';
    providerEl.dispatchEvent(new window.Event('change'));
    expect(apiKeyEl.placeholder).toContain('sk-');
  });

  it('requires API key on save', () => {
    document.getElementById('saveBtn').click();

    expect(document.getElementById('status').textContent).toBe('API key is required.');
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it('saves all prompt slots and debug setting', () => {
    document.getElementById('apiKey').value = 'sk-ant-12345';
    document.getElementById('systemPrompt1').value = 'Formal';
    document.getElementById('systemPrompt2').value = 'Concise';
    document.getElementById('systemPrompt3').value = 'Friendly';
    document.getElementById('triggerMode').value = 'auto';
    document.getElementById('debugToggle').checked = true;

    document.getElementById('saveBtn').click();

    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      provider: 'anthropic',
      triggerMode: 'auto',
      apiKey: 'sk-ant-12345',
      systemPrompt1: 'Formal',
      systemPrompt2: 'Concise',
      systemPrompt3: 'Friendly',
      enabled: true,
      debug: true
    }, expect.any(Function));
  });

  it('exports the debug log as JSON', () => {
    store.garDebugLog = [{ ts: '2026-07-09T00:00:00.000Z', source: 'content', event: 'x' }];

    document.getElementById('exportLogBtn').click();

    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
    expect(document.getElementById('status').textContent).toBe('Exported 1 log entries.');
  });

  it('clears the debug log', () => {
    store.garDebugLog = [{ event: 'x' }];

    document.getElementById('clearLogBtn').click();

    expect(store.garDebugLog).toEqual([]);
    expect(document.getElementById('status').textContent).toBe('Debug log cleared.');
  });
});
