import { createServer } from 'vite';

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
});

let exitCode = 0;

try {
  const v4Mod = await server.ssrLoadModule('/tests/v4-production.test.ts');
  const v5Mod = await server.ssrLoadModule('/tests/v5-reliability.test.ts');
  const v7Mod = await server.ssrLoadModule('/tests/v7-update-engine.test.ts');
  const v8Mod = await server.ssrLoadModule('/tests/v8-release-assurance.test.ts');
  const v9Mod = await server.ssrLoadModule('/tests/v9-resilient-boot.test.ts');
  const v10Mod = await server.ssrLoadModule('/tests/v10-architecture.test.ts');
  const v11Mod = await server.ssrLoadModule('/tests/v11-supabase-foundation.test.ts');
  const v12Mod = await server.ssrLoadModule('/tests/v12-membership-auth.test.ts');
  const uxMod = await server.ssrLoadModule('/tests/global-ux-audit.test.ts');
  const v13Mod = await server.ssrLoadModule('/tests/v13-universal-platform.test.ts');
  const v14Mod = await server.ssrLoadModule('/tests/v14-clinical-workflow-integrity.test.ts');

  const v4Results = await v4Mod.runAllV4ProductionTests();
  const v5Results = await v5Mod.runAllV5ReliabilityTests();
  const v7Results = await v7Mod.runAllV7UpdateEngineTests();
  const v8Results = await v8Mod.runAllV8ReleaseAssuranceTests();
  const v9Results = await v9Mod.runAllV9ResilientBootTests();
  const v10Results = await v10Mod.runAllV10ArchitectureTests();
  const v11Results = await v11Mod.runAllV11SupabaseFoundationTests();
  const v12Results = await v12Mod.runAllV12MembershipAuthTests();
  const uxResults = await uxMod.runAllGlobalUxAuditTests();
  const v13Results = await v13Mod.runAllV13UniversalPlatformTests();
  const v14Results = await v14Mod.runAllV14ClinicalWorkflowIntegrityTests();
  const allResults = [
    ...v4Results,
    ...v5Results,
    ...v7Results,
    ...v8Results,
    ...v9Results,
    ...v10Results,
    ...v11Results,
    ...v12Results,
    ...uxResults,
    ...v13Results,
    ...v14Results,
  ];

  let passed = 0;
  let failed = 0;

  for (const r of allResults) {
    if (r.passed) {
      passed += 1;
      console.log(`✔ ${r.name}`);
    } else {
      failed += 1;
      console.error(`✖ ${r.name}\n  ${r.error}`);
    }
  }

  console.log(
    `\nProduction-Import Tests (V4 + V5 + V7 + V8 + V9 + V10 + V11 + V12 + UX-Audit-V1 + V13 + V14): ${passed} passed, ${failed} failed (total ${allResults.length})`
  );
  if (failed > 0) {
    exitCode = 1;
  }
} finally {
  await server.close();
}

process.exit(exitCode);
