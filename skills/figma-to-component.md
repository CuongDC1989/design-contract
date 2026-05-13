# Skill: figma-to-component

Generate a complete feature page — React components + Storybook stories + design-contract test config — from a Figma page, then iterate until all tests pass.

---

## Phase 1 — Discovery & Decomposition

### 1a — Read project state

Before touching Figma, understand what already exists:

```bash
# Existing components
find src -name "*.tsx" ! -name "*.stories.tsx" ! -name "*.test.tsx"

# Existing stories
find src -name "*.stories.tsx"

# Existing contract cases
cat design-contract.config.mjs
grep -E "^(FIGMA_TOKEN|FIGMA_FILE_KEY|STORYBOOK_URL)=" .env | sed 's/=.*/=<set>/'
```

Build a mental map:
- Which components already exist?
- Which already have stories?
- Which are already wired in `design-contract.config.mjs`?

### 1b — Fetch Figma pages and let user choose

```bash
[ -f .env ] || { echo "ERROR: .env not found. Create it from .env.example"; exit 1; }
source .env
[ -n "$FIGMA_TOKEN" ]    || { echo "ERROR: FIGMA_TOKEN not set in .env"; exit 1; }
[ -n "$FIGMA_FILE_KEY" ] || { echo "ERROR: FIGMA_FILE_KEY not set in .env"; exit 1; }
curl -s -H "X-Figma-Token: $FIGMA_TOKEN" \
  "https://api.figma.com/v1/files/$FIGMA_FILE_KEY?depth=1" \
  | node -e "
    const raw = require('fs').readFileSync('/dev/stdin','utf8');
    const d = JSON.parse(raw);
    if (d.err || d.status === 403) { console.error('Figma API error:', d.err || d.status); process.exit(1); }
    d.document.children.forEach((p, i) => console.log((i+1) + '.', p.name, '  [' + p.id + ']'));
  "
```

This prints a numbered list, e.g.:
```
1. Auth   [2397-45766]
2. Users  [2397-46387]
3. Moderation  [2397-47352]
```

Present this list to the user and ask: **"Which page number do you want to implement?"**

The user replies with a number (e.g. `2`). You already have the full list — read off the corresponding `[ID]` from the output above. No copy-paste required from the user.

Use that ID as `PAGE_ID` in section 1c.

### 1c — Fetch all nodes on the page

```bash
# Replace PAGE_ID with the chosen page ID
source .env
curl -s -H "X-Figma-Token: $FIGMA_TOKEN" \
  "https://api.figma.com/v1/files/$FIGMA_FILE_KEY/nodes?ids=PAGE_ID" \
  | node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    if (d.err || d.status === 403) { console.error('Figma API error:', d.err || d.status); process.exit(1); }
    function walk(node, depth) {
      if (depth > 2) return;
      console.log(' '.repeat(depth*2) + node.id + '  \"' + node.name + '\"  [' + node.type + ']');
      (node.children || []).forEach(c => walk(c, depth+1));
    }
    Object.values(d.nodes).forEach(n => walk(n.document, 0));
  "
```

> Note: Response may be large for complex pages. The walk output will include all nested nodes — focus on nodes at depth 0-2 for component identification.

### 1d — Build Component Map

Map Figma node names → React component names. Rules:
- Remove spaces, dashes, underscores — PascalCase each word: `"Login Card"` → `LoginCard`
- Slash-scoped names: use part after last slash: `"Button/Primary"` → `Primary` (or keep both: `ButtonPrimary`)
- Numbers: append as-is: `"Card 2"` → `Card2`
- Page-level FRAME representing a routable view: append `Page` suffix: `"Auth"` → `AuthPage`, `"Users"` → `UsersPage`
- GROUP nodes: map to a component only if the group has a meaningful name (not "Group 1", "Group 2", etc.). Unnamed/numbered groups → skip (treat as layout primitive)
- Ignore RECTANGLE, VECTOR, ELLIPSE, INSTANCE with no meaningful name

For each mapped component, determine:
- **File path:** `src/features/<feature>/<ComponentName>.tsx` (or `src/components/ui/<ComponentName>.tsx` for shared UI)
- **testid:** `<feature>-<componentname>` (kebab-case, lowercase)
- **Figma node ID:** from the tree output above

