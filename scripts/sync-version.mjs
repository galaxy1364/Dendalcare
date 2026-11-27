#!/usr/bin/env node
/**
 * MinaDental Cross-Platform Version Synchronizer (Web package.json -> Android app/build.gradle.kts & public/version.json)
 *
 * Guarantees zero version drift between Web (package.json, public/version.json, vite.config.ts)
 * and Android (app/build.gradle.kts) BEFORE every local or CI build.
 *
 * Usage:
 *   node scripts/sync-version.mjs                         # Sync package.json version -> app/build.gradle.kts & public/version.json
 *   node scripts/sync-version.mjs --check                 # Fail-closed drift check without modifying files
 *   node scripts/sync-version.mjs --sequence 168          # Also sync baseline sequence/versionCode (>= 167)
 *   node scripts/sync-version.mjs --json                  # Emit structured JSON summary
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_ROOT = path.resolve(__dirname, '..');

export const MIN_MONOTONIC_SEQUENCE = 224;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function readPlatformVersions(repoRoot = DEFAULT_ROOT) {
  const pkgPath = path.join(repoRoot, 'package.json');
  const gradlePath = path.join(repoRoot, 'app', 'build.gradle.kts');
  const publicVersionPath = path.join(repoRoot, 'public', 'version.json');

  if (!fs.existsSync(pkgPath)) {
    throw new Error(`Missing package.json at ${pkgPath}`);
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const packageVersion = String(pkg.version || '').trim();
  if (!SEMVER_RE.test(packageVersion)) {
    throw new Error(`Invalid SemVer in package.json: "${packageVersion}"`);
  }

  let gradleVersionName = null;
  let gradleVersionCode = null;
  if (fs.existsSync(gradlePath)) {
    const gradleRaw = fs.readFileSync(gradlePath, 'utf8');
    gradleVersionName = gradleRaw.match(/versionName\s*=\s*"([^"]+)"/)?.[1] || null;
    const codeMatch = gradleRaw.match(/versionCode\s*=\s*(\d+)/);
    gradleVersionCode = codeMatch ? Number(codeMatch[1]) : null;
  }

  let publicVersion = null;
  let publicSequence = null;
  if (fs.existsSync(publicVersionPath)) {
    const pub = JSON.parse(fs.readFileSync(publicVersionPath, 'utf8'));
    publicVersion = typeof pub.version === 'string' ? pub.version : null;
    const seq = Number(pub.releaseSequence || pub.build || 0);
    publicSequence = Number.isInteger(seq) && seq > 0 ? seq : null;
  }

  return {
    packageVersion,
    gradleVersionName,
    gradleVersionCode,
    publicVersion,
    publicSequence,
  };
}

export function syncVersionAcrossPlatforms(options = {}) {
  const {
    repoRoot = DEFAULT_ROOT,
    checkOnly = false,
    sequenceOverride = null,
  } = options;

  const current = readPlatformVersions(repoRoot);
  const gradlePath = path.join(repoRoot, 'app', 'build.gradle.kts');
  const publicVersionPath = path.join(repoRoot, 'public', 'version.json');

  const envSeqRaw = (process.env.MINA_RELEASE_SEQUENCE || '').trim();
  if (envSeqRaw && !/^\d+$/.test(envSeqRaw)) {
    throw new Error('MINA_RELEASE_SEQUENCE must be a positive integer');
  }
  const parsedRequestedSeq =
    sequenceOverride !== null && sequenceOverride !== undefined
      ? Number(sequenceOverride)
      : envSeqRaw && /^\d+$/.test(envSeqRaw)
      ? Number(envSeqRaw)
      : null;

  if (parsedRequestedSeq !== null && (!Number.isSafeInteger(parsedRequestedSeq) || parsedRequestedSeq < MIN_MONOTONIC_SEQUENCE)) {
    throw new Error(
      `Requested release sequence (${parsedRequestedSeq}) must be an integer >= ${MIN_MONOTONIC_SEQUENCE}`
    );
  }

  const targetVersion = current.packageVersion;
  const baselineSequence = Math.max(
    MIN_MONOTONIC_SEQUENCE,
    current.gradleVersionCode || 0,
    current.publicSequence || 0
  );
  if (parsedRequestedSeq !== null && parsedRequestedSeq < baselineSequence) {
    throw new Error(`Requested release sequence #${parsedRequestedSeq} would regress baseline #${baselineSequence}`);
  }
  const targetSequence = parsedRequestedSeq ?? baselineSequence;

  const drifts = [];
  const updatedFiles = [];

  // 1. Check / Sync app/build.gradle.kts (ONLY defaultConfig versionName & base versionCode; NEVER touch signingConfigs/buildTypes!)
  if (fs.existsSync(gradlePath)) {
    const originalGradle = fs.readFileSync(gradlePath, 'utf8');
    let nextGradle = originalGradle;

    if (current.gradleVersionName !== targetVersion) {
      drifts.push(`app/build.gradle.kts versionName (${current.gradleVersionName}) != package.json (${targetVersion})`);
      nextGradle = nextGradle.replace(
        /(versionName\s*=\s*)"[^"]*"/,
        `$1"${targetVersion}"`
      );
    }

    if (current.gradleVersionCode !== null && current.gradleVersionCode < MIN_MONOTONIC_SEQUENCE) {
      drifts.push(`app/build.gradle.kts versionCode (${current.gradleVersionCode}) < minimum (${MIN_MONOTONIC_SEQUENCE})`);
    }

    if (current.gradleVersionCode !== targetSequence) {
      drifts.push(`app/build.gradle.kts versionCode (${current.gradleVersionCode}) != target sequence (${targetSequence})`);
      nextGradle = nextGradle
        .replace(/(val\s+baseVersionCode\s*=\s*)\d+/, (_, prefix) => `${prefix}${targetSequence}`)
        .replace(/(versionCode\s*=\s*)\d+/, (_, prefix) => `${prefix}${targetSequence}`);
    }

    if (!checkOnly && nextGradle !== originalGradle) {
      fs.writeFileSync(gradlePath, nextGradle, 'utf8');
      updatedFiles.push('app/build.gradle.kts');
    }
  }

  // 2. Check / Sync public/version.json
  if (fs.existsSync(publicVersionPath)) {
    const originalRaw = fs.readFileSync(publicVersionPath, 'utf8');
    const pub = JSON.parse(originalRaw);
    let dirty = false;

    if (pub.version !== targetVersion) {
      drifts.push(`public/version.json version (${pub.version}) != package.json (${targetVersion})`);
      pub.version = targetVersion;
      dirty = true;
    }
    if (pub.semver !== undefined && pub.semver !== targetVersion) {
      drifts.push(`public/version.json semver (${pub.semver}) != package.json (${targetVersion})`);
      pub.semver = targetVersion;
      dirty = true;
    }
    if (pub.androidVersionName !== undefined && pub.androidVersionName !== targetVersion) {
      drifts.push(`public/version.json androidVersionName (${pub.androidVersionName}) != package.json (${targetVersion})`);
      pub.androidVersionName = targetVersion;
      dirty = true;
    }
    const pubSeq = Number(pub.releaseSequence || pub.build || pub.androidVersionCode || 0);
    if (pubSeq < MIN_MONOTONIC_SEQUENCE) {
      drifts.push(`public/version.json releaseSequence (${pubSeq}) < minimum (${MIN_MONOTONIC_SEQUENCE})`);
      pub.releaseSequence = targetSequence;
      pub.build = targetSequence;
      if (pub.androidVersionCode !== undefined) pub.androidVersionCode = targetSequence;
      dirty = true;
    } else if (pubSeq !== targetSequence || pub.releaseSequence !== targetSequence || pub.build !== targetSequence || (pub.androidVersionCode !== undefined && pub.androidVersionCode !== targetSequence)) {
      drifts.push(`public/version.json releaseSequence (${pubSeq}) != target sequence (${targetSequence})`);
      pub.releaseSequence = targetSequence;
      pub.build = targetSequence;
      if (pub.androidVersionCode !== undefined) pub.androidVersionCode = targetSequence;
      dirty = true;
    }

    if (!checkOnly && dirty) {
      fs.writeFileSync(publicVersionPath, JSON.stringify(pub, null, 2) + '\n', 'utf8');
      updatedFiles.push('public/version.json');
    }
  }

  if (checkOnly && drifts.length > 0) {
    throw new Error(`Version drift detected:\n - ${drifts.join('\n - ')}\nRun "npm run sync:version" to synchronize.`);
  }

  return {
    ok: true,
    mode: checkOnly ? 'check' : 'sync',
    version: targetVersion,
    sequence: targetSequence,
    drifts,
    updatedFiles,
  };
}

function parseCliArgs(argv) {
  const args = { checkOnly: false, sequenceOverride: null, json: false, repoRoot: DEFAULT_ROOT };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--check') {
      args.checkOnly = true;
    } else if (token === '--sequence' && argv[i + 1]) {
      args.sequenceOverride = Number(argv[++i]);
    } else if (token === '--root' && argv[i + 1]) {
      args.repoRoot = path.resolve(argv[++i]);
    } else if (token === '--json') {
      args.json = true;
    }
  }
  return args;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const cli = parseCliArgs(process.argv.slice(2));
  try {
    const result = syncVersionAcrossPlatforms(cli);
    if (cli.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      const action = result.mode === 'check'
        ? 'CHECK PASS'
        : result.updatedFiles.length > 0
        ? `SYNCED (${result.updatedFiles.join(', ')})`
        : 'ALREADY IN SYNC';
      console.log(`[sync-version] ${action} | version=${result.version} | sequence=#${result.sequence}`);
    }
  } catch (err) {
    console.error(`[sync-version] FAIL: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
