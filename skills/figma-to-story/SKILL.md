# Skill: figma-to-story

Create React component stories wired to design-contract testing. Supports single-component and full-audit batch modes.

## Goal

**Maximum coverage, not maximum pass rate.**

The definition of success is: every component has a story, and every story compares as many CSS properties against Figma as possible. A test that fails because the component diverges from Figma is doing its job correctly — it surfaces a real discrepancy. A test that passes because checks were reduced is a false negative.

- **Good outcome**: 20 components tested, 5 failing → the 5 failures are real discrepancies to report
- **Bad outcome**: 20 components tested, 20 passing → 8 had CSS quietly changed to match the test

When in doubt, add more checks, not fewer.

---

## The Iron Rule: Never modify component CSS/logic to make a test pass

**This skill creates test infrastructure. It does not fix components.**

The only files this skill is allowed to touch on a component are:
- `[Component].tsx` — **only** to add `data-testid` attributes. Nothing else.
- `[Component].stories.tsx` — create/update story
- `design-check.config.mjs` — add config entry
- `design-spec.json` — sync spec entry

**Forbidden at all times during this skill:**

| Action | Why it's forbidden |
|---|---|
| Changing a Tailwind class to match what the test expects | Hides the discrepancy instead of surfacing it |
| Changing a CSS value (color, spacing, radius…) because the test failed | The test failure IS the deliverable — it means Figma ≠ component |
| Restructuring JSX to make a selector work | Scope creep; use a different selector instead |
| Fixing "other issues" noticed while reading the component | Out of scope for this skill |
| Removing a `check` entry to make a test pass | Reduces coverage; invalid except for structural impossibilities |

**When a test fails after wiring:**

```
✓ CORRECT response: "Test for [component] is failing on [check]. 
  This means the component diverges from Figma on [property]. 
  Reporting as a discrepancy — no action taken."

✗ WRONG response: "I'll adjust the padding to match the expected value 
  so the test passes."
```

A failing test is the correct, intended output of this skill. It means the infrastructure is working. Component fixes belong to a separate task, driven by the user, after reviewing the discrepancy.

**The only valid reason to touch component CSS:** the user explicitly says "fix this component to match Figma" as a separate instruction. Even then, changes must be driven by the Figma node data — not by reverse-engineering what value would make the test pass.

---

## Execution Rules

**Think before editing** — Before touching any file (component, story, config), state what changes and why. One sentence. If unclear, ask.

**Scope = testid + story + config only** — Adding a story for `LoginCard` means touching: `LoginCard.tsx` (add `data-testid` only), `LoginCard.stories.tsx`, `design-check.config.mjs`, `design-spec.json`. Nothing else. No CSS, no logic, no props.

**Surgical testid placement** — Add `data-testid` only where needed for design-check. Do not reorganize the component, rename props, or fix other issues noticed while reading the file.

**No assumptions** — Figma node ID not provided? Ask. Component has no clear root element? Ask. Do not pick a node ID by guessing from the Figma URL structure.

**Config changes are additive** — Only append to `cases[]` and `contractCases[]`. Never reformat, reorder, or touch existing entries.

**Stories go in `stories/` subfolder** — Never place `.stories.tsx` next to the component file. Always create `[ComponentDir]/stories/ComponentName.stories.tsx`. Create the `stories/` directory if it doesn't exist.

**Wire all gaps, not some** — Mode B must process EVERY component in the gap report. Do not ask "which ones?" — print the full list, confirm node IDs for all, then proceed in order. Never stop partway through.

**Never declare done early** — A batch run is only complete when Step 5e (final audit) confirms zero remaining gaps. Do not mark the task done after the last component's Step 4 — always run the final audit first.

**One component at a time, fully** — In batch mode, complete all steps (0d → 1 → 2 → 3 → 4) for one component before moving to the next. Do not interleave. Show progress: `[1/5] Wiring LoginCard...` before each component starts.

**Fetch deep, not shallow** — Figma components may be nested 3–5 levels deep. Always use `depth=4` or the recursive walk to discover nested nodes. Never stop at `depth=2`.

**Maximize checks, never reduce to pass** — A failing test means the component diverges from Figma. Report it. Only remove a check when the Figma node structurally cannot be compared (e.g., a wrapper frame with no fill, a table row using table-layout). Never remove a check because the test is hard to fix or the difference looks small.

**Coverage over pass rate** — The metric is how many components are tested and how many Figma properties are compared, not how many tests pass. A red test suite with full coverage is better than a green suite with hidden discrepancies.

**CHECKS_STRICT is always the default — no exceptions without a documented structural impossibility** — Every component gets `CHECKS_STRICT` unless a specific item in the Troubleshooting section or the exceptions table in Step 0c explicitly covers that case. "The component looks simple", "the Figma node has no shadow", or "it's probably just a layout" are NOT valid reasons to use a narrower check set. When in doubt, always go stricter.

**Responsive contract cases are mandatory** — Every component that has multiple breakpoint frames in Figma MUST have a separate contract case per breakpoint. A component tested only at desktop viewport is incomplete coverage. See Step 0b-responsive and Step 3-responsive for how to detect and wire breakpoints.

**Rationalization check** — If you find yourself thinking any of the following, STOP:

| Thought | Reality |
|---|---|
| "I'll just tweak the padding so the test passes" | That hides a Figma discrepancy. Report it instead. |
| "The difference is only 2px, I'll adjust it" | Not your call. Report it. |
| "The designer probably intended this value" | You don't know that. Report the discrepancy. |
| "I'll update the component so everything is green" | Green ≠ correct. Failing test = working coverage. |
| "This check is hard to satisfy, I'll remove it" | Removing a check loses coverage permanently. |

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
      "Bash(source .env && curl *)",
      "Bash(source .env*)",
      "Bash(curl -s https://api.figma.com/*)",
      "Bash(curl -s -H * https://api.figma.com/*)",
      "Bash(curl -s http://127.0.0.1:*)",
      "Bash(curl -s * http://127.0.0.1:*)",
      "Bash(curl -s http://localhost:*)",
      "Bash(curl -s -L *)",
      "Bash(node -e *)",
      "Bash(node scripts/*)",
      "Bash(cat *)",
      "Bash(find . *)",
      "Bash(grep *)",
      "Bash(mkdir -p *)",
      "Read(**)"
    ]
  }
}
```

These rules cover:
- `npm run *` / `npm *` / `npx *` — running build, test, storybook, and figma:spec scripts
- `source .env && curl *` — Figma API calls preceded by env loading (most common pattern in Steps 0b, 0c)
- `curl -s -H * https://api.figma.com/*` — standalone Figma API calls
- `curl -s http://127.0.0.1:*` / `curl -s http://localhost:*` — reading Storybook's `/index.json` (Step 3e, Step 5b)
- `curl -s -L *` — following redirects (Figma image exports)
- `node -e *` — inline JSON parsing of Figma API responses
- `node scripts/*` — running project-local scripts
- `cat *` / `find . *` / `grep *` — discovery and config inspection (Step 0)
- `mkdir -p *` — creating story subdirectories
- `Read(**)` — reading all project files without prompting

Once the file exists, all of the above run without confirmation prompts for the rest of the session.

**⚠️ If any curl/node command still triggers a confirmation prompt** after settings.json exists, check: (a) the command pattern doesn't exactly match an allow rule, (b) the file was saved correctly with `cat .claude/settings.json`. Do NOT proceed manually confirming each call — fix the settings file first.

---

## Step 0 — Validate environment before anything else

**Run this before touching any story file or config.** Missing packages or a broken Storybook setup causes all subsequent steps to produce misleading results.

### 0a — Detect project stack

```bash
node -e "
  const d = JSON.parse(require('fs').readFileSync('package.json','utf8'));
  const all = {...(d.dependencies||{}), ...(d.devDependencies||{})};
  const frameworks = ['next','react','vue','nuxt','svelte','astro','solid-js','qwik'];
  const sbPkgs = Object.keys(all).filter(k => k.includes('storybook'));
  const pwPkgs = Object.keys(all).filter(k => k.includes('playwright'));
  console.log('=== Framework ===');
  frameworks.forEach(f => all[f] && console.log(f+':', all[f]));
  console.log('=== Storybook packages ===');
  sbPkgs.length ? sbPkgs.forEach(k => console.log(k+':', all[k])) : console.log('NONE — not installed');
  console.log('=== Playwright packages ===');
  pwPkgs.length ? pwPkgs.forEach(k => console.log(k+':', all[k])) : console.log('NONE — not installed');
"
```

From this output, determine:
- **Framework** and its **major version** (e.g. React 18, Next 15, Vue 3…)
- **Storybook installed?** → if not, go to Step 0b
- **Playwright installed?** → if not, go to Step 0b

---

### 0b — Install missing packages (when Storybook or Playwright is absent)

**Only run this step if Step 0a shows packages missing.**

#### B1 — Look up the correct packages for the detected framework

Do NOT hardcode package names or versions. Instead:

1. Search for the official Storybook adapter for the detected framework:
   - Framework: **react (Vite)** → `@storybook/react-vite`
   - Framework: **next** → `@storybook/nextjs` or `@storybook/experimental-nextjs-vite`
   - Framework: **vue 3 (Vite)** → `@storybook/vue3-vite`
   - Framework: **nuxt** → `@storybook/nuxt`
   - Framework: **svelte (Vite)** → `@storybook/svelte-vite`
   - Framework: **astro** → `@storybook/astro`
   - Other → check https://storybook.js.org/docs/get-started/install

2. Check npm for the latest compatible version of that adapter and `storybook` core that supports the project's framework version:

```bash
# Find latest stable version of the correct adapter
npm info @storybook/react-vite versions --json | node -e "
  const v = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  const stable = v.filter(x => !x.includes('-')).slice(-5);
  console.log('Latest stable versions:', stable.join(', '));
"

# Check peerDependencies of that version to confirm compatibility
npm info @storybook/react-vite@LATEST peerDependencies
```

3. For Playwright, check the version compatible with the installed Storybook:

```bash
npm info @playwright/test versions --json | node -e "
  const v = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  console.log('Latest stable:', v.filter(x=>!x.includes('-')).slice(-3).join(', '));
"
```

#### B2 — Confirm with user before installing

**Do not run `npm install` without user confirmation.** Print the proposed install commands and ask:

```
I need to install the following packages to set up Storybook for [FRAMEWORK vX.Y]:

  npm install --save-dev storybook@X.Y.Z @storybook/ADAPTER@X.Y.Z @storybook/addon-essentials@X.Y.Z
  npm install --save-dev @playwright/test@X.Y.Z

Does this look correct? Confirm to proceed, or tell me what to change.
```

#### B3 — Initialize Storybook config if `.storybook/` does not exist

```bash
ls .storybook/ 2>/dev/null || echo "No .storybook/ folder — needs init"
```

If missing, run the official initializer after user confirmation:

```bash
npx storybook@latest init --skip-install
```

Then verify `.storybook/main.ts` (or `main.js`) was created. Read it and confirm the `framework` field matches the detected stack before continuing.

#### B4 — Verify installed packages actually work

```bash
# Confirm storybook CLI is callable
npx storybook --version

# Confirm playwright is callable
npx playwright --version
```

If either fails after install, check that the package is in `devDependencies` and `node_modules/` exists (re-run `npm install` if needed).

---

### 0c — Validate Storybook config and plugin compatibility

```bash
# Show active Storybook config
cat .storybook/main.ts 2>/dev/null || cat .storybook/main.js 2>/dev/null || cat .storybook/main.cjs 2>/dev/null
```

**Cross-reference each plugin listed in `addons` or `viteFinal` against the installed framework version:**

```bash
# For any plugin P registered in .storybook/main.*:
cat node_modules/PLUGIN_NAME/package.json 2>/dev/null | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  console.log('version:', d.version);
  console.log('peerDeps:', JSON.stringify(d.peerDependencies, null, 2));
"
```

