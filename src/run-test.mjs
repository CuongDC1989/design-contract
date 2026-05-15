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

    const details = [];
    const failures = [];
    const expected = item.expected;

    // Helper: record every checked property (pass or fail)
    const track = (chk, property, exp, actual, pass) => {
      details.push({ check: chk, property, expected: String(exp), actual: String(actual), pass });
      if (!pass) failures.push({ check: chk, property, expected: String(exp), actual: String(actual) });
    };

    if (item.checks.includes('exists')) {
      track('exists', 'element', 'visible', box ? 'visible' : 'not found', !!box);
    }
    if (item.checks.includes('background') && expected.backgroundColorRgba) {
      const pass = colorClose(styles.backgroundColor, expected.backgroundColorRgba);
      track('background', 'backgroundColor', expected.backgroundColorRgba, styles.backgroundColor, pass);
    }
    if (item.checks.includes('opacity') && typeof expected.opacity === 'number') {
      const actual = Number.parseFloat(styles.opacity);
      const pass = Number.isFinite(actual) && nearlyEqual(actual, expected.opacity, 0.08);
      track('opacity', 'opacity', String(expected.opacity), styles.opacity, pass);
    }
    if (item.checks.includes('border') && expected.border) {
      const w = firstNumberPx(styles.borderWidth);
      track('border', 'borderWidth', `${expected.border.width}px`, styles.borderWidth, w !== null && nearlyEqual(w, expected.border.width, 1.5));
      track('border', 'borderColor', expected.border.color, styles.borderColor, colorClose(styles.borderColor, expected.border.color));
      if (expected.border.style)
        track('border', 'borderStyle', expected.border.style, styles.borderStyle, styles.borderStyle === expected.border.style);
    }
    if (item.checks.includes('shadow') && expected.shadow) {
      track('shadow', 'boxShadow', 'drop-shadow', styles.boxShadow === 'none' ? 'none' : 'present', styles.boxShadow !== 'none');
    }
    if (item.checks.includes('layout') && expected.layout) {
      for (const [property, actual, exp] of [
        ['gap', styles.gap, expected.layout.gap],
        ['paddingTop', styles.paddingTop, expected.layout.paddingTop],
        ['paddingRight', styles.paddingRight, expected.layout.paddingRight],
        ['paddingBottom', styles.paddingBottom, expected.layout.paddingBottom],
        ['paddingLeft', styles.paddingLeft, expected.layout.paddingLeft],
      ]) {
        const n = actual === 'normal' ? 0 : firstNumberPx(actual);
        track('layout', property, `${exp}px`, actual, n !== null && nearlyEqual(n, exp, 2));
      }
      if (expected.layout.flexDirection)
        track('layout', 'flexDirection', expected.layout.flexDirection, styles.flexDirection, styles.flexDirection === expected.layout.flexDirection);
      if (expected.layout.alignItems)
        track('layout', 'alignItems', expected.layout.alignItems, styles.alignItems, styles.alignItems === expected.layout.alignItems);
      if (expected.layout.justifyContent)
        track('layout', 'justifyContent', expected.layout.justifyContent, styles.justifyContent, styles.justifyContent === expected.layout.justifyContent);
      if (expected.layout.wrap)
        track('layout', 'flexWrap', expected.layout.wrap, styles.flexWrap, styles.flexWrap === expected.layout.wrap);
    }
    if (item.checks.includes('typography') && expected.typography) {
      if (expected.typography.fontFamily)
        track('typography', 'fontFamily', expected.typography.fontFamily, styles.fontFamily, styles.fontFamily.toLowerCase().includes(expected.typography.fontFamily.toLowerCase()));
      if (expected.typography.fontWeight) {
        const w = Number.parseInt(styles.fontWeight, 10);
        track('typography', 'fontWeight', String(expected.typography.fontWeight), styles.fontWeight, !Number.isNaN(w) && nearlyEqual(w, expected.typography.fontWeight, 150));
      }
      if (expected.typography.fontSize) {
        const s = firstNumberPx(styles.fontSize);
        track('typography', 'fontSize', `${expected.typography.fontSize}px`, styles.fontSize, s !== null && nearlyEqual(s, expected.typography.fontSize, 2));
      }
      if (expected.typography.lineHeightPx) {
        const lh = firstNumberPx(styles.lineHeight);
        track('typography', 'lineHeight', `${expected.typography.lineHeightPx}px`, styles.lineHeight, lh !== null && nearlyEqual(lh, expected.typography.lineHeightPx, 1));
      }
      if (expected.typography.letterSpacing != null) {
        const ls = firstNumberPx(styles.letterSpacing);
        track('typography', 'letterSpacing', `${expected.typography.letterSpacing}px`, styles.letterSpacing, ls !== null && nearlyEqual(ls, expected.typography.letterSpacing, 1.5));
      }
      if (expected.typography.textAlign) {
        const norm = (v) => (v === 'start' ? 'left' : v === 'end' ? 'right' : v);
        track('typography', 'textAlign', expected.typography.textAlign, styles.textAlign, norm(styles.textAlign) === norm(expected.typography.textAlign));
      }
      if (expected.typography.color)
        track('typography', 'textColor', expected.typography.color, styles.color, colorClose(styles.color, expected.typography.color));
      if (expected.typography.textDecoration && expected.typography.textDecoration !== 'none')
        track('typography', 'textDecoration', expected.typography.textDecoration, styles.textDecoration, styles.textDecoration.includes(expected.typography.textDecoration));
      if (expected.typography.textTransform && expected.typography.textTransform !== 'none')
        track('typography', 'textTransform', expected.typography.textTransform, styles.textTransform, styles.textTransform === expected.typography.textTransform);
      if (expected.typography.fontStyle && expected.typography.fontStyle !== 'normal')
        track('typography', 'fontStyle', expected.typography.fontStyle, styles.fontStyle, styles.fontStyle === expected.typography.fontStyle);
    }
    if (item.checks.includes('size')) {
      if (!box) {
        track('size', 'boundingBox', 'visible', 'null', false);
      } else {
        track('size', 'width', `${expected.width}px`, `${box.width.toFixed(1)}px`, nearlyEqual(box.width, expected.width, 3));
        track('size', 'height', `${expected.height}px`, `${box.height.toFixed(1)}px`, nearlyEqual(box.height, expected.height, 3));
      }
      for (const [property, cssVal, expVal] of [
        ['minWidth', styles.minWidth, expected.minWidth],
        ['maxWidth', styles.maxWidth, expected.maxWidth],
        ['minHeight', styles.minHeight, expected.minHeight],
        ['maxHeight', styles.maxHeight, expected.maxHeight],
      ]) {
        if (expVal != null) {
          const n = firstNumberPx(cssVal);
          track('size', property, `${expVal}px`, cssVal, n !== null && nearlyEqual(n, expVal, 2));
        }
      }
    }
    if (item.checks.includes('overflow') && expected.overflow) {
      track('overflow', 'overflow', expected.overflow, styles.overflow, styles.overflow === expected.overflow);
    }
    if (item.checks.includes('blend') && expected.blendMode) {
      track('blend', 'mixBlendMode', expected.blendMode, styles.mixBlendMode, styles.mixBlendMode === expected.blendMode);
    }
    if (item.checks.includes('radius') && expected.cornerRadius !== null) {
      const r = firstNumberPx(styles.borderRadius);
      track('radius', 'borderRadius', `${expected.cornerRadius}px`, styles.borderRadius, r !== null && nearlyEqual(r, expected.cornerRadius, 2));
    }
    if (item.checks.includes('text') && expected.text) {
      const pass = text.includes(expected.text);
      track('text', 'innerText', `contains "${expected.text}"`, `"${text.slice(0, 80)}"`, pass);
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

    results.push(makeResult(item, status, failures, details, screenshot, null));
  }

  await browser.close();

  const endTime = Date.now();
  return { passed: failed === 0, results, startTime, endTime };
}

function makeResult(item, status, failures, details, screenshot, errorMessage) {
  return {
    name: item.name,
    storyId: item.storyId,
    figmaNodeId: item.figmaNodeId,
    selector: item.selector ?? null,
    checks: item.checks ?? [],
    status,
    failures,
    details,
    screenshot,
    errorMessage,
  };
}
