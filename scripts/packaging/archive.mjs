import asar from '@electron/asar';
import { normalize } from 'node:path';

export function extractArchiveFile(archive, filename) {
  return asar.extractFile(archive, normalize(filename));
}