Status values: `existing` (component file already exists), `new` (needs to be created), `skip` (existing + already has passing test)

Present to user:

```
Component          Path                                       testid              Figma node ID   Status
AuthPage         → src/features/auth/AuthPage.tsx             auth-authpage       2397-45766      existing
LoginCard        → src/features/auth/LoginCard.tsx            auth-logincard      2397-45790      existing
```

**Checkpoint:** Ask the user to confirm or adjust the map. Do not proceed to Phase 2 until confirmed.

> Important: If a component already exists AND already has a passing design-contract test, mark it `skip` and exclude it from Phase 2.

---

## Phase 2 — Component Implementation

For each component in the confirmed map (skip any marked `skip`):

### 2a — Fetch detailed Figma node properties

```bash
# Replace NODE_ID with the component's figmaNodeId
source .env
curl -s -H "X-Figma-Token: $FIGMA_TOKEN" \
  "https://api.figma.com/v1/files/$FIGMA_FILE_KEY/nodes?ids=NODE_ID" \
  | node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    if (d.err || d.status === 403) { console.error('Figma API error:', d.err || d.status); process.exit(1); }
    const node = Object.values(d.nodes)[0].document;
    const out = {
      name:           node.name,
      type:           node.type,
      width:          node.absoluteBoundingBox?.width,
      height:         node.absoluteBoundingBox?.height,
      layoutMode:     node.layoutMode,
      paddingTop:     node.paddingTop,
      paddingBottom:  node.paddingBottom,
      paddingLeft:    node.paddingLeft,
      paddingRight:   node.paddingRight,
      itemSpacing:    node.itemSpacing,
      alignItems:     node.counterAxisAlignItems,
      justifyContent: node.primaryAxisAlignItems,
      cornerRadius:   node.cornerRadius,
      fills:          (node.fills||[]).filter(f=>f.visible!==false),
      effects:        (node.effects||[]).filter(e=>e.visible!==false),
      strokes:        node.strokes,
      clipsContent:   node.clipsContent,
      opacity:        node.opacity,
    };
    console.log(JSON.stringify(out, null, 2));
  "
```

### 2a-typography — Fetch TEXT node properties

For components that contain text (buttons, badges, labels, headings), also fetch typography from the first TEXT child:

```bash
# Replace NODE_ID with the component's figmaNodeId
source .env
curl -s -H "X-Figma-Token: $FIGMA_TOKEN" \
  "https://api.figma.com/v1/files/$FIGMA_FILE_KEY/nodes?ids=NODE_ID" \
  | node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    if (d.err || d.status === 403) { console.error('Figma API error:', d.err || d.status); process.exit(1); }
    const node = Object.values(d.nodes)[0].document;
    function findText(n) {
      if (n.type === 'TEXT') return n;
      for (const c of (n.children || [])) { const found = findText(c); if (found) return found; }
      return null;
    }
    const textNode = findText(node);
    if (textNode) {
      const s = textNode.style || {};
      console.log(JSON.stringify({
        fontSize:      s.fontSize,
        fontWeight:    s.fontWeight,
        lineHeight:    s.lineHeightPx,        // pixel value (e.g. 20)
        lineHeightUnit: s.lineHeightUnit,     // 'PIXELS' | 'PERCENT' | 'AUTO'
        letterSpacing: s.letterSpacing,
        textAlign:     s.textAlignHorizontal,
      }, null, 2));
    } else {
      console.log('(no TEXT child found)');
    }
  "
```

### 2b — Wrapper frame pitfall

> ⚠️ If the fetched node `width` equals the full page width (e.g. 1440), you are likely on a **wrapper frame**, not the actual component. Drill into `node.children[0]` to get the inner node, then re-fetch with the child's ID.

### 2c — Map Figma values to Tailwind classes

**Layout:**

