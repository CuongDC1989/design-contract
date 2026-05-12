# @solashi/design-contract

Design contract testing engine: compare CSS computed styles in Storybook against Figma design specs.

## Install

```bash
npm install @solashi/design-contract
npx design-contract init
```

## Setup

1. Fill in `design-contract.config.mjs` with your Figma nodes and check rules
2. Add `FIGMA_TOKEN` and `FIGMA_FILE_KEY` to `.env`
3. Run: `npm run test:design:full` (Storybook must be running)

## Config

```js
import { CHECKS_STRICT, CHECKS_LAYOUT } from '@solashi/design-contract'

export default {
  figmaFileKey: process.env.FIGMA_FILE_KEY,
  figmaToken: process.env.FIGMA_TOKEN,
  storybookUrl: process.env.STORYBOOK_URL ?? 'http://127.0.0.1:6006',
  specOutputPath: './visual-tests/design-spec.json',
  cases: [
    { name: 'my-card--default', storyId: 'ui-card--default', figmaNodeId: '123-456', figmaScale: 1, viewport: { width: 1200, height: 900 } },
  ],
  contractCases: [
    { name: 'my-card--default', checks: CHECKS_STRICT, selector: '[data-testid="my-card"]' },
  ],
}
```

## CLI

| Command | Description |
|---|---|
| `design-contract init` | Create config template + add scripts to package.json |
| `design-contract fetch-spec` | Fetch Figma → write design-spec.json |
| `design-contract test` | Run Playwright tests against Storybook |
| `design-contract run` | fetch-spec + test (full pipeline) |

## Check sets

| Constant | Checks |
|---|---|
| `CHECKS_STRICT` | exists, size, radius, background, border, shadow, opacity, layout, typography, text, overflow, blend |
| `CHECKS_CONTAINER` | exists, size, radius, background, shadow, layout, overflow |
| `CHECKS_LAYOUT` | exists, size, layout |
| `CHECKS_SHAPE` | exists, size, radius, background |
