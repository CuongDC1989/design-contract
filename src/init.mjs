import fs from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { name: PACKAGE_NAME } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
);

const SKILLS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../skills'
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
  await fs.mkdir(skillDestDir, { recursive: true });
  const installed = await copySkills(SKILLS_DIR, skillDestDir);
  if (installed.length > 0) {
    installed.forEach(f => console.log(`✓  Installed Claude skill: .claude/commands/${f}`));
  }

  console.log('\nNext steps:');
  console.log('  1. Fill in cases[] and contractCases[] in design-contract.config.mjs');
  console.log('  2. Add FIGMA_TOKEN and FIGMA_FILE_KEY to .env');
  console.log('  3. Run: npm run test:design:full');
  console.log('  4. Use /figma-to-component in Claude Code to generate components from Figma');
  console.log('  5. Use /create-story to wire individual components to Figma');
}

async function copySkills(srcDir, destDir, relBase = '') {
  const installed = [];
  let entries;
  try { entries = await fs.readdir(srcDir, { withFileTypes: true }); }
  catch { return installed; }

  for (const entry of entries) {
    const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
    const src = path.join(srcDir, entry.name);
    const dest = path.join(destDir, entry.name);

    if (entry.isDirectory()) {
      await fs.mkdir(dest, { recursive: true });
      const sub = await copySkills(src, dest, rel);
      installed.push(...sub);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      if (existsSync(dest)) {
        console.log(`⚠  .claude/commands/${rel} already exists — skipping.`);
      } else {
        await fs.copyFile(src, dest);
        installed.push(rel);
      }
    }
  }
  return installed;
}
