import { createServer } from 'vite';

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
});

let exitCode = 0;

try {
  const mod = await server.ssrLoadModule('/tests/v4-production.test.ts');
  const results = await mod.runAllV4ProductionTests();

  let passed = 0;
  let failed = 0;

  for (const r of results) {
    if (r.passed) {
      passed += 1;
      console.log(`✔ ${r.name}`);
    } else {
      failed += 1;
      console.error(`✖ ${r.name}\n  ${r.error}`);
    }
  }

  console.log(
    `\nV4 Production-Import Tests: ${passed} passed, ${failed} failed (total ${results.length})`
  );
  if (failed > 0) {
    exitCode = 1;
  }
} finally {
  await server.close();
}

process.exit(exitCode);
