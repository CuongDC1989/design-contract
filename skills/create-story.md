# Skill: create-story

Create React component stories wired to design-contract testing. Supports single-component and full-audit batch modes.

---

## Step 0 — Always run discovery first

Before doing anything else, read the current state:

```bash
# 1. Existing contract cases + Figma credentials
cat design-contract.config.mjs
cat .env

# 2. All component files
find src -name "*.tsx" ! -name "*.stories.tsx" ! -name "*.test.tsx"

# 3. All existing story files
find src -name "*.stories.tsx"
```

Build a mental map:
- **Mapped components**: names already in `cases[]` of the config
- **Story files**: which components already have a `.stories.tsx`
- **Gaps**: components with a story but no contract case, or components with no story at all

---

## Step 0b — Fetch Figma node tree (auto node ID discovery)

Use `FIGMA_TOKEN` and `FIGMA_FILE_KEY` from `.env` to browse the Figma file and resolve node IDs automatically — no manual copy-paste needed.

**1. Get pages in the file:**

```bash
curl -s -H "X-Figma-Token: $FIGMA_TOKEN" \
  "https://api.figma.com/v1/files/$FIGMA_FILE_KEY?depth=1" \
  | node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    d.document.children.forEach(p => console.log(p.id, p.name));
  "
```

**2. Get top-level frames on a page** (replace `PAGE_ID` with the ID from step 1):

```bash
curl -s -H "X-Figma-Token: $FIGMA_TOKEN" \
  "https://api.figma.com/v1/files/$FIGMA_FILE_KEY/nodes?ids=PAGE_ID&depth=2" \
  | node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const page = Object.values(d.nodes)[0].document;
    page.children.forEach(n => console.log(n.id, n.name, n.type));
  "
```

**3. Search children of a specific frame** (replace `FRAME_ID` to drill deeper):

```bash
curl -s -H "X-Figma-Token: $FIGMA_TOKEN" \
  "https://api.figma.com/v1/files/$FIGMA_FILE_KEY/nodes?ids=FRAME_ID&depth=3" \
  | node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    function walk(node, depth) {
      console.log(' '.repeat(depth*2) + node.id + '  ' + node.name + '  [' + node.type + ']');
      (node.children || []).forEach(c => walk(c, depth+1));
    }
    Object.values(d.nodes).forEach(n => walk(n.document, 0));
  "
```

**Matching strategy:**
- Compare Figma frame/component names to React component names (case-insensitive, ignore spaces/dashes)
- `"Users Page"` → `UsersPage`, `"KPI Card"` → `KpiCard`, `"Status Badge"` → `StatusBadge`
- When multiple Figma nodes match a component, pick the one whose parent is a Page (top-level frame) for full-page stories, or the one nested inside a frame for sub-elements
- Show the user a match table and ask for confirmation before writing to config:

```
Component         Figma node name       Node ID       Confidence
UsersPage      →  Users Page            2397-46387    ✓ high
StatusBadge    →  Status / Badge        2397-46466    ✓ high
DataTable      →  Data Grid             2397-46401    ~ medium (confirm?)
LoginPage      →  (no match found)      —             needs manual input
```

---

## Step 0c — Fetch Figma node properties to determine checks

**This is mandatory** — fetch the actual Figma node data before choosing `checks`. Do not guess based on component type alone.

```bash
# Replace NODE_ID with the target figmaNodeId (use comma-separated for multiple)
curl -s -H "X-Figma-Token: $FIGMA_TOKEN" \
  "https://api.figma.com/v1/files/$FIGMA_FILE_KEY/nodes?ids=NODE_ID" \
  | node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const node = Object.values(d.nodes)[0].document;
    const props = {
      hasFill:       (node.fills || []).some(f => f.type !== 'IMAGE' && f.opacity !== 0),
      hasStroke:     (node.strokes || []).length > 0,
      hasEffect:     (node.effects || []).some(e => e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW'),
      hasRadius:     node.cornerRadius > 0 || (node.rectangleCornerRadii || []).some(r => r > 0),
      hasOpacity:    node.opacity != null && node.opacity !== 1,
      hasBlend:      node.blendMode && node.blendMode !== 'NORMAL',
      hasLayout:     node.layoutMode != null,
      hasPadding:    node.paddingLeft > 0 || node.paddingTop > 0,
      hasGap:        node.itemSpacing > 0,
      hasText:       node.type === 'TEXT',
      hasTypography: node.style != null,
      hasOverflow:   node.clipsContent === true,
      hasSize:       node.absoluteBoundingBox != null,
      name:          node.name,
      type:          node.type,
    };
    console.log(JSON.stringify(props, null, 2));
  "
```

