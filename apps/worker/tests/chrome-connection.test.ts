import { describe, expect, it } from 'vitest';
import { chromeSettingsSchema } from '@browser-2d/contracts/public';
import { loopbackUrl } from '../src/browser/connection';

describe('Chrome connection validation', () => {
  it('permits execution of the explicit local port 80 address accepted by settings', () => {
    const browser = chromeSettingsSchema.parse({
      mode: 'connect',
      endpoint: 'http://127.0.0.1:80',
    });
    if (browser.mode !== 'connect') throw new Error('Wrong mode');
    expect(() => loopbackUrl(browser.endpoint, 'http:')).not.toThrow();
  });
});
