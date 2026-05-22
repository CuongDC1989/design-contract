# Sub-skill: figma-to-feature / phase3-story

Covers Phase 3: creating Storybook stories and updating design-check.config.mjs.

**After completing Phase 3:** read `.claude/skills/figma-to-feature/phase4-repair.md` using the Read tool to start the iteration loop.

---

## Phase 3 Pre-conditions — Validate before writing any story

### P1 — Detect stack, check packages, verify Storybook runs

**Step 1: Detect what's installed**

```bash
node -e "
  const d = JSON.parse(require('fs').readFileSync('package.json','utf8'));
  const all = {...(d.dependencies||{}), ...(d.devDependencies||{})};
  const frameworks = ['next','react','vue','nuxt','svelte','astro','solid-js'];
  const sbPkgs = Object.keys(all).filter(k => k.includes('storybook'));
  const pwPkgs = Object.keys(all).filter(k => k.includes('playwright'));
  console.log('=== Framework ===');
  frameworks.forEach(f => all[f] && console.log(f+':', all[f]));
  console.log('=== Storybook ===');
  sbPkgs.length ? sbPkgs.forEach(k => console.log(k+':', all[k])) : console.log('NOT INSTALLED');
  console.log('=== Playwright ===');
  pwPkgs.length ? pwPkgs.forEach(k => console.log(k+':', all[k])) : console.log('NOT INSTALLED');
"
```

**Step 2: If Storybook or Playwright is missing → install before continuing**

Do NOT guess package names or versions. Use npm to look up the correct adapter for the detected framework:

```bash
# Check available versions of the correct Storybook adapter
npm info @storybook/ADAPTER versions --json | node -e "
  const v = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  console.log('Latest stable:', v.filter(x=>!x.includes('-')).slice(-5).join(', '));
"

# Confirm peerDeps cover the installed framework version
npm info @storybook/ADAPTER@LATEST peerDependencies
```

Print proposed install commands and **ask the user to confirm** before running `npm install`.

Standard adapter mapping (verify against npm before using):
- `react` + Vite → `@storybook/react-vite`
- `next` → `@storybook/nextjs` or `@storybook/experimental-nextjs-vite`
- `vue 3` + Vite → `@storybook/vue3-vite`
- `nuxt` → `@storybook/nuxt`
- `svelte` + Vite → `@storybook/svelte-vite`

If `.storybook/` directory does not exist, run `npx storybook@latest init --skip-install` after install.

**Step 3: If Storybook starts but browser shows blank/compile error — plugin conflict**

```bash
# Read .storybook/main.* and check each plugin's peerDependencies
cat node_modules/PLUGIN_NAME/package.json | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  console.log('peerDeps:', JSON.stringify(d.peerDependencies));
"
```

If `peerDependencies` don't cover the installed framework version, remove it in `viteFinal`:

```ts
viteFinal: async (config) => {
  config.plugins = (config.plugins || []).filter((p: any) =>
    !p?.name?.includes('THE_CONFLICTING_PLUGIN')
  );
  return config;
},
```

**Step 4: Gate — confirm Storybook serves stories**

```bash
curl -s http://127.0.0.1:6006/index.json | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  console.log('Stories registered:', Object.keys(d.entries || d.stories || {}).length);
" 2>/dev/null || echo "Storybook not running"
```

Do not proceed until this returns at least 1 story.

### P2 — settings.json must allow curl/node without prompts

If `curl`, `node -e`, or `npm run` commands trigger confirmation dialogs, stop and add the missing patterns to `.claude/settings.json` before continuing. Manual confirmations on every API call break the workflow.

---

## Phase 3 Constraint — Never modify component CSS/logic

**Phase 3 creates test infrastructure. It does not fix components.**

The only component file allowed to be touched is `[Component].tsx` — **only** to add `data-testid` attributes. No CSS changes, no class changes, no logic changes, no prop changes.

When tests run after Phase 3 and some fail:
- **Correct response:** "Coverage is working. These failures are real Figma discrepancies — reporting them."
- **Wrong response:** "I'll adjust the component CSS so the tests pass."

A red test result after Phase 3 = the infrastructure is doing its job. Do not touch the component to make it green. Component fixes are a separate task, explicitly requested by the user.

---

## MANDATORY: Typography + Layout must be in every contractCase that has text or spacing

Before writing any `contractCases[]` entry, apply this checklist:

| Does the component… | Required check | Violation if missing |
|---|---|---|
| Have visible text (in self or any descendant) | `'typography'` | YES — blocker |
| Have flex/grid/auto-layout, padding, or gap | `'layout'` | YES — blocker |
| Have both | Both (covered by `CHECKS_STRICT`) | YES — use `CHECKS_STRICT` |