**Determine checks from properties:**

| Property present in Figma node | Add to checks |
|---|---|
| `hasSize` (always true for visible nodes) | `'exists'`, `'size'` |
| `hasFill` | `'background'` |
| `hasStroke` | `'border'` |
| `hasEffect` (shadow) | `'shadow'` |
| `hasRadius` | `'radius'` |
| `hasOpacity` | `'opacity'` |
| `hasBlend` | `'blend'` |
| `hasLayout` (auto-layout) | `'layout'` |
| `hasTypography` or `hasText` | `'typography'` |
| `hasOverflow` | `'overflow'` |

**Map to named check sets:**

```
All of: size + background + radius + border + shadow + opacity + layout + typography + overflow + blend
  → CHECKS_STRICT

size + background + radius + shadow + layout + overflow (no typography)
  → CHECKS_CONTAINER

size + layout only
  → CHECKS_LAYOUT

size + background + radius only
  → CHECKS_SHAPE

Anything else
  → custom array: ['exists', 'size', 'layout', 'typography']
```

**Rule:** Always choose the strictest named set that fully covers the available properties.  
A component with `hasFill + hasRadius + hasLayout + hasTypography` → `CHECKS_STRICT`, not `CHECKS_CONTAINER`.  
Never downgrade to a looser set just because the component "looks simple".

---

## Modes

### Mode A — Single component (user provides component + Figma node ID)

Jump to Step 1 below. Use when user says "create story for X with node ID Y".  
Still run Step 0c to determine checks before writing config.

### Mode B — Batch audit (user says "wire up all" or "check what's missing")

1. Run discovery (Step 0)
2. Print a gap report to the user:

```
## Audit report

### Components with no story
- src/components/ui/Badge.tsx
- src/features/auth/LoginPage.tsx

### Stories with no contract case
- src/features/users/stories/AvatarCell.stories.tsx  →  story ID: users-avatarcell--default

### Already fully wired (story + contract case)
- UsersPage ✓
- StatusBadge ✓
- PlanBadge ✓
```

3. Ask the user: "Which components should I wire up? I'll need the Figma node ID for each."
4. For each confirmed component+nodeId pair, run Steps 0c → 1 → 2 → 3 → 4 in sequence.
5. After all components are done, run Step 5 (verify).

---

## Step 1 — Add `data-testid` to the component

Open the component file. Add `data-testid` to the **root element** and any key sub-elements that map to separate Figma nodes.

**Naming convention:** `[feature]-[component-name]` in kebab-case.

```tsx
<div data-testid="table-card-header" ...>
  <input data-testid="table-search" ... />
</div>
```

**Rules:**
- Root element of a standalone component → `[feature]-[component-name]`
- Sub-element inside a page that maps to its own Figma node → `[feature]-[element-name]`
- Table rows/cells → no testid needed, use CSS path selector in config instead
- Only add testids to what design-contract needs to locate

**Check first:** If the component already has the correct `data-testid`, skip this step.

---

## Step 2 — Create the Storybook story file

**Check first:** If a `.stories.tsx` already exists for this component, read it and check if it needs a new export (variant). If it's already correct, skip to Step 3.

**File location:** Colocate with the component in a `stories/` subfolder.
- `src/features/users/UsersPage.tsx` → `src/features/users/stories/UsersPage.stories.tsx`
- `src/components/ui/Badge.tsx` → `src/components/ui/stories/Badge.stories.tsx`

**Story ID format:** `[feature]-[componentname]--[variant]`
- Title `Users/UsersPage` → story ID `users-userspage--default`
- Title `UI/DataTable` → story ID `ui-datatable--default`

### ⚠️ Critical rules — these cause "story failed to load" if violated

