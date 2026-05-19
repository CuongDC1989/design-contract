# Skill: figma-to-story

Create React component stories wired to design-contract testing. Supports single-component and full-audit batch modes.

---

## Execution Rules

**Think before editing** — Before touching any file (component, story, config), state what changes and why. One sentence. If unclear, ask.

**Scope = this component only** — Adding a story for `LoginCard` means touching `LoginCard.stories.tsx`, `LoginCard.tsx` (testid only if missing), and `design-check.config.mjs`. Nothing else.

**Surgical testid placement** — Add `data-testid` only where needed for design-check. Do not reorganize the component, rename props, or fix other issues noticed while reading the file.

**No assumptions** — Figma node ID not provided? Ask. Component has no clear root element? Ask. Do not pick a node ID by guessing from the Figma URL structure.

**Config changes are additive** — Only append to `cases[]` and `contractCases[]`. Never reformat, reorder, or touch existing entries.

---

## Pre-flight — Ensure `.claude/settings.json` exists

Before running any steps, check that `.claude/settings.json` is present with the required permissions. Without it, every `npm`, `curl`, and `Read` call will prompt for manual confirmation.

```bash
cat .claude/settings.json 2>/dev/null || echo "MISSING"
```

If missing, create it now:

```json
{
  "permissions": {
    "allow": [
      "Bash(npm run *)",
      "Bash(npm *)",
      "Bash(npx *)",
      "Bash(curl -s * https://api.figma.com/*)",
      "Bash(curl -s -H * https://api.figma.com/*)",
      "Bash(curl -s http://127.0.0.1:*)",
      "Bash(curl -s * http://127.0.0.1:*)",
      "Bash(node -e *)",
      "Bash(cat *)",
      "Bash(find . *)",
      "Bash(grep *)",
      "Read(**)"
    ]
  }
}
```

These rules cover:
- `npm run *` / `npm *` / `npx *` — running build, test, storybook, and figma:spec scripts
- `curl * https://api.figma.com/*` — fetching Figma node trees and properties (Steps 0b, 0c)
- `curl * http://127.0.0.1:*` — reading Storybook's `/index.json` and story iframes (Step 5b)
- `node -e *` — inline JSON parsing of Figma API responses
- `cat *` / `find . *` / `grep *` — discovery and config inspection (Step 0)
- `Read(**)` — reading all project files without prompting

Once the file exists, all of the above run without confirmation prompts for the rest of the session.

---

## Step 0 — Always run discovery first

Before doing anything else, read the current state:

```bash
# 1. Existing contract cases + Figma credentials
cat design-check.config.mjs
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

### ⚠️ Bidirectional checks — reverse verification

Every check type now runs in **both directions**. When a check is included in `checks[]`, the engine verifies:

| Figma has property | Browser has property | Result |
|---|---|---|
| ✅ yes | ✅ yes, matches | **PASS** |
| ✅ yes | ❌ no / mismatch | **FAIL** — missing from browser |
| ❌ no | ❌ no | **PASS** |
| ❌ no | ✅ yes | **FAIL** — browser has extra property Figma doesn't |

This means **including a check type catches both missing AND extra properties**. For example, including `'shadow'` will:
- Catch if browser is missing a shadow Figma has (forward)
- Catch if browser has a shadow Figma doesn't have (reverse)

**Practical implication when choosing checks:** Even if the Figma node has NO shadow/border/background, you should still include those checks if you want to guarantee the browser also has none. Use this to prevent accidental CSS leaking in from parent styles or Tailwind defaults.

| You want to guarantee | Include in checks |
|---|---|
| Component has no `box-shadow` | `'shadow'` |
| Component has no `border` | `'border'` |
| Component has no fill / transparent background | `'background'` |
| Component has no `border-radius` | `'radius'` |

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

**⚠️ Testid must be on the element that OWNS the CSS — not a wrapper.**  
The `data-testid` must be placed on the SAME element that carries the visual and layout CSS properties Figma will check. Placing it on a wrapper `div.relative` or `div.shrink-0` that has no flex/padding/background will cause every layout check to fail (`gap=normal`, `padding=0`, `alignItems=normal`, etc.).

```tsx
// ❌ WRONG — testid on outer wrapper, layout properties on inner div
<div data-testid="nav-menu" className="relative">
  <div className="flex gap-[24px] items-center">...</div>  {/* ← gap/alignItems are HERE */}
</div>