**If `hasTypography: false` but the component visually has text:**
1. Re-run the recursive `hasText()` walk manually on the raw cache node.
2. Check whether the text is inside an INSTANCE node — navigate into its `children` in the cache.
3. If the cache is stale (fetch was before text was added to Figma), re-run the Phase 1 bulk fetch.
4. Use `typographySelector` in the config entry to pin the check to the right text element.
5. Only after exhausting the above may you document "no text found" and omit `typography`.

**If `hasLayout: false` but the component visually has spacing:**
1. Inspect `layoutMode` directly in the raw cache node — some Figma versions use different field names.
2. Check parent frame — the layout may be on the wrapper, not the component itself.
3. If confirmed absent in Figma data, document it; otherwise add `'layout'`.

**`['exists', 'size']` alone is never a valid checks list** for any component with text or spacing. It verifies only pixel dimensions — not CSS.

---

## Phase 3 — Story + Test Config

### 3a — Determine checks (read from cache — mandatory)

> **Cache-first:** Phase 1 already wrote `figma-nodes-cache.json`. Read from it — no API call needed.

```bash
# Replace NODE_ID with the component's figmaNodeId (colon form: 2397:45790)
node -e "
  const cache = JSON.parse(require('fs').readFileSync('figma-nodes-cache.json','utf8'));
  const root = cache.document || Object.values(cache.nodes || {})[0]?.document;
  function findNode(n, id) {
    if (!n) return null;
    if (n.id === id) return n;
    for (const c of (n.children||[])) { const r = findNode(c, id); if (r) return r; }
    return null;
  }
  function hasText(n) {
    if (n.type === 'TEXT') return true;
    return (n.children || []).some(hasText);
  }
  const TARGET_ID = 'NODE_ID';  // replace with actual ID
  const node = findNode(root, TARGET_ID);
  if (!node) { console.error('Node not found in cache'); process.exit(1); }
  const props = {
    hasFill:       (node.fills || []).some(f => f.type !== 'IMAGE' && f.opacity !== 0 && f.visible !== false),
    hasStroke:     (node.strokes || []).some(s => s.visible !== false),
    hasEffect:     (node.effects || []).some(e => (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW') && e.visible !== false),
    hasRadius:     (node.cornerRadius > 0) || (node.rectangleCornerRadii || []).some(r => r > 0),
    hasOpacity:    node.opacity != null && node.opacity !== 1,
    hasLayout:     node.layoutMode != null && node.layoutMode !== 'NONE',
    hasTypography: hasText(node),
    hasOverflow:   node.clipsContent === true,
    hasSize:       node.absoluteBoundingBox != null,
  };
  console.log(JSON.stringify(props, null, 2));
"
```

Named check sets (import from `@solashi2026/design_check`):

```js
import { CHECKS_STRICT, CHECKS_CONTAINER, CHECKS_LAYOUT, CHECKS_SHAPE, CHECKS_ROW } from '@solashi2026/design_check'
// CHECKS_STRICT    = ['exists','size','radius','background','border','shadow','opacity','layout','typography','text','overflow','blend']
// CHECKS_CONTAINER = ['exists','size','radius','background','shadow','layout','overflow']
// CHECKS_SHAPE     = ['exists','size','radius','background']
// CHECKS_LAYOUT    = ['exists','size','layout']
// CHECKS_ROW       = ['exists','size','layout']
```

**Selection rule — CHECKS_STRICT is the default. Always start here.**

The engine silently skips any check whose `expected` value is null, so CHECKS_STRICT never over-fires. Only downgrade when a structural reason makes a check impossible:

| Reason to downgrade | Use instead |
|---|---|
| Pure layout wrapper (no visual style at all) | `CHECKS_LAYOUT` |
| Shape-only element (icon container, avatar circle) | `CHECKS_SHAPE` |
| Container without typography and no clear text children | `CHECKS_CONTAINER` |
| Explicit user instruction to limit checks | Custom array |

**Never** downgrade just because a property wasn't detected — the engine's silent-skip handles absent properties safely. Downgrade only for structural impossibility.

### 3b — Determine figmaScale and viewport

| Component type | figmaScale | viewport |
|---|---|---|
| Full page (1200–1440px wide) | `1` | `{ width: 1440, height: 860 }` |
| Medium container (card ≥ 200px wide) | `1` | `{ width: 600, height: 500 }` |
| Small component (badge, avatar, ≤ 100px height) | `2` | `{ width: 250, height: 80 }` |
| Sidebar / narrow panel | `1` | match exact width: `{ width: 208, height: 868 }` |

### 3c — Create Storybook story

