---
name: figma-to-component
description: Use when converting a Figma design to a React/TypeScript component. Triggers on /figma-to-component, "generate component from figma", "figma to react", "convert figma to component". Extracts images from the Figma design and uses them as mock data instead of placeholders.
---

# figma-to-component

Generate a single production-ready React component from a Figma design using multi-agent architecture.

## Trigger

- /figma-to-component
- User mentions "generate component from figma", "figma to react", "convert figma to component"

## Execution Rules

**Think before spawning** — Before spawning the `frontend-developer` agent, confirm you have: file path, Figma data, Tailwind mapping, confirmed props interface, and user approval. Missing any of these = ask, not guess.

**Atomic decomposition first** — Before writing any code, decompose the design into the smallest reusable units (atoms → molecules → organisms). Never write a component that can be split further. A 200-line JSX file is a decomposition failure.

**Reuse before create** — Before creating a new atom/molecule, check if an equivalent already exists in the codebase (`find src/ -name "Button*" -o -name "Badge*"`). Reuse and extend, never duplicate.

**Simplicity first** — Pass only what the agent needs. Do not over-specify — if the Figma node has no shadow, don't mention shadow in the prompt.

**Goal = match Figma** — The output must match the Figma design. Not "close enough", not "similar pattern from another component", not "how I'd normally build it".

**Decompose, then assemble** — When user asks for `ProductCard`, the output is: `Badge` + `Avatar` + `Button` + `ProductCard` (assembled from atoms). Generating only `ProductCard` as a monolith is a violation.

**Responsive is mandatory, not optional** — Every component MUST support all breakpoints found in the Figma file. A component that only works at desktop width is incomplete. No component is "done" until responsive is verified at each breakpoint (Step 2d → Step 3 → Step 4 → Step 7).

**Bulk fetch before any analysis** — In API mode, the very first action is ALWAYS to fetch ALL pages at depth=5 and save to `figma-nodes-cache.json`. Never fetch individual node properties from the API — read from cache. Piecemeal fetches at depth=2 or depth=4 silently miss nested components and text nodes, causing incomplete implementation.

**MANDATORY: Typography and Layout must match Figma exactly — no tolerance**

Typography (`fontFamily`, `fontWeight`, `fontSize`, `lineHeight`, `letterSpacing`, `textAlign`, `color`) and layout (`flexDirection`, `padding`, `gap`, `alignItems`, `justifyContent`) are non-negotiable. The generated component MUST reproduce both exactly as specified in Figma.

- **Typography**: Every text node in Figma has a `style` object. Read it. Map every field (`fontSize`, `fontWeight`, `lineHeightPx`, `letterSpacing`, `textAlignHorizontal`) to Tailwind classes and verify after generation. Do not approximate (`text-sm` when Figma says 15px → use `text-[15px]`).
- **Layout**: Every auto-layout frame has `layoutMode`, `paddingTop/Bottom/Left/Right`, `itemSpacing`, `counterAxisAlignItems`, `primaryAxisAlignItems`. Read all fields. Map all fields. If a padding value is 0, still check whether the parent or sibling in Figma has spacing that compensates.
- **Before calling the frontend-developer agent**: verify that the prompt includes BOTH the full typography spec AND the full layout spec extracted from the cache. An agent prompt missing either of these will produce a component that fails design contract tests.
- **After code generation**: grep the output for the expected font-size, font-weight, and gap/padding classes. If any are missing → fix before marking the step complete.

---

## Instructions

You are an AI orchestrator that converts Figma designs into production-ready React/TypeScript components using a multi-agent architecture.

### Architecture Overview

**Phase 1: Planning (Opus)**
- Analyze Figma design structure
- **Atomic decomposition**: identify atoms → molecules → organisms bottom-up
- Detect duplicate/reusable elements across screens
- Check existing codebase for reusable components before planning new ones
- Define build order (atoms first, then molecules, then organisms)
- Define data flow and props interface per level

**Phase 2: Code Generation (Frontend Developer Agent)**
- Ask user which model to use (default: `claude-sonnet-4-6`)
- Spawn `frontend-developer` agent via Agent tool to generate complete React components
- Agent handles CSS (Tailwind), JSX structure, TypeScript interfaces, and logic
- Generates production-ready code following best practices

**Phase 3: Visual Verification Loop**
- Start dev server, screenshot rendered component with Playwright
- Load both images (Figma reference + rendered screenshot) into vision context
- AI compares side-by-side, lists specific discrepancies
- Auto-fix diffs in component file, re-screenshot
- Repeat until match (max 3 iterations) or escalate to user

