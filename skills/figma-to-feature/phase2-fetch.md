# Sub-skill: figma-to-feature / phase2-fetch

Covers Phase 2 sections 2a–2g: fetching Figma node properties, mapping values to Tailwind classes, writing components, TypeScript verification, and anti-hallucination checks.

**After completing 2a–2g:** load sub-skill `figma-to-feature/phase2-production` for production readiness rules before proceeding to Phase 3.

---

## Phase 2 — Component Implementation (2a–2g)

> **Figma source mode** was detected in Phase 1 (step 1b). Use the same mode (`[MCP]` or `[API]`) for every fetch in this phase — do not mix.

For each component in the confirmed map (skip any marked `skip`):

### 2a — Fetch detailed Figma node properties

**[MCP]** Call `figma___get_design_context` with the node ID. Extract from the response: `absoluteBoundingBox`, `layoutMode`, `padding*`, `itemSpacing`, `counterAxisAlignItems`, `primaryAxisAlignItems`, `cornerRadius`, `fills`, `effects`, `strokes`, `clipsContent`, `opacity`, `primaryAxisSizingMode`, `counterAxisSizingMode`, `minWidth/maxWidth/minHeight/maxHeight`, `layoutPositioning`, `relativeTransform`, `layoutWrap`. Build the same `out` object as the API path below.

**[API]**
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

For components that contain text, fetch typography from the first TEXT child.

**[MCP]** The `figma___get_design_context` response from 2a already contains the full node tree — traverse children to find the first node with `type === 'TEXT'` and read its `style` object: `fontSize`, `fontWeight`, `lineHeightPx`, `lineHeightUnit`, `letterSpacing`, `textAlignHorizontal`.

**[API]**
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

**[MCP]** Call `figma___get_design_context` at file scope (no nodeId) — it typically includes variable/token definitions. Extract COLOR variables: name → hex value → map to Tailwind token class using the table below.

**[API]**
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

### 2a-screenshot — Capture visual reference

Fetch a PNG of the Figma node to pass as visual context to the `frontend-developer` agent in step 2e.

**[MCP]** Call `figma___get_screenshot` with the node ID — it returns the image directly. Read it with the Read tool.

**[API]**
```bash
source .env
curl -s -H "X-Figma-Token: $FIGMA_TOKEN" \
  "https://api.figma.com/v1/images/$FIGMA_FILE_KEY?ids=NODE_ID&format=png&scale=2" \
  | node -e "
    const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    if(d.err){console.error(d.err);process.exit(1);}
    const url=Object.values(d.images||{})[0];
    console.log(url);
  "
# Download: curl -sL '<EXPORT_URL>' -o /tmp/figma-NODE_ID.png
```
Read the downloaded PNG with the Read tool.

---

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

### 2d-plan — Draft implementation plan and confirm

Using all data from 2a–2c, draft a structured plan and present to the user for confirmation **before** spawning the code generation agent.

```
## Implementation Plan: [ComponentName]

File:    [file_path]
testid:  [feature]-[componentname]
Node:    [NODE_ID]

### CSS
- Layout:     [e.g. flex flex-col gap-4 px-6 py-8]
- Background: [e.g. bg-white / bg-[#F5F5F5]]
- Typography: [e.g. text-sm font-medium leading-5]
- Shape:      [e.g. rounded-lg border border-grey-200]
- Shadow:     [e.g. shadow-card / none]

### Props interface (inferred from Figma structure)
interface [ComponentName]Props {
  // list props with types
}

### Async states
[ ] loading  [ ] error  [ ] empty  — mark if Figma has named variants

### Components to reuse
[from Phase 1e — UI library + existing project components]

### Notes
[wrapper frame, z-index issues, absolute children, i18n, etc.]
```

Wait for user confirmation: **"Proceed with code generation?"** Do not spawn the agent until confirmed.

---

### 2e — Spawn frontend-developer agent

After user confirms the plan, ask which model to use:

```
Which model should the frontend-developer agent use?
  1. claude-sonnet-4-6 (default)
  2. claude-opus-4-7
  3. claude-haiku-4-5-20251001
  [Enter number or press Enter for default]
```

Use the selected model (or `claude-sonnet-4-6` if no input). Then spawn the `frontend-developer` agent using the Agent tool with the following prompt:

---

**Agent:** `frontend-developer`

**Prompt:**

```
Generate a production-ready React/TypeScript component.

## Target
File: [file_path]
Component: [ComponentName]
data-testid: [testid]
Traceability: // Figma: "[NodeName]" · file: [FIGMA_FILE_KEY] · node: [NODE_ID]

## Figma data
[Paste full 2a output — layout, padding, gap, fills, strokes, effects, cornerRadius, opacity]
[Paste 2a-typography output — fontSize, fontWeight, lineHeight, letterSpacing, textAlign]
[Paste 2a-colors / 2a-variables output — resolved color tokens]

## Tailwind class mapping (from 2c)
[Paste the complete class list derived in 2c]

## Props interface
[Paste the confirmed interface from 2d-plan]

## Async states
[list needed states: loading / error / empty / success — only if confirmed in 2d-plan]

## Design system
- UI library: [from Phase 1e — e.g. @radix-ui, shadcn, none]
- Reuse: [existing shared components from Phase 1e]

## Existing code (if updating)
[Paste current file content from 2d — change only CSS values that differ, preserve logic/structure/naming]

## Visual reference
[Attach /tmp/figma-NODE_ID.png from 2a-screenshot]

## Execution rules
- **Think first** — before writing any line, state in one sentence what changes and why it matches the goal
- **Surgical** — write only `[file_path]`. Do not create stories, config, hooks, or helper files unless explicitly listed above
- **No assumptions** — if any Figma value above is missing or ambiguous, state the gap; do not invent a value
- **Simplicity first** — no abstractions unless 3+ concrete duplications force it right now
- **No over-engineering** — no future-proofing, no "while I'm here" refactors

## Code rules
- Named export, interface [ComponentName]Props at top of file
- Tailwind only — no inline styles except dynamic values (e.g. calculated widths)
- Never hardcode visible text — every text node is a prop, use Figma text as default value
- Check i18n: if project uses useTranslation, use t() keys instead of string defaults
- Semantic HTML: button for actions, nav/main/section for layout, ul/li for lists, table for tabular data
- ARIA: aria-label on icon-only buttons, alt on images, role="dialog" on modals
- key in lists: use stable identifier, never key={index}
- Split if JSX exceeds ~150 lines — extract at natural boundaries (repeated sub-elements, separate Figma node IDs)
- Import order: React → third-party → internal aliases → relative → type-only imports

Write only the component file at [file_path].
```

---

After the agent completes, read the generated file and verify it looks correct before proceeding to 2f.

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

After 2a–2g: load sub-skill `figma-to-feature/phase2-production` for production readiness rules.