**Rule 1: Always declare `component` in meta.**  
Using `render` without `component` in meta causes Storybook v10 to fail loading the story.

```tsx
// ✅ CORRECT
const meta: Meta<typeof ComponentName> = {
  title: 'Feature/ComponentName',
  component: ComponentName,          // required
}
export const Default: Story = {
  args: { prop: value },
}

// ❌ WRONG — story will fail to load
const meta: Meta = {
  title: 'Feature/ComponentName',    // no component field
}
export const Default: Story = {
  render: () => <ComponentName />,   // render without component → FAIL
}
```

**Rule 2: Never use external image URLs in mock data.**  
Images from `https://picsum.photos`, `https://via.placeholder.com`, or any external CDN will cause `networkidle` timeout. Use inline SVG data URLs instead.

```tsx
// ✅ CORRECT — no network requests
const PLACEHOLDER_AVATAR = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="%23e2e8f0"/></svg>'

// ❌ WRONG — will hang networkidle
avatar: 'https://picsum.photos/seed/user-1/64/64'
```

If the component being tested itself renders external images (e.g. user avatars from a CMS), add `parameters: { chromatic: { disableSnapshot: true } }` — but more importantly, ensure mock data passed in `args` uses placeholder SVG URLs or empty strings, not CDN URLs.

**Rule 3: Wrap with required providers in `decorators`, not in `render`.**  
If the component uses `useNavigate`, `useParams`, TanStack Query, or any React context, wrap in `decorators`.

```tsx
// ✅ CORRECT
decorators: [
  (Story) => (
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <Story />
      </QueryClientProvider>
    </MemoryRouter>
  ),
],
```

**Rule 4: All imports must resolve.**  
Read the component source and trace every import. If the component imports from `@/lib/api` or similar path aliases, verify the alias is configured in `.storybook/main.ts`. If any import is unresolvable, the entire module graph fails to compile.

**Rule 5: Provide all required props in `args`.**  
Do not leave required props undefined. TypeScript may not catch this at story level. A component that crashes on mount (e.g., `cannot read property of undefined`) causes story load failure.

```tsx
// ✅ All required props present
export const Default: Story = {
  args: {
    user: mockUser,  // required
    open: true,      // required
    onClose: () => {},  // required
  },
}
```

**Rule 6: Mock data cannot reference external URLs.**  
Any file the story module imports — including mock data files in the same directory — must not contain CDN/external image URLs. Replace with SVG data URLs or empty strings.

---

### Templates

**Atomic component:**

```tsx
import type { Meta, StoryObj } from '@storybook/react'
import { ComponentName } from '../ComponentName'

const meta: Meta<typeof ComponentName> = {
  title: 'Feature/ComponentName',
  component: ComponentName,
}
export default meta
type Story = StoryObj<typeof ComponentName>

export const Default: Story = {
  args: {
    // all required props
  },
}
```

**Page / container with providers:**

```tsx
import type { Meta, StoryObj } from '@storybook/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ComponentName } from '../ComponentName'

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

const meta: Meta<typeof ComponentName> = {
  title: 'Feature/ComponentName',
  component: ComponentName,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <Story />
        </MemoryRouter>
      </QueryClientProvider>
    ),
  ],
}
export default meta
type Story = StoryObj<typeof ComponentName>

export const Default: Story = {
  args: {},
}
```

**Component with local mock data (no external URLs):**

```tsx
const AVATAR_PLACEHOLDER = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="%23CBD5E1"/><text x="32" y="40" text-anchor="middle" fill="%23475569" font-size="24" font-family="sans-serif">U</text></svg>'

const mockUser = {
  id: 1,
  name: 'Anaka Haruto',
  avatar: AVATAR_PLACEHOLDER,   // ✅ not a CDN URL
  email: 'anaka@example.com',
}
```

---

## Step 3 — Choose config values

**`figmaScale`:**
| Component type | figmaScale |
|---|---|
| Full page / large layout | `1` |
| Medium container (card, panel) | `1` |
| Small component (badge, avatar, input, row) | `2` |

**`viewport`:**
| Component type | viewport |
|---|---|
| Full page | `{ width: 1200, height: 900 }` |
| Isolated small component | match natural size, e.g. `{ width: 250, height: 80 }` |