### Workflow

#### 1. Get Figma Design Input

Ask user for Figma URL or use provided URL:
```
Please provide:
1. Figma design URL (figma.com/design/... or figma.com/file/...)
2. Specific node ID (optional - if you want a specific component/frame)
```

#### 2. Detect Figma data source & Extract Design Context

First, detect which method is available — use it for all subsequent Figma fetches:

- **Try** calling `figma___get_metadata` with the file key
- If it returns data → **MCP mode**
- If unavailable → **API mode**: load `FIGMA_TOKEN` + `FIGMA_FILE_KEY` from `.env`

**[MCP]** Call in sequence:
- `figma___get_metadata` — file structure, pages
- `figma___get_design_context` with node ID — layout, fills, typography, effects
- `figma___get_screenshot` with node ID — visual reference image (attach to agent prompt)
- For each image node inside the component, call `figma___get_screenshot` to get the actual image URL

**[API] — Bulk fetch ALL nodes first, then read from cache:**

```bash
source .env

# Step A — List all files in the project (requires FIGMA_PROJECT_ID in .env)
curl -s -H "X-Figma-Token: $FIGMA_TOKEN" \
  "https://api.figma.com/v1/projects/$FIGMA_PROJECT_ID/files" \
  | node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    (d.files || []).forEach(f => console.log(f.key + '\t' + f.name));
  "
# Confirm FIGMA_FILE_KEY matches the target file from the list above

# Step B — Fetch complete file JSON (no depth limit)
curl -s -H "X-Figma-Token: $FIGMA_TOKEN" \
  "https://api.figma.com/v1/files/$FIGMA_FILE_KEY" \
  > figma-nodes-cache.json
echo "Cached: $(wc -c < figma-nodes-cache.json) bytes"

# Step C — Extract and verify all node IDs
node -e "
  const d = JSON.parse(require('fs').readFileSync('figma-nodes-cache.json','utf8'));
  const roots = d.document ? [d.document] : Object.values(d.nodes).map(n => n.document);
  let frames=0, text=0, total=0;
  function walk(n) { total++; if(n.type==='FRAME')frames++; if(n.type==='TEXT')text++; (n.children||[]).forEach(walk); }
  roots.forEach(walk);
  console.log('Total nodes:', total, ' FRAME:', frames, ' TEXT:', text);
  if(text===0) console.error('⚠ 0 text nodes — fetch may have failed');
  else console.log('✓ Cache complete');
"

# Step C: Walk cache to find target component node (replace ComponentName)
node -e "
  const d = JSON.parse(require('fs').readFileSync('figma-nodes-cache.json','utf8'));
  function walk(n, page) {
    const w = n.absoluteBoundingBox?.width;
    if (n.name.toLowerCase().includes('SEARCH_TERM')) {
      console.log(page, n.id, n.name, '['+n.type+']', w ? w+'px' : '');
    }
    (n.children||[]).forEach(c => walk(c, page));
  }
  // /files/:key format: d.document.children = pages
  (d.document.children||[]).forEach(page => (page.children||[]).forEach(c => walk(c, page.name)));
" 2>&1 | head -30
# Replace SEARCH_TERM with a keyword from the component name

# Step D: Screenshot of the target node (use as visual reference)
curl -s -H "X-Figma-Token: $FIGMA_TOKEN" \
  "https://api.figma.com/v1/images/$FIGMA_FILE_KEY?ids=NODE_ID&format=png&scale=2"

# Step E: Export individual image nodes (for mock data)
curl -s -H "X-Figma-Token: $FIGMA_TOKEN" \
  "https://api.figma.com/v1/images/$FIGMA_FILE_KEY?ids=NODE_ID1,NODE_ID2&format=png&scale=2"
# Returns: { "images": { "NODE_ID1": "https://...", "NODE_ID2": "https://..." } }
```

**⚠️ Never fetch individual node properties from the API after Step B.** Read from `figma-nodes-cache.json` for all subsequent steps. If a node is not in the cache, re-run Step B with depth=8.

**Image node detection:** When traversing the Figma node tree, identify nodes where:
- `type === "RECTANGLE"` and `fills[].type === "IMAGE"` — these are image placeholders
- `type === "VECTOR"` or `type === "INSTANCE"` that represent avatars, product photos, banners