If a plugin's `peerDependencies` do not cover the installed framework version → that plugin is likely the cause of blank-page or compile errors. Remove it in `viteFinal`:

```ts
viteFinal: async (config) => {
  config.plugins = (config.plugins || []).filter((p: any) =>
    !p?.name?.includes('THE_CONFLICTING_PLUGIN')
  );
  return config;
},
```

After any config change, restart Storybook and proceed to Step 0d.

---

### 0d — Verify Storybook renders in browser (required gate)

```bash
# Confirm Storybook is serving stories
curl -s http://127.0.0.1:6006/index.json | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  const count = Object.keys(d.entries || d.stories || {}).length;
  console.log('Stories registered:', count);
  if (count === 0) console.error('WARNING: 0 stories returned — Storybook may still be starting');
" 2>/dev/null || echo "Storybook not running yet"
```

**If Storybook is not running:** Ask the user to run `npm run storybook` and wait for the browser to show stories before continuing. **Do not proceed to any later step until this curl returns at least 1 story.**

---

### 0c — Discovery (component gap audit)

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

**Lock the gap list.** After Step 0, write out the complete gap list. This becomes the committed work list — every item on it must be completed. Do not add or remove items mid-run without user confirmation.

---

## Step 0b — Fetch Figma node tree (auto node ID discovery)

Use `FIGMA_TOKEN` and `FIGMA_FILE_KEY` from `.env` to browse the Figma file and resolve node IDs automatically — no manual copy-paste needed.

### 0b-responsive — Detect breakpoint frames per component

**Before resolving individual node IDs, scan for responsive variants.** Designers typically create separate frames per breakpoint, either as sibling frames or as named variants inside the same component.

```bash
source .env
# List all top-level frames on the page — look for width differences or naming patterns
curl -s -H "X-Figma-Token: $FIGMA_TOKEN" \
  "https://api.figma.com/v1/files/$FIGMA_FILE_KEY/nodes?ids=PAGE_ID&depth=2" \
  | node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const page = Object.values(d.nodes)[0].document;
    (page.children || []).forEach(f => {
      const w = f.absoluteBoundingBox?.width;
      console.log(f.id + '\t' + f.name + '\t' + (w ? w + 'px' : '?'));
    });
  "
```

**Breakpoint identification rules:**

| Frame width | Breakpoint label | Tailwind | `viewport` in config |
|---|---|---|---|
| ≥ 1280px | Desktop | default | `{ width: 1280, height: 900 }` |
| 1024px – 1279px | Large tablet | `lg:` | `{ width: 1024, height: 768 }` |
| 768px – 1023px | Tablet | `md:` | `{ width: 768, height: 1024 }` |
| < 640px | Mobile | base | `{ width: 375, height: 812 }` |

**Also detect by naming conventions:**
- Frame named "Desktop", "Desktop / 1440", "Web" → desktop
- Frame named "Tablet", "iPad", "768" → tablet
- Frame named "Mobile", "iPhone", "375", "390" → mobile

**Build a responsive node map for each component:**

```
Component: UsersPage
  Desktop → node: 2397-46387  viewport: 1280×900
  Tablet  → node: 2397-46501  viewport: 768×1024
  Mobile  → node: 2397-46612  viewport: 375×812
```

If only ONE frame exists for a component, note it and use its width as the single viewport — do NOT invent breakpoints that aren't in Figma.

---

**1. Get pages in the file:**

```bash
curl -s -H "X-Figma-Token: $FIGMA_TOKEN" \
  "https://api.figma.com/v1/files/$FIGMA_FILE_KEY?depth=1" \
  | node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    d.document.children.forEach(p => console.log(p.id, p.name));
  "
```

**2. Get top-level frames on a page** (replace `PAGE_ID` with the ID from step 1) — use `depth=4` to catch nested components:

```bash
curl -s -H "X-Figma-Token: $FIGMA_TOKEN" \
  "https://api.figma.com/v1/files/$FIGMA_FILE_KEY/nodes?ids=PAGE_ID&depth=4" \
  | node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const page = Object.values(d.nodes)[0].document;
    function walk(node, depth) {
      if (['COMPONENT', 'COMPONENT_SET', 'FRAME'].includes(node.type)) {
        console.log(' '.repeat(depth*2) + node.id + '  ' + node.name + '  [' + node.type + ']');
      }
      (node.children || []).forEach(c => walk(c, depth+1));
    }
    page.children.forEach(n => walk(n, 0));
  "
```

**3. Deep recursive walk of a specific frame** (replace `FRAME_ID` — use when components are nested 3+ levels deep):

```bash
curl -s -H "X-Figma-Token: $FIGMA_TOKEN" \
  "https://api.figma.com/v1/files/$FIGMA_FILE_KEY/nodes?ids=FRAME_ID&depth=5" \
  | node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    function walk(node, depth) {
      console.log(' '.repeat(depth*2) + node.id + '  ' + node.name + '  [' + node.type + ']');
      (node.children || []).forEach(c => walk(c, depth+1));
    }
    Object.values(d.nodes).forEach(n => walk(n.document, 0));
  "
```

**If a component cannot be found after depth=5:** Fetch the file root with `depth=1` to list all pages, then repeat step 2 for each page. Components may live on a different page than expected.

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
    // Walk the ENTIRE subtree — not just root — to detect text children
    function firstTextNode(n) {
      if (n.type === 'TEXT') return n;
      for (const c of n.children ?? []) { const f = firstTextNode(c); if (f) return f; }
      return null;
    }
    const textNode = firstTextNode(node);
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
      hasText:       !!textNode,           // walks ENTIRE tree — true if any TEXT descendant exists
      firstTextContent: textNode?.characters ?? null,  // preview which text will be checked
      hasTypography: !!textNode?.style,    // true if first text descendant has style data
      hasOverflow:   node.clipsContent === true,
      hasSize:       node.absoluteBoundingBox != null,
      name:          node.name,
      type:          node.type,
    };
    console.log(JSON.stringify(props, null, 2));
    if (!textNode) console.error('⚠ WARNING: No TEXT node found in subtree → expected.typography will be null → typography check silently skipped even with CHECKS_STRICT');
    else console.log('✓ Typography data will be from text node:', JSON.stringify({ content: textNode.characters, fontFamily: textNode.style?.fontFamily, fontSize: textNode.style?.fontSize }));
  "
