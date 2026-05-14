# Sub-skill: figma-to-component / phase2-production

Production readiness rules (Phase 2h). Apply these to every component after the visual implementation is done. A component that passes design-contract tests but fails in production is not done.

**After completing 2h:** load sub-skill `figma-to-component/phase3-story`.

---

## 2h — Production readiness rules

### Semantic component inference

Before writing props, infer the component's data contract from its Figma structure:

| Figma node structure | Inferred props |
|---|---|
| Frame with Avatar + Name + Status badge | `user: { name: string; status: string; avatarUrl?: string }` |
| COMPONENT_SET `State=Active/Inactive/Disabled` | `status: 'active' \| 'inactive' \| 'disabled'` |
| Frame with Input + Button | `onSearch: (query: string) => void; placeholder?: string` |
| List of identical child frames | `items: ItemType[]` |
| Frame with title + count number | `title: string; count: number` |
| Prototype link (tap/click) on node | `onClick?: () => void` |

Present the inferred interface to the user before writing code. Confirm before proceeding.

---

### Text content strategy

- **Never hardcode visible text** as string literals in JSX. Every visible text must be a prop.
- Figma text value → use as the **default** prop value: `label = "Submit"` not `<span>Submit</span>`.
- Check i18n: `grep -r "useTranslation\|i18next\|t(" src/ | head -5`. If yes, extract to translation key: `t('auth.loginCard.submit')`.
- Numbers, dates, names from data → required prop with strong type: `count: number`, `date: Date | string`.
- Truncation: if Figma shows ellipsis or `clipsContent = true` → `truncate` (single line) or `line-clamp-N` (multiline).

---

### Async state strategy

Every data-driven component must handle 4 states. Check Figma for named variants "Loading", "Error", "Empty":

```tsx
type Status = 'loading' | 'error' | 'empty' | 'success'

// Pattern A — status prop (stateless, for Storybook)
interface Props { status?: Status; data?: DataType }

// Pattern B — hook-driven (stateful, for pages)
const { data, status } = useComponentData(id)
```

- **loading** → Skeleton or `animate-pulse` blocks (see Loading skeleton strategy below)
- **error** → error message + retry action; use Figma "Error" variant design if present
- **empty** → empty state illustration/text; use Figma "Empty" variant if present
- **success** → normal render

For Storybook: add named exports `Loading`, `Error`, `Empty` alongside `Default`.

---

### Loading skeleton strategy

```bash
find src -name "Skeleton*" -o -name "*skeleton*" 2>/dev/null | head -5
grep -r "Skeleton\|skeleton" src/components/ui/ 2>/dev/null | head -5
```

- **Project has Skeleton:** compose with the same flex structure and widths as the real component
- **No Skeleton:** `<div className="animate-pulse bg-muted rounded-md w-[Xpx] h-[Ypx]" />` matching 2a dimensions
- Add `data-testid="<testid>-skeleton"` to the skeleton root

---

### Chart handling

When a Figma node is a chart/graph visualization (name contains "Chart", "Graph", "Metric", "Sparkline"):

```bash
node -e "const d=require('./package.json'); const libs=['recharts','chart.js','react-chartjs-2','nivo','victory','@visx','@tremor']; Object.keys({...d.dependencies,...(d.devDependencies||{})}).filter(k=>libs.some(l=>k.includes(l))).forEach(k=>console.log(k))"
```

- **Generate wrapper** with exact Figma dimensions (`w-[Xpx] h-[Ypx]`), typed `data` prop, and a `// TODO: wire up <LibraryChart> with data prop` comment
- **Never** recreate chart visuals with CSS/divs — charts are data-driven

---

### Form validation strategy

When a component contains form inputs:

```bash
node -e "const d=require('./package.json'); ['react-hook-form','formik','@tanstack/form','final-form'].filter(k=>d.dependencies?.[k]||d.devDependencies?.[k]).forEach(k=>console.log(k))"
```

- **react-hook-form** → `register`, `Controller`, `formState.errors`; never uncontrolled `onChange`
- **formik** → `Field`, `useField`, `errors` from `useFormikContext`
- **None detected** → `React.useState` with local validation
- Error state: if Figma has red-border input variant → `error?: string` prop + `border-destructive` when truthy
- Check for Figma variants "Error", "Success", "Disabled" — implement all three

---

### Animation libraries

```bash
node -e "const d=require('./package.json'); ['framer-motion','@headlessui/react','react-spring','auto-animate','@formkit/auto-animate'].filter(k=>d.dependencies?.[k]).forEach(k=>console.log(k))"
```