Extract from either source:
- File key, node ID, component hierarchy
- Design tokens (colors, spacing, typography)
- **Image node IDs** — collect all image nodes for export in next step

#### 2b. Detect Responsive Breakpoints from Figma

**Before extracting images, scan the Figma file for multiple breakpoint frames.** Designers typically create separate frames per breakpoint, named or sized differently.

**[MCP]** List all top-level frames on the relevant page:
```
figma___get_design_context(nodeId: PAGE_ID)
→ Look at children frames — names like "Desktop", "Mobile", "Tablet", "1440", "768", "375"
```

**[API]** Read from cache (no new API call):
```bash
# List all top-level frames across all pages with their widths
node -e "
  const d = JSON.parse(require('fs').readFileSync('figma-nodes-cache.json','utf8'));
  // /files/:key format: d.document.children = pages
  (d.document.children || []).forEach(page => {
    console.log('=== PAGE:', page.name);
    (page.children || []).forEach(f => {
      const w = f.absoluteBoundingBox?.width;
      console.log(f.id, '\t', f.name, '\t['+f.type+']\t', w ? w+'px' : '?');
    });
  });
"
```

**Breakpoint detection rules:**

| Frame width | Breakpoint | Tailwind prefix |
|---|---|---|
| ≥ 1280px | Desktop (xl) | default / `xl:` |
| 1024px – 1279px | Large tablet (lg) | `lg:` |
| 768px – 1023px | Tablet (md) | `md:` |
| 640px – 767px | Small tablet (sm) | `sm:` |
| < 640px | Mobile | `sm:` (base) |

**Build a breakpoint map:**
```
RESPONSIVE FRAMES FOUND:
- Desktop (1440px)  → node: XXXX-001  → Tailwind: default
- Tablet  (768px)   → node: XXXX-002  → Tailwind: md:
- Mobile  (375px)   → node: XXXX-003  → Tailwind: sm: (base)
```

If only ONE frame is found → still apply mobile-first defaults and flag to user:
```
⚠️  Only one breakpoint found in Figma (Xpx). Generating mobile-first responsive classes using standard breakpoints.
```

**Screenshot ALL breakpoint frames** (not just desktop):
```bash
# Get screenshot for each breakpoint frame
curl -s -H "X-Figma-Token: $FIGMA_TOKEN" \
  "https://api.figma.com/v1/images/$FIGMA_FILE_KEY?ids=DESKTOP_ID,TABLET_ID,MOBILE_ID&format=png&scale=1.5"
# Save as: /tmp/figma-ref-[ComponentName]-desktop.png, -tablet.png, -mobile.png
```

Store breakpoint map as `responsiveFrames` — pass this to Step 3 and Step 4.

---

#### 2c. Export Images from Design (for Mock Data)

After identifying image nodes, export them to get real URLs:

**[MCP]** For each image node:
```
figma___get_screenshot(nodeId: IMAGE_NODE_ID)
→ Returns URL of the actual image rendered from Figma
```
Collect all URLs into a map: `{ nodeId → imageUrl }`

**[API]** Batch export all image nodes at once:
```bash
# Comma-separate all image node IDs
IMAGE_NODES="NODE_ID1,NODE_ID2,NODE_ID3"
curl -s -H "X-Figma-Token: $FIGMA_TOKEN" \
  "https://api.figma.com/v1/images/$FIGMA_FILE_KEY?ids=$IMAGE_NODES&format=png&scale=2" \
  | jq '.images'
# Returns: { "NODE_ID1": "https://cdn.figma.com/...", "NODE_ID2": "..." }
```

Store the result as `imageAssets` (remote URLs from Figma S3):
```json
{
  "productImage1": "https://figma-alpha-api.s3.us-west-2.amazonaws.com/...",
  "avatar": "https://figma-alpha-api.s3.us-west-2.amazonaws.com/...",
  "banner": "https://figma-alpha-api.s3.us-west-2.amazonaws.com/..."
}
```

#### 2d. Download Images to Local (ALWAYS DO THIS)

**Figma S3 URLs expire** — always download them to local before passing to the component.

**Determine download destination** (check in order):
1. If project has `public/images/figma/` → use it
2. If project has `public/assets/` → use `public/assets/figma/`
3. If project has any `public/` directory → use `public/figma/`
4. Fallback → `/tmp/figma-assets/`

