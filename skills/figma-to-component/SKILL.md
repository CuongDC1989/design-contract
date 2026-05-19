# figma-to-component

Generate a single production-ready React component from a Figma design using multi-agent architecture.

## Trigger

- /figma-to-component
- User mentions "generate component from figma", "figma to react", "convert figma to component"

## Execution Rules

**Think before spawning** — Before spawning the `frontend-developer` agent, confirm you have: file path, Figma data, Tailwind mapping, confirmed props interface, and user approval. Missing any of these = ask, not guess.

**One component per run** — This skill generates exactly one component per invocation. Do not chain multiple components in a single agent call.

**Simplicity first** — Pass only what the agent needs. Do not over-specify — if the Figma node has no shadow, don't mention shadow in the prompt.

**Goal = match Figma** — The output must match the Figma design. Not "close enough", not "similar pattern from another component", not "how I'd normally build it".

**No scope creep** — If the user asks for a `LoginCard`, generate `LoginCard` only. Do not generate `LoginButton`, `LoginInput`, or other components discovered in the Figma tree unless explicitly requested.

---

## Instructions

You are an AI orchestrator that converts Figma designs into production-ready React/TypeScript components using a multi-agent architecture.

### Architecture Overview

**Phase 1: Planning (Opus)**
- Analyze Figma design structure
- Break down into pages/screens
- Create implementation plan for each screen
- Define component hierarchy and data flow

**Phase 2: Code Generation (Frontend Developer Agent)**
- Ask user which model to use (default: `claude-sonnet-4-6`)
- Spawn `frontend-developer` agent via Agent tool to generate complete React components
- Agent handles CSS (Tailwind), JSX structure, TypeScript interfaces, and logic
- Generates production-ready code following best practices

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
- `figma___get_screenshot` with node ID — visual reference image

**[API]** Use REST API:
```bash
source .env
# File structure
curl -s -H "X-Figma-Token: $FIGMA_TOKEN" \
  "https://api.figma.com/v1/files/$FIGMA_FILE_KEY?depth=1"

# Node properties
curl -s -H "X-Figma-Token: $FIGMA_TOKEN" \
  "https://api.figma.com/v1/files/$FIGMA_FILE_KEY/nodes?ids=NODE_ID"

# Screenshot export URL
curl -s -H "X-Figma-Token: $FIGMA_TOKEN" \
  "https://api.figma.com/v1/images/$FIGMA_FILE_KEY?ids=NODE_ID&format=png&scale=2"
```

Extract from either source:
- File key, node ID, component hierarchy
- Design tokens (colors, spacing, typography)

#### 3. Analyze & Create Plan (Opus)

Analyze the design and create a structured plan:

```markdown
## Design Analysis

**Pages/Screens Identified:**
1. [Screen Name] - [Purpose]
2. [Screen Name] - [Purpose]

**Component Hierarchy:**
- Parent Component
  - Child Component 1
  - Child Component 2
    - Nested Component

**Design Tokens:**
- Colors: [list]
- Typography: [list]
- Spacing: [list]

## Implementation Plan

### Screen: [Name]

**Component Structure:**
- Main component: `[ComponentName].tsx`
- Sub-components: `[SubComponent].tsx`

**CSS Requirements:**
- Layout: [flexbox/grid/etc]
- Responsive breakpoints: [mobile/tablet/desktop]
- Animations: [if any]
- Custom styles: [if needed beyond Tailwind]

**JSX Requirements:**
- HTML structure
- Conditional rendering
- List rendering
- Props interface

**Logic Requirements:**
- State variables: [list]
- Event handlers: [list]
- Side effects: [list]
- API calls: [if any]
- Form validation: [if any]

**Data Flow:**
- Props: [list with types]
- State: [list with types]
- Context: [if needed]
```

Show plan to user and ask for confirmation:
```
I've analyzed the Figma design. Here's my implementation plan:

[Show plan]

Should I proceed with code generation?
```

#### 4. Spawn Frontend Developer Agent

Ask which model to use:
```
Which model should the frontend-developer agent use?
  1. claude-sonnet-4-6 (default)
  2. claude-opus-4-7
  3. claude-haiku-4-5-20251001
  [Enter number or press Enter for default]
```

After user confirms model, spawn the `frontend-developer` agent using the **Agent tool**:

```
Goal: Generate production-ready React/TypeScript component for [ComponentName]

Context:
- Design tokens: [colors, spacing, typography from Figma]
- Component hierarchy: [from plan]
- Layout requirements: [flexbox/grid, responsive breakpoints]
- Props interface: [from plan]
- State requirements: [from plan]
- Event handlers: [from plan]
- Figma screenshot: [attach image from step 2]

Tasks:
1. Generate complete React component with TypeScript
2. Create Tailwind CSS classes for styling (mobile-first)
3. Implement JSX structure with semantic HTML
4. Add TypeScript interfaces for props and state
5. Implement event handlers and logic
6. Include accessibility attributes (WCAG 2.2 AA)
7. Add responsive design (mobile/tablet/desktop)
8. Handle edge cases (loading, error, empty states)

Output format:
- Complete .tsx file with all imports, interfaces, and implementation
- Separate types.ts if interfaces are complex
- Custom CSS file only if Tailwind is insufficient
- Component follows React best practices and project conventions
```

#### 5. Create Component Files

After the agent completes, create the component files in the project:
   ```
   components/
     [ComponentName]/
       index.tsx          # Main component
       [ComponentName].tsx # Component implementation
       types.ts           # TypeScript interfaces
       styles.css         # Custom CSS if needed
   ```

4. **Generate supporting files**:
   - `types.ts` - TypeScript interfaces
   - `constants.ts` - Constants if needed
   - `utils.ts` - Helper functions if needed
   - `README.md` - Component documentation

#### 6. Create Files

Ask user where to create files:
```
Where should I create the component files?
1. Current directory
2. Specify custom path
3. Create in components/ directory
```

Create all files using the Create tool.

#### 7. Verify & Document

1. **Run type checking**:
   ```bash
   npx tsc --noEmit [ComponentName].tsx
   ```

2. **Check for missing dependencies**:
   - Review imports
   - Check if packages are installed
   - Suggest installation commands if needed

3. **Generate documentation**:
   ```markdown
   # [ComponentName]

   ## Overview
   [Brief description]

   ## Props
   | Prop | Type | Required | Default | Description |
   |------|------|----------|---------|-------------|
   | ... | ... | ... | ... | ... |

   ## Usage
   ```tsx
   import { ComponentName } from './components/ComponentName';

   function App() {
     return <ComponentName prop1="value" />;
   }
   ```

   ## Features
   - [Feature 1]
   - [Feature 2]

   ## Figma Reference
   [Figma URL]
   ```

4. **Show summary**:
   ```
   ✅ Generated [N] component files
   ✅ Type checking passed
   ✅ Documentation created

   Files created:
   - components/[ComponentName]/index.tsx
   - components/[ComponentName]/types.ts
   - components/[ComponentName]/README.md

   Next steps:
   1. Review the generated code
   2. Install missing dependencies (if any)
   3. Import and use the component
   4. Customize as needed

   Figma source: [URL]
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
- Prefer Tailwind utility classes
- Use CSS variables for theme values
- Follow mobile-first responsive design
- Include hover/focus states
- Add smooth transitions

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
