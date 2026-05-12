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

## Modes

### Mode A — Single component (user provides component + Figma node ID)

Jump to Step 1 below. Use when user says "create story for X with node ID Y".

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
4. For each confirmed component+nodeId pair, run Steps 1–4 below in sequence.
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

**Template for atomic components (CSF3):**

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
    // fill from component props
  },
}
```

**Template for generic/page components** — always use `component` + `args`, NOT `render`. Using `render` without `component` causes "story failed to load" in Storybook v10:

```tsx
import type { Meta, StoryObj } from '@storybook/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ComponentName } from '../ComponentName'

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

const meta: Meta<typeof ComponentName> = {
  title: 'Feature/ComponentName',
  component: ComponentName,
  parameters: {
    layout: 'fullscreen',
  },
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
  args: {
    // fill props here
  },
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

**`checks`:**
| Component type | checks |
|---|---|
| Full page layout | `CHECKS_LAYOUT` |
| Container with background/border/shadow | `CHECKS_CONTAINER` |
| Atomic component (all properties) | `CHECKS_STRICT` |
| Custom subset | `['exists', 'size', 'layout', 'typography']` |

**`selector`:**
- Whole story (full page): omit selector
- Specific element: `'[data-testid="my-component"]'`
- Table cell: `'#storybook-root table tbody tr:first-child td:nth-child(2)'`
- Extra typography target: add `typographySelector: 'span.truncate'`

---

## Step 4 — Update `design-contract.config.mjs`

**Check first:** Read the current config. If this component's `name` already exists in `cases[]` or `contractCases[]`, update the existing entry rather than adding a duplicate.

Add one entry to `cases[]` and one to `contractCases[]`:

```js
// cases[]
{ name: 'feature-component--variant', storyId: 'feature-component--variant', figmaNodeId: 'XXXX-XXXX', figmaScale: 1, viewport: { width: 1200, height: 900 } },

// contractCases[]
{ name: 'feature-component--variant', checks: CHECKS_LAYOUT, selector: '[data-testid="component"]' },
```

For a sub-element tested inside a parent page story:
```js
// cases[] — parent story captures the viewport, Figma node is the sub-node
{ name: 'feature-element--default', storyId: 'feature-parentpage--default', figmaNodeId: 'XXXX-XXXX', figmaScale: 1, viewport: { width: 1200, height: 900 } },

// contractCases[] — selector finds the element within the parent story
{ name: 'feature-element--default', checks: CHECKS_CONTAINER, selector: '[data-testid="element"]' },
```

---

## Step 5 — Verify

After all stories are created:

1. Check TypeScript compiles: `npx tsc --noEmit`
2. Remind the user to:
   - Open Storybook (`npm run storybook`) and verify each new story renders correctly
   - Run `npm run test:design` after Storybook is running

---

## Quick reference — naming patterns from this project

| Component | storyId | figmaScale | checks | selector |
|---|---|---|---|---|
| Full page | `users-userspage--default` | 1 | `CHECKS_LAYOUT` | _(none)_ |
| Card header (in page) | `users-userspage--default` | 1 | `CHECKS_CONTAINER` | `[data-testid="table-card-header"]` |
| Search input (in page) | `users-userspage--default` | 2 | `CHECKS_STRICT` | `[data-testid="table-search"]` |
| Status badge (standalone) | `users-statusbadge--active` | 2 | `CHECKS_STRICT` | _(story is the component)_ |
| Table cell | `users-userspage--default` | 2 | `['exists','size','layout','typography']` | `#storybook-root table tbody tr:first-child td:nth-child(1)` |
