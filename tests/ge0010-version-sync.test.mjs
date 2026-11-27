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

import { parseApksignerOutput } from '../scripts/verify-apk-artifact.mjs';

const cert = 'a'.repeat(64);
const pub = 'b'.repeat(64);
const header = 'Verifies\nVerified using v1 scheme (JAR signing): false\nVerified using v2 scheme (APK Signature Scheme v2): true\nNumber of signers: 1\n';
const newSigner = 'V2 Signer: certificate DN: CN=MinaDental, O=MinaDental, C=LU\nV2 Signer: certificate SHA-256 digest: ' + cert + '\nV2 Signer: public key SHA-256 digest: ' + pub + '\n';
test('GE-0013: parse real modern v2 signer format, not public key digest', () => {
  const p = parseApksignerOutput(header + newSigner);
  assert.equal(p.verified, true);
  assert.equal(p.signerCertSha256, cert);
  assert.equal(p.isDebugCertificate, false);
});
test('GE-0013: legacy signer format remains supported', () => {
  const p = parseApksignerOutput(header + newSigner.replaceAll('V2 Signer: ', 'Signer #1 '));
  assert.equal(p.signerCertSha256, cert);
});
test('GE-0013: reject missing or ambiguous certificates and multiple signers', () => {
  for (const output of [header + 'V2 Signer: public key SHA-256 digest: ' + pub, header + newSigner + newSigner.replace(cert, pub), (header + newSigner).replace('Number of signers: 1', 'Number of signers: 2'), (header + newSigner).replace('Number of signers: 1\n', '')]) {
    assert.equal(parseApksignerOutput(output).signerCertSha256, null);
  }
});
test('GE-0013: debug and unverified signatures remain distinguishable', () => {
  assert.equal(parseApksignerOutput(header + newSigner.replace('CN=MinaDental, O=MinaDental, C=LU', 'CN=Android Debug, O=Android, C=US')).isDebugCertificate, true);
  assert.equal(parseApksignerOutput(header.replace('Verifies', 'DOES NOT VERIFY') + newSigner).verified, false);
});

import { archiveTag } from '../scripts/archive-android-release.mjs';
test('GE-0014: stable archives have distinct immutable version tags', () => {
  const m = {versionName: '4.18.0', releaseSequence: 306, versionCode: 306, gitCommit: 'a'.repeat(40), sha256: 'b'.repeat(64), signingCertSha256: 'c'.repeat(64), signingMode: 'release_upload_keystore'};
  assert.equal(archiveTag(m), 'android-v4.18.0-306');
  assert.equal(archiveTag({...m, releaseSequence: 307, versionCode: 307}), 'android-v4.18.0-307');
  for (const bad of [{versionCode: 305}, {signingMode: 'qa_debug_preview_keystore'}, {releaseSequence: 0}, {sha256: 'bad'}, {gitCommit: 'main'}]) {
    assert.throws(() => archiveTag({...m, ...bad}), /Invalid stable release identity/);
  }
});
test('GE-0014: both pipelines archive before touching latest alias', () => {
  const root = new URL('../', import.meta.url);
  for (const name of ['deploy.yml', 'android-apk.yml']) {
    const s = fs.readFileSync(new URL('.github/workflows/' + name, root), 'utf8');
    assert.ok(s.indexOf('node scripts/archive-android-release.mjs') >= 0);
    assert.ok(s.indexOf('node scripts/archive-android-release.mjs') < s.indexOf('gh release upload "$RELEASE_TAG"'));
    assert.ok(s.includes('[Download APK / دانلود مستقیم]'));
  }
});