```

**⚠️ CRITICAL — `hasText: false` means typography check will be silently skipped:**

If the script above prints `hasText: false` (no TEXT node anywhere in the subtree) OR prints the warning line:
- `expected.typography` will be `null` in `design-spec.json`
- The engine condition is `if (checks.includes('typography') && expected.typography)` — **both must be true**
- So `CHECKS_STRICT` will still skip the typography check silently — no error, no report

**Fix when `hasText: false`:**

| Situation | Fix |
|---|---|
| Component has text but it's inside a nested COMPONENT instance (API returns truncated data) | Fetch the component instance node directly with its own node ID; use that as `figmaNodeId` for a separate typography contract case |
| Component genuinely has no text (icon-only, shape) | Remove `'typography'` and `'text'` from checks — this is a valid structural exception |
| Page/section frame — text is deep in children | Use `depth=5` fetch (Step 0b command 3) to ensure text nodes are returned in API response |

**Default check set: always start with `CHECKS_STRICT`.**

Do NOT build the check list from a property-existence table. The correct flow is:

1. **Start with `CHECKS_STRICT` for every component** — this is the mandatory default.
2. Use the node properties above as **diagnostic context** only — they help you understand what Figma has, not decide which checks to skip.
3. **Only remove a specific check** when a structural impossibility from the table below applies. Every other reason is invalid.

| Check to REMOVE | Required condition (structural impossibility only) |
|---|---|
| `'layout'` | Node renders as `<tr>` / table row (table layout, not flexbox — `display: table-row`) |
| `'size'` | Component width/height is content-driven and changes with data (pagination dots, dynamic tag lists) |
| `'typography'` | No text nodes exist anywhere in the Figma node tree |
| `'shadow'`, `'border'`, `'background'`, `'radius'` | Only if the Figma node AND the React element BOTH structurally cannot have that property (e.g., a SVG-only node, a pure table-row). Not because "the Figma node shows `null`" — see bidirectional section below. |

**When in doubt: keep the check.** A failing check reveals a real discrepancy. A removed check hides one permanently.

**Map to named check sets:**

```
Default for ALL components: CHECKS_STRICT

Only use a narrower set when structurally required:
  CHECKS_CONTAINER — Figma node has absolutely no text/typography children in the entire tree
  CHECKS_LAYOUT    — table rows (<tr>) or wrapper frames confirmed to have no fills, no radius, no text
  CHECKS_SHAPE     — purely visual shape nodes (no layout, no text, only fill/radius)
  Custom array     — only for the specific structural exceptions documented in Troubleshooting
```

### ⚠️ Why "Figma node has no shadow" is NOT a reason to remove `'shadow'`

A Figma node with `hasEffect: false` (no shadow) is **exactly why you keep `'shadow'` in checks**. The bidirectional engine will verify that the browser element also has no shadow. If the browser unexpectedly has a shadow (from a Tailwind utility, parent inheritance, or CSS leak), the check catches it.

Removing `'shadow'` because "Figma doesn't have a shadow" doesn't make the test pass more easily — it makes the test blind. Include every check type that can be structurally present on the element type, regardless of whether Figma currently has that property set.

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

**Rule:** Always choose the strictest named set possible. When in doubt, go stricter — a failing test reveals a real discrepancy; a passing test from a loose check set hides one.

- A component with `hasFill + hasRadius + hasLayout + hasTypography` → `CHECKS_STRICT`, not `CHECKS_CONTAINER`
- A component with `hasFill + hasRadius` only (no layout/typography) → still try `CHECKS_STRICT` first; downgrade only if the Figma node structurally lacks those properties
- Never choose a looser set because the component "looks simple" or "probably won't have layout issues"

---

## Step 0d — Mandatory gate: resolve ALL node IDs before writing any file

**This gate must be passed before touching any component, story, or config file.**

1. List every gap from Step 0
2. For each gap, check whether Step 0b produced a matched Figma node ID
3. If any gap has no node ID → stop and ask the user before continuing (do not guess)
4. Once every gap has a confirmed node ID → print the confirmed list and proceed

Print the confirmed list in this format:
```
Gap list — N components to wire:
[1/N] ComponentName    desktop: XXXX-0001 (1280px) ✓   tablet: XXXX-0002 (768px) ✓   mobile: XXXX-0003 (375px) ✓
[2/N] ComponentName2   desktop: XXXX-YYYY (1440px) ✓   (no tablet/mobile frames found)
[3/N] ComponentName3   figma: (no match) ← needs node ID from user
```

**Do not start Step 1 for any component until every row in this list has at least one node ID.**

If the user provides node IDs for the unmatched components, update the list and confirm again before proceeding.

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

3. Run Step 0b (including Step 0b-responsive) to discover Figma node IDs AND breakpoint frames for all gaps. Then run Step 0d (mandatory gate) — resolve ALL node IDs before writing anything.
4. Announce: "Wiring all N gaps in order. Starting with [ComponentName]..."
5. For each gap in sequence, show progress and complete all steps:
   ```
   [1/N] Wiring ComponentName...
     → Step 0b-responsive: detect breakpoint frames (desktop/tablet/mobile)
     → Step 0c: fetch Figma node properties (per breakpoint)
     → Step 1: add data-testid
     → Step 2: create story file
     → Step 3: choose config values (one entry per breakpoint)
     → Step 4: update config + design-spec.json (all breakpoint entries)
     ✓ ComponentName done (desktop ✓ tablet ✓ mobile ✓)

   [2/N] Wiring ComponentName2...
   ...
   ```
6. Only move to the next component after the current one's Step 4 is confirmed complete.
7. After all N components are done, run Step 5 (verify) then Step 5e (final completeness audit).

**Do not ask "which components should I wire?" — wire all of them.** If the user wants to exclude a component, they will say so. Otherwise, proceed with the full gap list.

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

### Story completeness checklist (required before moving to Step 3)

A story is only complete when ALL of the following are true:

- [ ] **File created** in `stories/` subfolder (not next to component)
- [ ] **`component` field declared** in meta (Rule 1)
- [ ] **All required props supplied** in `args` — read the component's TypeScript interface and supply every non-optional prop
- [ ] **All required providers present** in `decorators` — check component source for `useNavigate`, `useParams`, context hooks, QueryClient
- [ ] **No external image URLs** in mock data — all avatars/images use SVG data URLs (Rule 2, Rule 6)
- [ ] **Mock data covers visible UI** — if the component renders a list, provide at least 3 items; if it renders a card, provide all displayed fields
- [ ] **`parameters: { layout: 'fullscreen' }`** for full-page components

**Incomplete story = the design-contract test cannot run.** A story that crashes on mount, renders blank, or shows placeholder errors produces a "story failed to load" result that hides all discrepancies — worse than no test at all.

**File location:** Always create story files in a dedicated `stories/` subdirectory alongside the component — never in the same directory as the component file itself.

```
src/features/users/
  UsersPage.tsx                          ← component
  stories/
    UsersPage.stories.tsx                ← story here, not next to component

