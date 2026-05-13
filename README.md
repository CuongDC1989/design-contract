# @cuongdc1989/design-contract

Design contract testing engine: compare CSS computed styles in Storybook against Figma design specs.

Fetches node properties from Figma, renders your stories in a headless browser, and checks that computed CSS values match — automatically generating an HTML report.

---

## Install

```bash
npm install @cuongdc1989/design-contract
npx design-contract init
```

`init` creates `design-contract.config.mjs` and adds npm scripts to `package.json`. If Claude Code is installed, it also installs a `/create-story` skill that automates wiring up new components.

---

## Quick start

1. Add `FIGMA_TOKEN` and `FIGMA_FILE_KEY` to `.env`
2. Fill in `design-contract.config.mjs`
3. Start Storybook: `npm run storybook`
4. Run the full pipeline: `npm run test:design:full`

---

## CLI

| Command | Description |
|---|---|
| `design-contract init` | Create config template + add scripts to package.json |
| `design-contract fetch-spec` | Fetch Figma nodes → write design-spec.json |
| `design-contract test` | Run Playwright tests against Storybook |
| `design-contract run` | fetch-spec + test (full pipeline) |

---

## Config reference

```js
// design-contract.config.mjs
import { CHECKS_STRICT, CHECKS_LAYOUT } from '@cuongdc1989/design-contract'

export default {
  figmaFileKey:   process.env.FIGMA_FILE_KEY,
  figmaToken:     process.env.FIGMA_TOKEN,
  storybookUrl:   process.env.STORYBOOK_URL ?? 'http://127.0.0.1:6006',
  specOutputPath: './design-spec.json',
  reportOutputPath: './design-contract-report.html',

  cases: [
    {
      name:        'users-statusbadge--active',
      storyId:     'users-statusbadge--active',
      figmaNodeId: '2397-46466',
      figmaScale:  2,
      viewport:    { width: 250, height: 80 },
    },
  ],

  contractCases: [
    {
      name:     'users-statusbadge--active',
      checks:   CHECKS_STRICT,
      selector: '[data-testid="status-badge"]',
    },
  ],
}
```

### Top-level fields

| Field | Type | Description |
|---|---|---|
| `figmaFileKey` | `string` | Figma file key — from the URL: `figma.com/file/<KEY>/...` |
| `figmaToken` | `string` | Figma personal access token with read scope |
| `storybookUrl` | `string` | Base URL of the running Storybook instance. Default: `http://127.0.0.1:6006` |
| `specOutputPath` | `string` | Where to write the fetched Figma spec JSON. Default: `./design-spec.json` |
| `reportOutputPath` | `string` | Where to write the HTML report. Default: `./design-contract-report.html` |

---

### `cases[]` — Figma snapshot config

Each entry in `cases` pairs a Storybook story with a Figma node. The engine fetches the node's design properties (size, color, spacing, typography…) and saves them as the expected spec.

