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

  const v4Results = await v4Mod.runAllV4ProductionTests();
  const v5Results = await v5Mod.runAllV5ReliabilityTests();
  const v7Results = await v7Mod.runAllV7UpdateEngineTests();
  const v8Results = await v8Mod.runAllV8ReleaseAssuranceTests();
  const v9Results = await v9Mod.runAllV9ResilientBootTests();
  const allResults = [...v4Results, ...v5Results, ...v7Results, ...v8Results, ...v9Results];

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
    `\nProduction-Import Tests (V4 + V5 + V7 + V8 + V9): ${passed} passed, ${failed} failed (total ${allResults.length})`
  );
  if (failed > 0) {
    exitCode = 1;
  }
} finally {
  await server.close();
}

process.exit(exitCode);
