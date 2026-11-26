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
  const v15Mod = await server.ssrLoadModule('/tests/v15-clinical-record-patient-safety.test.ts');
  const v16Mod = await server.ssrLoadModule('/tests/v16-financial-intelligence.test.ts');
  const ge0002Mod = await server.ssrLoadModule('/tests/ge0002-p0-recovery.test.ts');
  const ge0003Mod = await server.ssrLoadModule('/tests/ge0003-intelligent-shell.test.ts');

  const v4Results = await v4Mod.runAllV4ProductionTests();
  const v5Results = await v5Mod.runAllV5ReliabilityTests();
  const v7Results = await v7Mod.runAllV7UpdateEngineTests();
  const v8Results = await v8Mod.runAllV8ReleaseAssuranceTests();
  const v9Results = await v9Mod.runAllV9ResilientBootTests();
  const v10Results = await v10Mod.runAllV10ArchitectureTests();
  const v11ModResults = await v11Mod.runAllV11SupabaseFoundationTests();
  const v12ModResults = await v12Mod.runAllV12MembershipAuthTests();
  const uxResults = await uxMod.runAllGlobalUxAuditTests();
  const v13Results = await v13Mod.runAllV13UniversalPlatformTests();
  const v14Results = await v14Mod.runAllV14ClinicalWorkflowIntegrityTests();
  const v15Results = await v15Mod.runAllV15ClinicalRecordPatientSafetyTests();
  const v16Results = await v16Mod.runAllV16FinancialIntelligenceTests();
  const ge0002Results = await ge0002Mod.runAllGe0002P0RecoveryTests();
  const ge0003Results = await ge0003Mod.runAllGe0003IntelligentShellTests();
  const allResults = [
    ...v4Results,
    ...v5Results,
    ...v7Results,
    ...v8Results,
    ...v9Results,
    ...v10Results,
    ...v11ModResults,
    ...v12ModResults,
    ...uxResults,
    ...v13Results,
    ...v14Results,
    ...v15Results,
    ...v16Results,
    ...ge0002Results,
    ...ge0003Results,
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
    `\nProduction-Import Tests (V4..V16 + GE-0002 + GE-0003): ${passed} passed, ${failed} failed (total ${allResults.length})`
  );
  if (failed > 0) {
    exitCode = 1;
  }
} finally {
  await server.close();
}

process.exit(exitCode);
