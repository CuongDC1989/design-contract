# Skill: figma-to-feature

Generate a complete feature page — React components + Storybook stories + design-contract test config — from a Figma page, then iterate until all tests pass.

**This is the orchestrator.** It runs Phase 1 in full, then directs you to load a focused sub-skill for each subsequent phase. Loading sub-skills on demand keeps context lean (~300 lines active at a time instead of 1265).

---

## MANDATORY RULE — Typography + Layout accuracy is non-negotiable

> **This rule applies to every phase of this skill. It overrides any "keep it simple" instinct.**

**Typography** (`fontFamily`, `fontWeight`, `fontSize`, `lineHeight`, `letterSpacing`, `textAlign`, `color`) and **layout** (`flexDirection`, `padding`, `gap`, `alignItems`, `justifyContent`) must be captured accurately from Figma and reflected in BOTH the component code AND the design contract tests.

**In Phase 2 (implementation):**
- The `frontend-developer` agent prompt MUST include the full typography spec AND full layout spec from `2a` and `2a-typography`. An agent prompt missing either will produce a component that fails design contract tests.
- After code generation, grep the output for the expected font-size, font-weight, and gap/padding classes. Missing → fix immediately.

**In Phase 3 (story + config):**
- ANY component with visible text MUST include `'typography'` in its `contractCases[]` checks.
- ANY component with flex/grid/auto-layout MUST include `'layout'` in its `contractCases[]` checks.
- `CHECKS_STRICT` covers both — use it by default.
- If the cache diagnostic returns `hasTypography: false` for a component that visually has text → STOP, do not accept it. Investigate: re-run the recursive `hasText()` walk, check for stale cache, inspect INSTANCE children.
- `['exists', 'size']` alone is NOT a valid checks list for any component with text or spacing.

**Violation is a blocker** — do not proceed to the next phase if either rule is violated.

---

## Workflow overview

| Phase | What happens | File to read |
|---|---|---|
| 1 — Discovery | Read project state, fetch Figma page tree, build component map | _(this file — run in full)_ |
| 2a — Implementation | Fetch node props, screenshot, map Tailwind, confirm plan, spawn `frontend-developer` agent | `.claude/skills/figma-to-feature/phase2-fetch.md` |
| 2h — Production | Review generated code against production rules (text, states, forms, animation…) | `.claude/skills/figma-to-feature/phase2-production.md` |
| 3 — Story + Config | Create stories, update design-check.config.mjs | `.claude/skills/figma-to-feature/phase3-story.md` |
| 4+5 — Iteration & Repair | Fix failing tests, repair mode, telemetry | `.claude/skills/figma-to-feature/phase4-repair.md` |

**Loading instruction:** When transitioning between phases, use the **Read tool** to read the file listed above. Do not use the Skill tool for these — they are context files, not standalone skills. Load the file, then follow its instructions before continuing.

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
cat design-check.config.mjs
grep -E "^(FIGMA_TOKEN|FIGMA_FILE_KEY|STORYBOOK_URL)=" .env | sed 's/=.*/=<set>/'
```

Build a mental map:
- Which components already exist?
- Which already have stories?
- Which are already wired in `design-check.config.mjs`?

### 1b — Bulk fetch the entire Figma file (follow figma-to-component)

**This step replaces all piecemeal Figma API calls.** Follow the exact same 3-step bulk fetch defined in `figma-to-component`:

**Step 1 — List files in the project (optional, if `FIGMA_PROJECT_ID` is set):**
```bash
source .env
curl -s -H "X-Figma-Token: $FIGMA_TOKEN" \
  "https://api.figma.com/v1/projects/$FIGMA_PROJECT_ID/files" \
  | node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    (d.files || []).forEach(f => console.log(f.key + '\t' + f.name));
  "
