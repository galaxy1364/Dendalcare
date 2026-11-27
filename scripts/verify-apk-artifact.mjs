#!/usr/bin/env node
/**
 * MinaDental Automated Android APK Signature (apksigner + keytool), Structure,
 * Installability & Version-Parity Verifier with CI Build Report Export.
 *
 * Fail-closed verification script used both locally (`npm run verify:apk -- --apk <path>`)
 * and in GitHub Actions BEFORE publishing any APK to GitHub Releases.
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
 * 6. X.509 certificate inspection via JDK `keytool -printcert -jarfile <apk>` (Owner DN, Issuer DN,
 *    validity window, SHA-256 fingerprint) + debug keystore detection (`--forbid-debug-signing`).
 * 7. Optional `--metadata apk-release.json` strict cross-check (`sha256`, `sizeBytes`,
 *    `signingCertSha256`, `versionName`, `versionCode`, `applicationId`, HTTPS `downloadUrl`).
 * 8. Structured CI Build Report export via `--report <path>` (+ GitHub Step Summary if available).
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

export function findKeytoolBinary() {
  if (process.env.JAVA_HOME) {
    const candidate = path.join(process.env.JAVA_HOME, 'bin', 'keytool');
    if (fs.existsSync(candidate)) return candidate;
  }
  try {
    const whichOut = execFileSync('which', ['keytool'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (whichOut && fs.existsSync(whichOut)) return whichOut;
  } catch {
    // not on PATH
  }
  return null;
}

export function isDebugCertificateDn(dnText) {
  const lower = String(dnText || '').toLowerCase();
  return (
    lower.includes('cn=android debug') ||
    lower.includes('androiddebugkey') ||
    lower.includes('o=android, c=us') ||
    lower.includes('cn=minadental ci debug') ||
    lower.includes('cn=minadental ci,')
  );
}

export function parseApksignerOutput(outputText) {
  const schemes = {};
  const schemeRegex = /Verified using (v\d+(?:\.\d+)?) scheme \([^)]+\):\s*(true|false)/gi;
  let m;
  while ((m = schemeRegex.exec(outputText)) !== null) {
    schemes[m[1].toLowerCase()] = m[2].toLowerCase() === 'true';
  }
  // Older build-tools print "Signer #1 certificate ..."; newer releases
  // print scheme-specific "V2 Signer: certificate ...". Ignore public-key
  // digests and SourceStamp certificates; reject ambiguous signer identities.
  const fingerprints = [...outputText.matchAll(/^(?:Signer #1\s+|V[1234](?:\.\d+)? Signer:\s*)certificate SHA-256 digest:\s*([0-9a-f]{64})\s*$/gim)].map(m => m[1].toLowerCase());
  const dns = [...outputText.matchAll(/^(?:Signer #1\s+|V[1234](?:\.\d+)? Signer:\s*)certificate DN:\s*(.+)$/gim)].map(m => m[1].trim());
  const counts = [...outputText.matchAll(/^Number of signers:\s*(\d+)\s*$/gim)];
  const singleSigner = counts.length === 1 && counts[0][1] === '1';
  const uniqueDigests = [...new Set(fingerprints)];
  const uniqueDns = [...new Set(dns)];
  const unambiguous = singleSigner && uniqueDigests.length === 1 && uniqueDns.length === 1;
  const signerDn = unambiguous ? uniqueDns[0] : null;
  return {
    verified: /^Verifies\s*$/m.test(outputText) && Object.values(schemes).some(Boolean),
    schemes,
    signerCertSha256: unambiguous ? uniqueDigests[0] : null,
    signerDn,
    isDebugCertificate: dns.some(isDebugCertificateDn),
  };
}

export function parseKeytoolPrintCertOutput(outputText) {
  const owner = outputText.match(/Owner:\s*(.+)/i)?.[1]?.trim() || null;
  const issuer = outputText.match(/Issuer:\s*(.+)/i)?.[1]?.trim() || null;
  const validMatch = outputText.match(/Valid from:\s*(.+?)\s+until:\s*(.+)/i);
  const sha256Raw = outputText.match(/SHA256:\s*([0-9A-Fa-f:]+)/i)?.[1] || null;
  const certSha256 = sha256Raw ? sha256Raw.replace(/:/g, '').toLowerCase() : null;
  const sigAlg = outputText.match(/Signature algorithm name:\s*(.+)/i)?.[1]?.trim() || null;

  return {
    owner,
    issuer,
    validFrom: validMatch ? validMatch[1].trim() : null,
    validUntil: validMatch ? validMatch[2].trim() : null,
    certSha256,
    signatureAlgorithm: sigAlg,
    isDebugCertificate: isDebugCertificateDn(owner || issuer),
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
      isDebugCertificate: false,
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

export function inspectApkCertificateWithKeytool(apkPath, options = {}) {
  const keytool = options.keytoolPath || findKeytoolBinary();
  if (!keytool) {
    if (options.requireKeytool) {
      throw new Error('keytool binary not found in JAVA_HOME/bin or PATH');
    }
    return {
      skipped: true,
      inspected: false,
      keytoolPath: null,
      owner: null,
      issuer: null,
      validFrom: null,
      validUntil: null,
      certSha256: null,
      signatureAlgorithm: null,
      isDebugCertificate: false,
    };
  }

  let output = '';
  try {
    output = execFileSync(keytool, ['-printcert', '-jarfile', apkPath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    // Note: Pure v2/v3 APKs without v1 JAR signature may return "Not a signed jar file" from keytool -jarfile;
    // handle gracefully unless v1 signature is present and corrupt.
    const msg = String((err && (err.stderr || err.stdout)) || err.message || '');
    if (/not a signed jar/i.test(msg)) {
      return {
        skipped: false,
        inspected: false,
        v2OnlyNoV1JarSignature: true,
        keytoolPath: keytool,
        owner: null,
        issuer: null,
        validFrom: null,
        validUntil: null,
        certSha256: null,
        signatureAlgorithm: null,
        isDebugCertificate: false,
      };
    }
    throw new Error(`keytool -printcert failed for ${apkPath}: ${msg.trim()}`);
  }

  const parsed = parseKeytoolPrintCertOutput(output);
  return {
    skipped: false,
    inspected: Boolean(parsed.owner || parsed.certSha256),
    v2OnlyNoV1JarSignature: false,
    keytoolPath: keytool,
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

export function writeVerificationBuildReport(reportPath, report) {
  const resolved = path.resolve(reportPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, JSON.stringify(report, null, 2) + '\n', 'utf8');

  if (process.env.GITHUB_STEP_SUMMARY) {
    const schemesList = Object.entries(report.signature?.schemes || {})
      .filter(([, v]) => v)
      .map(([k]) => k)
      .join(', ') || 'n/a';
    const md = [
      '### MinaDental Android APK Verification Report',
      '',
      '| Check | Result |',
      '|---|---|',
      `| Status | ${report.ok ? 'PASS' : 'FAIL'} |`,
      `| Installable on Android | ${report.installableOnAndroid ? 'YES' : 'NO'} |`,
      `| File | \`${path.basename(report.apkPath || 'unknown')}\` (${((report.sizeBytes || 0) / (1024 * 1024)).toFixed(2)} MB) |`,
      `| APK SHA-256 | \`${report.sha256 || 'n/a'}\` |`,
      `| apksigner Schemes | \`${schemesList}\` |`,
      `| Signer Cert SHA-256 | \`${report.signature?.signerCertSha256 || report.keytool?.certSha256 || 'n/a'}\` |`,
      `| Keytool Owner DN | \`${report.keytool?.owner || report.signature?.signerDn || 'n/a'}\` |`,
      `| Debug Signing Detected | ${report.isDebugSigned ? 'YES (non-stable)' : 'NO (production key)'} |`,
      `| Embedded Web Bundle | \`${report.structure?.embeddedWebVersion?.releaseId || 'n/a'}\` (#${report.structure?.embeddedWebVersion?.releaseSequence || 'n/a'}) |`,
      `| Metadata Cross-Check | ${report.metadataVerified ? 'VERIFIED' : 'not supplied'} |`,
      '',
    ].join('\n');
    try {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md, 'utf8');
    } catch {
      // ignore non-writable summary path
    }
  }
}

export function verifyApkArtifact(options) {
  const {
    apkPath,
    metadataPath = null,
    reportPath = null,
    repoRoot = DEFAULT_ROOT,
    requireApksigner = false,
    requireKeytool = false,
    forbidDebugSigning = false,
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
  const keytool = inspectApkCertificateWithKeytool(resolvedApk, { requireKeytool });

  // keytool -jarfile can inspect v1 JAR signatures, but not v2-only APKs.
  // Do not accept an absent keytool certificate when apksigner reports v1.
  if (requireKeytool && !signature.skipped && signature.schemes.v1 &&
      (!keytool.inspected || !keytool.certSha256)) {
    throw new Error('keytool failed to inspect the verified v1 certificate');
  }
  // Cross-check apksigner SHA-256 vs keytool SHA-256 when both inspected the signer certificate
  if (signature.signerCertSha256 && keytool.certSha256 && signature.signerCertSha256 !== keytool.certSha256) {
    throw new Error(
      `Certificate SHA-256 mismatch between apksigner (${signature.signerCertSha256}) and keytool (${keytool.certSha256})`
    );
  }

  const isDebugSigned = Boolean(signature.isDebugCertificate || keytool.isDebugCertificate);
  if (forbidDebugSigning && isDebugSigned) {
    throw new Error(
      `Debug signing certificate is PROHIBITED for stable releases (signer: ${signature.signerDn || keytool.owner || 'unknown'})`
    );
  }

  let metadataVerified = false;
  if (metadataPath) {
    const resolvedMeta = path.resolve(metadataPath);
    if (!fs.existsSync(resolvedMeta)) {
      throw new Error(`Metadata file not found: ${resolvedMeta}`);
    }
    const metadata = JSON.parse(fs.readFileSync(resolvedMeta, 'utf8'));
    if (forbidDebugSigning && String(metadata.signingMode || '').includes('debug')) {
      throw new Error(`Metadata signingMode (${metadata.signingMode}) is prohibited for stable releases`);
    }
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

  const installableOnAndroid = Boolean(
    structure.dexCount > 0 &&
      (signature.verified || (signature.skipped && (structure.hasV1MetaInfSignature || keytool.inspected)))
  );

  const report = {
    ok: true,
    verifiedAt: new Date().toISOString(),
    installableOnAndroid,
    isDebugSigned,
    apkPath: resolvedApk,
    sizeBytes,
    sha256,
    baseline,
    structure,
    signature,
    keytool,
    metadataVerified,
  };

  if (reportPath) {
    writeVerificationBuildReport(reportPath, report);
  }

  return report;
}

function parseCliArgs(argv) {
  const args = {
    apkPath: null,
    metadataPath: null,
    reportPath: null,
    requireApksigner: false,
    requireKeytool: false,
    forbidDebugSigning: false,
    requireWebBundle: true,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--apk' && argv[i + 1]) {
      args.apkPath = argv[++i];
    } else if (token === '--metadata' && argv[i + 1]) {
      args.metadataPath = argv[++i];
    } else if (token === '--report' && argv[i + 1]) {
      args.reportPath = argv[++i];
    } else if (token === '--require-apksigner') {
      args.requireApksigner = true;
    } else if (token === '--require-keytool') {
      args.requireKeytool = true;
    } else if (token === '--forbid-debug-signing') {
      args.forbidDebugSigning = true;
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
      reportPath: parsed.reportPath,
      requireApksigner: parsed.requireApksigner,
      requireKeytool: parsed.requireKeytool,
      forbidDebugSigning: parsed.forbidDebugSigning,
      requireWebBundle: parsed.requireWebBundle,
    });
    if (parsed.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(
        `[verify-apk] PASS: ${path.basename(report.apkPath)} | ${(report.sizeBytes / (1024 * 1024)).toFixed(2)} MB | sha256=${report.sha256.slice(0, 16)}... | entries=${report.structure.entryCount} | dex=${report.structure.dexCount} | web=${report.structure.embeddedWebVersion?.releaseId || 'n/a'} (#${report.structure.embeddedWebVersion?.releaseSequence || 'n/a'}) | apksigner=${report.signature.skipped ? 'skipped' : `VERIFIED (${Object.entries(report.signature.schemes).filter(([, v]) => v).map(([k]) => k).join(',')})`} | keytool=${report.keytool.skipped ? 'skipped' : report.keytool.inspected ? `VERIFIED (${report.keytool.owner})` : 'v2-only'} | debugSigned=${report.isDebugSigned} | installable=${report.installableOnAndroid} | metadata=${report.metadataVerified ? 'VERIFIED' : 'none'}${parsed.reportPath ? ` | report=${parsed.reportPath}` : ''}`
      );
    }
  } catch (err) {
    if (parsed.reportPath) {
      writeVerificationBuildReport(parsed.reportPath, {
        ok: false,
        verifiedAt: new Date().toISOString(),
        installableOnAndroid: false,
        apkPath: apkPath || null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    console.error(`[verify-apk] FAIL: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
