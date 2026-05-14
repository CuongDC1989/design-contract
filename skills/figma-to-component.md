# Skill: figma-to-component

Generate a complete feature page — React components + Storybook stories + design-contract test config — from a Figma page, then iterate until all tests pass.

**This is the orchestrator.** It runs Phase 1 in full, then directs you to load a focused sub-skill for each subsequent phase. Loading sub-skills on demand keeps context lean (~300 lines active at a time instead of 1265).

---

## Workflow overview

| Phase | What happens | Sub-skill to load |
|---|---|---|
| 1 — Discovery | Read project state, fetch Figma page tree, build component map | _(this file — run in full)_ |
| 2a — Implementation | Fetch node props, map Tailwind classes, write components | `figma-to-component/phase2-fetch` |
| 2h — Production | Production readiness rules (text, states, forms, animation…) | `figma-to-component/phase2-production` |
| 3 — Story + Config | Create stories, update design-contract.config.mjs | `figma-to-component/phase3-story` |
| 4+5 — Iteration & Repair | Fix failing tests, repair mode, telemetry | `figma-to-component/phase4-repair` |

**Loading instruction:** When transitioning between phases, invoke the Skill tool with the sub-skill name above. Do not proceed to the next phase without loading the corresponding sub-skill first.

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

The user replies with a number (e.g. `2`). Read the corresponding `[ID]` from the output above. Use that ID as `PAGE_ID` in section 1c.

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
      if (node.visible === false) return;
      if ((node.opacity ?? 1) === 0) return;
      if (/^_/.test(node.name)) return;
      const w = node.absoluteBoundingBox?.width ?? 0;
      const h = node.absoluteBoundingBox?.height ?? 0;
      if (w < 4 && h < 4 && node.type !== 'COMPONENT') return;
      console.log(' '.repeat(depth*2) + node.id + '  \"' + node.name + '\"  [' + node.type + ']');
      (node.children || []).forEach(c => walk(c, depth+1));
    }
    Object.values(d.nodes).forEach(n => walk(n.document, 0));
  "
```

**Node filtering heuristic** — nodes silently skipped:
- `visible = false` — hidden in Figma
- `opacity = 0` — fully transparent
- Name starts with `_` — internal/helper frame convention
- Width < 4px AND height < 4px (decorative dots/dividers) — unless COMPONENT
- Type is MASK — skip entirely
- Type is BOOLEAN_OPERATION — treat as icon (map to `<img>` or icon library)

**Figma API fallback strategy** — when any curl call fails:

| Error | Cause | Action |
|---|---|---|
| `"err": "Not found"` | Wrong NODE_ID or FILE_KEY | Re-check 1b output for correct IDs |
| `"status": 403` | Token expired or wrong | Re-run `grep FIGMA_TOKEN .env` to verify |
| `"status": 429` | Rate limited | Wait 30s, retry: `sleep 30 && <same curl>` |
| Empty response / timeout | Network issue | Retry up to 3×; cache: `echo "$r" > /tmp/figma_cache_NODE_ID.json` |
| Partial data (node missing props) | Figma API inconsistency | Use cached response; fallback to `absoluteBoundingBox` for size |

For repeated 429s: batch node IDs — `ids=ID1,ID2,ID3` (comma-separated, max 1000 characters).

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

**Load sub-skill:** invoke `figma-to-component/phase2-fetch`

That sub-skill covers:
- Fetching detailed Figma node properties (2a scripts)
- Tailwind class mapping tables (2c)
- Writing the component (2e)
- TypeScript check + anti-hallucination (2f, 2g)

After 2a–2g, load `figma-to-component/phase2-production` for production rules (2h) before moving to Phase 3.
