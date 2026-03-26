import { jest } from '@jest/globals';

// Mock providers.js module before importing background.js
jest.unstable_mockModule('../providers.js', () => ({
  PROVIDERS: {
    anthropic: {
      endpoint: 'mock-endpoint',
      buildHeaders: jest.fn(() => ({ 'mock-header': 'yes' })),
      buildBody: jest.fn(() => ({ mock: 'body' })),
      extractText: jest.fn()
    }
  }
}));

// We need to use dynamic imports for the mocks to take effect in ESM
const { PROVIDERS } = await import('../providers.js');

// Mock chrome API
global.chrome = {
  runtime: {
    onMessage: { addListener: jest.fn() }
  },
  commands: {
    onCommand: { addListener: jest.fn() }
  },
  tabs: {
    query: jest.fn(),
    sendMessage: jest.fn()
  }
};

// Mock fetch
global.fetch = jest.fn();

// Load background script side-effects
await import('../background.js');

// Extract the message listener that background.js registered
const messageListener = global.chrome.runtime.onMessage.addListener.mock.calls[0][0];

describe('background.js', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('refineEmail delegates to correct provider and handles success', async () => {
    PROVIDERS.anthropic.extractText.mockReturnValue({ subject: 'Sub', body: 'Refined text', signature: 'Best' });
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ mockResponse: true })
    });

    const sendResponse = jest.fn();
    
    // Simulate background script receiving a message
    messageListener(
      { type: 'REFINE_EMAIL', draft: 'draft', systemPrompt: 'sys', apiKey: 'key', provider: 'anthropic' },
      {},
      sendResponse
    );

    // Wait for async operations
    await new Promise(process.nextTick);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toBe('mock-endpoint');
    expect(PROVIDERS.anthropic.buildHeaders).toHaveBeenCalledWith('key');
    expect(PROVIDERS.anthropic.buildBody).toHaveBeenCalledWith('draft', 'sys');
    expect(sendResponse).toHaveBeenCalledWith({ 
      success: true, 
      refined: { subject: 'Sub', body: 'Refined text', signature: 'Best' } 
    });
  });

  it('handles API errors gracefully', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: { message: 'Invalid API key' } })
    });

    const sendResponse = jest.fn();
    
    messageListener(
      { type: 'REFINE_EMAIL', draft: 'draft', systemPrompt: 'sys', apiKey: 'key', provider: 'anthropic' },
      {},
      sendResponse
    );

    await new Promise(process.nextTick);

    expect(sendResponse).toHaveBeenCalledWith({ success: false, error: 'Invalid API key' });
  });

  it('handles unknown providers gracefully', async () => {
    const sendResponse = jest.fn();
    
    messageListener(
      { type: 'REFINE_EMAIL', draft: 'draft', systemPrompt: 'sys', apiKey: 'key', provider: 'unknown' },
      {},
      sendResponse
    );

    await new Promise(process.nextTick);

    expect(sendResponse).toHaveBeenCalledWith({ success: false, error: 'Unknown provider: unknown' });
  });
});