**`checks`** — determined by Step 0c Figma node properties, not by assumption:

| Named set | Includes |
|---|---|
| `CHECKS_STRICT` | exists, size, radius, background, border, shadow, opacity, layout, typography, text, overflow, blend |
| `CHECKS_CONTAINER` | exists, size, radius, background, shadow, layout, overflow |
| `CHECKS_LAYOUT` | exists, size, layout |
| `CHECKS_SHAPE` | exists, size, radius, background |

Default: if the Figma node has **both** visual (fill/border/shadow/radius) **and** layout (padding/gap) properties, use `CHECKS_STRICT`.  
Only use `CHECKS_LAYOUT` when the node has no fill, no border, and no radius set.

**`selector`:**
- Whole story (full page): omit selector
- Specific element: `'[data-testid="my-component"]'`
- Table cell: `'#storybook-root table tbody tr:first-child td:nth-child(2)'`
- Extra typography target: add `typographySelector: 'span.truncate'`

**`typographySelector`:**  
Add when the component's typography is not on its root element. Point to the most representative text leaf:
- A card with a title → `typographySelector: 'h2'`
- A table cell with truncated text → `typographySelector: 'span.truncate'`
- A badge with label text → `typographySelector: 'span'`

---

## Step 3b — Page / Screen: Maximizing CSS Coverage

**The problem with page root testing:** A Figma page/screen root frame typically has no fills, no `layoutMode`, and no direct text children → `background`, `layout`, `typography` checks all get skipped silently. Simply adding `CHECKS_STRICT` to the page root won't help if the Figma node has nothing to check.

**The fix:** Test each **section** within the page as a separate contract case.

### Three-level strategy

| Level | What | checks | selector |
|---|---|---|---|
| Page root | Background color, overflow, size | `['exists','size','background','overflow']` | `[data-testid="page-root"]` or omit |
| Each section (header, hero, sidebar, content) | Full CSS: bg, layout, radius, shadow, typography | `CHECKS_STRICT` or `CHECKS_CONTAINER` | `[data-testid="section-hero"]` |
| Isolated text block (hero title, nav label) | Typography only | `['exists','typography','text']` | `[data-testid="hero-title"]` |

**Never use `['exists','size']` for a page.** If you only see 2 checks in the report, you're missing coverage.

### Getting section node IDs from Figma

```bash
source .env
curl -s -H "X-Figma-Token: $FIGMA_TOKEN" \
  "https://api.figma.com/v1/files/$FIGMA_FILE_KEY/nodes?ids=PAGE_NODE_ID" \
  | node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const page = Object.values(d.nodes)[0].document;
    (page.children || []).forEach(child => {
      console.log(child.id.replace(':','-'), '\t', child.name, '\t', child.type);
    });
  "
```

Each line is one section: node ID + name. Use those IDs in `cases[].figmaNodeId`.

### Config pattern for a page with sections

```js
// cases[] — one entry per section Figma node, all sharing the same storyId
{ name: 'landing-hero',     storyId: 'landing-page--default', figmaNodeId: 'HERO_NODE_ID', figmaScale: 1, viewport: { width: 1440, height: 860 } },
{ name: 'landing-features', storyId: 'landing-page--default', figmaNodeId: 'FEAT_NODE_ID', figmaScale: 1, viewport: { width: 1440, height: 860 } },
{ name: 'landing-cta',      storyId: 'landing-page--default', figmaNodeId: 'CTA_NODE_ID',  figmaScale: 1, viewport: { width: 1440, height: 860 } },

// contractCases[] — each selector targets its section in the rendered story
{ name: 'landing-hero',     checks: CHECKS_STRICT,    selector: '[data-testid="hero-section"]',     typographySelector: 'h1' },
{ name: 'landing-features', checks: CHECKS_CONTAINER, selector: '[data-testid="features-section"]' },
{ name: 'landing-cta',      checks: CHECKS_STRICT,    selector: '[data-testid="cta-section"]',      typographySelector: 'h2' },
```

### `typographySelector` for sections

Without `typographySelector`, the engine finds the first text leaf in the section (may be a badge, nav link, or caption — not the heading). Use `typographySelector` to pin the typography check to the right element.