- **framer-motion:** `motion.div` with `initial/animate/exit` variants. `AnimatePresence` for mount/unmount.
- **Headless UI:** built-in `Transition` for dialogs/dropdowns
- **No library:** `transition-all duration-200 ease-in-out` for hover/focus; `transition-opacity duration-150` for fades
- **Tests ignore animations** — put `data-testid` on the underlying element, not the `motion` wrapper
- Always add prefers-reduced-motion: `motion-safe:transition-all motion-reduce:transition-none`

---

### React architecture rules

- **One component per file.** Tiny sub-components (< 20 lines, unexported) may colocate.
- **Named exports** — unless project convention is default (check `grep "export default" src/components/ui/*.tsx | head -3`).
- **Props interface at top**, named `<ComponentName>Props`.
- **No inline object/array literals in JSX** — creates new references every render.
- **Custom hooks:** > 3 `useState`/`useEffect` calls → extract to `use<ComponentName>.ts`.
- **No `any` types** — use `unknown` with narrowing, or the exact type.
- **Colocate:** `ComponentName.tsx`, `ComponentName.stories.tsx`, `use<ComponentName>.ts` in same directory.

---

### Import ordering

```tsx
// 1. React
import React, { useState, useEffect } from 'react'

// 2. Third-party (alphabetical)
import { motion } from 'framer-motion'
import { useForm } from 'react-hook-form'

// 3. Internal aliases (alphabetical)
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// 4. Relative imports (alphabetical)
import { useLoginCard } from './useLoginCard'

// 5. Type-only imports (last)
import type { LoginCardProps } from './LoginCard.types'
```

```bash
grep -E "import.*order|sort-imports|@trivago" package.json .eslintrc* 2>/dev/null | head -3
```
If ESLint import plugin is configured, run `eslint --fix` after generation.

---

### Deterministic generation rule

Same Figma node + same project state → same output every run:
- No `Math.random()`, `crypto.randomUUID()`, `Date.now()` in static component files
- No timestamp-based class names or keys
- Always sort import lists alphabetically
- `key={index}` in lists → use a stable data identifier instead
- `data-testid` derived from Figma node name only (from Phase 1d component map)

---

### Component composition hierarchy

| Tier | Examples | Location | Rule |
|---|---|---|---|
| Atom | Button, Badge, Input, Icon | `src/components/ui/` | Stateless, no data fetching, max 50 lines |
| Molecule | SearchBar, FormField, UserAvatar | `src/components/` | Composes atoms, may have local state |
| Organism | LoginCard, UserTable, Sidebar | `src/features/<feature>/` | Composes molecules, may call hooks |
| Template | DashboardLayout, AuthLayout | `src/layouts/` | Page structure only, no business logic |
| Page | AuthPage, DashboardPage | `src/features/<feature>/` | Wires organism + template + data |

**Rule:** never skip tiers. Pages use Templates; Organisms import Atoms.

---

### Container query / breakpoint strategy

```bash
grep -r "@container\|container-type" src/ tailwind.config.* 2>/dev/null | head -5
```

- **Container queries in use:** `container-type: inline-size` on wrapper; `@lg:` prefix for inner layout
- **Standard breakpoints:** check for Figma mobile/tablet variants. Map 375px frame → default classes; 1440px frame → `lg:` classes.
- **No responsive Figma variants:** generate desktop-first; add `// TODO: add responsive behavior` comment.

---

### Safe rewrite boundary

Before modifying any existing component:

```bash
git diff --name-only HEAD | grep "ComponentName"
git log --oneline -3 -- path/to/ComponentName.tsx
```

- **Uncommitted local changes** → STOP. Show diff, ask user whether to merge or skip.
- **Component has passing test** (status = `skip`) → never touch unless user explicitly requests.
- **Full rewrite (Phase 5e):** always backup first: `cp ComponentName.tsx ComponentName.tsx.figma-backup`

---

### Generated documentation

Single-line traceability comment at top of every new file:
```tsx
// Figma: "<NodeName>" · file: FIGMA_FILE_KEY · node: NODE_ID
```

JSDoc only on non-obvious props — one line max:
```tsx
interface TableProps {
  /** Column definitions from design-contract config */
  columns: ColumnDef[]
  data: Row[]
}
```

---

## Next step

After all production rules applied: load sub-skill `figma-to-component/phase3-story`.
