import { PROVIDERS, extractJson } from '../providers.js';

describe('providers.js registry', () => {
  describe('extractJson', () => {
    it('extracts structured keys from JSON', () => {
      const input = '{"subject": "Hi", "refined_email": "Body text", "signature": "Best"}';
      const result = extractJson(input);
      expect(result.subject).toBe('Hi');
      expect(result.body).toBe('Body text');
      expect(result.signature).toBe('Best');
    });

    it('strips markdown json wrappers', () => {
      const input = '```json\n{"subject": "", "refined_email": "Hello World", "signature": ""}\n```';
      expect(extractJson(input).body).toBe('Hello World');
    });

    it('falls back to raw text in body if json is invalid', () => {
      const input = 'Here is the refined version:\n\nHello World';
      const result = extractJson(input);
      expect(result.body).toBe('Hello World');
      expect(result.subject).toBe('');
    });
  });

  describe('Anthropic Provider', () => {
    const provider = PROVIDERS.anthropic;

    it('builds headers correctly', () => {
      const headers = provider.buildHeaders('sk-ant-123');
      expect(headers['x-api-key']).toBe('sk-ant-123');
      expect(headers['anthropic-version']).toBe('2023-06-01');
    });

    it('builds body with forced JSON start', () => {
      const body = provider.buildBody('draft text', 'prompt');
      expect(body.model).toBe('claude-3-7-sonnet-latest');
      expect(body.system).toContain('prompt');
      expect(body.system).toContain('RULES:');
      const lastMessage = body.messages[body.messages.length - 1];
      expect(lastMessage.role).toBe('assistant');
      expect(lastMessage.content).toBe('{');
    });

    it('extracts text by prepending {', () => {
      const responseData = {
        content: [{ text: '"subject": "Sub", "refined_email": "Cleaned text", "signature": "Bye"}' }]
      };
      const result = provider.extractText(responseData);
      expect(result.body).toBe('Cleaned text');
      expect(result.subject).toBe('Sub');
    });
  });

  describe('Gemini Provider', () => {
    const provider = PROVIDERS.gemini;

    it('builds endpoint with key', () => {
      const url = provider.buildEndpoint(provider.endpoint, 'AIza123');
      expect(url).toContain('?key=AIza123');
    });

    it('builds body with system prompt and JSON config', () => {
      const body = provider.buildBody('draft', 'prompt');
      const promptText = body.system_instruction.parts[0].text;
      expect(promptText).toContain('prompt');
      expect(promptText).toContain('RULES:');
      expect(body.generationConfig.response_mime_type).toBe('application/json');
    });

    it('extracts text from candidates', () => {
      const responseData = {
        candidates: [{
          content: { parts: [{ text: '{"subject": "", "refined_email": "Text", "signature": ""}' }] }
        }]
      };
      expect(provider.extractText(responseData).body).toBe('Text');
    });
  });

  describe('DeepSeek Provider', () => {
    const provider = PROVIDERS.deepseek;

    it('builds headers with Bearer token', () => {
      const headers = provider.buildHeaders('sk-123');
      expect(headers['Authorization']).toBe('Bearer sk-123');
    });

    it('builds body with response_format json_object', () => {
      const body = provider.buildBody('draft', 'prompt');
      expect(body.response_format.type).toBe('json_object');
      expect(body.model).toBe('deepseek-chat');
      const sysMsg = body.messages.find(m => m.role === 'system').content;
      expect(sysMsg).toContain('prompt');
      expect(sysMsg).toContain('RULES:');
    });

    it('extracts text from choices', () => {
      const responseData = {
        choices: [{
          message: { content: '{"subject": "S", "refined_email": "Deep text", "signature": "G"}' }
        }]
      };
      const result = provider.extractText(responseData);
      expect(result.body).toBe('Deep text');
      expect(result.subject).toBe('S');
    });
  });
});