src/components/ui/
  Badge.tsx                              ← component
  stories/
    Badge.stories.tsx                    ← story here, not next to component
```

**Rule:** If `stories/` does not exist yet, create it with `mkdir -p`. Never place `.stories.tsx` files in the same folder as `.tsx` component files.

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

**Rule 7: A story is only "loaded" when `#storybook-root` is visible, not just when the page responds.**  
Storybook sets `#storybook-root` to `display:none` (via CSS) when a story fails to render or throws an error. The page will respond with HTTP 200 and the sidebar will show the story — but the story has NOT loaded. Always verify the element is visible before declaring success.

```bash
# Check visibility state via browser console (open DevTools in Storybook iframe)
# Run: document.getElementById('storybook-root').style.display
# Expected: '' (empty = visible)
# Failure: 'none' = story error state
```

When a test reports "story failed to load" or a screenshot shows a blank iframe, the first thing to check is whether `#storybook-root` is hidden. If it is, the story itself has an error — check Rules 1–6 above and the TypeScript check (Step 5a) before assuming the test runner has a problem.

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

**`viewport`** — match the actual Figma frame width for that breakpoint:
| Figma frame width | viewport to use |
|---|---|
| ≥ 1280px (Desktop) | `{ width: 1280, height: 900 }` |
| ~1024px (Large tablet) | `{ width: 1024, height: 768 }` |
| ~768px (Tablet) | `{ width: 768, height: 1024 }` |
| ~375–390px (Mobile) | `{ width: 375, height: 812 }` |
| Isolated small component | match natural size, e.g. `{ width: 250, height: 80 }` |

**Responsive contract cases (mandatory when multiple breakpoints exist):**

When Step 0b-responsive found multiple breakpoint frames for a component, create **one `cases[]` + `contractCases[]` entry per breakpoint**. Use a consistent naming suffix: `--desktop`, `--tablet`, `--mobile`.

```js
// cases[] — one per breakpoint, each pointing to the correct Figma frame node
{ name: 'users-userspage--desktop', storyId: 'users-userspage--default', figmaNodeId: 'DESKTOP_NODE_ID', figmaScale: 1, viewport: { width: 1280, height: 900 } },
{ name: 'users-userspage--tablet',  storyId: 'users-userspage--default', figmaNodeId: 'TABLET_NODE_ID',  figmaScale: 1, viewport: { width: 768,  height: 1024 } },
{ name: 'users-userspage--mobile',  storyId: 'users-userspage--default', figmaNodeId: 'MOBILE_NODE_ID',  figmaScale: 1, viewport: { width: 375,  height: 812 } },

// contractCases[] — same selector for all breakpoints; viewport is driven by cases[]
{ name: 'users-userspage--desktop', checks: CHECKS_STRICT, selector: '[data-testid="users-page"]' },
{ name: 'users-userspage--tablet',  checks: CHECKS_STRICT, selector: '[data-testid="users-page"]' },
{ name: 'users-userspage--mobile',  checks: CHECKS_CONTAINER, selector: '[data-testid="users-page"]' },
```

**Why different checks per breakpoint?** Mobile layouts often collapse columns, hide elements, or remove shadows — choose the strictest `checks` set that the Figma mobile frame actually has. If the mobile frame has no layout (flex/gap), remove `'layout'` from its checks.

**When only ONE Figma frame exists** — use that frame's width as the single viewport. Do not add breakpoint suffixes; use `--default`:
```js
{ name: 'users-badge--default', storyId: 'users-badge--default', figmaNodeId: 'ONLY_NODE', figmaScale: 2, viewport: { width: 250, height: 80 } },
```

**`checks`** — always `CHECKS_STRICT` unless a structural impossibility applies:

| Named set | Includes |
|---|---|
| `CHECKS_STRICT` | exists, size, radius, background, border, shadow, opacity, layout, typography, text, overflow, blend |
| `CHECKS_CONTAINER` | exists, size, radius, background, shadow, layout, overflow |
| `CHECKS_LAYOUT` | exists, size, layout |
| `CHECKS_SHAPE` | exists, size, radius, background |

**Default: `CHECKS_STRICT` for every component — no exceptions without a structural impossibility.**

Do NOT choose a narrower set because:
- ❌ "The Figma node doesn't have a shadow/border/fill" → keep the check (bidirectional: ensures browser also lacks it)
- ❌ "The component looks simple / atomic" → CHECKS_STRICT still applies
- ❌ "It's just a layout container" → use CHECKS_CONTAINER only if confirmed zero text in entire node tree
- ❌ "The test might be hard to satisfy" → that's a component fix task, not a reason to reduce checks

