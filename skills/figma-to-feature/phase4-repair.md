# Sub-skill: figma-to-feature / phase4-repair

Covers Phase 4 (iteration loop) and Phase 5 (repair mode), plus Quick Reference, telemetry, and design-token sync.

---

## Execution Rules — repair is the highest-risk phase for scope creep

**Phase 4 only runs when the user explicitly asks to fix a component to match Figma.**  
If no such instruction exists, failing tests are the correct output — do not enter Phase 4 on your own initiative.

**Diagnose before fixing** — Read the exact failure message and screenshot before touching any file. State in one sentence what is wrong and why.

**One failure, one fix** — Fix the failing check only. Do not refactor surrounding code, rename variables, or clean up while you're in the file.

**Surgical changes** — If `padding` is wrong, change only the padding class. If `border-radius` is wrong, change only the radius class. Do not restructure the JSX to fix a CSS value.

**Fix to Figma, not to pass** — Every CSS change must be backed by a Figma node property. The correct workflow is:
1. Read the test failure (e.g., `padding expected 24px, got 16px`)
2. Fetch the Figma node and confirm the expected value (`paddingLeft: 24`)
3. Update the component CSS to match Figma (`px-6` → `px-[24px]`)

**Never reverse-engineer to pass.** If a test expects `24px` and you change the component to `24px` without confirming that value in Figma, you may be locking in a wrong value. Always trace back to the Figma source.

**Fix code, not checks** — Never remove a check because it's hard to match. The only valid reason to remove a check is a confirmed null/0 Figma property (see 4d). Everything else means the component is wrong.

**No lateral fixes** — If you notice other failing tests or unrelated issues while repairing, note them and finish the current repair first. Do not context-switch mid-fix.

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

---

## Phase 4 — Iteration Loop

### 4a — TypeScript check (run before asking user to start Storybook)

```bash
npx tsc --noEmit
```

Fix all TypeScript errors before asking the user to run tests. TypeScript errors prevent the entire Storybook module graph from compiling — all tests will fail with "story failed to load".

### 4b — Ask user to run Storybook + tests

Remind the user:
1. Start Storybook: `npm run storybook`
2. Wait for it to be ready at `http://127.0.0.1:6006`
3. Run tests: `npm run test:design`
4. Paste the full output here

### 4c — Diagnose each failing test

**Screenshot-aware diagnosis:** When a test fails with a visual check (size, layout, background), take screenshots of both the rendered story and the Figma node to compare:

```bash
# Screenshot the rendered Storybook story (requires Storybook running)
source .env
npx playwright screenshot \
  "http://127.0.0.1:6006/iframe.html?id=STORY_ID&viewMode=story" \
  /tmp/story-COMPONENT.png --wait-for-selector "[data-testid='TESTID']"

# Export Figma node as PNG for visual comparison
curl -s -H "X-Figma-Token: $FIGMA_TOKEN" \
  "https://api.figma.com/v1/images/$FIGMA_FILE_KEY?ids=NODE_ID&format=png&scale=2" \
  | node -e "
    const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    if(d.err){console.error(d.err);process.exit(1);}
    const url=Object.values(d.images||{})[0];
    console.log('Figma export URL:', url);
  "
# Then download: curl -L '<url>' > /tmp/figma-COMPONENT.png
```

Read both screenshots to identify what specifically differs (spacing, color, size) before writing any fix.

**Diagnosis decision tree:**

