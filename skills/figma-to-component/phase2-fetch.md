# Sub-skill: figma-to-component / phase2-fetch

Covers Phase 2 sections 2a–2g: fetching Figma node properties, mapping values to Tailwind classes, writing components, TypeScript verification, and anti-hallucination checks.

**After completing 2a–2g:** load sub-skill `figma-to-component/phase2-production` for production readiness rules before proceeding to Phase 3.

---

## Phase 2 — Component Implementation (2a–2g)

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
      constraints:    node.constraints,
      primaryAxisSizingMode: node.primaryAxisSizingMode,
      counterAxisSizingMode: node.counterAxisSizingMode,
      minWidth:    node.minWidth,
      maxWidth:    node.maxWidth,
      minHeight:   node.minHeight,
      maxHeight:   node.maxHeight,
      hasVariables: !!(node.fills||[]).find(f=>f.boundVariables?.color) ||
                    !!(node.strokes||[]).find(s=>s.boundVariables?.color),
      layoutPositioning: node.layoutPositioning,
      relativePosition: node.relativeTransform
        ? { x: node.relativeTransform[0][2], y: node.relativeTransform[1][2] }
        : null,
      layoutWrap:  node.layoutWrap,
      zIndexHint:  null,
      shadowDetails: (node.effects||[])
        .filter(e=>e.type==='DROP_SHADOW'&&e.visible!==false)
        .map(e=>({
          x:e.offset?.x, y:e.offset?.y, blur:e.radius, spread:e.spread,
          color:e.color ? `rgba(${Math.round(e.color.r*255)},${Math.round(e.color.g*255)},${Math.round(e.color.b*255)},${(e.color.a??1).toFixed(2)})` : null
        })),
    };
    console.log(JSON.stringify(out, null, 2));
  "
```

### 2a-typography — Fetch TEXT node properties

For components that contain text, fetch typography from the first TEXT child:

```bash
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
        fontSize:       s.fontSize,
        fontWeight:     s.fontWeight,
        lineHeight:     s.lineHeightPx,
        lineHeightUnit: s.lineHeightUnit,
        letterSpacing:  s.letterSpacing,
        textAlign:      s.textAlignHorizontal,
      }, null, 2));
    } else {
      console.log('(no TEXT child found)');
    }
  "
```

### 2a-colors — Match fill color to design token

```bash
# Replace R G B with fills[0].color.r, .g, .b from 2a output (values 0–1)
node -e "
  const r = R_VALUE, g = G_VALUE, b = B_VALUE;
  const hex = '#' + [r,g,b].map(v => Math.round(v*255).toString(16).padStart(2,'0')).join('').toUpperCase();
  console.log('Fill hex:', hex);