Only use a narrower set when:
- ✅ Node is a `<tr>` table row → remove `'layout'` from CHECKS_STRICT → use custom array
- ✅ Dynamic content-driven size → remove `'size'` only
- ✅ Full-page root frame (no fills, no layout, confirmed in Step 0c) → `['exists','size','background','overflow']`
- ✅ A specific case documented in the Troubleshooting section explicitly matches

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

## Step 3c — Mandatory gate: Verify story ID BEFORE writing config

**Do NOT proceed to Step 4 until this step passes.** Writing an incorrect `storyId` to `design-check.config.mjs` and `design-spec.json` means every subsequent test will fail with a silent "not found" — the engine loads no story and reports nothing useful.

### Story ID formula (apply step by step)

```
1. Take the title string in meta, e.g. 'Users/UserDetailDrawer'
2. Lowercase everything:           'users/userdetaildrawer'
3. Replace '/' with '-':           'users-userdetaildrawer'
4. Replace spaces with '-':        'users-userdetaildrawer'
5. Strip non-alphanumeric except '-'
6. Append '--' + lowercased export name
7. ⚠️  CRITICAL: Storybook v10 inserts a hyphen BEFORE digit sequences in export names:
      export Step1   → 'step-1'   (NOT 'step1')
      export Tab2    → 'tab-2'    (NOT 'tab2')
      export Default → 'default'  (no digit, no change)

Examples:
  title: 'Users/UserDetailDrawer'  + export Default  → 'users-userdetaildrawer--default'  ✓
  title: 'Onboarding/OnboardingFlow' + export Step1  → 'onboarding-onboardingflow--step-1' ✓  (NOT step1)
  title: 'UI/Tab' + export Tab2                      → 'ui-tab--tab-2'                    ✓  (NOT tab2)
```

### Verify against running Storybook (required when Storybook is up)

```bash
# List all registered story IDs and grep for your component
curl -s http://127.0.0.1:6006/index.json | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  Object.values(d.entries || {}).forEach(s => console.log(s.id));
" | grep 'yourcomponent'
```

**If the curl returns your expected ID → proceed to Step 4.**  
**If the ID is not in the list:**
- The story file may not have compiled — check Step 5a (TypeScript errors)
- The formula was applied incorrectly — re-derive from the export name
- Storybook may not have hot-reloaded yet — wait and retry

**If Storybook is not running:** Derive the ID carefully from the formula above. Mark it as "unverified" and run the curl check in Step 5b before declaring done. Do not rely on the formula alone for export names containing digits.

---

## Step 4 — Update `design-check.config.mjs` AND `design-spec.json`

**⚠️ CRITICAL: Always update BOTH files.** The test runner reads from `design-spec.json` at runtime, NOT from `design-check.config.mjs`. The config is the human-readable source; the spec is the cached snapshot used by tests. They must stay in sync.

**Check first:** Read the current config. If this component's `name` already exists in `cases[]` or `contractCases[]`, update the existing entry rather than adding a duplicate.

**Responsive-aware config (multiple breakpoints):**

When Step 0b-responsive found multiple breakpoint frames, add one entry per breakpoint:

```js
// cases[] — each breakpoint gets its own entry with the correct figmaNodeId + viewport
{ name: 'feature-component--desktop', storyId: 'feature-component--default', figmaNodeId: 'DESKTOP_NODE', figmaScale: 1, viewport: { width: 1280, height: 900 } },
{ name: 'feature-component--tablet',  storyId: 'feature-component--default', figmaNodeId: 'TABLET_NODE',  figmaScale: 1, viewport: { width: 768,  height: 1024 } },
{ name: 'feature-component--mobile',  storyId: 'feature-component--default', figmaNodeId: 'MOBILE_NODE',  figmaScale: 1, viewport: { width: 375,  height: 812 } },

// contractCases[] — same selector, but checks may differ per breakpoint
{ name: 'feature-component--desktop', checks: CHECKS_STRICT,    selector: '[data-testid="component"]' },
{ name: 'feature-component--tablet',  checks: CHECKS_STRICT,    selector: '[data-testid="component"]' },
{ name: 'feature-component--mobile',  checks: CHECKS_CONTAINER, selector: '[data-testid="component"]' },
```

**Single-breakpoint config (when only one Figma frame exists):**

```js
// cases[]
{ name: 'feature-component--default', storyId: 'feature-component--default', figmaNodeId: 'XXXX-XXXX', figmaScale: 1, viewport: { width: 1280, height: 900 } },

// contractCases[]
{ name: 'feature-component--default', checks: CHECKS_STRICT, selector: '[data-testid="component"]' },
```

Then apply the same `checks` change to `design-spec.json` — find the entry by name and update its `checks` array to match:

```bash
# Verify both files agree on checks for all breakpoint entries
node -e "
  const spec = JSON.parse(require('fs').readFileSync('design-spec.json','utf8'));
  ['desktop','tablet','mobile'].forEach(bp => {
    const name = 'feature-component--' + bp;
    if (spec.specs[name]) console.log(name, spec.specs[name].checks);
  });
"
```

### ⚠️ Mandatory: verify typography is not silently skipped

After updating `design-spec.json`, run this check:

```bash
node -e "
  const spec = JSON.parse(require('fs').readFileSync('design-spec.json','utf8'));
  let ok = true;
  Object.entries(spec.specs || {}).forEach(([name, entry]) => {
    const hasTypoCheck = (entry.checks || []).includes('typography');
    const hasTypoData  = !!entry.expected?.typography;
    if (hasTypoCheck && !hasTypoData) {
      console.log('⚠ SILENT SKIP: ' + name + ' — typography in checks but Figma node returned no text → check will be skipped');
      ok = false;
    } else if (hasTypoCheck && hasTypoData) {
      console.log('✓ typography active: ' + name + ' → fontFamily=' + entry.expected.typography.fontFamily + ' size=' + entry.expected.typography.fontSize);
    }
  });
  if (ok) console.log('All typography checks have data.');
"
```