```

**Step 2 — Fetch complete file, no depth limit:**
```bash
source .env
[ -n "$FIGMA_TOKEN" ]    || { echo "ERROR: FIGMA_TOKEN not set"; exit 1; }
[ -n "$FIGMA_FILE_KEY" ] || { echo "ERROR: FIGMA_FILE_KEY not set"; exit 1; }
curl -s -H "X-Figma-Token: $FIGMA_TOKEN" \
  "https://api.figma.com/v1/files/$FIGMA_FILE_KEY" \
  > figma-nodes-cache.json
echo "Cached: $(wc -c < figma-nodes-cache.json) bytes"
```

**Step 3 — Verify and extract all node IDs:**
```bash
node -e "
  const d = JSON.parse(require('fs').readFileSync('figma-nodes-cache.json','utf8'));
  const roots = d.document ? [d.document] : Object.values(d.nodes).map(n => n.document);
  let frames=0, components=0, text=0, total=0, maxDepth=0;
  function walk(n, depth) {
    total++; if(depth>maxDepth)maxDepth=depth;
    if(n.type==='FRAME')frames++;
    if(n.type==='COMPONENT'||n.type==='COMPONENT_SET')components++;
    if(n.type==='TEXT')text++;
    (n.children||[]).forEach(c=>walk(c,depth+1));
  }
  roots.forEach(r=>walk(r,0));
  console.log('Total:', total, ' FRAME:', frames, ' COMPONENT/SET:', components, ' TEXT:', text, ' maxDepth:', maxDepth);
  if(text===0) console.error('⚠ 0 text nodes — fetch may have failed');
  else console.log('✓ Cache complete — all subsequent steps read from figma-nodes-cache.json');
"
```

> **MCP mode:** Call `figma___get_metadata` — if it returns data, use MCP calls (`figma___get_design_context`) instead of curl for the steps below. The cache file is still written for property inspection.

### 1c — List pages and let user choose

**From cache:**
```bash
node -e "
  const d = JSON.parse(require('fs').readFileSync('figma-nodes-cache.json','utf8'));
  (d.document.children || []).forEach((p, i) => console.log((i+1) + '.', p.name, '  [' + p.id + ']'));
"
```

Present the numbered list and ask: **"Which page number do you want to implement?"**

### 1d — List all components/frames on the chosen page

**From cache — no API call:**
```bash
node -e "
  const d = JSON.parse(require('fs').readFileSync('figma-nodes-cache.json','utf8'));
  const PAGE_NAME = 'CHOSEN_PAGE_NAME'; // replace with user's choice
  const page = (d.document.children || []).find(p => p.name === PAGE_NAME);
  if (!page) { console.error('Page not found'); process.exit(1); }
  function walk(node, depth) {
    if (node.visible === false || (node.opacity ?? 1) === 0) return;
    if (/^_/.test(node.name)) return;
    const w = node.absoluteBoundingBox?.width ?? 0;
    const h = node.absoluteBoundingBox?.height ?? 0;
    if (w < 4 && h < 4 && node.type !== 'COMPONENT') return;
    if (['FRAME','COMPONENT','COMPONENT_SET','SECTION'].includes(node.type)) {
      console.log(' '.repeat(depth*2) + node.id + '  \"' + node.name + '\"  [' + node.type + ']  ' + (w ? Math.round(w)+'x'+Math.round(h) : ''));
    }
    (node.children || []).forEach(c => walk(c, depth + 1));
  }
  (page.children || []).forEach(c => walk(c, 0));