| Figma property | Example value | Tailwind class |
|---|---|---|
| `layoutMode = HORIZONTAL` | — | `flex flex-row` |
| `layoutMode = VERTICAL` | — | `flex flex-col` |
| `paddingTop` = `paddingBottom` | 80 | `py-20` (÷4) |
| `paddingLeft` = `paddingRight` | 40 | `px-10` (÷4) |
| `paddingTop` ≠ `paddingBottom` | 16 / 24 | `pt-4 pb-6` |
| `itemSpacing` (gap) | 16 | `gap-4` (÷4) |
| `counterAxisAlignItems = CENTER` | — | `items-center` |
| `counterAxisAlignItems = MIN` | — | `items-start` |
| `counterAxisAlignItems = MAX` | — | `items-end` |
| `primaryAxisAlignItems = CENTER` | — | `justify-center` |
| `primaryAxisAlignItems = SPACE_BETWEEN` | — | `justify-between` |
| `primaryAxisAlignItems = MIN` | — | `justify-start` |
| `paddingLeft` ≠ `paddingRight` | 12 / 24 | `pl-3 pr-6` |
| `primaryAxisAlignItems = MAX` | — | `justify-end` |
| `counterAxisAlignItems = BASELINE` | — | `items-baseline` |
| `layoutMode = NONE` (or absent) | — | no flex class; use `block` or `relative` |

**Shape & Visual:**

| Figma property | Example value | Tailwind class |
|---|---|---|
| `cornerRadius` | 4 | `rounded` |
| `cornerRadius` | 8 | `rounded-lg` |
| `cornerRadius` | 12 | `rounded-xl` |
| `cornerRadius` | 16 | `rounded-2xl` |
| `cornerRadius` | 24 | `rounded-3xl` |
| `cornerRadius` | 9999 | `rounded-full` |
| `cornerRadius` non-standard | 6 | `rounded-[6px]` |
| `fills[0]` solid color | rgba(255,255,255,1) | `bg-white` or design token |
| `effects[0].type = DROP_SHADOW` | — | `shadow-*` (check existing tokens) |
| `strokes` length > 0 | — | `border border-*` |
| `clipsContent = true` | — | `overflow-hidden` |
| `opacity < 1` | 0.5 | `opacity-50` |

**Typography (TEXT nodes or style property):**

| Figma property | Example value | Tailwind class |
|---|---|---|
| `fontSize` | 12 | `text-xs` (= 12px) |
| `fontSize` | 14 | `text-sm` |
| `fontSize` | 16 | `text-base` |
| `fontWeight` | 400 | `font-normal` |
| `fontWeight` | 500 | `font-medium` |
| `fontWeight` | 600 | `font-semibold` |
| `fontWeight` | 700 | `font-bold` |
| `lineHeight` (px) | 20 | `leading-5` (÷4) |
| `lineHeight` (px) non-standard | 21 | `leading-[21px]` |
| `lineHeight` (px) non-standard | 22 | `leading-[22px]` |
| `textAlignHorizontal = CENTER` | — | `text-center` |

**Non-standard values rule:** When Figma value ÷ 4 is not an integer, always use the arbitrary Tailwind syntax: `leading-[21px]`, `w-[75px]`, `h-[21px]`.

> **lineHeight note:** Use `lineHeightPx` from the TEXT node's `style` object. When `lineHeightUnit = "AUTO"`, omit the leading class (browser default). When `lineHeightUnit = "PERCENT"`, multiply `lineHeightPx` by font-size if needed or use the closest named class.

**Design tokens:** Before using raw Tailwind color classes, check `tailwind.config.*` and the project's design token definitions. Map semantic colors (`bg-primary`, `text-ink-secondary`, `bg-surface`) where they match Figma color style names.

### 2d — Check existing component before rewriting

If the component already exists:
1. Read the current file
2. Compare existing CSS classes against Figma values from Step 2a
3. Only change values that differ — preserve existing logic, structure, and naming
4. Do NOT rewrite the whole component if only a few CSS values differ

### 2e — Write or update the component

Component conventions:
- Functional components with named exports
- Tailwind CSS only (no inline styles except for dynamic values like `style={{ background: color }}`)
- `data-testid` on root element: `<feature>-<componentname>`
- Sub-elements that map to separate Figma nodes get their own `data-testid`: `<feature>-<elementname>`
- Props typed with `interface`