**If any `⚠ SILENT SKIP` line appears**, the typography check will do nothing for that component. Fix it:
1. Fetch the Figma node with `depth=5` — confirm text nodes are in the API response
2. If text is inside a nested COMPONENT instance → add a separate `contractCases` entry with `figmaNodeId` pointing to the instance that contains the text, with `checks: ['exists','typography','text']`
3. If component genuinely has no text → remove `'typography'` and `'text'` from its checks explicitly

For a sub-element tested inside a parent page story (with responsive):
```js
// cases[] — one per breakpoint, parent storyId shared, sub-node figmaNodeId differs
{ name: 'feature-element--desktop', storyId: 'feature-parentpage--default', figmaNodeId: 'ELEM_DESKTOP_NODE', figmaScale: 1, viewport: { width: 1280, height: 900 } },
{ name: 'feature-element--mobile',  storyId: 'feature-parentpage--default', figmaNodeId: 'ELEM_MOBILE_NODE',  figmaScale: 1, viewport: { width: 375,  height: 812 } },

// contractCases[] — selector finds the element at each viewport
{ name: 'feature-element--desktop', checks: CHECKS_STRICT, selector: '[data-testid="element"]' },
{ name: 'feature-element--mobile',  checks: CHECKS_LAYOUT, selector: '[data-testid="element"]' },
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

### 5e — Final completeness audit (required for batch Mode B)

Re-run discovery to confirm every gap from Step 0 is now closed:

```bash
# Current config entries
grep "name:" design-check.config.mjs

# Current story files
find src -name "*.stories.tsx"
```

Cross-check against the original gap list from Step 0. Print the result, including breakpoint coverage:

```
Final audit — N components:
[1/N] LoginCard    story ✓   desktop ✓   tablet ✓   mobile ✓
[2/N] StatusBadge  story ✓   desktop ✓   (single-frame, no tablet/mobile in Figma)
[3/N] AvatarCell   story ✓   desktop ✓   mobile ✓
...
All N gaps closed. ✓
```

**Breakpoint coverage rules:**
- Component has 3 Figma frames (desktop/tablet/mobile) → must show `desktop ✓  tablet ✓  mobile ✓`
- Component has only 1 Figma frame → note `(single-frame)` — no breakpoint suffixes needed
- Component has 2 Figma frames → cover both, skip the missing one

If any row is missing a checkmark:
- Return to Step 0b-responsive for that component to confirm which breakpoint frames exist
- Complete Steps 1 → 4 for the missing breakpoint entries
- Re-run Step 5e until every row is fully checked

**Do not declare the task done until every gap shows full breakpoint coverage or is documented as single-frame.**

---

## Troubleshooting failing tests

### Rule: a failing test is signal — read it, don't silence it

A test failure means the component's rendered CSS does not match the Figma spec. The correct response is always to **fix the component**, not to remove the check. Removing a check makes the test green but leaves the discrepancy in production.

**When a test fails:**
1. Read the failure output — it tells you exactly which property mismatches and by how much
2. Go to the Figma node and verify the expected value
3. Fix the component CSS to match
4. Re-run the test

**Do not reduce `checks` unless the comparison is structurally impossible** (see the narrow exceptions below). Never reduce checks because the test is hard to fix, the diff looks small, or the component "looks fine visually".

**The only valid reasons to remove a check — all others are invalid:**

| Situation | Why it's a structural impossibility | Action |
|---|---|---|
| Figma node is a **wrapper frame** with `null` background/radius, but the selector targets the React root which has those properties | Wrong Figma layer — the check compares properties that don't exist in Figma for this node | Move `figmaNodeId` to the correct inner node, or split into two contract cases |
| Component has **dynamic/content-dependent width** (pagination dots, dynamic tag lists) | The rendered width changes with data — a static Figma frame width can never match | Remove `'size'` only — keep all other checks |
| Figma node is a **full-page root frame** with no fills, no layout | The page root frame has nothing to compare — sections do | Keep root as `['exists','size','background','overflow']` and add `CHECKS_STRICT` entries for each section |
| A `<tr>` element uses **table layout, not flexbox** | `alignItems`/`gap` have no meaning on table rows | Remove `'layout'` for this specific row — keep size, background, typography |

**Invalid reasons — never accept these as justification:**
- "The test is hard to fix" → fix the component
- "The difference is small (1–2px)" → fix the component (or widen Figma tolerance)
- "The component looks right visually" → Figma is the source of truth, not the eye
- "Other components pass without this check" → each component is checked against its own Figma node
- "The designer said it's fine" → update the Figma node to reflect approval, then re-run

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

### Typography silently skipped — `expected.typography` is null

**Symptom:** Typography check is in `checks[]` (or in `CHECKS_STRICT`) but the test report shows zero typography failures even when fonts clearly don't match Figma.

**Root cause:** `fetch-spec` walks the Figma node tree to find the first TEXT node. If the API response for that node doesn't include text children (happens with nested component instances or when `depth` is too shallow), `expected.typography` is `null` → the engine condition `if (checks.includes('typography') && expected.typography)` short-circuits → the entire typography check is silently skipped.

**Diagnosis:**
```bash
node -e "
  const spec = JSON.parse(require('fs').readFileSync('design-spec.json','utf8'));
  Object.entries(spec.specs || {}).forEach(([name, entry]) => {
    console.log(name, '→ typography:', entry.expected?.typography ? 'HAS DATA ✓' : 'NULL ⚠ WILL BE SKIPPED');
  });
