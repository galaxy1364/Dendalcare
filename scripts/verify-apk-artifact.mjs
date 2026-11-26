#!/usr/bin/env node
/**
 * MinaDental Automated Android APK Signature, Structure & Version-Parity Verifier
 *
 * Fail-closed verification script used both locally (`npm run verify:apk -- --apk <path>`)
 * and in `.github/workflows/android-apk.yml` BEFORE publishing any APK to GitHub Releases.
 *
 * Checks performed:
 * 1. Binary presence, minimum valid APK size (>= 100 KB), exact PK\x03\x04 ZIP magic bytes,
 *    and explicit rejection of HTML/JSON/plain-text error payloads.
 * 2. Full ZIP archive integrity (`unzip -t`) + required Android APK core structure
 *    (`AndroidManifest.xml`, `classes*.dex`, `resources.arsc`).
 * 3. Embedded MinaDental WebView bundle integrity (`assets/www/index.html`,
 *    `assets/www/version.json`, `assets/www/manifest.json`, `assets/www/release-manifest.json`)
 *    with strict HTML sanity (compiled module entry, no raw TSX or unstamped placeholders).
 * 4. Cross-platform Web <-> Android version parity against `package.json` & `app/build.gradle.kts`.
 * 5. Cryptographic APK signature verification via Android SDK `apksigner verify --verbose --print-certs`
 *    (verifying v1/v2/v3/v3.1 scheme + extracting signer certificate SHA-256).
 * 6. Optional `--metadata apk-release.json` cross-verification of `sha256`, `sizeBytes`,
 *    `signingCertSha256`, `versionName`, `versionCode`, `applicationId`, and HTTPS `downloadUrl`.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_ROOT = path.resolve(__dirname, '..');

export const MIN_VALID_APK_BYTES = 100 * 1024;
export const EXPECTED_APPLICATION_ID = 'com.aistudio.auditpro.kxmfzq';

export function hasApkZipMagicBytes(buffer) {
  if (!buffer || buffer.length < 4) return false;
  return buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
}

export function looksLikeHtmlOrJsonPayload(buffer) {
  if (!buffer || buffer.length === 0) return false;
  const head = buffer.subarray(0, 64).toString('utf8').trimStart().toLowerCase();
  return (
    head.startsWith('<!doctype') ||
    head.startsWith('<html') ||
    head.startsWith('<?xml') ||
    head.startsWith('{') ||
    head.startsWith('[')
  );
}

export function computeFileSha256(filePath) {
  const hash = crypto.createHash('sha256');
  const data = fs.readFileSync(filePath);
  hash.update(data);
  return { sha256: hash.digest('hex'), sizeBytes: data.byteLength, head: data.subarray(0, 64) };
}

export function readRepoVersionBaseline(repoRoot = DEFAULT_ROOT) {
  const pkgPath = path.join(repoRoot, 'package.json');
  const gradlePath = path.join(repoRoot, 'app', 'build.gradle.kts');
  const pkg = fs.existsSync(pkgPath) ? JSON.parse(fs.readFileSync(pkgPath, 'utf8')) : null;
  const gradleRaw = fs.existsSync(gradlePath) ? fs.readFileSync(gradlePath, 'utf8') : '';

  const gradleVersionCode = Number(gradleRaw.match(/versionCode\s*=\s*(\d+)/)?.[1] || 0);
  const gradleVersionName = gradleRaw.match(/versionName\s*=\s*"([^"]+)"/)?.[1] || null;
  const gradleAppId = gradleRaw.match(/applicationId\s*=\s*"([^"]+)"/)?.[1] || null;

  return {
    packageVersion: pkg?.version ? String(pkg.version) : null,
    gradleVersionCode: Number.isInteger(gradleVersionCode) && gradleVersionCode > 0 ? gradleVersionCode : null,
    gradleVersionName,
    gradleAppId,
  };
}

export function findApksignerBinary() {
  const envRoots = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT].filter(Boolean);
  for (const sdkRoot of envRoots) {
    const buildToolsDir = path.join(sdkRoot, 'build-tools');
    if (!fs.existsSync(buildToolsDir)) continue;
    const versions = fs
      .readdirSync(buildToolsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    for (let i = versions.length - 1; i >= 0; i -= 1) {
      const candidate = path.join(buildToolsDir, versions[i], 'apksigner');
      if (fs.existsSync(candidate)) return candidate;
    }
  }

  try {
    const whichOut = execFileSync('which', ['apksigner'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (whichOut && fs.existsSync(whichOut)) return whichOut;
  } catch {
    // not on PATH
  }
  return null;
}

export function parseApksignerOutput(outputText) {
  const schemes = {};
  const schemeRegex = /Verified using (v\d+(?:\.\d+)?) scheme \([^)]+\):\s*(true|false)/gi;
  let m;
  while ((m = schemeRegex.exec(outputText)) !== null) {
    schemes[m[1].toLowerCase()] = m[2].toLowerCase() === 'true';
  }
  const sha256Match = outputText.match(/Signer #1 certificate SHA-256 digest:\s*([0-9a-fA-F]{64})/i);
  const dnMatch = outputText.match(/Signer #1 certificate DN:\s*(.+)/i);
  return {
    verified: outputText.includes('Verifies') && Object.values(schemes).some(Boolean),
    schemes,
    signerCertSha256: sha256Match ? sha256Match[1].toLowerCase() : null,
    signerDn: dnMatch ? dnMatch[1].trim() : null,
  };
}

export function verifyApkSignatureWithApksigner(apkPath, options = {}) {
  const apksigner = options.apksignerPath || findApksignerBinary();
  if (!apksigner) {
    if (options.requireApksigner) {
      throw new Error('apksigner binary not found in ANDROID_HOME/ANDROID_SDK_ROOT/build-tools or PATH');
    }
    return {
      skipped: true,
      verified: false,
      apksignerPath: null,
      schemes: {},
      signerCertSha256: null,
      signerDn: null,
    };
  }

  let output = '';
  try {
    output = execFileSync(apksigner, ['verify', '--verbose', '--print-certs', apkPath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    const stderr = err && err.stderr ? String(err.stderr) : '';
    const stdout = err && err.stdout ? String(err.stdout) : '';
    throw new Error(`apksigner verification failed for ${apkPath}: ${(stderr || stdout || err.message).trim()}`);
  }

  const parsed = parseApksignerOutput(output);
  if (!parsed.verified) {
    throw new Error(`apksigner did not confirm a valid v1/v2/v3 APK signature scheme:\n${output}`);
  }
  if (!parsed.signerCertSha256 || !/^[0-9a-f]{64}$/.test(parsed.signerCertSha256)) {
    throw new Error(`apksigner succeeded but signer SHA-256 digest was not found:\n${output}`);
  }

  return {
    skipped: false,
    apksignerPath: apksigner,
    ...parsed,
  };
}

export function inspectApkZipStructure(apkPath, options = {}) {
  const requireWebBundle = options.requireWebBundle !== false;
  try {
    execFileSync('unzip', ['-t', apkPath], { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    const stderr = err && err.stderr ? String(err.stderr) : err.message;
    throw new Error(`ZIP integrity test (unzip -t) failed: ${String(stderr).trim()}`);
  }

  const listRaw = execFileSync('unzip', ['-Z1', apkPath], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  const entries = listRaw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const entrySet = new Set(entries);

  const missingCore = [];
  if (!entrySet.has('AndroidManifest.xml')) missingCore.push('AndroidManifest.xml');
  if (!entrySet.has('resources.arsc')) missingCore.push('resources.arsc');
  const dexEntries = entries.filter((e) => /^classes\d*\.dex$/.test(e));
  if (dexEntries.length === 0) missingCore.push('classes.dex');
  if (missingCore.length > 0) {
    throw new Error(`APK is missing core Android entries: ${missingCore.join(', ')}`);
  }

  const metaInfSigEntries = entries.filter((e) => /^META-INF\/.+\.(SF|RSA|DSA|EC)$/i.test(e));

  let embeddedWebVersion = null;
  let embeddedIndexHtmlOk = false;
  if (requireWebBundle) {
    const requiredWebEntries = [
      'assets/www/index.html',
      'assets/www/version.json',
      'assets/www/manifest.json',
      'assets/www/release-manifest.json',
    ];
    const missingWeb = requiredWebEntries.filter((rel) => !entrySet.has(rel));
    if (missingWeb.length > 0) {
      throw new Error(`APK is missing bundled WebView assets: ${missingWeb.join(', ')}`);
    }

    const indexHtml = execFileSync('unzip', ['-p', apkPath, 'assets/www/index.html'], {
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
    });
    if (indexHtml.includes('src/main.tsx') || indexHtml.includes('__MINA_BUILD_ID_VALUE__')) {
      throw new Error('APK assets/www/index.html contains raw dev TSX or unstamped placeholders');
    }
    if (!/<script[^>]+src="\.\/assets\/[^"]+\.js"/i.test(indexHtml)) {
      throw new Error('APK assets/www/index.html is missing compiled ./assets/*.js entry bundle');
    }
    embeddedIndexHtmlOk = true;

    const versionRaw = execFileSync('unzip', ['-p', apkPath, 'assets/www/version.json'], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    });
    embeddedWebVersion = JSON.parse(versionRaw);
    if (!embeddedWebVersion || typeof embeddedWebVersion.version !== 'string') {
      throw new Error('APK assets/www/version.json is missing valid version field');
    }
  }

  return {
    entryCount: entries.length,
    dexCount: dexEntries.length,
    hasV1MetaInfSignature: metaInfSigEntries.length > 0,
    embeddedIndexHtmlOk,
    embeddedWebVersion,
  };
}

export function verifyApkMetadataCrossCheck({ metadata, sha256, sizeBytes, signature, baseline }) {
  const errors = [];
  if (!metadata || typeof metadata !== 'object') {
    throw new Error('apk-release.json metadata must be a valid JSON object');
  }
  if (metadata.applicationId !== (baseline.gradleAppId || EXPECTED_APPLICATION_ID)) {
    errors.push(`applicationId mismatch: metadata=${metadata.applicationId} expected=${baseline.gradleAppId || EXPECTED_APPLICATION_ID}`);
  }
  if (String(metadata.sha256 || '').toLowerCase() !== sha256.toLowerCase()) {
    errors.push(`sha256 mismatch: metadata=${metadata.sha256} actual=${sha256}`);
  }
  if (Number(metadata.sizeBytes) !== sizeBytes) {
    errors.push(`sizeBytes mismatch: metadata=${metadata.sizeBytes} actual=${sizeBytes}`);
  }
  if (!signature.skipped && signature.signerCertSha256) {
    if (String(metadata.signingCertSha256 || '').toLowerCase() !== signature.signerCertSha256.toLowerCase()) {
      errors.push(`signingCertSha256 mismatch: metadata=${metadata.signingCertSha256} actual=${signature.signerCertSha256}`);
    }
  }
  if (baseline.packageVersion && metadata.versionName !== baseline.packageVersion) {
    errors.push(`versionName mismatch: metadata=${metadata.versionName} package.json=${baseline.packageVersion}`);
  }
  if (baseline.gradleVersionCode && Number(metadata.versionCode) < baseline.gradleVersionCode) {
    errors.push(`versionCode regression: metadata=${metadata.versionCode} < baseline=${baseline.gradleVersionCode}`);
  }
  if (typeof metadata.downloadUrl !== 'string' || !/^https:\/\/.+\.apk$/i.test(metadata.downloadUrl)) {
    errors.push(`downloadUrl must be a valid HTTPS .apk URL (got ${String(metadata.downloadUrl)})`);
  }
  if (errors.length > 0) {
    throw new Error(`APK metadata cross-check failed:\n - ${errors.join('\n - ')}`);
  }
  return true;
}

export function verifyApkArtifact(options) {
  const {
    apkPath,
    metadataPath = null,
    repoRoot = DEFAULT_ROOT,
    requireApksigner = false,
    requireWebBundle = true,
    minBytes = MIN_VALID_APK_BYTES,
  } = options;

  if (!apkPath) {
    throw new Error('Missing required --apk <path> argument');
  }
  const resolvedApk = path.resolve(apkPath);
  if (!fs.existsSync(resolvedApk)) {
    throw new Error(`APK file not found: ${resolvedApk}`);
  }

  const { sha256, sizeBytes, head } = computeFileSha256(resolvedApk);
  if (looksLikeHtmlOrJsonPayload(head)) {
    throw new Error(`File at ${resolvedApk} is HTML/JSON/text rather than a binary Android APK`);
  }
  if (!hasApkZipMagicBytes(head)) {
    throw new Error(`Invalid APK magic bytes (expected 504b0304 PK\\x03\\x04, got ${head.subarray(0, 4).toString('hex')})`);
  }
  if (sizeBytes < minBytes) {
    throw new Error(`APK size (${sizeBytes} bytes) is below minimum valid APK threshold (${minBytes} bytes)`);
  }

  const baseline = readRepoVersionBaseline(repoRoot);
  if (baseline.packageVersion && baseline.gradleVersionName && baseline.packageVersion !== baseline.gradleVersionName) {
    throw new Error(
      `Web/Android version drift detected: package.json=${baseline.packageVersion} != app/build.gradle.kts=${baseline.gradleVersionName}`
    );
  }

  const structure = inspectApkZipStructure(resolvedApk, { requireWebBundle });

  // Verify embedded WebView bundle matches repo semver and baseline sequence
  if (structure.embeddedWebVersion) {
    if (baseline.packageVersion && structure.embeddedWebVersion.version !== baseline.packageVersion) {
      throw new Error(
        `Embedded APK web bundle version (${structure.embeddedWebVersion.version}) != package.json (${baseline.packageVersion})`
      );
    }
    const embeddedSeq = Number(structure.embeddedWebVersion.releaseSequence || structure.embeddedWebVersion.build || 0);
    if (baseline.gradleVersionCode && embeddedSeq < baseline.gradleVersionCode) {
      throw new Error(
        `Embedded APK web releaseSequence (${embeddedSeq}) < Android baseline versionCode (${baseline.gradleVersionCode})`
      );
    }
  }

  const signature = verifyApkSignatureWithApksigner(resolvedApk, { requireApksigner });

  let metadataVerified = false;
  if (metadataPath) {
    const resolvedMeta = path.resolve(metadataPath);
    if (!fs.existsSync(resolvedMeta)) {
      throw new Error(`Metadata file not found: ${resolvedMeta}`);
    }
    const metadata = JSON.parse(fs.readFileSync(resolvedMeta, 'utf8'));
    verifyApkMetadataCrossCheck({ metadata, sha256, sizeBytes, signature, baseline });
    if (
      structure.embeddedWebVersion &&
      Number(metadata.versionCode) !== Number(structure.embeddedWebVersion.releaseSequence || structure.embeddedWebVersion.build)
    ) {
      throw new Error(
        `APK metadata versionCode (${metadata.versionCode}) != embedded WebView releaseSequence (${structure.embeddedWebVersion.releaseSequence})`
      );
    }
    metadataVerified = true;
  }

  return {
    ok: true,
    apkPath: resolvedApk,
    sizeBytes,
    sha256,
    baseline,
    structure,
    signature,
    metadataVerified,
  };
}

function parseCliArgs(argv) {
  const args = {
    apkPath: null,
    metadataPath: null,
    requireApksigner: false,
    requireWebBundle: true,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--apk' && argv[i + 1]) {
      args.apkPath = argv[++i];
    } else if (token === '--metadata' && argv[i + 1]) {
      args.metadataPath = argv[++i];
    } else if (token === '--require-apksigner') {
      args.requireApksigner = true;
    } else if (token === '--skip-web-bundle-check') {
      args.requireWebBundle = false;
    } else if (token === '--json') {
      args.json = true;
    }
  }
  return args;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const parsed = parseCliArgs(process.argv.slice(2));
  const defaultCandidates = [
    'release-apk/MinaDental-android.apk',
    'app/build/outputs/apk/release/app-release.apk',
    'app/build/outputs/apk/debug/app-debug.apk',
  ];
  const apkPath =
    parsed.apkPath || defaultCandidates.find((rel) => fs.existsSync(path.resolve(DEFAULT_ROOT, rel)));

  try {
    const report = verifyApkArtifact({
      apkPath,
      metadataPath: parsed.metadataPath,
      requireApksigner: parsed.requireApksigner,
      requireWebBundle: parsed.requireWebBundle,
    });
    if (parsed.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(
        `[verify-apk] PASS: ${path.basename(report.apkPath)} | ${(report.sizeBytes / (1024 * 1024)).toFixed(2)} MB | sha256=${report.sha256.slice(0, 16)}... | entries=${report.structure.entryCount} | dex=${report.structure.dexCount} | web=${report.structure.embeddedWebVersion?.releaseId || 'n/a'} (#${report.structure.embeddedWebVersion?.releaseSequence || 'n/a'}) | apksigner=${report.signature.skipped ? 'skipped' : `VERIFIED (${Object.entries(report.signature.schemes).filter(([, v]) => v).map(([k]) => k).join(',')}) cert=${report.signature.signerCertSha256?.slice(0, 16)}...`} | metadata=${report.metadataVerified ? 'VERIFIED' : 'none'}`
      );
    }
  } catch (err) {
    console.error(`[verify-apk] FAIL: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