```bash
# Create destination directory
DEST="public/images/figma"   # or /tmp/figma-assets
mkdir -p "$DEST"

# Download each image (names should be descriptive, not node IDs)
curl -sL -o "$DEST/product-image-1.png" "https://figma-alpha-api.s3.us-west-2.amazonaws.com/..."
curl -sL -o "$DEST/avatar.png" "https://figma-alpha-api.s3.us-west-2.amazonaws.com/..."
curl -sL -o "$DEST/banner.png" "https://figma-alpha-api.s3.us-west-2.amazonaws.com/..."
```

After downloading, build `localImageAssets` map using paths relative to project root:
```json
{
  "productImage1": "/images/figma/product-image-1.png",
  "avatar": "/images/figma/avatar.png",
  "banner": "/images/figma/banner.png"
}
```

If downloaded to `/tmp`, use absolute paths:
```json
{
  "productImage1": "/tmp/figma-assets/product-image-1.png"
}
```

**Use `localImageAssets` (not the S3 URLs) in all mock data and component props.**

These local paths will be used in mock data — **never use placeholder URLs like `picsum.photos` or `via.placeholder.com`** when real images are available from the design.

#### 3. Atomic Decomposition & Plan (Opus)

**Step A — Scan existing components first:**
```bash
find src -type f -name "*.tsx" | xargs grep -l "export" | head -40
# Look for: Button, Badge, Avatar, Tag, Icon, Input, Card, Text, Image components
```
List what already exists → mark as `[REUSE]` in plan, not `[CREATE]`.

**Step B — Decompose the Figma design bottom-up:**

Traverse the Figma node tree and classify every visual element:

| Level | Rule | Examples |
|---|---|---|
| **Atom** | Cannot be split further. Single visual purpose. < 30 lines JSX. | Button, Badge, Avatar, Icon, Tag, Chip, Divider, Skeleton |
| **Molecule** | 2–4 atoms combined. One interaction purpose. < 60 lines JSX. | SearchBar, UserInfo, RatingStars, PriceTag, ImageWithCaption |
| **Organism** | Multiple molecules. One section of UI. < 100 lines JSX. | ProductCard, NavBar, FilterPanel, CommentThread |
| **Template** | Assembles organisms into a page layout. No business logic. | PageLayout, DashboardTemplate |

**Decomposition test** — ask for each component:
> "Can any part of this be extracted and used elsewhere on the screen or in another screen?"  
> If YES → extract it. If NO → it's an atom.

**Step C — Detect duplicates across screens:**

Elements that appear 2+ times across screens = must be components, never inline repeated JSX.

```
DUPLICATE DETECTION:
- [element description] appears in [Screen A], [Screen B] → create as shared atom/molecule
```

**Step D — Write the plan:**

```markdown
## Atomic Decomposition

### Responsive Breakpoints
| Breakpoint | Figma frame | Width | Tailwind |
|---|---|---|---|
| Desktop | XXXX-001 | 1440px | default |
| Tablet | XXXX-002 | 768px | md: |
| Mobile | XXXX-003 | 375px | base (sm:) |

### Atoms (build first)
| Component | Status | Props | Responsive behavior |
|---|---|---|---|
| `Button` | [REUSE] src/components/Button.tsx | - | full-width on mobile |
| `Badge` | [CREATE] | variant, label, color | no change across breakpoints |
| `Avatar` | [CREATE] | src, size, alt | size: 32px mobile / 40px desktop |
| `StarIcon` | [CREATE] | filled: boolean | no change |

### Molecules (build second)
| Component | Status | Composed of | Responsive behavior |
|---|---|---|---|
| `RatingStars` | [CREATE] | StarIcon × 5 | hidden on mobile, visible md: |
| `PriceTag` | [CREATE] | Text atoms | font-size smaller on mobile |
| `UserInfo` | [CREATE] | Avatar + Text | stacks vertically on mobile |

### Organisms (build last)
| Component | Status | Composed of | Responsive behavior |
|---|---|---|---|
| `ProductCard` | [CREATE] | Badge + Avatar + RatingStars + PriceTag + Button | grid-cols-1 mobile / grid-cols-2 md: |

## Build Order
1. Badge, Avatar, StarIcon  ← atoms, no dependencies
2. RatingStars, PriceTag, UserInfo  ← molecules, depend on atoms
3. ProductCard  ← organism, assembles everything

## Design Tokens
- Colors: [exact hex list]
- Typography: [font sizes, weights — per breakpoint if different]
- Spacing: [px values used — per breakpoint if different]

## Image Assets (from Figma export)
- [name]: [local path after step 2d download]
```

