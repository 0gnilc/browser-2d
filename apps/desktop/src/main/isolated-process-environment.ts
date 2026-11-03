import { isAbsolute } from 'node:path';

export function isolatedProcessEnvironment(
  role: 'browser-worker' | 'test-browser-platform' | 'verification',
): Record<string, string> {
  const environment: Record<string, string> = { BROWSER2D_ROLE: role };
  if (process.platform === 'win32') {
    const systemRoot = process.env.SystemRoot;
    if (!systemRoot || !isAbsolute(systemRoot))
      throw new Error('Windows isolated processes require an absolute SystemRoot');
    environment.SystemRoot = systemRoot;
  }
  return environment;
}