// ✅ CORRECT — testid on the element that actually has the layout
<div className="relative">
  <div data-testid="nav-menu" className="flex gap-[24px] items-center">...</div>
</div>
```

When flattening is possible (outer wrapper exists only for relative positioning), collapse both divs into one and put testid + visual CSS on the single element.

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

**Rule 0: Never use inline `<style>` tags inside React components (React 19).**  
React 19 hoists `<style>` tags from component bodies to `<document.head>`. This breaks Storybook story loading because the hoisting mechanism behaves differently inside Storybook's iframe context, causing the story to hang or throw.

```tsx
// ❌ WRONG — causes "story failed to load" in React 19 + Storybook
function MyComponent() {
  return (
    <div>
      <style>{`@keyframes slideIn { from { opacity: 0 } to { opacity: 1 } }`}</style>
      ...
    </div>
  )
}

// ✅ CORRECT — define keyframes in globals.css and use a CSS class
// In globals.css:
// @keyframes slideIn { from { opacity: 0; } to { opacity: 1; } }
// .animate-slide-in { animation: slideIn 0.25s ease-out; }

function MyComponent() {
  return (
    <div>
      <div className="animate-slide-in">...</div>
    </div>
  )
}
```

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

## Step 4 — Update `design-check.config.mjs` AND `design-spec.json`

**⚠️ CRITICAL: Always update BOTH files.** The test runner reads from `design-spec.json` at runtime, NOT from `design-check.config.mjs`. The config is the human-readable source; the spec is the cached snapshot used by tests. They must stay in sync.

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

Formula: lowercase the title, replace `/` with `-`, replace spaces with `-`, keep letters and digits only, then append `--` + lowercased export name (with hyphens inserted before digit sequences).

```
title: 'Users/UserDetailDrawer'  →  prefix: users-userdetaildrawer
export const Default             →  variant: default
storyId: 'users-userdetaildrawer--default'   ✓

title: 'Onboarding/OnboardingFlow'  →  prefix: onboarding-onboardingflow
export const Step1                  →  variant: step-1   (NOT step1 — v10 inserts hyphen before digits)
storyId: 'onboarding-onboardingflow--step-1'   ✓
```

Common mistakes:
- Camel case in title not fully lowercased → `UserDetail` becomes `userdetail` not `user-detail`
- Extra spaces in title creating double hyphens
- Export name with uppercase → always lowercase it in the storyId
- **Export name with digits** → Storybook v10 inserts a hyphen before digit sequences: `Step1` → `step-1`, `Tab2` → `tab-2`. Always verify with the curl command below.

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

### `drop-shadow` vs `box-shadow` — shadow check will always fail with `drop-shadow-*`

Tailwind's `drop-shadow-[...]` generates `filter: drop-shadow(...)` — a CSS filter, **not** `box-shadow`. The design-contract `shadow` check exclusively reads the `box-shadow` CSS property. If you use `drop-shadow`, the check reports `boxShadow: none` even when a visible shadow exists.

```tsx
// ❌ WRONG — generates filter:drop-shadow(...), shadow check sees "none"
className="drop-shadow-[0px_12px_12px_rgba(145,158,171,0.12)]"

// ✅ CORRECT — generates box-shadow, shadow check works
className="shadow-[0px_12px_12px_rgba(145,158,171,0.12)]"
```

**Rule:** When Figma has `effects: [DROP_SHADOW]` on a node, always use Tailwind `shadow-*` utilities (not `drop-shadow-*`) on the corresponding React element.

---

### `aria-hidden` border overlay — border check always fails

Some components simulate borders with an absolutely-positioned `aria-hidden` child div to avoid CSS border affecting layout box size. This means the testid element itself has no `border-color` → design-contract reads `rgb(0,0,0)` (default).

```tsx
// ❌ Border is on a child, not the testid element → borderColor check fails
<div data-testid="my-component" className="relative">
  <div aria-hidden="true" className="absolute border border-border inset-0 pointer-events-none" />
  ...
</div>

// ✅ Border directly on testid element → borderColor check passes
<div data-testid="my-component" className="border border-border relative">
  ...
</div>
```

If the overlay pattern is intentional and cannot be changed, remove `'border'` from `checks` for that contract case.

---

### Typography check picks wrong text node — use `typographySelector`

The `typography` check auto-selects the **first text descendant** of the selector element. For components with a visible text node (e.g., a "Send" button) that appears before the primary text target (e.g., an `<input>` placeholder), the check reads the wrong element's font styles.

```js
// ❌ Typography check finds "Send" button text (font-bold, white, center-aligned)
{ name: 'chat-chatinput--default', checks: CHECKS_STRICT, selector: '[data-testid="chat-input"]' }

