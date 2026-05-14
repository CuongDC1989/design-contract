# Sub-skill: figma-to-component / phase3-story

Covers Phase 3: creating Storybook stories and updating design-contract.config.mjs.

**After completing Phase 3:** load sub-skill `figma-to-component/phase4-repair` to start the iteration loop.

---

## Phase 3 — Story + Test Config

### 3a — Determine checks (fetch Figma node props — mandatory)

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
// CHECKS_ROW       = ['exists','size','layout']
```

**Selection rule:** Use the strictest named set that is fully covered by the properties actually present. Custom array for anything else.

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

---

## Next step

After Phase 3: load sub-skill `figma-to-component/phase4-repair` to begin the iteration loop.