| Field | Type | Description |
|---|---|---|
| `name` | `string` | Unique identifier. Must match the corresponding entry in `contractCases`. |
| `storyId` | `string` | Storybook story ID used to navigate to the iframe URL. See [Story ID format](#story-id-format). |
| `figmaNodeId` | `string` | ID of the Figma node to fetch. See [Finding node IDs](#finding-node-ids). |
| `figmaScale` | `number` | Screenshot scale. `1` for full-page / large frames, `2` for small components. Does not affect spec values — only the screenshot resolution in the HTML report. |
| `viewport` | `{ width, height }` | Browser viewport when rendering the story. Should match the Figma frame's canvas size. |

#### `figmaScale`

Controls only the resolution of the screenshot that appears in the HTML report — it has no effect on the CSS comparison values.

| Value | When to use |
|---|---|
| `1` | Full page layouts, large containers (≥ 400px wide) |
| `2` | Small components: badges, avatars, inputs, table rows (< 400px wide) |

Use `2` for small elements so the screenshot is readable in the report.

#### `viewport`

Sets the Playwright browser viewport when rendering the story. The Figma node's `absoluteBoundingBox` is fetched at whatever size it is in Figma — viewport only affects how the **browser** renders the story, not what size Figma reports.

| Scenario | Recommended viewport |
|---|---|
| Full-page story | `{ width: 1200, height: 900 }` |
| Component rendered in isolation | Match the component's natural size, e.g. `{ width: 250, height: 80 }` |
| Component inside a larger page | Use the page viewport so the layout context is correct |

If the component uses `min-width: 100%` or stretches to fill its container, use the page viewport even for a small element — otherwise the browser will collapse it.

---

### `contractCases[]` — CSS check config

Each entry in `contractCases` defines which CSS properties to compare for a given case.

| Field | Type | Description |
|---|---|---|
| `name` | `string` | Must match a `name` in `cases[]`. |
| `checks` | `string[]` | Which CSS property groups to compare. Use a named constant or a custom array. |
| `selector` | `string` | CSS selector to locate the element inside the Storybook iframe. Optional — defaults to the first visible child of `#storybook-root`. |
| `typographySelector` | `string` | Secondary CSS selector pointing to the text element for typography checks. Optional. |

#### `checks`

Defines which groups of CSS properties are compared against the Figma spec. Use the exported constants or build a custom array from the tokens below.

**Named constants:**

| Constant | Checks included |
|---|---|
| `CHECKS_STRICT` | `exists` `size` `radius` `background` `border` `shadow` `opacity` `layout` `typography` `text` `overflow` `blend` |
| `CHECKS_CONTAINER` | `exists` `size` `radius` `background` `shadow` `layout` `overflow` |
| `CHECKS_LAYOUT` | `exists` `size` `layout` |
| `CHECKS_SHAPE` | `exists` `size` `radius` `background` |

**Individual check tokens and what they verify:**

| Token | CSS properties checked | Figma source |
|---|---|---|
| `exists` | Element is found and visible in the DOM | — |
| `size` | `width`, `height`, `minWidth`, `maxWidth`, `minHeight`, `maxHeight` | `absoluteBoundingBox`, `minWidth`, `maxWidth`, `minHeight`, `maxHeight` |
| `background` | `backgroundColor` (as `rgba(…)`) | First solid `fills` paint |
| `border` | `borderWidth`, `borderColor`, `borderStyle` | `strokes`, `strokeWeight`, `strokeDashes` |
| `radius` | `borderRadius` | `cornerRadius` / `rectangleCornerRadii` |
| `shadow` | `boxShadow` (presence only) | First `DROP_SHADOW` effect |
| `opacity` | `opacity` | `opacity` |
| `blend` | `mixBlendMode` | `blendMode` |
| `layout` | `gap`, `paddingTop/Right/Bottom/Left`, `flexDirection`, `alignItems`, `justifyContent`, `flexWrap` | `layoutMode`, `itemSpacing`, `padding*`, `*AxisAlignItems`, `layoutWrap` |
| `typography` | `fontFamily`, `fontWeight`, `fontSize`, `lineHeight`, `letterSpacing`, `textAlign`, `color`, `textDecoration`, `textTransform`, `fontStyle` | First `TEXT` node found inside the Figma node (`style` object) |
| `text` | `innerText` contains the Figma text value | `characters` of the first text node |
| `overflow` | `overflow` | `clipsContent` |

**How to choose:**

1. Fetch the Figma node's properties (see [Choosing checks from Figma data](#choosing-checks-from-figma-data)).
2. Pick the strictest named constant that is fully covered by the node's data.
3. Only use a custom array when the named constants don't fit — for example, a table row that needs size + layout + typography but has no background or border.

```js
// Custom subset example
{ name: 'users-tablerow--default', checks: ['exists', 'size', 'layout', 'typography'] }
```

#### `selector`

A CSS selector used by Playwright to locate the target element within the Storybook iframe (`http://localhost:6006/iframe.html`).

| Scenario | Selector |
|---|---|
| Story renders only the component | Omit — defaults to `#storybook-root > *:visible` |
| Component has a `data-testid` | `'[data-testid="my-component"]'` |
| Table row / grid cell | `'#storybook-root table tbody tr:first-child td:nth-child(2)'` |
| Nested element inside a page story | `'[data-testid="card-header"] .title'` |

Add `data-testid` to the component's root element so the selector is stable across DOM changes:

```tsx
// In your component
<div data-testid="status-badge" className="...">
```

```js
// In contractCases
{ name: '...', checks: CHECKS_STRICT, selector: '[data-testid="status-badge"]' }
```

#### `typographySelector`

By default, the typography check reads computed styles from the **first text leaf** found inside the target element. If that heuristic picks the wrong element (e.g. a label instead of the main title), use `typographySelector` to specify an explicit CSS selector relative to the Storybook root.

```js
// Read typography from the truncated span, not the outer div
{
  name: 'users-avatarcell--default',
  checks: ['exists', 'size', 'layout', 'typography'],
  selector: '#storybook-root table tbody tr:first-child td:nth-child(1)',
  typographySelector: 'span.truncate',
}
```

Use `typographySelector` when:
- The component has multiple text elements and the first one is not the one Figma describes
- The root element has no text content itself (typography is inherited by a child)
- You want to verify a specific heading or label, not all text

---

## Story ID format

Storybook derives the story ID from the `title` and the export name:

```
title: 'Users/UserDetailDrawer'  +  export const Default
  → story ID: users-userdetaildrawer--default
```

Rules:
- Lowercase everything
- `/` → `-`
- Spaces → `-`
- Remove non-alphanumeric characters (no underscores, no dots)
- Export name appended with `--`

| Title | Export | Story ID |
|---|---|---|
| `Users/UsersPage` | `Default` | `users-userspage--default` |
| `UI/DataTable` | `Default` | `ui-datatable--default` |
| `Auth/LoginPage` | `Default` | `auth-loginpage--default` |
| `Dashboard/KPICard` | `Revenue` | `dashboard-kpicard--revenue` |

Verify with (Storybook must be running):

```bash
curl -s http://127.0.0.1:6006/index.json \
  | node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    Object.keys(d.stories || d.entries || {}).forEach(id => console.log(id));
  "
```

---

## Finding node IDs

In Figma: right-click a frame or component → **Copy link** → the URL contains `node-id=XXXX-YYYY`.  
Use `XXXX-YYYY` as the `figmaNodeId` value (hyphens, not colons).

Alternatively, use the Figma REST API to browse the file tree:

```bash
# List pages
curl -s -H "X-Figma-Token: $FIGMA_TOKEN" \
  "https://api.figma.com/v1/files/$FIGMA_FILE_KEY?depth=1" \
  | node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    d.document.children.forEach(p => console.log(p.id, p.name));
  "

# List top-level frames on a page (replace PAGE_ID)
curl -s -H "X-Figma-Token: $FIGMA_TOKEN" \
  "https://api.figma.com/v1/files/$FIGMA_FILE_KEY/nodes?ids=PAGE_ID&depth=2" \
  | node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    Object.values(d.nodes)[0].document.children
      .forEach(n => console.log(n.id, n.name, n.type));
  "
```

---

## Choosing checks from Figma data

Fetch the node's raw properties to determine which checks are applicable:

```bash
curl -s -H "X-Figma-Token: $FIGMA_TOKEN" \
  "https://api.figma.com/v1/files/$FIGMA_FILE_KEY/nodes?ids=NODE_ID" \
  | node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const n = Object.values(d.nodes)[0].document;
    console.log({
      hasFill:     (n.fills||[]).some(f => f.type!=='IMAGE' && f.opacity!==0),
      hasStroke:   (n.strokes||[]).length > 0,
      hasShadow:   (n.effects||[]).some(e => e.type==='DROP_SHADOW'),
      hasRadius:    n.cornerRadius > 0 || (n.rectangleCornerRadii||[]).some(r=>r>0),
      hasOpacity:   n.opacity != null && n.opacity !== 1,
      hasLayout:    n.layoutMode != null && n.layoutMode !== 'NONE',
      hasTypography:(n.type==='TEXT') || !!(n.children||[]).some(c=>c.type==='TEXT'),
      hasOverflow:  n.clipsContent === true,
    });
  "
```

Decision:

```
hasFill + hasRadius + hasLayout + hasTypography  →  CHECKS_STRICT
hasFill + hasRadius + hasLayout                  →  CHECKS_CONTAINER
hasFill + hasRadius                              →  CHECKS_SHAPE
hasLayout only                                   →  CHECKS_LAYOUT
subset needed                                    →  custom array
```

---

## Component & Story Guide

### 1 — Add `data-testid` to your component

Add `data-testid` to the root element and any sub-elements that map to separate Figma nodes.

**Naming:** `[feature]-[component-name]` in kebab-case.

```tsx
<div data-testid="table-card-header">
  <input data-testid="table-search" />
</div>
```

### 2 — Create a Storybook story

Place stories in a `stories/` subfolder next to the component file:

```
src/features/users/
  UsersPage.tsx
  stories/
    UsersPage.stories.tsx
```

Always declare `component` in meta. Do not use `render` without `component` — this causes story load failures in Storybook v10.

```tsx
import type { Meta, StoryObj } from '@storybook/react'
import { MyComponent } from '../MyComponent'

const meta: Meta<typeof MyComponent> = {
  title: 'Feature/MyComponent',
  component: MyComponent,           // required
}
export default meta
type Story = StoryObj<typeof MyComponent>

export const Default: Story = {
  args: { /* all required props */ },
}
```

Do not use external image URLs (picsum, via.placeholder, etc.) in mock data — Playwright's page load will time out waiting for the CDN. Use SVG data URLs instead:

```ts
const AVATAR = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="%23CBD5E1"/></svg>'
```

### 3 — Add to config

```js
cases: [
  {
    name:        'feature-mycomponent--default',
    storyId:     'feature-mycomponent--default',
    figmaNodeId: '1234-5678',
    figmaScale:  2,
    viewport:    { width: 250, height: 80 },
  },
],
contractCases: [
  {
    name:     'feature-mycomponent--default',
    checks:   CHECKS_STRICT,
    selector: '[data-testid="my-component"]',
  },
],
```

---

## AI assistant (Claude Code)

Running `npx design-contract init` installs a `/create-story` skill into `.claude/commands/`.

In Claude Code, type `/create-story` — the AI will:
- Scan the codebase for components without stories
- Browse the Figma file via API to match components to node IDs
- Add `data-testid` to the component
- Create the story file with correct providers and no external URLs
- Fetch the node's Figma properties to determine the strictest applicable `checks`
- Update `design-contract.config.mjs`
- Run TypeScript and verify the story ID before finishing
