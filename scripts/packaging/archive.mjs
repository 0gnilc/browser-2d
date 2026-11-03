import asar from '@electron/asar';

export function extractArchiveFile(archive, filename) {
  return asar.extractFile(archive, filename);
}