```
Test fails
  ├── "story failed to load" or "timeout waiting for networkidle"
  │     → First check: is #storybook-root hidden?
  │       Open browser DevTools in Storybook iframe, run:
  │         document.getElementById('storybook-root').style.display
  │       If 'none' → story has a render error. Check the Console tab for the actual exception.
  │       If '' (visible) → the test runner timed out, not a story error — check network/selector.
  │     → Story file issue. Check all 7 rules from Phase 3c.
  │     → Most common: missing `component` in meta, external URL in mock data,
  │       inline <style> tag (React 19), unresolved import, TypeScript error in module graph
  │
  ├── "size mismatch" (width/height wrong)
  │     → Screenshot first — identify which dimension is wrong
  │     → Check if Figma node is a wrapper frame (Phase 2b)
  │     → Check viewport in cases[]: does it match Figma frame dimensions?
  │     → Check for extra padding/margin on root element
  │
  ├── "layout mismatch" (padding/gap wrong)
  │     → Screenshot first — identify which spacing is wrong
  │     → Re-check Figma node padding/gap from Phase 2a
  │     → Verify Tailwind math: 80px = py-20 (80÷4), 40px = gap-10 (40÷4)
  │     → Check for parent element adding conflicting padding
  │
  ├── "typography mismatch" (font-size/weight/lineHeight wrong)
  │     → Re-run Phase 2a-typography to get exact values
  │     → lineHeight is lineHeightPx — non-standard values need `leading-[Xpx]`
  │     → lineHeightPx=21 → `leading-[21px]` NOT `leading-5`
  │
  ├── "background mismatch" (color wrong)
  │     → Run 2a-colors token normalization (including perceptual match)
  │     → Screenshot comparison to see exact color difference
  │
  ├── "radius mismatch"
  │     → cornerRadius 24 = `rounded-3xl`, 12 = `rounded-xl`
  │     → Non-standard: `rounded-[Xpx]`
  │
  └── Check passes but Figma property is null/0
        → Remove that check from contractCases entry
        → This is the ONLY valid reason to remove a check
```

**AST-safe editing for targeted fixes:**

When fixing a single Tailwind class in an existing component, use ts-morph for precise edits instead of text replacement (avoids accidentally matching the same class string in another element):

```bash
# Check if ts-morph is available
node -e "require('ts-morph')" 2>/dev/null && echo "available" || echo "not installed — use Edit tool"
```

If ts-morph is available:
```bash
node -e "
  const { Project, SyntaxKind } = require('ts-morph');
  const p = new Project({ tsConfigFilePath: 'tsconfig.json' });
  const f = p.addSourceFileAtPath('src/features/auth/LoginCard.tsx');
  // Find JSX element with specific data-testid, update its className
  f.getDescendantsOfKind(SyntaxKind.JsxOpeningElement)
    .filter(el => el.getAttribute('data-testid')?.getInitializer()?.getText()?.includes('auth-logincard'))
    .forEach(el => {
      const classAttr = el.getAttribute('className');
      if (classAttr) {
        const current = classAttr.getInitializer().getText().replace(/[\"']/g,'');
        const fixed = current.replace('py-8', 'py-20'); // example fix
        classAttr.getInitializer().replaceWithText('\`' + fixed + '\`');
      }
    });
  f.saveSync();
  console.log('Done');
"
```

If ts-morph is not available, use the Edit tool with enough surrounding context to make the `old_string` unique.

### 4d — Fix priority rule

**Always fix component code first. Only modify checks as a last resort.**

| Situation | Action |
|---|---|
| Figma `cornerRadius` is 0 or null | Remove `'radius'` from checks |
| Figma `fills` is empty or all invisible | Remove `'background'` from checks |
| Figma `effects` has no visible shadows | Remove `'shadow'` from checks |
| Figma `clipsContent` is false | Remove `'overflow'` from checks |
| Figma node has dynamic/content-driven width | Remove `'size'` or reduce to `['exists']` |

**Never remove a check because the CSS is "hard to match."** Fix the CSS instead.

### 4e — Table component special rules

1. **Column widths need `table-layout: fixed`** for correct width measurement:
```tsx
<table style={{ tableLayout: 'fixed', width: '100%' }}>
```

2. **Set column widths via `col.size`** in column definitions, not on `<th>`/`<td>` cells.

3. **Inline-flex badges inside `<td>` can overflow** — add `overflow-hidden` to the cell wrapper.

### 4f — Re-run and repeat

After each fix:
```bash
npx tsc --noEmit
```

Ask the user to re-run `npm run test:design`. Repeat 4c → 4d → 4f until all targeted tests pass. After each repair cycle, append to the telemetry log (5f).

---

## Phase 5 — Repair Mode

Use when Phase 4 is stuck (3+ rounds without progress) or a component has diverged too far to fix incrementally.

### 5a — Diagnose root cause first

