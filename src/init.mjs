import fs from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { name: PACKAGE_NAME } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
);

const SKILL_SOURCE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../skills/create-story.md'
);

const CONFIG_TEMPLATE = `import { CHECKS_STRICT, CHECKS_CONTAINER, CHECKS_LAYOUT } from '${PACKAGE_NAME}'

export default {
  figmaFileKey: process.env.FIGMA_FILE_KEY,   // required
  figmaToken: process.env.FIGMA_TOKEN,          // required
  storybookUrl: process.env.STORYBOOK_URL ?? 'http://127.0.0.1:6006',
  specOutputPath: './visual-tests/design-spec.json',

  cases: [
    // {
    //   name: 'my-component--default',
    //   storyId: 'feature-mycomponent--default',
    //   figmaNodeId: '123-456',
    //   figmaScale: 1,
    //   viewport: { width: 1200, height: 900 },
    // },
  ],

  contractCases: [
    // {
    //   name: 'my-component--default',
    //   checks: CHECKS_STRICT,
    //   selector: '[data-testid="my-component"]',
    // },
  ],
}
`;

const SCRIPTS_TO_ADD = {
  'figma:spec': 'design-contract fetch-spec',
  'test:design': 'design-contract test',
  'test:design:full': 'design-contract run',
};

export async function init() {
  const cwd = process.cwd();

  const configPath = path.join(cwd, 'design-contract.config.mjs');
  if (existsSync(configPath)) {
    console.log('⚠  design-contract.config.mjs already exists — skipping.');
  } else {
    await fs.writeFile(configPath, CONFIG_TEMPLATE, 'utf8');
    console.log('✓  Created design-contract.config.mjs');
  }

  const pkgPath = path.join(cwd, 'package.json');
  if (!existsSync(pkgPath)) {
    console.log('⚠  package.json not found — skipping script injection.');
    return;
  }
  const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'));
  pkg.scripts = pkg.scripts ?? {};

  let added = 0;
  for (const [key, value] of Object.entries(SCRIPTS_TO_ADD)) {
    if (pkg.scripts[key]) {
      console.log(`⚠  script "${key}" already exists — skipping.`);
    } else {
      pkg.scripts[key] = value;
      added++;
    }
  }

  if (added > 0) {
    await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
    console.log(`✓  Added ${added} script(s) to package.json`);
  }

  const skillDestDir = path.join(cwd, '.claude', 'commands');
  const skillDestPath = path.join(skillDestDir, 'create-story.md');
  if (existsSync(skillDestPath)) {
    console.log('⚠  .claude/commands/create-story.md already exists — skipping.');
  } else if (existsSync(SKILL_SOURCE)) {
    await fs.mkdir(skillDestDir, { recursive: true });
    await fs.copyFile(SKILL_SOURCE, skillDestPath);
    console.log('✓  Installed Claude skill: .claude/commands/create-story.md');
  }

  console.log('\nNext steps:');
  console.log('  1. Fill in cases[] and contractCases[] in design-contract.config.mjs');
  console.log('  2. Add FIGMA_TOKEN and FIGMA_FILE_KEY to .env');
  console.log('  3. Run: npm run test:design:full');
  console.log('  4. Use /create-story in Claude Code to wire new components to Figma');
}
