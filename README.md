# @cuongdc1989/design-contract

Design contract testing engine: compare CSS computed styles in Storybook against Figma design specs.

## Install

```bash
npm install @cuongdc1989/design-contract
npx design-contract init
```

## Setup

1. Fill in `design-contract.config.mjs` with your Figma nodes and check rules
2. Add `FIGMA_TOKEN` and `FIGMA_FILE_KEY` to `.env`
3. Run: `npm run test:design:full` (Storybook must be running)

## Config

```js
import { CHECKS_STRICT, CHECKS_LAYOUT } from '@cuongdc1989/design-contract'

export default {
  figmaFileKey: process.env.FIGMA_FILE_KEY,
  figmaToken: process.env.FIGMA_TOKEN,
  storybookUrl: process.env.STORYBOOK_URL ?? 'http://127.0.0.1:6006',
  specOutputPath: './visual-tests/design-spec.json',
  reportOutputPath: './design-contract-report.html', // optional, default: ./design-contract-report.html
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

## Component & Story Guide

### 1 — Add `data-testid` to your component

Add `data-testid` to the **root element** and any key sub-elements that map to separate Figma nodes.

**Naming:** `[feature]-[component-name]` in kebab-case.

```tsx
<div data-testid="table-card-header">
  <input data-testid="table-search" />
</div>
```

### 2 — Create a Storybook story

Place stories in a `stories/` subfolder next to the component file.

```
src/features/users/
  UsersPage.tsx
  stories/
    UsersPage.stories.tsx
```

**Story ID format:** `[feature]-[componentname]--[variant]`  
Title `Users/UsersPage` → story ID `users-userspage--default`

```tsx
import type { Meta, StoryObj } from '@storybook/react'
import { MyComponent } from '../MyComponent'

const meta: Meta<typeof MyComponent> = {
  title: 'Feature/MyComponent',
  component: MyComponent,
}
export default meta
type Story = StoryObj<typeof MyComponent>

export const Default: Story = {}
```

### 3 — Add to config

```js
cases: [
  {
    name: 'feature-mycomponent--default',
    storyId: 'feature-mycomponent--default',
    figmaNodeId: '1234-5678',   // from Figma: right-click node → Copy link → node-id param
    figmaScale: 2,              // 1 for full page/large, 2 for small components
    viewport: { width: 250, height: 80 },
  },
],
contractCases: [
  {
    name: 'feature-mycomponent--default',
    checks: CHECKS_STRICT,      // CHECKS_LAYOUT for pages, CHECKS_CONTAINER for panels
    selector: '[data-testid="my-component"]',
  },
],
```

### AI assistant (Claude Code)

Running `npx design-contract init` installs a `/create-story` skill into `.claude/commands/`.  
In Claude Code, type `/create-story` and provide the component name + Figma node ID — the AI will add `data-testid`, create the story file, and update the config automatically.