Show plan to user:
```
Here's the decomposition plan — [N] atoms, [M] molecules, [K] organisms.
[N_reuse] can be reused from existing code, [N_create] need to be created.

Build order: [list]

Should I proceed?
```

#### 4. Spawn Frontend Developer Agent (one per component, build order: atoms first)

Ask which model to use:
```
Which model should the frontend-developer agent use?
  1. claude-sonnet-4-6 (default)
  2. claude-opus-4-7
  3. claude-haiku-4-5-20251001
  [Enter number or press Enter for default]
```

**Spawn one agent per component, following the build order from step 3.**  
Do not spawn an organism agent until all its molecule/atom dependencies are created.

Agent prompt template (repeat for each `[CREATE]` component):

```
Goal: Generate ONE atomic React/TypeScript component — [ComponentName] ([Atom|Molecule|Organism])

ATOMIC DESIGN RULES (strictly enforced):
- This component does ONE thing. No more.
- Max JSX lines: Atom=30, Molecule=60, Organism=100
- If you find yourself writing more — stop and split further
- Import atoms/molecules from their paths instead of inlining their markup
- Never repeat JSX that could be its own component

RESPONSIVE RULES (strictly enforced):
- Use mobile-first: write base styles for mobile, override with `md:` / `lg:` / `xl:` for larger screens
- NEVER use fixed pixel widths like `w-[400px]` on layout containers — use `w-full`, `max-w-[Xpx]`, or responsive variants
- NEVER hardcode a layout as desktop-only — if the Figma only shows desktop, infer the mobile layout from the structure
- When in doubt: stack vertically on mobile, place side-by-side on desktop
- Check the responsive behavior table before writing a single class

Component level: [Atom | Molecule | Organism]
Dependencies (already created — import from these paths):
- [AtomName] → [path]
- [MoleculeName] → [path]

CRITICAL: Match the Figma design EXACTLY at EVERY breakpoint.
Figma screenshots (attach ALL):
- Desktop (default): [ATTACH /tmp/figma-ref-[ComponentName]-desktop.png]
- Tablet (md:): [ATTACH /tmp/figma-ref-[ComponentName]-tablet.png — if exists]
- Mobile (base): [ATTACH /tmp/figma-ref-[ComponentName]-mobile.png — if exists]

Context:
- Design tokens: [colors (exact hex), spacing (px values), font sizes, weights]
- Layout: [flexbox/grid, alignment]
- Props interface: [from plan — minimal, focused props only]
- Variants/states: [from Figma — e.g. default/hover/disabled/active]

Responsive Behavior (from Step 2b breakpoint analysis):
- Mobile (base / < 640px):
  - Layout: [e.g. flex-col, full-width, hidden elements]
  - Typography: [e.g. text-sm, font changes]
  - Spacing: [e.g. px-4, gap-2]
- Tablet (md: / 768px+):
  - Layout: [e.g. flex-row, 2-column grid]
  - Typography: [e.g. text-base]
  - Spacing: [e.g. px-6, gap-4]
- Desktop (lg: / 1024px+):
  - Layout: [e.g. 3-column grid, sidebar visible]
  - Typography: [e.g. text-lg for headings]
  - Spacing: [e.g. px-8, gap-6]

Elements that change visibility:
- [ElementName]: hidden on mobile, block on md:
- [ElementName]: block on mobile (hamburger menu), hidden on md:

Image Assets (local paths — use in mock data):
- [name]: "[local path from step 2d]"

Mock Data Rules:
- Use local Figma image paths for any image fields
- Do NOT use picsum.photos, via.placeholder.com, or any remote placeholder
- Text content must match Figma labels exactly

Tasks:
1. One focused component, TypeScript, strict props interface
2. Tailwind classes — mobile-first, match Figma at every breakpoint
   - Use `sm:`, `md:`, `lg:`, `xl:` prefixes for overrides
   - Use arbitrary values (`w-[Xpx]`) only for fixed assets (icons, images) — never for layout containers
3. Semantic HTML + accessibility (aria attributes, roles)
4. Export named + default
5. If Atom: include all visual variants as props (variant, size, color, disabled, etc.)
6. If Molecule: compose from imported atoms only — no inline atom markup
7. If Organism: compose from imported molecules/atoms — no inline molecule markup

Design Accuracy Checklist:
- [ ] Colors match Figma exactly at all breakpoints
- [ ] Spacing/padding match Figma pixel values (per breakpoint)
- [ ] Font sizes, weights, line heights match (per breakpoint)
- [ ] Border radius, shadows match
- [ ] Layout switches correctly at each breakpoint (columns → stack, etc.)
- [ ] Elements that should hide/show at breakpoints are handled with `hidden md:block` etc.
- [ ] Component is self-contained and has no hardcoded dependencies on parent context
- [ ] No fixed-width layout containers (use responsive width classes)

Output:
- Single `.tsx` file + `types.ts` if props are complex
- **No CSS file** — all styles via Tailwind classes in JSX
- If a style truly can't be done with Tailwind, note it as a comment like:
  `{/* TODO globals.css: add .scrollbar-hide to @layer utilities */}`
  The orchestrator will consolidate these into globals.css after all components are built
```