| Question | Points to |
|---|---|
| Is CSS value wrong (color/spacing/typography)? | Targeted CSS fix (5b) |
| Is HTML structure wrong (wrong nesting/element)? | Structural rewrite (5c) |
| Is the test config wrong (selector/nodeId/checks)? | Config fix (5d) |
| Combination of all three? | Full rewrite (5e) |

### 5b — Targeted CSS repair

1. Re-fetch the Figma node (Phase 2a + 2a-typography + 2a-colors)
2. Take screenshots of story and Figma node (see 4c screenshot commands)
3. Open the component file and compare **every CSS class** against Figma values line by line
4. Fix only the lines that differ — do not restructure
5. Use AST-safe editing (4c) when the class string appears multiple times in the file

### 5c — Structural repair

1. Re-fetch the Figma node with its children:
```bash
source .env
curl -s -H "X-Figma-Token: $FIGMA_TOKEN" \
  "https://api.figma.com/v1/files/$FIGMA_FILE_KEY/nodes?ids=NODE_ID" \
  | node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    function walk(n, depth) {
      console.log(' '.repeat(depth*2) + '[' + n.type + '] ' + n.name + ' (' + (n.layoutMode||'') + ')');
      (n.children||[]).forEach(c => walk(c, depth+1));
    }
    walk(Object.values(d.nodes)[0].document, 0);
  "
```
2. Rebuild JSX hierarchy to match Figma's parent → children structure exactly
3. Check: number of nesting levels, which nodes are flex containers, which are leaves

### 5d — Test config repair

Verify each independently:
- `figmaNodeId` — re-confirm this is the actual component node, not a wrapper frame (Phase 2b)
- `selector` — open story in browser, run `document.querySelector('[data-testid="..."]')` in console
- `figmaScale` — component ≤ 100px? → 2, otherwise → 1
- `viewport` — does it match the story's rendering context?
- `checks` — re-run Phase 3a detection script to verify which checks are valid

### 5e — Full rewrite (last resort)

Only when 5b–5d all fail:
1. Check safe rewrite boundary: `git diff --name-only HEAD | grep "ComponentName"`
2. Uncommitted changes? → show diff, ask user first
3. Create backup: `cp ComponentName.tsx ComponentName.tsx.figma-backup`
4. Delete the current component file
5. Re-read Figma from scratch: Phase 2a → 2a-typography → 2a-colors → 2a-variables → 2a-images
6. Run Phase 1e to confirm no existing component to reuse
7. Re-run Phase 2g anti-hallucination checklist before saving
8. **Do NOT copy-paste old broken code** — start from blank file

### 5f — Repair telemetry

After each completed repair cycle:

```bash
node -e "
  const fs = require('fs');
  const log = fs.existsSync('.design-check-log.json')
    ? JSON.parse(fs.readFileSync('.design-check-log.json','utf8'))
    : [];
  log.push({
    timestamp: new Date().toISOString(),
    component: 'ComponentName',
    check: 'size',
    iteration: 2,
    fix: 'changed h-[80px] to h-20',
    result: 'pass'
  });
  fs.writeFileSync('.design-check-log.json', JSON.stringify(log, null, 2));
"
```

If `size` check fails > 3 times in a session → re-check all `absoluteBoundingBox` references across components.

### 5g — Design-token sync strategy

After all components pass tests:

```bash
# Find hardcoded hex colors that should be tokens
grep -rn "bg-\[#\|text-\[#\|border-\[#" src/features/ src/components/ 2>/dev/null

# Find raw pixel sizes that may have token equivalents
grep -rn "\[.*px\]" src/features/ src/components/ 2>/dev/null | grep -v "test\|stories"
```

For each hardcoded hex:
1. Check if it matches a Figma color style (from 2a-colors output)
2. Check if it matches a value in `tailwind.config.*`
3. Match found → replace with token class
4. No match → add token to `tailwind.config.*` and replace

**Token sync checklist before finishing:**
- [ ] Zero `bg-[#...]` in new components
- [ ] Zero `text-[#...]` in new components
- [ ] All shadow values use named tokens from `tailwind.config.*`
- [ ] All border-radius values use named tokens (or arbitrary only when no token matches)