**File location:** colocate in a `stories/` subfolder.
- `src/features/auth/LoginCard.tsx` → `src/features/auth/stories/LoginCard.stories.tsx`
- `src/components/ui/Badge.tsx` → `src/components/ui/stories/Badge.stories.tsx`

**Story ID formula:** lowercase title, `/` → `-`, no spaces, append `--` + lowercase export name.
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

**Loading skeleton story:** if the component implements a `loading` state, add:
```tsx
export const Loading: Story = { args: { status: 'loading' } }
export const Empty: Story = { args: { status: 'empty' } }
export const Error: Story = { args: { status: 'error' } }
```

**Screenshot-aware repair setup:** Add a `data-storybook-id` attribute to the story's root element matching the storyId — this enables screenshot comparison in Phase 4:
```tsx
// In the story decorator or args
parameters: {
  layout: 'centered',  // or 'fullscreen' for pages
}
```

### 3d-pre — Mandatory gate: Verify story ID before updating config

**Do NOT write to `design-check.config.mjs` or `design-spec.json` until this step passes.** An incorrect `storyId` causes all tests for this component to silently fail — the engine finds no story and reports nothing.

**Story ID formula:**

```
title: 'Feature/ComponentName'   + export Default  → 'feature-componentname--default'
title: 'Auth/LoginCard'          + export Default  → 'auth-logincard--default'
title: 'Users/UserDetailDrawer'  + export Default  → 'users-userdetaildrawer--default'
```

⚠️ **Storybook v10 inserts a hyphen before digit sequences in export names:**
```
export Step1   → 'step-1'   (NOT 'step1')
export Tab2    → 'tab-2'    (NOT 'tab2')
export Default → 'default'  (no change — no digits)
```

**Verify against running Storybook:**

```bash
curl -s http://127.0.0.1:6006/index.json | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  Object.values(d.entries || {}).forEach(s => console.log(s.id));
" | grep 'componentname'
```

If the ID appears in the output → proceed to 3d.  
If not found:
- TypeScript errors may have prevented compilation → run `npx tsc --noEmit` first
- Re-derive the ID from the formula (check for digit sequences in export names)
- If Storybook is not running, mark as "unverified" and run the check in Step 3e before finalizing config

### 3d — Update design-check.config.mjs

Read the current config. If an entry already exists for this component, update it — do not duplicate.

Add to `cases[]`:
```js
{ name: 'auth-logincard--default', storyId: 'auth-logincard--default', figmaNodeId: '2397-45790', figmaScale: 1, viewport: { width: 600, height: 500 } },
```

Add to `contractCases[]`:
```js
{ name: 'auth-logincard--default', checks: CHECKS_CONTAINER, selector: '[data-testid="auth-logincard"]' },
```

For sub-elements inside a parent page story:
```js
// cases[]: storyId = parent page story, figmaNodeId = sub-element's own node
{ name: 'dashboard-kpicard--revenue', storyId: 'dashboard-dashboardpage--default', figmaNodeId: '2397-45907', figmaScale: 2, viewport: { width: 1200, height: 900 } },
// contractCases[]: selector targets the element within the rendered page
{ name: 'dashboard-kpicard--revenue', checks: CHECKS_STRICT, selector: '[data-testid="kpicard-revenue"]' },
```

For a standalone component with its own story:
```js
{ name: 'users-planbadge--premium', storyId: 'users-planbadge--premium', figmaNodeId: '2397-46462', figmaScale: 2, viewport: { width: 200, height: 60 } },
{ name: 'users-planbadge--premium', checks: ['exists','size','overflow','typography'] },
```

### 3e — Verify story ID

Formula: lowercase title, replace `/` with `-`, no spaces, append `--` + lowercase export name.

```
title: 'Users/UserDetailDrawer'  →  prefix: users-userdetaildrawer
export const Default             →  variant: default
storyId: 'users-userdetaildrawer--default'   ✓
```

Common mistakes:
- CamelCase not fully lowercased: `UserDetail` → `userdetail` (not `user-detail`)
- Uppercase export name: always lowercase in storyId

Verify against running Storybook:
```bash
curl -s http://127.0.0.1:6006/index.json | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  Object.keys(d.stories || d.entries || {}).forEach(id => console.log(id));
" | grep 'auth-logincard'
```

### 3f — Page / Screen: maximizing CSS coverage

**Why page root checks are thin**: A Figma page/screen frame usually has no fills, no layoutMode, no direct text → `background`, `layout`, `typography` all get skipped. The fix is to **test each section separately**, not the page as one unit.

#### Three-level strategy