```js
// ❌ May pick up a nav label or badge inside hero
{ name: 'landing-hero', checks: CHECKS_STRICT, selector: '[data-testid="hero-section"]' }

// ✅ Always measures the h1 typography
{ name: 'landing-hero', checks: CHECKS_STRICT, selector: '[data-testid="hero-section"]', typographySelector: 'h1' }
```

Figma side: `extractNodeSpec()` uses `firstTextNode()` from the section's Figma node tree — typically the first heading. This aligns with `typographySelector: 'h1'`.

### Shadow checks (detailed)

When the `shadow` check runs, it now verifies 4 properties — not just presence:

| Property | What is checked |
|---|---|
| `boxShadow` | Shadow present or none |
| `shadowOffsetX` | CSS x-offset vs Figma `offset.x` (±2px tolerance) |
| `shadowOffsetY` | CSS y-offset vs Figma `offset.y` (±2px tolerance) |
| `shadowBlur` | CSS blur-radius vs Figma `radius` (±3px tolerance) |
| `shadowColor` | CSS shadow color vs Figma drop shadow color |

No config change needed — this is automatic when `'shadow'` is in `checks`.

---

## Step 4 — Update `design-contract.config.mjs` AND `design-spec.json`

**⚠️ CRITICAL: Always update BOTH files.** The test runner reads from `design-spec.json` at runtime, NOT from `design-contract.config.mjs`. The config is the human-readable source; the spec is the cached snapshot used by tests. They must stay in sync.

**Check first:** Read the current config. If this component's `name` already exists in `cases[]` or `contractCases[]`, update the existing entry rather than adding a duplicate.

Add one entry to `cases[]` and one to `contractCases[]` in the config:

```js
// cases[]
{ name: 'feature-component--variant', storyId: 'feature-component--variant', figmaNodeId: 'XXXX-XXXX', figmaScale: 1, viewport: { width: 1200, height: 900 } },

// contractCases[]
{ name: 'feature-component--variant', checks: CHECKS_STRICT, selector: '[data-testid="component"]' },
```

Then apply the same `checks` change to `design-spec.json` — find the entry by name and update its `checks` array to match:

```bash
# Verify both files agree on checks
node -e "
  const spec = JSON.parse(require('fs').readFileSync('design-spec.json','utf8'));
  const name = 'feature-component--variant';
  console.log(spec.specs[name]?.checks);
"
```

For a sub-element tested inside a parent page story:
```js
// cases[] — parent story captures the viewport, Figma node is the sub-node
{ name: 'feature-element--default', storyId: 'feature-parentpage--default', figmaNodeId: 'XXXX-XXXX', figmaScale: 1, viewport: { width: 1200, height: 900 } },

// contractCases[] — selector finds the element within the parent story
{ name: 'feature-element--default', checks: CHECKS_STRICT, selector: '[data-testid="element"]' },
```

---

## Step 5 — Verify before declaring done

Run all of these. Do not skip any.

### 5a — TypeScript check

```bash
npx tsc --noEmit
```

Fix any errors before continuing. A TypeScript error in a story file prevents the entire Storybook module graph from compiling.

### 5b — Verify story ID is correct

The story ID Storybook generates from a `title` must exactly match the `storyId` in config.

Formula: lowercase the title, replace `/` with `-`, replace spaces with `-`, keep letters and digits only, then append `--` + lowercase export name.

```
title: 'Users/UserDetailDrawer'  →  prefix: users-userdetaildrawer
export const Default             →  variant: default
storyId: 'users-userdetaildrawer--default'   ✓
```

Common mistakes:
- Camel case in title not fully lowercased → `UserDetail` becomes `userdetail` not `user-detail`
- Extra spaces in title creating double hyphens
- Export name with uppercase → always lowercase it in the storyId

Verify with:
```bash
# List all current story IDs Storybook knows about (requires Storybook running)
curl -s http://127.0.0.1:6006/index.json | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  Object.keys(d.stories || d.entries || {}).forEach(id => console.log(id));
" | grep 'users-userdetail'
```

### 5c — Check for external URLs in mock data

```bash
# Scan story and imported mock files for external image URLs
grep -r "picsum\|placeholder.com\|via\.placeholder\|cloudinary\|imgur\|unsplash" \
  src --include="*.tsx" --include="*.ts" -l
```

