import { describe, expect, it } from 'vitest';
import { chromeSettingsSchema } from '@browser-2d/contracts/public';
import { abortable, loopbackUrl } from '../src/browser/connection';

describe('Chrome connection validation', () => {
  it('observes a rejected command when cancellation has already happened', async () => {
    const signal = AbortSignal.abort(new Error('Cancelled'));
    await expect(abortable(Promise.reject(new Error('Late command failure')), signal)).rejects.toBe(
      signal.reason,
    );
  });

  it('permits execution of the explicit local port 80 address accepted by settings', () => {
    const browser = chromeSettingsSchema.parse({
      mode: 'connect',
      endpoint: 'http://127.0.0.1:80',
    });
    if (browser.mode !== 'connect') throw new Error('Wrong mode');
    expect(() => loopbackUrl(browser.endpoint, 'http:')).not.toThrow();
  });
});