| Level | What to test | checks to use | selector pattern |
|---|---|---|---|
| Page root | Background color, overflow clip, size | `['exists','size','background','overflow']` | `[data-testid="page-root"]` or `#storybook-root > *:visible` |
| Sections (header, hero, sidebar, content) | Full CSS: bg, layout, radius, shadow, typography | `CHECKS_STRICT` or `CHECKS_CONTAINER` | `[data-testid="section-hero"]` |
| Isolated text blocks (hero title, nav links) | Typography only | `['exists','size','typography','text']` | `[data-testid="hero-title"]` |

**Never use `['exists','size']` for a page.** If you only have 2 checks, you're not testing CSS.

#### Config pattern for a full page

```js
// cases[]: one entry per Figma section node
{ name: 'landing-hero--default',    storyId: 'landing-page--default', figmaNodeId: 'HERO_NODE_ID',    figmaScale: 1, viewport: { width: 1440, height: 860 } },
{ name: 'landing-features--default',storyId: 'landing-page--default', figmaNodeId: 'FEAT_NODE_ID',    figmaScale: 1, viewport: { width: 1440, height: 860 } },
{ name: 'landing-cta--default',     storyId: 'landing-page--default', figmaNodeId: 'CTA_NODE_ID',     figmaScale: 1, viewport: { width: 1440, height: 860 } },

// contractCases[]: selector targets each section inside the rendered page
{ name: 'landing-hero--default',     checks: CHECKS_STRICT,     selector: '[data-testid="hero-section"]',     typographySelector: 'h1' },
{ name: 'landing-features--default', checks: CHECKS_CONTAINER,  selector: '[data-testid="features-section"]' },
{ name: 'landing-cta--default',      checks: CHECKS_STRICT,     selector: '[data-testid="cta-section"]',      typographySelector: 'h2' },
```

#### `typographySelector` — when to use it

`typographySelector` is a CSS selector evaluated **inside** the section element. Use it when:
- The section's first text node is a label/badge (wrong) but you want to check the heading typography
- A section has multiple text styles and you want to pin to a specific one

```js
// Without typographySelector: checks the first text leaf found in the section (may be a nav item or badge)
{ name: 'landing-hero--default', checks: CHECKS_STRICT, selector: '[data-testid="hero-section"]' }

// With typographySelector: always measures the <h1> typography
{ name: 'landing-hero--default', checks: CHECKS_STRICT, selector: '[data-testid="hero-section"]', typographySelector: 'h1' }
```

Figma side: `extractNodeSpec()` uses `firstTextNode()` from the section's Figma node (typically the heading) — aligns with `typographySelector: 'h1'`.

#### How to find Figma section node IDs

```bash
# Replace PAGE_NODE_ID with the page frame's ID (colon form)
node -e "
  const cache = JSON.parse(require('fs').readFileSync('figma-nodes-cache.json','utf8'));
  const root = cache.document || Object.values(cache.nodes || {})[0]?.document;
  function findNode(n, id) {
    if (!n) return null;
    if (n.id === id) return n;
    for (const c of (n.children||[])) { const r = findNode(c, id); if (r) return r; }
    return null;
  }
  const pageNode = findNode(root, 'PAGE_NODE_ID');
  if (!pageNode) { console.error('Node not found in cache'); process.exit(1); }
  (pageNode.children || []).forEach(child => {
    const id = child.id.replace(/:/g, '-');
    const w = child.absoluteBoundingBox?.width ?? 0;
    const h = child.absoluteBoundingBox?.height ?? 0;
    console.log(id.padEnd(20), child.name.padEnd(30), child.type, Math.round(w)+'x'+Math.round(h));
  });
"
```

Each line is a section node ID (hyphen form for config) + name. Use those IDs in `cases[].figmaNodeId`.

#### What checks each section actually tests

When `CHECKS_STRICT` runs on a section frame that has:
- `fills` → `background` (backgroundColor)
- `strokes` → `border` (width, color, style)
- `effects` with DROP_SHADOW → `shadow` (presence, offsetX, offsetY, blur, color)
- `cornerRadius > 0` → `radius` (borderRadius)
- `layoutMode` HORIZONTAL/VERTICAL → `layout` (gap, padding x4, flexDirection, alignItems, justifyContent)
- TEXT child anywhere → `typography` (fontFamily, fontWeight, fontSize, lineHeight, letterSpacing, textAlign, color)
- `clipsContent` → `overflow`
- `absoluteBoundingBox` → `size` (width, height)

Checks with null expected values are **silently skipped** — so `CHECKS_STRICT` on a section that has no stroke won't fail the border check; it just doesn't run it. This is intentional: use the strictest set and let the spec drive which checks actually execute.

---

## Next step

After Phase 3: read `.claude/skills/figma-to-feature/phase4-repair.md` using the Read tool to begin the iteration loop.