"
```

**Node filtering heuristic** — nodes silently skipped:
- `visible = false` — hidden in Figma
- `opacity = 0` — fully transparent
- Name starts with `_` — internal/helper frame convention
- Width < 4px AND height < 4px — unless COMPONENT
- Type is MASK or BOOLEAN_OPERATION — treat as icon

### 1d — Build Component Map

Map Figma node names → React component names. Rules:
- Remove spaces, dashes, underscores — PascalCase each word: `"Login Card"` → `LoginCard`
- Slash-scoped names: use part after last slash: `"Button/Primary"` → `Primary` (or keep both: `ButtonPrimary`)
- Numbers: append as-is: `"Card 2"` → `Card2`
- Page-level FRAME representing a routable view: append `Page` suffix: `"Auth"` → `AuthPage`, `"Users"` → `UsersPage`
- GROUP nodes: map to a component only if the group has a meaningful name (not "Group 1", "Group 2", etc.). Unnamed/numbered groups → skip (treat as layout primitive)
- Ignore RECTANGLE, VECTOR, ELLIPSE, INSTANCE with no meaningful name
- **COMPONENT_SET nodes:** expand into variants — check `node.children` for variant names (e.g. `"State=Active"`, `"Type=Primary"`). Each variant becomes a separate Story export in Phase 3.

For each mapped component, determine:
- **File path:** `src/features/<feature>/<ComponentName>.tsx` (or `src/components/ui/<ComponentName>.tsx` for shared UI)
- **testid:** `<feature>-<componentname>` (kebab-case, lowercase)
- **Figma node ID:** from the tree output above

Status values: `existing` (component file already exists), `new` (needs to be created), `skip` (existing + already has passing test)

**Confidence scoring** — add a `conf` column to the map:
- `high` — COMPONENT or COMPONENT_SET with a meaningful name, clearly maps to one React component
- `med` — FRAME with auto-layout and recognizable name (Card, Modal, Header…)
- `low` — GROUP, ambiguous FRAME, name like "Frame 42", >150px bounding with unclear purpose

For `low` confidence nodes: flag them and ask the user whether to implement or skip. Never silently generate a `low` confidence component.

Present to user:

```
Component     Path                                    testid           Figma node ID  Status    Conf
AuthPage    → src/features/auth/AuthPage.tsx           auth-authpage    2397-45766     existing  high
LoginCard   → src/features/auth/LoginCard.tsx          auth-logincard   2397-45790     existing  high
Frame42     → ???                                       ???              2397-45900     new        low  ← needs user input
```

**Checkpoint:** Ask the user to confirm or adjust the map. Do not proceed to Phase 2 until confirmed.

> If a component already exists AND already has a passing design-contract test, mark it `skip` and exclude it from Phase 2.

### 1e — Detect design system & reusable components

Before writing any component code, check what UI infrastructure already exists:

```bash
# 1. Detect UI component library
cat package.json | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  const deps = {...(d.dependencies||{}), ...(d.devDependencies||{})};
  const libs = ['@radix-ui','shadcn','@mui/material','antd','@headlessui','@mantine','react-aria','@chakra-ui'];
  const found = Object.keys(deps).filter(k => libs.some(l => k.startsWith(l)));
  found.length ? found.forEach(k => console.log('UI lib:', k)) : console.log('No UI library — plain Tailwind project');
"

# 2. List existing shared UI components
find src/components/ui -name "*.tsx" ! -name "*.stories.tsx" 2>/dev/null | sed 's|.*/||;s|\.tsx||' | sort
```

**Reuse rules — apply in this order before creating anything new:**

1. **UI library first:** If the project has Radix/shadcn/MUI, check if that library already provides the element (Button, Input, Select, Dialog, Badge, Tooltip…). **Import and use it.**
2. **Project components second:** If `src/components/ui/` has a match, use it — adapt via props or a wrapper, not by reimplementing from scratch.
3. **Create new only if:** no library match AND no existing project component match.

> This step often eliminates 30–50% of the work in Phase 2. Always run it first.

---

## Transition to Phase 2

Phase 1 is complete. Before starting implementation:

**Load phase file:** use the Read tool to read `.claude/skills/figma-to-feature/phase2-fetch.md`

That file covers:
- Fetching detailed Figma node properties (2a scripts)
- Tailwind class mapping tables (2c)
- Writing the component (2e)
- TypeScript check + anti-hallucination (2f, 2g)

After 2a–2g, read `.claude/skills/figma-to-feature/phase2-production.md` for production rules (2h) before moving to Phase 3.
