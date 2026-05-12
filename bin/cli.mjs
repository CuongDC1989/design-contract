#!/usr/bin/env node
import path from 'node:path';
import { init } from '../src/init.mjs';
import { fetchFigmaSpec } from '../src/fetch-spec.mjs';
import { runDesignContractTest } from '../src/run-test.mjs';
import { generateReport } from '../src/reporter.mjs';

// Load .env from CWD before anything else (safe to fail if dotenv not present)
try { await import('dotenv/config'); } catch {}

const command = process.argv[2];

async function loadConfig() {
  const configPath = path.resolve(process.cwd(), 'design-contract.config.mjs');
  try {
    const { default: config } = await import(configPath);
    return config;
  } catch {
    console.error(`Error: design-contract.config.mjs not found in ${process.cwd()}`);
    console.error('Run "npx design-contract init" to create one.');
    process.exit(1);
  }
}

switch (command) {
  case 'init':
    await init();
    break;

  case 'fetch-spec': {
    const config = await loadConfig();
    await fetchFigmaSpec(config);
    break;
  }

  case 'test': {
    const config = await loadConfig();
    const { passed, results, startTime, endTime } = await runDesignContractTest(config);
    const reportPath = await generateReport(results, config, { startTime, endTime });
    console.log(`\nReport: ${reportPath}`);
    if (!passed) process.exit(1);
    break;
  }

  case 'run': {
    const config = await loadConfig();
    await fetchFigmaSpec(config);
    const { passed, results, startTime, endTime } = await runDesignContractTest(config);
    const reportPath = await generateReport(results, config, { startTime, endTime });
    console.log(`\nReport: ${reportPath}`);
    if (!passed) process.exit(1);
    break;
  }

  default:
    console.log(`Usage: design-contract <command>

Commands:
  init          Create config template + add scripts to package.json
  fetch-spec    Fetch Figma nodes → write design-spec.json
  test          Run Playwright tests against Storybook
  run           fetch-spec + test (full pipeline)
`);
    process.exit(1);
}