// ✅ Explicitly target the input for font metrics; exclude 'text' since placeholder ≠ innerText
{ name: 'chat-chatinput--default',
  checks: ['exists','size','background','border','shadow','radius','layout','typography'],
  selector: '[data-testid="chat-input"]',
  typographySelector: 'input' }
```

**Note:** `<input>` placeholder text lives in the `::placeholder` pseudo-element — it is NOT part of `innerText`. Never include `'text'` in `checks` for an input whose "text" in Figma is placeholder copy.

---

### Story decorator padding shrinks rendered width

A decorator with `padding: '16px'` reduces the available width for the component. If the Figma frame expects 448px but the decorator is `{ width: '448px', padding: '16px' }`, the component renders at 416px (448 - 32).

```tsx
// ❌ Decorator padding shrinks content to 416px — size check fails vs 448px Figma frame
decorators: [(Story) => <div style={{ width: '448px', padding: '16px' }}><Story /></div>]

// ✅ No padding on the decorator — component fills all 448px
decorators: [(Story) => <div style={{ width: '448px' }}><Story /></div>]
```

Storybook's own `layout: 'padded'` already adds canvas-level padding. Decorator containers should match the Figma frame width exactly with no additional padding.

---

### `flex-1 min-h-0` components collapse in Storybook without a flex parent

`flex-1` only grows when the element is inside a flex container. In Storybook's `fullscreen` layout the `#storybook-root` is a block element by default — `flex-1` has no effect and the component renders at content height (e.g., 102px instead of 900px).

For components that are designed to fill the full viewport (loading screens, full-page layouts), use `min-h-screen` instead of `flex-1 min-h-0` OR add a decorator that provides an explicit height with `display: flex`:

```tsx
// ✅ Option A: component uses min-h-screen
<div data-testid="loading-screen" className="min-h-screen overflow-hidden rounded-[16px] ...">

// ✅ Option B: story decorator provides flex context
decorators: [(Story) => <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}><Story /></div>]
```

---

### `size` check fails for content-width or content-height components

Some components have width determined by their text content (nav menus, pagination controls) or height determined by mock data quantity. Their rendered size will never reliably match a static Figma frame.

Use `['exists', 'layout']` instead of `CHECKS_LAYOUT` (which includes `'size'`) for:
- Components whose width is text-content-driven (nav items, tag lists, pagination dots)
- Page-level stories where story renders full scrollable height but Figma shows a viewport-clipped frame height
- Any component where Figma dimension ≠ actual render and the difference is structural (not a CSS bug)

```js
// ❌ size check fails because Figma frame width = full row (912px), component is content-width
{ name: 'home-pagination--default', checks: CHECKS_LAYOUT, selector: '[data-testid="pagination"]' }

// ✅ skip size, still catch layout (gap, flex-direction, alignItems)
{ name: 'home-pagination--default', checks: ['exists', 'layout'], selector: '[data-testid="pagination"]' }
```

---

### Storybook v10 story IDs for numbered export names contain hyphens

In Storybook v10, the ID generator inserts a hyphen before digit sequences when it lowercases PascalCase export names. `Step1` → `step-1`, `Step2` → `step-2`. Older Storybook produced `step1`.

This means `storyId: 'onboarding-onboardingflow--step1'` will silently fail to load — the real ID is `step-1`.

**Always verify actual story IDs before writing config:**
```bash
curl -s http://127.0.0.1:6006/index.json | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  Object.values(d.entries || {}).forEach(s => console.log(s.id));
" | grep 'yourcomponent'
```

This is already covered by Step 5b's "Verify story ID is correct" step — but this specific hyphen-before-digit behavior is easy to miss because the formula appears to work (`step1` looks valid) yet the ID doesn't exist.

---

### `overflow-clip` ≠ `overflow-hidden` — Figma `clipsContent` maps to `hidden`

Tailwind `overflow-clip` generates `overflow: clip` (CSS Overflow Level 3). Figma's `clipsContent: true` is represented by design-contract as `overflow: hidden`. These are different CSS values — `overflow: clip` fails the `overflow` check even though both visually clip the content.

