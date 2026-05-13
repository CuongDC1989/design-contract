import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { chromium } from 'playwright';
import { nearlyEqual, firstNumberPx, colorClose } from './utils.mjs';

if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = '0';
}

function isMissingBrowserError(error) {
  return (error instanceof Error ? error.message : String(error)).includes("Executable doesn't exist");
}

function ensureChromium() {
  const result = spawnSync('npx', ['playwright', 'install', 'chromium'], { stdio: 'inherit', env: process.env });
  if (result.status !== 0) throw new Error('Unable to install Playwright Chromium automatically.');
}

async function launchChromium() {
  try {
    return await chromium.launch();
  } catch (error) {
    if (!isMissingBrowserError(error)) throw error;
    console.warn('Playwright Chromium missing. Installing (one-time setup)...');
    ensureChromium();
    return chromium.launch();
  }
}

export async function runDesignContractTest(config) {
  const specPath = path.resolve(process.cwd(), config.specOutputPath ?? './visual-tests/design-spec.json');
  const storybookUrl = config.storybookUrl ?? 'http://127.0.0.1:6006';
  const startTime = Date.now();

  const { specs } = JSON.parse(await fs.readFile(specPath, 'utf8'));
  const browser = await launchChromium();
  const page = await browser.newPage();
  let failed = 0;
  const results = [];

  for (const item of Object.values(specs)) {
    if (item.viewport?.width && item.viewport?.height) {
      await page.setViewportSize(item.viewport);
    }
    const url = `${storybookUrl}/iframe.html?id=${item.storyId}&viewMode=story`;
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#storybook-root', { timeout: 10000 });
    } catch {
      failed++;
      const msg = `story failed to load: ${item.storyId}`;
      console.log(`FAIL ${item.name}\n  - ${msg}`);
      results.push(makeResult(item, 'error', [], null, msg));
      continue;
    }

    const locator = page.locator(item.selector ?? '#storybook-root > *:visible').first();
    try {
      await locator.waitFor({ state: 'visible', timeout: 10000 });
    } catch {
      failed++;
      const msg = `element not found: ${item.selector}`;
      console.log(`FAIL ${item.name}\n  - ${msg}`);
      results.push(makeResult(item, 'error', [], null, msg));
      continue;
    }

    const box = await locator.boundingBox();
    const text = (await locator.innerText()).trim();
    const typographySelector = item.typographySelector ?? null;

    const styles = await locator.evaluate((el, typSel) => {
      const computed = window.getComputedStyle(el);
      function findFirstTextLeaf(node) {
        for (const child of node.childNodes) {
          if (child.nodeType === Node.TEXT_NODE && child.textContent.trim()) return node;
          if (child.nodeType === Node.ELEMENT_NODE) {
            const found = findFirstTextLeaf(child);
            if (found) return found;
          }
        }
        return null;
      }
      const typEl = typSel
        ? (el.querySelector(typSel) ?? el)
        : (findFirstTextLeaf(el) ?? el.querySelector('*') ?? el);
      const t = window.getComputedStyle(typEl);
      return {
        borderRadius: computed.borderRadius,
        backgroundColor: computed.backgroundColor,
        borderWidth: computed.borderWidth,
        borderColor: computed.borderColor,
        borderStyle: computed.borderStyle,
        opacity: computed.opacity,
        boxShadow: computed.boxShadow,
        paddingTop: computed.paddingTop,
        paddingRight: computed.paddingRight,
        paddingBottom: computed.paddingBottom,
        paddingLeft: computed.paddingLeft,
        gap: computed.gap,
        flexDirection: computed.flexDirection,
        alignItems: computed.alignItems,
        justifyContent: computed.justifyContent,
        flexWrap: computed.flexWrap,
        overflow: computed.overflow,
        minWidth: computed.minWidth,
        maxWidth: computed.maxWidth,
        minHeight: computed.minHeight,
        maxHeight: computed.maxHeight,
        mixBlendMode: computed.mixBlendMode,
        fontFamily: t.fontFamily,
        fontWeight: t.fontWeight,
        fontSize: t.fontSize,
        lineHeight: t.lineHeight,
        letterSpacing: t.letterSpacing,
        textAlign: t.textAlign,
        color: t.color,
        textDecoration: t.textDecoration,
        textTransform: t.textTransform,
        fontStyle: t.fontStyle,
      };
    }, typographySelector);

    const failures = [];
    const expected = item.expected;

    if (item.checks.includes('background') && expected.backgroundColorRgba) {
      if (!colorClose(styles.backgroundColor, expected.backgroundColorRgba))
        failures.push({ check: 'background', property: 'backgroundColor', expected: expected.backgroundColorRgba, actual: styles.backgroundColor });
    }
    if (item.checks.includes('opacity') && typeof expected.opacity === 'number') {
      const actual = Number.parseFloat(styles.opacity);
      if (!Number.isFinite(actual) || !nearlyEqual(actual, expected.opacity, 0.08))
        failures.push({ check: 'opacity', property: 'opacity', expected: String(expected.opacity), actual: styles.opacity });
    }
    if (item.checks.includes('border') && expected.border) {
      const w = firstNumberPx(styles.borderWidth);
      if (w === null || !nearlyEqual(w, expected.border.width, 1.5))
        failures.push({ check: 'border', property: 'borderWidth', expected: `${expected.border.width}px`, actual: styles.borderWidth });
      if (!colorClose(styles.borderColor, expected.border.color))
        failures.push({ check: 'border', property: 'borderColor', expected: expected.border.color, actual: styles.borderColor });
      if (expected.border.style && styles.borderStyle !== expected.border.style)
        failures.push({ check: 'border', property: 'borderStyle', expected: expected.border.style, actual: styles.borderStyle });
    }
    if (item.checks.includes('shadow') && expected.shadow) {
      if (styles.boxShadow === 'none')
        failures.push({ check: 'shadow', property: 'boxShadow', expected: 'drop-shadow', actual: 'none' });
    }
    if (item.checks.includes('layout') && expected.layout) {
      for (const [property, actual, exp] of [
        ['gap', styles.gap, expected.layout.gap],
        ['paddingTop', styles.paddingTop, expected.layout.paddingTop],
        ['paddingRight', styles.paddingRight, expected.layout.paddingRight],
        ['paddingBottom', styles.paddingBottom, expected.layout.paddingBottom],
        ['paddingLeft', styles.paddingLeft, expected.layout.paddingLeft],
      ]) {
        // CSS reports 'normal' when no gap/padding is set — treat as 0
        const n = actual === 'normal' ? 0 : firstNumberPx(actual);
        if (n === null || !nearlyEqual(n, exp, 2))
          failures.push({ check: 'layout', property, expected: `${exp}px`, actual });
      }
      if (expected.layout.flexDirection && styles.flexDirection !== expected.layout.flexDirection)
        failures.push({ check: 'layout', property: 'flexDirection', expected: expected.layout.flexDirection, actual: styles.flexDirection });
      if (expected.layout.alignItems && styles.alignItems !== expected.layout.alignItems)
        failures.push({ check: 'layout', property: 'alignItems', expected: expected.layout.alignItems, actual: styles.alignItems });
      if (expected.layout.justifyContent && styles.justifyContent !== expected.layout.justifyContent)
        failures.push({ check: 'layout', property: 'justifyContent', expected: expected.layout.justifyContent, actual: styles.justifyContent });
      if (expected.layout.wrap && styles.flexWrap !== expected.layout.wrap)
        failures.push({ check: 'layout', property: 'flexWrap', expected: expected.layout.wrap, actual: styles.flexWrap });
    }
    if (item.checks.includes('typography') && expected.typography) {
      if (expected.typography.fontFamily && !styles.fontFamily.toLowerCase().includes(expected.typography.fontFamily.toLowerCase()))
        failures.push({ check: 'typography', property: 'fontFamily', expected: expected.typography.fontFamily, actual: styles.fontFamily });
      if (expected.typography.fontWeight) {
        const w = Number.parseInt(styles.fontWeight, 10);
        if (!Number.isNaN(w) && !nearlyEqual(w, expected.typography.fontWeight, 150))
          failures.push({ check: 'typography', property: 'fontWeight', expected: String(expected.typography.fontWeight), actual: styles.fontWeight });
      }
      if (expected.typography.fontSize) {
        const s = firstNumberPx(styles.fontSize);
        if (s === null || !nearlyEqual(s, expected.typography.fontSize, 2))
          failures.push({ check: 'typography', property: 'fontSize', expected: `${expected.typography.fontSize}px`, actual: styles.fontSize });
      }
      if (expected.typography.lineHeightPx) {
        const lh = firstNumberPx(styles.lineHeight);
        if (lh !== null && !nearlyEqual(lh, expected.typography.lineHeightPx, 1))
          failures.push({ check: 'typography', property: 'lineHeight', expected: `${expected.typography.lineHeightPx}px`, actual: styles.lineHeight });
      }
      if (expected.typography.letterSpacing != null) {
        const ls = firstNumberPx(styles.letterSpacing);
        if (ls !== null && !nearlyEqual(ls, expected.typography.letterSpacing, 1.5))
          failures.push({ check: 'typography', property: 'letterSpacing', expected: `${expected.typography.letterSpacing}px`, actual: styles.letterSpacing });
      }
      if (expected.typography.textAlign) {
        const norm = (v) => (v === 'start' ? 'left' : v === 'end' ? 'right' : v);
        if (norm(styles.textAlign) !== norm(expected.typography.textAlign))
          failures.push({ check: 'typography', property: 'textAlign', expected: expected.typography.textAlign, actual: styles.textAlign });
      }
      if (expected.typography.color && !colorClose(styles.color, expected.typography.color))
        failures.push({ check: 'typography', property: 'textColor', expected: expected.typography.color, actual: styles.color });
      if (expected.typography.textDecoration && expected.typography.textDecoration !== 'none') {
        if (!styles.textDecoration.includes(expected.typography.textDecoration))
          failures.push({ check: 'typography', property: 'textDecoration', expected: expected.typography.textDecoration, actual: styles.textDecoration });
      }
      if (expected.typography.textTransform && expected.typography.textTransform !== 'none') {
        if (styles.textTransform !== expected.typography.textTransform)
          failures.push({ check: 'typography', property: 'textTransform', expected: expected.typography.textTransform, actual: styles.textTransform });
      }
      if (expected.typography.fontStyle && expected.typography.fontStyle !== 'normal') {
        if (styles.fontStyle !== expected.typography.fontStyle)
          failures.push({ check: 'typography', property: 'fontStyle', expected: expected.typography.fontStyle, actual: styles.fontStyle });
      }
    }
    if (item.checks.includes('size')) {
      if (!box) {
        failures.push({ check: 'size', property: 'boundingBox', expected: 'visible', actual: 'null' });
      } else {
        if (!nearlyEqual(box.width, expected.width, 3))
          failures.push({ check: 'size', property: 'width', expected: `${expected.width}px`, actual: `${box.width.toFixed(1)}px` });
        if (!nearlyEqual(box.height, expected.height, 3))
          failures.push({ check: 'size', property: 'height', expected: `${expected.height}px`, actual: `${box.height.toFixed(1)}px` });
      }
      for (const [property, cssVal, expVal] of [
        ['minWidth', styles.minWidth, expected.minWidth],
        ['maxWidth', styles.maxWidth, expected.maxWidth],
        ['minHeight', styles.minHeight, expected.minHeight],
        ['maxHeight', styles.maxHeight, expected.maxHeight],
      ]) {
        if (expVal != null) {
          const n = firstNumberPx(cssVal);
          if (n !== null && !nearlyEqual(n, expVal, 2))
            failures.push({ check: 'size', property, expected: `${expVal}px`, actual: cssVal });
        }
      }
    }
    if (item.checks.includes('overflow') && expected.overflow) {
      if (styles.overflow !== expected.overflow)
        failures.push({ check: 'overflow', property: 'overflow', expected: expected.overflow, actual: styles.overflow });
    }
    if (item.checks.includes('blend') && expected.blendMode) {
      if (styles.mixBlendMode !== expected.blendMode)
        failures.push({ check: 'blend', property: 'mixBlendMode', expected: expected.blendMode, actual: styles.mixBlendMode });
    }
    if (item.checks.includes('radius') && expected.cornerRadius !== null) {
      const r = firstNumberPx(styles.borderRadius);
      if (r === null || !nearlyEqual(r, expected.cornerRadius, 2))
        failures.push({ check: 'radius', property: 'borderRadius', expected: `${expected.cornerRadius}px`, actual: styles.borderRadius });
    }
    if (item.checks.includes('text') && expected.text) {
      if (!text.includes(expected.text))
        failures.push({ check: 'text', property: 'innerText', expected: `contains "${expected.text}"`, actual: `"${text.slice(0, 80)}"` });
    }

    const screenshot = await locator.screenshot({ type: 'png' }).then(buf => buf.toString('base64')).catch(() => null);
    const status = failures.length > 0 ? 'fail' : 'pass';

    if (failures.length > 0) {
      failed++;
      console.log(`FAIL ${item.name}`);
      for (const f of failures) console.log(`  - ${f.property} actual=${f.actual} expected=${f.expected}`);
    } else {
      console.log(`PASS ${item.name}`);
    }

    results.push(makeResult(item, status, failures, screenshot, null));
  }

  await browser.close();

  const endTime = Date.now();
  return { passed: failed === 0, results, startTime, endTime };
}

function makeResult(item, status, failures, screenshot, errorMessage) {
  return {
    name: item.name,
    storyId: item.storyId,
    figmaNodeId: item.figmaNodeId,
    selector: item.selector ?? null,
    checks: item.checks ?? [],
    status,
    failures,
    screenshot,
    errorMessage,
  };
}
