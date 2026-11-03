import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseDocument, stringify } from 'yaml';

export async function finalizeMacInstaller(directory, environment) {
  const dmgs = (await readdir(directory)).filter((name) => name.endsWith('.dmg'));
  assert.equal(dmgs.length, 1, 'Production expects one final DMG');
  const dmg = join(directory, dmgs[0]);
  const submitted = spawnSync(
    'xcrun',
    [
      'notarytool',
      'submit',
      dmg,
      '--apple-id',
      environment.APPLE_ID,
      '--password',
      environment.APPLE_APP_SPECIFIC_PASSWORD,
      '--team-id',
      environment.APPLE_TEAM_ID,
      '--wait',
      '--output-format',
      'json',
    ],
    { encoding: 'utf8' },
  );
  assert(!submitted.error && submitted.status === 0, 'DMG notarization submission failed');
  const result = JSON.parse(submitted.stdout);
  assert.equal(result.status, 'Accepted', 'Apple did not accept the DMG notarization');
  const staple = spawnSync('xcrun', ['stapler', 'staple', dmg], { encoding: 'utf8' });
  assert(!staple.error && staple.status === 0, 'DMG notarization stapling failed');
  await writeFile(
    join(directory, 'notarization.json'),
    JSON.stringify(
      { schemaVersion: 1, artifact: dmgs[0], submissionId: result.id, status: result.status },
      null,
      2,
    ),
  );
  await finalizeMacUpdateMetadata(directory, dmgs[0]);
}

export async function finalizeMacUpdateMetadata(directory, dmgName) {
  await rm(join(directory, `${dmgName}.blockmap`), { force: true });
  const metadataPath = join(directory, 'latest-mac.yml');
  const document = parseDocument(await readFile(metadataPath, 'utf8'), { uniqueKeys: true });
  assert.equal(document.errors.length, 0, 'Invalid macOS metadata before finalization');
  const metadata = document.toJS({ maxAliasCount: 0 });
  metadata.files = metadata.files.filter((file) => !file.url.endsWith('.dmg'));
  const zip = metadata.files.find((file) => file.url.endsWith('.zip'));
  assert(zip, 'macOS updates require a ZIP payload');
  metadata.path = zip.url;
  metadata.sha512 = zip.sha512;
  await writeFile(metadataPath, stringify(metadata));
}