Example:
```tsx
interface LoginCardProps {
  onSubmit: (data: FormData) => void;
}

export function LoginCard({ onSubmit }: LoginCardProps) {
  return (
    <div
      data-testid="auth-logincard"
      className="bg-surface rounded-3xl py-20 px-10 shadow-card flex flex-col items-center gap-10"
    >
      {/* children */}
    </div>
  );
}
```

### 2f — TypeScript check after all components

```bash
npx tsc --noEmit
```

Fix ALL errors before proceeding to Phase 3. TypeScript errors in component files prevent the Storybook module graph from compiling.

---

## Phase 3 — Story + Test Config

### 3a — Determine checks (fetch Figma node props — mandatory)

For each component, run the detection script and evaluate which checks are appropriate:

```bash
source .env
curl -s -H "X-Figma-Token: $FIGMA_TOKEN" \
  "https://api.figma.com/v1/files/$FIGMA_FILE_KEY/nodes?ids=NODE_ID" \
  | node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    if (d.err || d.status === 403) { console.error('Figma API error:', d.err || d.status); process.exit(1); }
    const node = Object.values(d.nodes)[0].document;
    const props = {
      hasFill:       (node.fills || []).some(f => f.type !== 'IMAGE' && f.opacity !== 0 && f.visible !== false),
      hasStroke:     (node.strokes || []).some(s => s.visible !== false),
      hasEffect:     (node.effects || []).some(e => (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW') && e.visible !== false),
      hasRadius:     (node.cornerRadius > 0) || (node.rectangleCornerRadii || []).some(r => r > 0),
      hasOpacity:    node.opacity != null && node.opacity !== 1,
      hasLayout:     node.layoutMode != null && node.layoutMode !== 'NONE',
      hasTypography: (function hasText(n) {
        if (n.type === 'TEXT') return true;
        return (n.children || []).some(hasText);
      })(node),
      hasOverflow:   node.clipsContent === true,
      hasSize:       node.absoluteBoundingBox != null,
    };
    console.log(JSON.stringify(props, null, 2));
  "
```

Map properties → checks:

| Figma property true | Add check |
|---|---|
| `hasSize` (always true for visible nodes) | `'exists'`, `'size'` |
| `hasFill` | `'background'` |
| `hasStroke` | `'border'` |
| `hasEffect` | `'shadow'` |
| `hasRadius` | `'radius'` |
| `hasOpacity` | `'opacity'` |
| `hasLayout` | `'layout'` |
| `hasTypography` | `'typography'` |
| `hasOverflow` | `'overflow'` |

Named check sets (import from `@cuongdc1989/design-contract`):

```js
import { CHECKS_STRICT, CHECKS_CONTAINER, CHECKS_LAYOUT, CHECKS_SHAPE, CHECKS_ROW } from '@cuongdc1989/design-contract'
// CHECKS_STRICT    = ['exists','size','radius','background','border','shadow','opacity','layout','typography','text','overflow','blend']
// CHECKS_CONTAINER = ['exists','size','radius','background','shadow','layout','overflow']
// CHECKS_SHAPE     = ['exists','size','radius','background']
// CHECKS_LAYOUT    = ['exists','size','layout']
// CHECKS_ROW       = ['exists','size','layout']  (alias for CHECKS_LAYOUT, semantic for table rows)
```

**Selection rule:** Use the strictest named set that is **fully covered** by the properties actually present. Custom array for anything else.

### 3b — Determine figmaScale and viewport

| Component type | figmaScale | viewport |
|---|---|---|
| Full page (1200–1440px wide) | `1` | match Figma frame: `{ width: 1440, height: 860 }` |
| Medium container (card ≥ 200px wide) | `1` | match component width + margin: `{ width: 600, height: 500 }` |
| Small component (badge, avatar, ≤ 100px height) | `2` | `{ width: 250, height: 80 }` |
| Sidebar / narrow panel | `1` | match exact width: `{ width: 208, height: 868 }` |

### 3c — Create Storybook story

**File location:** Colocate with the component in a `stories/` subfolder.
- `src/features/auth/LoginCard.tsx` → `src/features/auth/stories/LoginCard.stories.tsx`
- `src/components/ui/Badge.tsx` → `src/components/ui/stories/Badge.stories.tsx`