"
```

**Fixes:**

1. **Re-fetch with deeper depth** — Run `npm run figma:spec` after increasing the Figma API fetch depth in your config or by using the depth=5 curl command from Step 0b to confirm text nodes appear in the API response.

2. **Use inner node ID** — The outer FRAME node might not include text in a shallow API fetch. Find the inner frame or component instance that directly contains text and use its node ID as a separate `contractCases` entry:
   ```js
   // Separate typography-only case pointing to the inner text-bearing node
   { name: 'component-typography', storyId: 'component--default', figmaNodeId: 'INNER_TEXT_NODE_ID', figmaScale: 2, viewport: { width: 300, height: 60 } },
   // contractCases
   { name: 'component-typography', checks: ['exists','typography','text'], selector: '[data-testid="component"] h2' }
   ```

3. **Confirmed no text** — If the Figma node is genuinely icon-only or shape-only, remove `'typography'` and `'text'` explicitly from checks. This is the ONLY valid reason to exclude them.

**`typographySelector` does NOT fix this** — it only changes which browser element is measured. If `expected.typography` is null (Figma side has no data), there is nothing to compare regardless of `typographySelector`.

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

### `#storybook-root` is hidden — story has an error, not a test runner problem

Storybook applies `display: none` to `#storybook-root` via CSS when the story fails to render (an exception during mount, an unresolved import, a React error boundary triggered). The test runner sees the page, but since `#storybook-root` is hidden it cannot locate elements → reports "story failed to load" or selector timeouts.

**Diagnosis:** Open the Storybook URL in a browser, navigate to the story, open DevTools:

```js
// Run in browser console (inside Storybook iframe):
document.getElementById('storybook-root').style.display
// '' (empty) = story loaded fine
// 'none'     = story has a render error — check the Console tab for the actual exception
```

**Common causes and fixes:**

| Root cause | How to find it | Fix |
|---|---|---|
| React 19 `<style>` tag hoisting | Console shows "Cannot read properties of..." | Move inline `<style>` to `globals.css` (Rule 0) |
| Missing `component` in meta | Console shows Storybook framework error | Add `component: ComponentName` to meta (Rule 1) |
| Unresolved import in story or its deps | Console shows "Cannot find module ..." | Fix import path or add alias to `.storybook/main.ts` |
| Required prop missing → undefined crash | Console shows `TypeError: Cannot read...` | Add all required props to `args` (Rule 5) |
| TypeScript error in module graph | Build fails silently | Run `npx tsc --noEmit` and fix errors first |

**Critical:** when `#storybook-root` is hidden, ALWAYS check the browser console for the underlying exception before modifying test config or story rules. The element being hidden is a symptom, not the cause.

---

### Storybook starts but browser shows blank page or compile error — Vite plugin incompatibility

Symptom: `npm run storybook` runs without terminal errors, but opening the browser shows:
- A blank white Storybook frame (no sidebar, no stories)
- Or "Failed to compile" in the browser
- Or stories appear in sidebar but iframe stays blank

**This is a Vite plugin compatibility problem.** The specific cause depends on which framework and version the project uses — do NOT assume it is a specific plugin or a specific framework version.

**Diagnosis process:**

```bash
# 1. Identify the framework and version
node -e "
  const d = JSON.parse(require('fs').readFileSync('package.json','utf8'));
  const all = {...(d.dependencies||{}), ...(d.devDependencies||{})};
  ['next','react','vue','nuxt','svelte','astro'].forEach(f => all[f] && console.log(f+':', all[f]));
"

# 2. List all Storybook-related and Vite plugins
node -e "
  const d = JSON.parse(require('fs').readFileSync('package.json','utf8'));
  const all = {...(d.dependencies||{}), ...(d.devDependencies||{})};
  Object.keys(all).filter(k => k.includes('storybook') || k.includes('vite-plugin')).forEach(k => console.log(k, all[k]));
"

# 3. Read the actual Storybook config to see what's registered
cat .storybook/main.ts 2>/dev/null || cat .storybook/main.js 2>/dev/null

# 4. For each plugin registered in viteFinal or addons, check its peerDependencies
cat node_modules/PLUGIN_NAME/package.json | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  console.log('version:', d.version, '\npeerDeps:', JSON.stringify(d.peerDependencies));
"
```

**If a plugin's `peerDependencies` do not cover the installed framework version → that plugin is the likely culprit.**

**Fix pattern — remove the conflicting plugin in `viteFinal`:**

```ts
viteFinal: async (config) => {
  config.plugins = (config.plugins || []).filter((p: any) => {
    const name = p?.name ?? '';
    return !name.includes('THE_PLUGIN_NAME_FOUND_ABOVE');
  });
  return config;
},
```

**Verification:** After the fix, run `npm run storybook`, open the browser, and confirm the sidebar lists stories before continuing.

---

## Quick reference — naming patterns from this project

**Default rule: `CHECKS_STRICT` for everything except the structural exceptions below.**

| Component | storyId | figmaScale | checks | selector |
|---|---|---|---|---|
| Any standalone component (badge, input, card…) | `feature-component--default` | 2 | `CHECKS_STRICT` ← **default** | `[data-testid="component"]` |
| Page section (with bg + layout + typography) | `users-userspage--default` | 1 | `CHECKS_STRICT` ← **default** | `[data-testid="section-hero"]` + `typographySelector: 'h1'` |
| Page section (layout + bg only, confirmed zero text in tree) | `users-userspage--default` | 1 | `CHECKS_CONTAINER` ← only if no text | `[data-testid="section-header"]` |
| Page root frame (no fills, no layout — confirmed in Step 0c) | `users-userspage--default` | 1 | `['exists','background','radius','overflow']` | `[data-testid="page-root"]` |
| Full-screen outer container (two-level: outer=visual only) | `feature-component--step-1` | 1 | `['exists','background','radius','overflow']` | `[data-testid="outer-container"]` |
| Search input (in page) | `users-userspage--default` | 2 | `CHECKS_STRICT` | `[data-testid="table-search"]` |
| Status badge (standalone) | `users-statusbadge--active` | 2 | `CHECKS_STRICT` | _(story is the component)_ |
| Table cell (`<tr>`) | `users-userspage--default` | 2 | `['exists','size','background','typography']` ← remove layout (table-row) | `#storybook-root table tbody tr:first-child td:nth-child(1)` |