If any file is flagged, replace those URLs with SVG data URLs before running the test.

### 5d — Remind user

After all checks pass:
- Open Storybook (`npm run storybook`) and visually verify each new story renders without errors
- Run `npm run test:design` after Storybook is running

---

## Troubleshooting failing tests

### Rule: fix component code, not checks

When a test fails, the default action is to **fix the component to match Figma**, not to reduce `checks`. Reducing checks means the test passes but the bug survives. Only reduce or skip a check when the mismatch is fundamentally incomparable — see valid exceptions below.

**Valid reasons to skip or reduce a check:**

| Situation | Action |
|---|---|
| Figma node is a **wrapper frame** with null background/radius (no fill, no border) but the React component root has those properties | Remove `'background'` / `'radius'` — the checks compare the wrong layer |
| Component has **dynamic/content-dependent width** (pagination controls, dynamic lists) | Skip `'size'` — width will never reliably match a Figma static snapshot |
| Figma node is a **full-page frame** root with no fills/layout | Reduce to `['exists','size','background','overflow']` for the root only — test each section separately with `CHECKS_STRICT` |
| A `<tr>` element uses **table layout, not flex** | Skip `'layout'` (alignItems/gap don't apply to table rows) |

**Invalid reasons to reduce checks:**
- "The test is hard to fix" → fix the component instead
- "The difference is small" → fix it
- "The component looks right visually" → Figma is the source of truth

---

### Figma wrapper frame pitfall

When `figmaNodeId` points to a wrapper frame (e.g., `"Frame 7002"`) that has `backgroundColorRgba: null`, `cornerRadius: null`, `layout: null` — but your React selector points to the rendered component root (a `<span>` with background and border-radius) — the checks must be based on the **Figma node's actual properties**, not what the React element looks like.

Check Figma node properties first (Step 0c) before deciding checks. If the Figma node has null for a property, do **not** include that check — even if the DOM element has that property set.

---

### CSS table-layout:fixed column width precision

In Chrome, `table-layout: fixed` distributes **excess** table width proportionally across ALL columns — including columns that already have an explicit `size`. This means columns don't get exactly their declared widths unless ALL column sizes sum exactly to the table width.

**Rule:** Give every column an explicit `size`. Make the total exactly equal to the table's render width.

```
Table render width = viewport width - story container padding
                   = 1200 - 2×16px (Storybook p-4) = 1168px

Column sizes must sum to 1168px:
  name(165) + email(165) + phone(166) + ... = 1168  ✓
```

If any column is left without a `size`, Chrome distributes excess to all columns and none get exact widths.

---

### inline-flex badge wrapping in table cells

`inline-flex` elements inherit `line-height` from their parent `<td>`. If the td has a large line-height (e.g., `leading-[22px]`) and the badge content is wide relative to the column, the badge may wrap to 2 lines and blow up the row height.

Fix: add `whitespace-nowrap` and an explicit `leading-[Xpx]` on the badge span so it doesn't depend on the inherited line-height.

---

## Quick reference — naming patterns from this project

| Component | storyId | figmaScale | checks | selector |
|---|---|---|---|---|
| Page root frame | `users-userspage--default` | 1 | `['exists','size','background','overflow']` | `[data-testid="page-root"]` |
| Page section (with bg + layout) | `users-userspage--default` | 1 | `CHECKS_CONTAINER` | `[data-testid="section-header"]` |
| Page section (with typography) | `users-userspage--default` | 1 | `CHECKS_STRICT` | `[data-testid="section-hero"]` + `typographySelector: 'h1'` |
| Card header (in page) | `users-userspage--default` | 1 | `CHECKS_CONTAINER` | `[data-testid="table-card-header"]` |
| Search input (in page) | `users-userspage--default` | 2 | `CHECKS_STRICT` | `[data-testid="table-search"]` |
| Status badge (standalone) | `users-statusbadge--active` | 2 | `CHECKS_STRICT` | _(story is the component)_ |
| Table cell | `users-userspage--default` | 2 | `['exists','size','layout','typography']` | `#storybook-root table tbody tr:first-child td:nth-child(1)` |