**Story ID formula:** Lowercase the title, replace `/` with `-`, remove spaces, append `--` + lowercase export name.
- `title: 'Auth/LoginCard'` + `export const Default` → `auth-logincard--default`

**⚠️ Critical rules — violating any causes "story failed to load":**

**Rule 1: Always declare `component` in meta.**
```tsx
const meta: Meta<typeof LoginCard> = {
  title: 'Auth/LoginCard',
  component: LoginCard,   // required — never omit
}
```

**Rule 2: Never use external image URLs in mock data.** Use SVG data URLs:
```tsx
const AVATAR = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="%23e2e8f0"/></svg>'
```

**Rule 3: Wrap context providers in `decorators`, not in `render`.**
```tsx
decorators: [(Story) => <MemoryRouter><Story /></MemoryRouter>]
```

**Rule 4: All imports must resolve.** Verify path aliases in `.storybook/main.ts`.

**Rule 5: All required props must be provided in `args`.**

**Rule 6: Mock data files must not contain CDN/external image URLs.**

### 3d — Update design-contract.config.mjs

Read the current config. If an entry already exists for this component, update it — do not duplicate.

Add to `cases[]`:
```js
{ name: 'auth-logincard--default', storyId: 'auth-logincard--default', figmaNodeId: '2397-45790', figmaScale: 1, viewport: { width: 600, height: 500 } },
```

Add to `contractCases[]`:
```js
{ name: 'auth-logincard--default', checks: CHECKS_CONTAINER, selector: '[data-testid="auth-logincard"]' },
```

For sub-elements tested inside a parent page story (e.g. a KPI card embedded in a dashboard page):
```js
// cases[]: storyId = parent page story, figmaNodeId = the sub-element's own node
{ name: 'dashboard-kpicard--revenue', storyId: 'dashboard-dashboardpage--default', figmaNodeId: '2397-45907', figmaScale: 2, viewport: { width: 1200, height: 900 } },
// contractCases[]: selector targets the element within the rendered page story
{ name: 'dashboard-kpicard--revenue', checks: CHECKS_STRICT, selector: '[data-testid="kpicard-revenue"]' },
```

For a standalone component with its own story (badge, avatar, etc.):
```js
// cases[]: storyId = the component's own story
{ name: 'users-planbadge--premium', storyId: 'users-planbadge--premium', figmaNodeId: '2397-46462', figmaScale: 2, viewport: { width: 200, height: 60 } },
// contractCases[]: no selector needed — the whole story is the component
{ name: 'users-planbadge--premium', checks: ['exists','size','overflow','typography'] },
```

### 3e — Verify story ID

The story ID Storybook generates must exactly match the `storyId` in config.

Formula: lowercase title, replace `/` with `-`, remove spaces, append `--` + lowercase export name.

```
title: 'Users/UserDetailDrawer'  →  prefix: users-userdetaildrawer
export const Default             →  variant: default
storyId: 'users-userdetaildrawer--default'   ✓
```

Common mistakes:
- CamelCase title not fully lowercased: `UserDetail` → `userdetail` (not `user-detail`)
- Uppercase export name: always lowercase in storyId

Verify against running Storybook (optional):
```bash
curl -s http://127.0.0.1:6006/index.json | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  Object.keys(d.stories || d.entries || {}).forEach(id => console.log(id));
" | grep 'auth-logincard'
```

---

## Phase 4 — Iteration Loop

### 4a — TypeScript check (run before asking user to start Storybook)

```bash
npx tsc --noEmit
```

Fix all TypeScript errors before asking the user to run tests. TypeScript errors in story or component files prevent the entire Storybook module graph from compiling — all tests will fail with "story failed to load" if this is not clean.

### 4b — Ask user to run Storybook + tests

Remind the user:
1. Start Storybook: `npm run storybook`
2. Wait for it to be ready at `http://127.0.0.1:6006`
3. Run tests: `npm run test:design`
4. Paste the full output here

### 4c — Diagnose each failing test

For each failure, follow this decision tree:

```
Test fails
  ├── "story failed to load" or "timeout waiting for networkidle"
  │     → Story file issue. Check all 6 rules from Phase 3c.
  │     → Most common: missing `component` in meta, external URL in mock data
  │
  ├── "size mismatch" (width/height wrong)
  │     → Check if Figma node is a wrapper frame (Phase 2b):
  │         Re-fetch the node — is width equal to the full page width?
  │         If yes → use the child node ID instead
  │     → Check viewport in cases[]: does it match the Figma frame dimensions?
  │     → Check for extra padding/margin on the root element
  │
  ├── "layout mismatch" (padding/gap wrong)
  │     → Re-check Figma node padding/gap values from Phase 2a
  │     → Verify Tailwind math: 80px = py-20 (80÷4), 40px = gap-10 (40÷4)
  │     → Check for a parent element that adds conflicting padding
  │
  ├── "typography mismatch" (font-size/weight/lineHeight wrong)
  │     → Re-run Phase 2a-typography on the node to get exact values
  │     → lineHeight is lineHeightPx — non-standard values need `leading-[Xpx]`
  │     → Example: Figma lineHeightPx=21 → `leading-[21px]` NOT `leading-5`
  │     → Check fontWeight: 700 → `font-bold`, 600 → `font-semibold`
  │
  ├── "background mismatch" (color wrong)
  │     → Map Figma fill color to design token in tailwind.config.*
  │     → If no token match, use arbitrary color: `bg-[#FF3986]`
  │
  ├── "radius mismatch"
  │     → cornerRadius 24 = `rounded-3xl`, 12 = `rounded-xl`
  │     → Non-standard: use `rounded-[Xpx]`
  │
  └── Check passes but Figma property is null/0
        → Remove that check from contractCases entry
        → This is the ONLY valid reason to remove a check
```

### 4d — Fix priority rule

**Always fix component code first. Only modify checks as a last resort.**

Exception table — when it IS correct to remove a check:

| Situation | Action |
|---|---|
| Figma `cornerRadius` is 0 or null | Remove `'radius'` from checks |
| Figma `fills` is empty or all invisible | Remove `'background'` from checks |
| Figma `effects` has no visible shadows | Remove `'shadow'` from checks |
| Figma `clipsContent` is false | Remove `'overflow'` from checks |
| Figma node has dynamic/content-driven width | Remove `'size'` or reduce to `['exists']` |

**Never remove a check because the CSS is "hard to match."** Fix the CSS instead.

### 4e — Table component special rules

For components that render `<table>` (e.g. DataTable):

1. **Column widths need `table-layout: fixed`** for Playwright to measure the right widths:
```tsx
<table style={{ tableLayout: 'fixed', width: '100%' }}>
```

2. **Set column widths via `col.size` in column definitions**, not CSS on `<th>` or `<td>` cells.

3. **Inline-flex badges inside `<td>` can overflow** — add `overflow-hidden` to the cell wrapper if badges appear clipped.

### 4f — Re-run and repeat

After each fix:
```bash
npx tsc --noEmit
```

Then ask the user to re-run `npm run test:design`. Repeat steps 4c → 4d → 4f until all targeted tests pass.

---

## Quick Reference — Naming & Config Patterns

| Component type | storyId | figmaScale | checks | selector |
|---|---|---|---|---|
| Full page (1200–1440px) | `feature-page--default` | 1 | `['exists','size']` | _(none)_ |
| Card / panel | `feature-card--default` | 1 | `CHECKS_CONTAINER` | `[data-testid="..."]` |
| Search / text input | `feature-page--default` | 2 | `CHECKS_STRICT` | `[data-testid="..."]` |
| Status badge (standalone) | `feature-badge--active` | 2 | `CHECKS_STRICT` | _(story is the component)_ |
| Plan badge (no radius/bg) | `feature-badge--premium` | 2 | `['exists','size','overflow','typography']` | _(story is the component)_ |
| Table row / cell | `feature-page--default` | 2 | `['exists','size','layout','typography']` | `#storybook-root table tbody tr:first-child td:nth-child(N)` |
| Sidebar | `layout-sidebar--default` | 1 | `CHECKS_CONTAINER` | `[data-testid="..."]` |
| Drawer / panel | `feature-drawer--default` | 1 | `CHECKS_CONTAINER` | `[data-testid="..."]` |
| Avatar / icon | `feature-avatar--default` | 2 | `CHECKS_SHAPE` | _(story is the component)_ |