"
grep -ri "HEX_VALUE" tailwind.config.* src/ --include="*.ts" --include="*.js" --include="*.css" 2>/dev/null | head -10
```

- **Match found** → use token class (`bg-primary`, `bg-surface`, `text-ink`)
- **No match** → use arbitrary class `bg-[#RRGGBB]`

> Skip this step if `hasVariables: true` — use section 2a-variables instead.

**Token normalization:** Before accepting "no match", apply multi-level matching:

```bash
node -e "
  // Perceptual match — ΔE check (simple Euclidean in sRGB, threshold <15)
  const figmaR=R, figmaG=G, figmaB=B;
  const tokens = { /* paste tailwind.config color tokens as { name: '#RRGGBB' } */ };
  Object.entries(tokens).forEach(([name, hex]) => {
    const tr=parseInt(hex.slice(1,3),16), tg=parseInt(hex.slice(3,5),16), tb=parseInt(hex.slice(5,7),16);
    const dist=Math.sqrt((figmaR-tr)**2+(figmaG-tg)**2+(figmaB-tb)**2);
    if (dist < 15) console.log('Near match:', name, hex, 'dist:', dist.toFixed(1));
  });
"
```

| Match level | Threshold | Action |
|---|---|---|
| Exact hex | dist = 0 | Use token directly |
| Near match | dist < 15 | Use token + note the small delta |
| Alias chain | token = another token's value | Resolve alias, use semantic name |
| Dark mode pair | light + dark fill present | Generate both `bg-surface dark:bg-surface-dark` |
| No match | dist ≥ 15 | Fallback `bg-[#RRGGBB]`, flag for 5g sync |

### 2a-variables — Resolve Figma variables (design tokens)

When `hasVariables: true` in 2a output:

```bash
source .env
curl -s -H "X-Figma-Token: $FIGMA_TOKEN" \
  "https://api.figma.com/v1/files/$FIGMA_FILE_KEY/variables/local" \
  | node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    if (d.err || d.status === 403) { console.error('Figma API error:', d.err); process.exit(1); }
    const vars = Object.values(d.meta?.variables || {});
    vars.filter(v => v.resolvedType === 'COLOR').forEach(v => {
      const val = Object.values(v.valuesByMode || {})[0];
      if (!val || typeof val !== 'object') return;
      const hex = '#' + ['r','g','b'].map(c => Math.round((val[c]||0)*255).toString(16).padStart(2,'0')).join('').toUpperCase();
      console.log(v.name.padEnd(45), hex);
    });
  "
```

| Figma variable name pattern | Code token class |
|---|---|
| `Primary` / `Brand` | `bg-primary`, `text-primary` |
| `Ink` / `Text/Dark` / `Neutral/900` | `text-ink` |
| `Ink/Secondary` / `Text/Secondary` | `text-ink-secondary` |
| `Surface` / `Background/White` | `bg-surface` |
| `Grey/300` / `Border/Default` | `border-grey-300` |
| `Success` / `Green` | `text-success`, `bg-success` |

### 2a-images — Image & asset handling

```bash
# Check icon library availability
cat package.json | grep -E '"lucide|heroicon|phosphor|feather|tabler' | head -5
```

**Icon nodes (VECTOR / icon-sized FRAME ≤ 32px):**
- Icon library exists → use matching icon (`<ChevronDown size={16} />`)
- No library → export SVG from Figma, save to `src/assets/icons/`, import as React component

**IMAGE fills (photos, illustrations):**
- Never embed base64 — expose as `src` prop
- Story mock data: use SVG data URL placeholder (never CDN URL)

```tsx
<img src={src} alt={alt} width={figmaWidth} height={figmaHeight} className="object-cover" />
```

| Figma `scaleMode` | CSS class |
|---|---|
| `FILL` | `object-cover` |
| `FIT` | `object-contain` |
| `CROP` | `object-cover` |
| `TILE` | `bg-repeat` (use background-image) |

### 2b — Wrapper frame pitfall

> ⚠️ If the fetched node `width` equals the full page width (e.g. 1440), you are on a **wrapper frame**. Drill into `node.children[0]` and re-fetch with the child's ID.

### 2c — Map Figma values to Tailwind classes

**Layout:**

| Figma property | Example | Tailwind |
|---|---|---|
| `layoutMode = HORIZONTAL` | — | `flex flex-row` |
| `layoutMode = VERTICAL` | — | `flex flex-col` |
| `paddingTop` = `paddingBottom` | 80 | `py-20` (÷4) |
| `paddingLeft` = `paddingRight` | 40 | `px-10` (÷4) |
| `paddingTop` ≠ `paddingBottom` | 16 / 24 | `pt-4 pb-6` |
| `paddingLeft` ≠ `paddingRight` | 12 / 24 | `pl-3 pr-6` |
| `itemSpacing` | 16 | `gap-4` (÷4) |
| `counterAxisAlignItems = CENTER` | — | `items-center` |
| `counterAxisAlignItems = MIN` | — | `items-start` |
| `counterAxisAlignItems = MAX` | — | `items-end` |
| `counterAxisAlignItems = BASELINE` | — | `items-baseline` |
| `primaryAxisAlignItems = CENTER` | — | `justify-center` |
| `primaryAxisAlignItems = SPACE_BETWEEN` | — | `justify-between` |
| `primaryAxisAlignItems = MIN` | — | `justify-start` |
| `primaryAxisAlignItems = MAX` | — | `justify-end` |
| `layoutMode = NONE` (or absent) | — | `block` or `relative` |
| `primaryAxisSizingMode = FILL` | — | `flex-1` (row parent) or `w-full` (col parent) |
| `primaryAxisSizingMode = HUG` | — | no width class |
| `primaryAxisSizingMode = FIXED` | — | `w-[Xpx]` from `absoluteBoundingBox.width` |
| `counterAxisSizingMode = FILL` | — | `self-stretch` or `h-full` |
| `counterAxisSizingMode = HUG` | — | no height class |
| `counterAxisSizingMode = FIXED` | — | `h-[Xpx]` from `absoluteBoundingBox.height` |
| `minWidth > 0` | 100 | `min-w-[100px]` |
| `maxWidth > 0` | 400 | `max-w-[400px]` |
| `layoutWrap = "WRAP"` | — | `flex-wrap` |
| `layoutWrap = "WRAP"` + `counterAxisSpacing > 0` | 16 | `gap-y-4` (+ `gap-x-*` from itemSpacing) |
| wrap + equal item sizes (grid-like) | — | consider `grid grid-cols-N` |

**Z-index from node order:**

Figma's painter's model: later children in `children[]` render on top. When siblings have overlapping `absoluteBoundingBox`:

```
children[0] → no z-index (below)
children[1] → z-10
children[2] → z-20
```

Only add `z-*` to nodes that actually overlap. Set `zIndexHint` manually by inspecting sibling bounding boxes.

**Token priority order:**

1. Figma variable (`hasVariables = true`) → resolve via 2a-variables → `var(--color-token)`
2. Semantic token → match RGBA against `tailwind.config.*` by Figma style name → `bg-primary`
3. Hex match in tailwind.config → use token class, not raw hex
4. Perceptual match (dist < 15) → use nearest token + note delta
5. Arbitrary hex → `bg-[#RRGGBB]` — only when 1–4 all fail; flag for 5g sync

**CSS conflict rules — never write these combinations:**

| Pattern | Problem | Fix |
|---|---|---|
| `p-4 px-6` | `px-6` overrides padding-x from `p-4` | `px-6 py-4` |
| `p-4 py-2` | `py-2` overrides padding-y | `px-4 py-2` |
| `w-full w-[200px]` | conflict, last wins | pick one based on sizingMode |
| `flex grid` | incompatible systems | use only one |
| `inset-0 top-4` | `top-4` overrides inset top | `top-4 right-0 bottom-0 left-0` |
| `overflow-hidden overflow-auto` | conflict | use only one |
| `text-sm text-[14px]` | redundant | use `text-sm` |

**Responsive (constraints → Tailwind):**

| `constraints.horizontal` | Tailwind |
|---|---|
| `LEFT_RIGHT` | `w-full` |
| `CENTER` | `mx-auto w-[Xpx]` |
| `SCALE` | `w-full` |
| `LEFT` or `RIGHT` | `w-[Xpx]` |

| `constraints.vertical` | Tailwind |
|---|---|
| `TOP_BOTTOM` | `h-full` |
| `SCALE` | `h-full` |
| `TOP` or `BOTTOM` | `h-[Xpx]` |

**Absolute Positioning:**

| Situation | Tailwind |
|---|---|
| `layoutPositioning = "ABSOLUTE"` in auto-layout parent | `absolute` on child; `relative` on parent |
| Parent has no `layoutMode` (free-form frame) | parent: `relative w-[Xpx] h-[Ypx]`; children: `absolute` |
| Anchor top-left | `top-[Ypx] left-[Xpx]` (from `relativePosition`) |
| Anchor top-right | `top-[Ypx] right-[Rpx]` |
| x=0, y=0 | `top-0 left-0` |
| Full overlay | `inset-0` |
| Centered overlay | `top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2` |
| Pinned to bottom | `bottom-[Bpx] left-[Xpx]` |

Rules: use `relativePosition` (from `relativeTransform`), NOT `absoluteBoundingBox`. When x or y ÷ 4 is integer, use Tailwind unit (`top-4` not `top-[16px]`).

**Shape & Visual:**

| Figma property | Example | Tailwind |
|---|---|---|
| `cornerRadius` | 4 | `rounded` |
| `cornerRadius` | 8 | `rounded-lg` |
| `cornerRadius` | 12 | `rounded-xl` |
| `cornerRadius` | 16 | `rounded-2xl` |
| `cornerRadius` | 24 | `rounded-3xl` |
| `cornerRadius` | 9999 | `rounded-full` |
| `cornerRadius` non-standard | 6 | `rounded-[6px]` |
| `fills[0]` solid | rgba | run 2a-colors script; fallback `bg-[#RRGGBB]` |
| `hasVariables = true` | — | run 2a-variables first |
| `DROP_SHADOW` effect | — | match `shadowDetails` against `tailwind.config.*` shadow tokens |
| `strokes` length > 0 | — | `border border-*` |
| `clipsContent = true` | — | `overflow-hidden` |
| `opacity < 1` | 0.5 | `opacity-50` |

**Typography:**

| Figma property | Example | Tailwind |
|---|---|---|
| `fontSize` | 12 | `text-xs` |
| `fontSize` | 14 | `text-sm` |
| `fontSize` | 16 | `text-base` |
| `fontWeight` | 400 | `font-normal` |
| `fontWeight` | 500 | `font-medium` |
| `fontWeight` | 600 | `font-semibold` |
| `fontWeight` | 700 | `font-bold` |
| `lineHeight` px | 20 | `leading-5` (÷4) |
| `lineHeight` non-standard | 21 | `leading-[21px]` |
| `textAlignHorizontal = CENTER` | — | `text-center` |

`lineHeightUnit = "AUTO"` → omit leading class. `lineHeightUnit = "PERCENT"` → use `lineHeightPx` value.

**Shadow matching:**
```bash
grep -A3 "shadow" tailwind.config.* 2>/dev/null | head -30
```
Compare token definition against `shadowDetails` values. Never guess `shadow-md` without verifying.

**Non-standard values rule:** When Figma value ÷ 4 is not an integer → always use arbitrary syntax: `leading-[21px]`, `w-[75px]`.

### 2d — Check existing component before rewriting

If the component already exists:
1. Read the current file
2. Compare existing CSS classes against Figma values from 2a
3. Only change values that differ — preserve existing logic, structure, naming
4. Do NOT rewrite the whole component if only a few CSS values differ

### 2e — Write or update the component

**Component conventions:**
- Functional components with named exports
- Tailwind CSS only (no inline styles except for dynamic values)
- `data-testid` on root element: `<feature>-<componentname>`
- Sub-elements mapping to separate Figma nodes get their own `data-testid`
- Props typed with `interface`

**Complexity threshold:** If a component would exceed ~150 lines of JSX, split it. Natural split points:
- Repeated sub-elements → extract as named sub-component
- Elements with their own Figma node ID → already designed as separate components
- Sections that could render independently → extract

**Semantic HTML — choose the right element:**

| Use case | Element |
|---|---|
| Clickable action | `<button type="button">` |
| Navigation link | `<a href>` or `<Link to>` |
| Navigation container | `<nav aria-label="...">` |
| Main page content | `<main>` |
| Grouped section | `<section aria-labelledby="...">` |
| Heading | `<h1>`–`<h6>` |
| Form | `<form onSubmit={...}>` |
| List of items | `<ul><li>` or `<ol><li>` |
| Data table | `<table><thead><tbody><th scope="col">` |

**Accessibility — required for interactive & informational elements:**

| Element type | Required |
|---|---|
| `<button>` or `<a>` with no text | `aria-label` |
| Icon-only button | `aria-label` + `aria-hidden="true"` on icon |
| `<img>` (informative) | `alt="description"` |
| `<img>` (decorative) | `alt=""` |
| `<input>` | `<label htmlFor>` or `aria-label` |
| Modal / Drawer | `role="dialog"` + `aria-labelledby` |
| Loading spinner | `role="status"` + `aria-label="Loading"` |

**Interaction extraction:**

| Figma interaction | Tailwind |
|---|---|
| Mouse enter (hover) | `hover:` |
| Focus | `focus:` `focus-visible:` |
| Press / mouse down | `active:` |
| Any visual state change | `transition-colors duration-200` |

**Variant handling (COMPONENT_SET):**

```tsx
export const Active: Story = { args: { status: 'active' } }
export const Disabled: Story = { args: { status: 'disabled' } }
```

**Traceability comment** at top of every newly generated file:
```tsx
// Figma: "<NodeName>" · file: FIGMA_FILE_KEY · node: NODE_ID
```

### 2f — TypeScript check after all components

```bash
npx tsc --noEmit
```

Fix ALL errors before proceeding. TypeScript errors prevent the Storybook module graph from compiling — all tests will fail with "story failed to load".

### 2g — Anti-hallucination checklist

**Imports:**
```bash
grep -rn "^import" src/components/ui/NewComponent.tsx | grep "from './" | \
  sed "s|.*from '||;s|'.*||" | while read p; do
    [ -f "src/$(dirname NewComponent.tsx)/$p.tsx" ] || echo "MISSING: $p"
  done
```
- Every library import — verify the named export exists in that package
- Every `@/` alias — verify it resolves in `tsconfig.json` paths

**Tailwind classes:**
- Custom tokens (`bg-primary`, `text-ink`, `shadow-card`) — verify in `tailwind.config.*`
- Arbitrary values — valid: `w-[75px]` — invalid: `w-[75]`

**Props and types:**
- All JSX props exist in the component's `interface`
- Imported component props match their actual exported interface

```bash
npx tsc --noEmit 2>&1 | grep "error TS" | head -20
```

Zero `error TS` = no hallucinated names.

---

## Next step

After 2a–2g: load sub-skill `figma-to-component/phase2-production` for production readiness rules.
