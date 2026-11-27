import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { syncVersionAcrossPlatforms } from '../scripts/sync-version.mjs';

function fixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mina-ge0010-'));
  try {
    fs.mkdirSync(path.join(root, 'app'));
    fs.mkdirSync(path.join(root, 'public'));
    fs.writeFileSync(path.join(root, 'package.json'), '{"version":"4.18.0"}');
    fs.writeFileSync(path.join(root, 'app/build.gradle.kts'), 'val baseVersionCode = 230\nversionCode = 230\nversionName = "4.18.0"\n// signingConfigs unchanged\n');
    fs.writeFileSync(path.join(root, 'public/version.json'), '{"version":"4.18.0","build":230,"releaseSequence":230}');
    fn(root);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

for (const sequence of [302, 9000]) {
  test('GE-0010: allocated sequence ' + sequence + ' syncs before strict build and is idempotent', () => fixture(root => {
    const options = {repoRoot: root, sequenceOverride: sequence};
    assert.throws(() => syncVersionAcrossPlatforms({...options, checkOnly: true}), /Version drift/);
    syncVersionAcrossPlatforms(options);
    assert.equal(syncVersionAcrossPlatforms({...options, checkOnly: true}).sequence, sequence);
    assert.deepEqual(syncVersionAcrossPlatforms(options).updatedFiles, []);
    const gradle = fs.readFileSync(path.join(root, 'app/build.gradle.kts'), 'utf8');
    assert.ok(gradle.includes('val baseVersionCode = ' + sequence));
    assert.ok(gradle.includes('versionCode = ' + sequence));
    assert.ok(gradle.includes('// signingConfigs unchanged'));
    const meta = JSON.parse(fs.readFileSync(path.join(root, 'public/version.json'), 'utf8'));
    assert.equal(meta.releaseSequence, sequence);
    assert.equal(meta.build, sequence);
    assert.throws(() => syncVersionAcrossPlatforms({repoRoot: root, sequenceOverride: 230}), /regress baseline/);
  }));
}

// Both Android CI entry points must match the repository's pinned Gradle distribution.
test('GE-0012: Android CI Gradle version matches the wrapper distribution', () => {
  const root = new URL('../', import.meta.url);
  const wrapper = fs.readFileSync(new URL('gradle/wrapper/gradle-wrapper.properties', root), 'utf8');
  const version = wrapper.match(/gradle-([0-9.]+)-bin\.zip/)?.[1];
  assert.ok(version, 'wrapper distribution must specify an exact Gradle version');
  for (const name of ['deploy.yml', 'android-apk.yml']) {
    const workflow = fs.readFileSync(new URL('.github/workflows/' + name, root), 'utf8');
    assert.equal(workflow.match(/gradle-version:\s*['"]([0-9.]+)['"]/)?.[1], version, name);
  }
});