```tsx
// ❌ WRONG — generates overflow:clip, overflow check fails against Figma clipsContent=true
className="overflow-clip ..."

// ✅ CORRECT — generates overflow:hidden, matches Figma clipsContent=true
className="overflow-hidden ..."
```

**Rule:** Whenever `hasOverflow: true` from Step 0c (Figma `clipsContent === true`), use `overflow-hidden`.

---

### Tailwind v4 `shadow-[...]` may not be readable by `getComputedStyle` — use inline style

In Tailwind v4, arbitrary shadow utilities (`shadow-[...]`) are implemented via CSS custom properties (`--tw-shadow`). When `getComputedStyle(el).boxShadow` is called (as the `shadow` check does), browsers sometimes return the variable chain (`0 0 #0000, 0 0 #0000, 0 0 #0000`) rather than the resolved shadow values, causing the check to see `offsetY=0, blur=0` even though a shadow is visually rendered.

```tsx
// ❌ May fail shadow check — Tailwind v4 uses --tw-shadow variable
className="shadow-[0px_12px_24px_rgba(145,158,171,0.12)]"

// ✅ Inline style bypasses variable abstraction — shadow check reads actual value
style={{ boxShadow: '0px 12px 24px rgba(145, 158, 171, 0.12)' }}
```

**Rule:** When a component must pass the `shadow` check AND uses Tailwind v4, apply box-shadow as an inline `style` prop rather than a Tailwind arbitrary class.

---

### Two-level Figma frame: outer container + inner layout frame

Figma components often have a two-level structure:
- **Outer frame**: visual container — has `background`, `cornerRadius`, `clipsContent` — but **no auto-layout** (gap=0, padding=0)
- **Inner frame**: layout shell — has `layoutMode`, `gap`, `paddingTop/Bottom/Left/Right`

A single testid can only target one level. The bidirectional layout check makes both choices fail if the wrong level is picked:

| Testid placement | Layout check result |
|---|---|
| Outer element (no CSS gap/padding), but Figma inner node selected | browser=0, Figma=32 → **FAIL** (was missing) |
| Merged/inner element (gap=32, padding=32/24), but Figma outer frame selected | browser=32, Figma=0 → **FAIL** (extra in browser) |

**Correct strategy:**
1. Put testid on the **outer** element — match Figma outer frame node ID
2. Use custom checks limited to what the outer frame **actually has**: `['exists', 'background', 'radius', 'overflow']`
3. Do NOT include `'layout'` or `'size'` — the outer frame has no auto-layout and its height is viewport-dependent
4. If layout verification matters, add a second testid on the inner element mapped to the Figma inner frame node ID as a separate contract case

```tsx
// Outer element: testid + visual container props only (no gap/padding)
<div data-testid="onboarding-flow" className="bg-background flex flex-col overflow-hidden rounded-[16px] size-full">
  {/* Inner element: owns the layout — no testid needed unless testing separately */}
  <div className="flex flex-col items-center justify-between gap-[32px] py-[32px] px-[24px] size-full">
    ...
  </div>
</div>
```

```js
// Config: outer frame checks only
{ name: 'onboarding-flow--step1', checks: ['exists', 'background', 'radius', 'overflow'], selector: '[data-testid="onboarding-flow"]' }
```

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
| Page root frame (has fills+radius+overflow, no layout) | `users-userspage--default` | 1 | `['exists','background','radius','overflow']` | `[data-testid="page-root"]` |
| Full-screen outer container (two-level: outer=visual, inner=layout) | `feature-component--step-1` | 1 | `['exists','background','radius','overflow']` | `[data-testid="outer-container"]` |
| Page section (with bg + layout) | `users-userspage--default` | 1 | `CHECKS_CONTAINER` | `[data-testid="section-header"]` |
| Page section (with typography) | `users-userspage--default` | 1 | `CHECKS_STRICT` | `[data-testid="section-hero"]` + `typographySelector: 'h1'` |
| Card header (in page) | `users-userspage--default` | 1 | `CHECKS_CONTAINER` | `[data-testid="table-card-header"]` |
| Search input (in page) | `users-userspage--default` | 2 | `CHECKS_STRICT` | `[data-testid="table-search"]` |
| Status badge (standalone) | `users-statusbadge--active` | 2 | `CHECKS_STRICT` | _(story is the component)_ |
| Table cell | `users-userspage--default` | 2 | `['exists','size','layout','typography']` | `#storybook-root table tbody tr:first-child td:nth-child(1)` |
