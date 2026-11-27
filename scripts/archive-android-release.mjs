#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = 'galaxy1364/Dendalcare';
const FILES = ['MinaDental-android.apk', 'DentalCare.apk', 'MinaDental-android.apk.sha256', 'apk-release.json', 'apk-verification-report.json'];
const sha = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
export function archiveTag(meta) {
  if (!/^\d+\.\d+\.\d+$/.test(meta.versionName) || !Number.isSafeInteger(meta.releaseSequence) ||
      meta.releaseSequence < 1 || meta.versionCode !== meta.releaseSequence ||
      !/^[0-9a-f]{40}$/.test(meta.gitCommit) || !/^[0-9a-f]{64}$/.test(meta.sha256) ||
      !/^[0-9a-f]{64}$/.test(meta.signingCertSha256) ||
      meta.signingMode !== 'release_upload_keystore') throw new Error('Invalid stable release identity');
  return 'android-v' + meta.versionName + '-' + meta.releaseSequence;
}
function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024 });
}
function api(endpoint) {
  try { return JSON.parse(gh(['api', 'repos/' + REPO + '/' + endpoint])); }
  catch (e) {
    if (e.status && /HTTP 404\b/.test(String(e.stderr))) return null;
    throw e;
  }
}
function readJson(dir, name) { return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); }
export function validateArchiveFiles(dir) {
  const m = readJson(dir, 'apk-release.json');
  archiveTag(m);
  const p = readJson(dir, 'apk-verification-report.json');
  const binary = path.join(dir, FILES[0]);
  if (sha(binary) !== m.sha256 || fs.statSync(binary).size !== m.sizeBytes ||
      sha(path.join(dir, FILES[1])) !== m.sha256 ||
      fs.readFileSync(path.join(dir, FILES[2]), 'utf8').trim() !== m.sha256 + '  ' + FILES[0] ||
      p.ok !== true || p.metadataVerified !== true || p.isDebugSigned !== false ||
      p.sha256 !== m.sha256 || p.sizeBytes !== m.sizeBytes ||
      p.signature?.verified !== true || p.signature?.signerCertSha256 !== m.signingCertSha256 ||
      Number(p.structure?.embeddedWebVersion?.releaseSequence) !== m.releaseSequence ||
      p.structure?.embeddedWebVersion?.releaseId !== m.releaseId) throw new Error('Archive verification mismatch');
  return m;
}
function assertRemote(release, dir, names = FILES) {
  if (!release || release.draft || release.prerelease) throw new Error('Release is not public stable');
  for (const name of names) {
    const asset = release.assets.find(a => a.name === name);
    if (!asset || asset.state !== 'uploaded' ||
        asset.size !== fs.statSync(path.join(dir, name)).size ||
        asset.digest !== 'sha256:' + sha(path.join(dir, name))) throw new Error('Remote asset mismatch: ' + name);
  }
}
function checkTag(tag, commit) {
  const ref = api('git/ref/tags/' + tag);
  if (ref && (ref.object.type !== 'commit' || ref.object.sha !== commit)) throw new Error('Archive tag points to another commit: ' + tag);
}
function archive(dir) {
  const m = validateArchiveFiles(dir);
  const tag = archiveTag(m);
  checkTag(tag, m.gitCommit);
  const existing = api('releases/tags/' + tag);
  if (existing) {
    assertRemote(existing, dir, FILES.slice(0, 3));
    if (!existing.assets.some(a => a.name === 'apk-release.json' && a.state === 'uploaded') ||
        !existing.assets.some(a => a.name === 'apk-verification-report.json' && a.state === 'uploaded')) throw new Error('Archive metadata missing');
    console.log('Archive already exists: ' + tag);
    return;
  }
  const staged = fs.mkdtempSync(path.join(os.tmpdir(), 'mina-archive-'));
  try {
    for (const name of FILES) fs.copyFileSync(path.join(dir, name), path.join(staged, name));
    const url = 'https://github.com/' + REPO + '/releases/';
    const archived = {...m, downloadUrl: url + 'download/' + tag + '/' + FILES[0],
      compatDownloadUrl: url + 'download/' + tag + '/' + FILES[1], releasePageUrl: url + 'tag/' + tag};
    fs.writeFileSync(path.join(staged, 'apk-release.json'), JSON.stringify(archived, null, 2) + '\n');
    const title = 'MinaDental Android ' + m.versionName + ' — #' + m.releaseSequence;
    const notes = 'Official signed APK / نسخه رسمی اندروید\n\n[Download APK / دانلود مستقیم](' + archived.downloadUrl + ')\n\n' +
      'APK SHA-256: ' + m.sha256 + '\n\nSigning certificate SHA-256: ' + m.signingCertSha256 +
      '\n\nSource commit: ' + m.gitCommit + '\n\nCI: https://github.com/' + REPO + '/actions/runs/' + m.ciRunId +
      '\n\nDo not uninstall older installations without a verified backup.';
    gh(['release', 'create', tag, ...FILES.map(n => path.join(staged, n)), '--repo', REPO,
      '--target', m.gitCommit, '--title', title, '--notes', notes, '--latest=false']);
    assertRemote(api('releases/tags/' + tag), staged);
    checkTag(tag, m.gitCommit);
    console.log('Published versioned archive: ' + tag);
  } finally { fs.rmSync(staged, { recursive: true, force: true }); }
}
function main() {
  const dir = path.resolve('release-apk');
  const current = validateArchiveFiles(dir);
  const previous = api('releases/tags/android-latest');
  if (previous) {
    const old = fs.mkdtempSync(path.join(os.tmpdir(), 'mina-previous-'));
    try {
      gh(['release', 'download', 'android-latest', '--repo', REPO, '--dir', old, ...FILES.flatMap(n => ['--pattern', n])]);
      assertRemote(previous, old);
      const prior = validateArchiveFiles(old);
      if (prior.releaseSequence > current.releaseSequence ||
          (prior.releaseSequence === current.releaseSequence && prior.sha256 !== current.sha256) ||
          prior.signingCertSha256 !== current.signingCertSha256) throw new Error('Refusing sequence regression, conflict or signing key change');
      archive(old);
    } finally { fs.rmSync(old, {recursive: true, force: true}); }
  }
  archive(dir);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