#### 5. Create Component Files

Use this file structure — **flat by level, not by feature**:

```
components/
  atoms/
    Button/
      index.tsx       ← named + default export
      Button.tsx      ← Tailwind classes only, no CSS file
      types.ts        ← ButtonProps interface
    Badge/
      index.tsx
      Badge.tsx
    Avatar/
      index.tsx
      Avatar.tsx
  molecules/
    RatingStars/
      index.tsx
      RatingStars.tsx
    PriceTag/
      index.tsx
      PriceTag.tsx
  organisms/
    ProductCard/
      index.tsx
      ProductCard.tsx
      types.ts

styles/
  globals.css         ← ALL custom CSS lives here (design tokens, @layer components/utilities)
```

**Rule:** If you see a `*.css` file inside `components/`, it's wrong — move its contents to `globals.css` under the appropriate `@layer`.

**Index barrel exports** — create/update `components/atoms/index.ts`, `components/molecules/index.ts`, `components/organisms/index.ts`:
```ts
// components/atoms/index.ts
export { default as Button } from './Button';
export { default as Badge } from './Badge';
export { default as Avatar } from './Avatar';
```

This allows imports like: `import { Button, Badge } from '@/components/atoms'`

**Supporting files** (only if needed):
   - `types.ts` — shared TypeScript interfaces across levels
   - `constants.ts` — shared design token values if not using CSS vars

**After all components are built — collect CSS TODOs into globals.css:**
```bash
# Find all CSS TODOs left by agents
grep -rn "TODO globals.css" src/components/
```
For each hit, add the corresponding rule to `styles/globals.css` under the right `@layer`, then remove the comment from the component file.
   - `README.md` - Component documentation

#### 6. Visual Verification Loop (Phase 3)

**This step is MANDATORY after creating component files. Never skip.**

**Max iterations: 3.** Each iteration = screenshot → compare → fix → repeat.

---

##### 7a. Detect Renderer & Find Component URL

Check project type to determine where to view the component:

```bash
# Check for Storybook
ls .storybook/ 2>/dev/null && echo "storybook"

# Check for Next.js
cat package.json | grep '"next"'

# Check for Vite / CRA
cat package.json | grep -E '"vite"|"react-scripts"'
```

| Project type | Dev command | Component URL |
|---|---|---|
| Storybook | `npm run storybook` | `http://localhost:6006/iframe.html?id=<story-id>` |
| Next.js | `npm run dev` | `http://localhost:3000/<route>` |
| Vite | `npm run dev` | `http://localhost:5173/<route>` |
| CRA | `npm start` | `http://localhost:3000/<route>` |

**If project has Storybook** — prefer Storybook because it renders the component in isolation.  
Find or create a story for the component:
```bash
ls src/**/*.stories.* 2>/dev/null | grep -i "[ComponentName]"
```
If story doesn't exist, create a minimal one:
```tsx
// [ComponentName].stories.tsx
import { ComponentName } from './[ComponentName]';
export default { title: 'Components/[ComponentName]', component: ComponentName };
export const Default = {};
```

**If no Storybook** — create a temporary preview page at `/tmp/preview-[ComponentName].html` or add a `/dev/preview` route, render the component with mock data.

---

##### 7b. Start Dev Server

```bash
# Start server in background, wait for it to be ready
npm run storybook &   # or npm run dev
SERVER_PID=$!

# Wait up to 30s for server
for i in $(seq 1 30); do
  curl -s http://localhost:6006 > /dev/null && break
  sleep 1
done
```

If server already running (port in use), skip start and use existing.

---

##### 7c. Screenshot with Playwright (ALL breakpoints)

Save Figma reference screenshots (already done in step 2b) — confirm these files exist:
- `/tmp/figma-ref-[ComponentName]-desktop.png`
- `/tmp/figma-ref-[ComponentName]-tablet.png` (if Figma had tablet frame)
- `/tmp/figma-ref-[ComponentName]-mobile.png` (if Figma had mobile frame)

Then capture rendered component **at each breakpoint**:

```bash
node -e "
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const viewports = [
    { name: 'desktop', width: 1280, height: 900 },
    { name: 'tablet',  width: 768,  height: 1024 },
    { name: 'mobile',  width: 375,  height: 812 },
  ];
  for (const vp of viewports) {
    const page = await browser.newPage();
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto('COMPONENT_URL', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    await page.screenshot({
      path: '/tmp/rendered-[ComponentName]-' + vp.name + '-iter[N].png',
    });
    await page.close();
    console.log('Screenshot saved:', vp.name);
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
"
```

Replace `[N]` with current iteration number (1, 2, 3).

---

##### 7d. AI Visual Diff (CRITICAL STEP — run for EACH breakpoint)

Load **all breakpoint image pairs** into context and compare:
- `figma_desktop` vs `rendered_desktop`
- `figma_tablet` vs `rendered_tablet` (if tablet frame existed)
- `figma_mobile` vs `rendered_mobile` (if mobile frame existed)

**Comparison checklist — check every item at EVERY breakpoint:**

| Category | What to check |
|---|---|
| **Layout** | Structure matches at this breakpoint? Columns collapse to rows? |
| **Responsive switches** | Elements that should hide/show at this viewport are correct? |
| **Spacing** | Padding/margin/gap between elements — exact px (may differ per breakpoint) |
| **Colors** | Background, text, border, icon colors — exact hex |
| **Typography** | Font size, weight, line-height (may differ per breakpoint) |
| **Sizing** | Width, height of cards, buttons, images, icons |
| **Border/Radius** | Border-radius, border-width, border-color |
| **Shadows** | Box-shadow presence, offset, blur, color |
| **Images** | Image displayed, correct aspect ratio, object-fit |
| **Text** | Content matches Figma labels exactly |
| **States** | Hover, active, disabled states visible if shown in Figma |

Output the diff as a structured list **per breakpoint**:
```
DIFF REPORT — Iteration [N]

[DESKTOP — 1280px]
✅ PASS: [items that match]
❌ FAIL:
  1. [Element]: Figma=[value] | Rendered=[value] | Fix=[specific CSS/class change]

[TABLET — 768px]
✅ PASS: [items that match]
❌ FAIL:
  1. [Element]: Figma=[value] | Rendered=[value] | Fix=[specific CSS/class change]

[MOBILE — 375px]
✅ PASS: [items that match]
❌ FAIL:
  1. [Element]: Figma=[value] | Rendered=[value] | Fix=[specific CSS/class change]

OVERALL MATCH SCORE: [X/10 per breakpoint, e.g. Desktop 9/10, Tablet 8/10, Mobile 7/10]
```

---

##### 7e. Auto-Fix

For each `❌ FAIL` item, apply the fix directly to the component file:

- **Color mismatch** → change Tailwind class or hex value
- **Spacing off** → adjust `p-`, `m-`, `gap-`, or use arbitrary `p-[Xpx]`
- **Font wrong** → fix `text-`, `font-`, `leading-`, `tracking-` classes
- **Size wrong** → fix `w-`, `h-`, or use `w-[Xpx]` arbitrary values
- **Border/shadow** → add/fix `rounded-`, `shadow-`, `border-` classes
- **Layout wrong** → fix `flex`, `grid`, `items-`, `justify-` classes

After applying all fixes, go back to **step 7c** (re-screenshot, increment iteration).

---

##### 7f. Loop Exit Conditions

```
IF all breakpoints score >= 9/10 → PASS ✅ — proceed to step 8
IF any breakpoint score < 9/10 AND iteration < 3 → fix that breakpoint's issues → re-screenshot → repeat
IF iteration == 3 AND any breakpoint score < 9/10 → ESCALATE to user:
  Show:
  - Figma reference images (all breakpoints)
  - Best rendered screenshots (highest score iteration, all breakpoints)
  - Remaining diff list per breakpoint
  Ask: "These [N] issues remain after 3 iterations:
    - Desktop: [list]
    - Tablet: [list]
    - Mobile: [list]
  Should I:
    1. Try 3 more iterations
    2. Show me exactly what to fix manually
    3. Accept current state"
```

**Do NOT mark component as done until ALL breakpoints score ≥ 9/10 or user explicitly accepts.**

---

#### 8. Type Check & Summary

1. **Run type checking**:
   ```bash
   npx tsc --noEmit
   ```

2. **Show final summary**:
   ```
   ✅ Component [ComponentName] generated
   ✅ Visual verification passed ([score]/10) after [N] iteration(s)
   ✅ Type checking passed

   Files:
   - [ComponentName]/index.tsx
   - [ComponentName]/types.ts

   Figma source: [URL]
   Screenshot comparison: /tmp/rendered-[ComponentName]-iter[N].png vs /tmp/figma-ref-[ComponentName].png
   ```

### Best Practices

**Code Quality:**
- Use TypeScript strict mode
- Follow React best practices (hooks rules, key props, etc.)
- Use semantic HTML elements
- Include accessibility attributes
- Add proper error boundaries
- Use meaningful variable names

**Styling:**
- **Tailwind utility classes only** — no per-component CSS files (`styles.css`, `Component.css`)
- Custom styles that Tailwind can't handle → write to **global CSS** (`globals.css` / `index.css`) inside `@layer components { }` or `@layer utilities { }`
- Design tokens (colors, spacing, radii, shadows) → CSS variables in `:root` inside global CSS, then reference via Tailwind config or `var(--token)`
- **Never create a CSS file scoped to one component** — it pollutes the global namespace without the scoping benefit of CSS Modules
- Include hover/focus/disabled states (`hover:` `focus:` `disabled:` variants)
- Add smooth transitions via Tailwind (`transition-all duration-200`)

**Responsive (mandatory — not optional):**
- **Mobile-first always** — base classes = mobile styles; `md:`, `lg:`, `xl:` = overrides for larger screens
- **Never use fixed-width layout containers** — `w-[400px]` on a card or page section is wrong; use `w-full max-w-[400px]` or responsive variants
- **Layout switching pattern:**
  ```tsx
  // Stack on mobile, side-by-side on tablet+
  <div className="flex flex-col md:flex-row gap-4">
  
  // Single column mobile, 2-col tablet, 3-col desktop
  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
  ```
- **Visibility switching pattern:**
  ```tsx
  // Hamburger: show mobile, hide desktop
  <button className="block md:hidden">☰</button>
  // Nav: hide mobile, show desktop
  <nav className="hidden md:flex gap-6">
  ```
- **Typography scaling pattern:**
  ```tsx
  <h1 className="text-2xl md:text-3xl lg:text-4xl font-bold">
  <p className="text-sm md:text-base">
  ```
- **Spacing scaling pattern:**
  ```tsx
  <section className="px-4 md:px-8 lg:px-16 py-8 md:py-12">
  ```
- **Images:** always use `w-full h-auto` or `object-cover` with `aspect-ratio` classes — never fixed `w-[Xpx] h-[Ypx]` on images that span layout

**Global CSS structure** (`globals.css`):
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

/* Design tokens */
:root {
  --color-primary: #3B82F6;
  --radius-card: 12px;
  --shadow-card: 0 2px 8px rgba(0,0,0,0.1);
}

/* Custom utilities Tailwind can't express */
@layer components {
  .card-shadow { box-shadow: var(--shadow-card); }
}

@layer utilities {
  .scrollbar-hide { scrollbar-width: none; }
}
```

**Performance:**
- Use React.memo for expensive components
- Lazy load heavy components
- Optimize images
- Avoid unnecessary re-renders

**Maintainability:**
- Keep components small and focused
- Extract reusable logic to hooks
- Document complex logic
- Use consistent naming conventions

### Error Handling

If Figma MCP is not available:
```
Figma MCP is not connected. Add it with:
  claude mcp add figma --transport http-sse https://mcp.figma.com/mcp

Then restart Claude Code and try again.
```

If design is too complex:
```
This design is quite complex. I recommend breaking it into smaller components.
Should I:
1. Generate all components at once
2. Let you choose which components to generate first
3. Create a simplified version first
```

If agents fail:
```
One or more agents encountered an error. 
[Show error details]

Should I:
1. Retry with the same plan
2. Adjust the plan and retry
3. Generate manually without agents
```

### Notes

- Always show the plan before generating code
- Allow user to modify the plan
- Generate production-ready code, not prototypes
- Include proper TypeScript types
- Follow the project's existing code style if detected
- Suggest improvements to the Figma design if issues found
- Always link back to the Figma source
