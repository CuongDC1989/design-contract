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

  const { specs } = JSON.parse(await fs.readFile(specPath, 'utf8'));
  const browser = await launchChromium();
  const page = await browser.newPage();
  let failed = 0;

  for (const item of Object.values(specs)) {
    if (item.viewport?.width && item.viewport?.height) {
      await page.setViewportSize(item.viewport);
    }
    const url = `${storybookUrl}/iframe.html?id=${item.storyId}&viewMode=story`;
    try {
      await page.goto(url, { waitUntil: 'networkidle' });
      await page.waitForSelector('#storybook-root', { timeout: 10000 });
    } catch {
      failed++;
      console.log(`FAIL ${item.name}\n  - story failed to load: ${item.storyId}`);
      continue;
    }

    const locator = page.locator(item.selector ?? '#storybook-root > *:visible').first();
    try {
      await locator.waitFor({ state: 'visible', timeout: 10000 });
    } catch {
      failed++;
      console.log(`FAIL ${item.name}\n  - element not found: ${item.selector}`);
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

    const errors = [];
    const expected = item.expected;

    if (item.checks.includes('background') && expected.backgroundColorRgba) {
      if (!colorClose(styles.backgroundColor, expected.backgroundColorRgba))
        errors.push(`background actual=${styles.backgroundColor} expected=${expected.backgroundColorRgba}`);
    }
    if (item.checks.includes('opacity') && typeof expected.opacity === 'number') {
      const actual = Number.parseFloat(styles.opacity);
      if (!Number.isFinite(actual) || !nearlyEqual(actual, expected.opacity, 0.08))
        errors.push(`opacity actual=${styles.opacity} expected=${expected.opacity}`);
    }
    if (item.checks.includes('border') && expected.border) {
      const w = firstNumberPx(styles.borderWidth);
      if (w === null || !nearlyEqual(w, expected.border.width, 1.5))
        errors.push(`borderWidth actual=${styles.borderWidth} expected=${expected.border.width}px`);
      if (!colorClose(styles.borderColor, expected.border.color))
        errors.push(`borderColor actual=${styles.borderColor} expected=${expected.border.color}`);
      if (expected.border.style && styles.borderStyle !== expected.border.style)
        errors.push(`borderStyle actual=${styles.borderStyle} expected=${expected.border.style}`);
    }
    if (item.checks.includes('shadow') && expected.shadow) {
      if (styles.boxShadow === 'none') errors.push('boxShadow actual=none expected=drop-shadow');
    }
    if (item.checks.includes('layout') && expected.layout) {
      for (const [label, actual, exp] of [
        ['gap', styles.gap, expected.layout.gap],
        ['paddingTop', styles.paddingTop, expected.layout.paddingTop],
        ['paddingRight', styles.paddingRight, expected.layout.paddingRight],
        ['paddingBottom', styles.paddingBottom, expected.layout.paddingBottom],
        ['paddingLeft', styles.paddingLeft, expected.layout.paddingLeft],
      ]) {
        const n = firstNumberPx(actual);
        if (n === null || !nearlyEqual(n, exp, 2)) errors.push(`${label} actual=${actual} expected=${exp}px`);
      }
      if (expected.layout.flexDirection && styles.flexDirection !== expected.layout.flexDirection)
        errors.push(`flexDirection actual=${styles.flexDirection} expected=${expected.layout.flexDirection}`);
      if (expected.layout.alignItems && styles.alignItems !== expected.layout.alignItems)
        errors.push(`alignItems actual=${styles.alignItems} expected=${expected.layout.alignItems}`);
      if (expected.layout.justifyContent && styles.justifyContent !== expected.layout.justifyContent)
        errors.push(`justifyContent actual=${styles.justifyContent} expected=${expected.layout.justifyContent}`);
      if (expected.layout.wrap && styles.flexWrap !== expected.layout.wrap)
        errors.push(`flexWrap actual=${styles.flexWrap} expected=${expected.layout.wrap}`);
    }
    if (item.checks.includes('typography') && expected.typography) {
      if (expected.typography.fontFamily && !styles.fontFamily.toLowerCase().includes(expected.typography.fontFamily.toLowerCase()))
        errors.push(`fontFamily actual=${styles.fontFamily} expected~=${expected.typography.fontFamily}`);
      if (expected.typography.fontWeight) {
        const w = Number.parseInt(styles.fontWeight, 10);
        if (!Number.isNaN(w) && !nearlyEqual(w, expected.typography.fontWeight, 150))
          errors.push(`fontWeight actual=${styles.fontWeight} expected=${expected.typography.fontWeight}`);
      }
      if (expected.typography.fontSize) {
        const s = firstNumberPx(styles.fontSize);
        if (s === null || !nearlyEqual(s, expected.typography.fontSize, 2))
          errors.push(`fontSize actual=${styles.fontSize} expected=${expected.typography.fontSize}px`);
      }
      if (expected.typography.lineHeightPx) {
        const lh = firstNumberPx(styles.lineHeight);
        if (lh !== null && !nearlyEqual(lh, expected.typography.lineHeightPx, 1))
          errors.push(`lineHeight actual=${styles.lineHeight} expected=${expected.typography.lineHeightPx}px`);
      }
      if (expected.typography.letterSpacing != null) {
        const ls = firstNumberPx(styles.letterSpacing);
        if (ls !== null && !nearlyEqual(ls, expected.typography.letterSpacing, 1.5))
          errors.push(`letterSpacing actual=${styles.letterSpacing} expected=${expected.typography.letterSpacing}px`);
      }
      if (expected.typography.textAlign) {
        const norm = (v) => (v === 'start' ? 'left' : v === 'end' ? 'right' : v);
        if (norm(styles.textAlign) !== norm(expected.typography.textAlign))
          errors.push(`textAlign actual=${styles.textAlign} expected=${expected.typography.textAlign}`);
      }
      if (expected.typography.color && !colorClose(styles.color, expected.typography.color))
        errors.push(`textColor actual=${styles.color} expected=${expected.typography.color}`);
      if (expected.typography.textDecoration && expected.typography.textDecoration !== 'none') {
        if (!styles.textDecoration.includes(expected.typography.textDecoration))
          errors.push(`textDecoration actual=${styles.textDecoration} expected=${expected.typography.textDecoration}`);
      }
      if (expected.typography.textTransform && expected.typography.textTransform !== 'none') {
        if (styles.textTransform !== expected.typography.textTransform)
          errors.push(`textTransform actual=${styles.textTransform} expected=${expected.typography.textTransform}`);
      }
      if (expected.typography.fontStyle && expected.typography.fontStyle !== 'normal') {
        if (styles.fontStyle !== expected.typography.fontStyle)
          errors.push(`fontStyle actual=${styles.fontStyle} expected=${expected.typography.fontStyle}`);
      }
    }
    if (item.checks.includes('size')) {
      if (!box) {
        errors.push('cannot compute bounding box');
      } else {
        if (!nearlyEqual(box.width, expected.width, 3))
          errors.push(`width actual=${box.width.toFixed(1)} expected=${expected.width}`);
        if (!nearlyEqual(box.height, expected.height, 3))
          errors.push(`height actual=${box.height.toFixed(1)} expected=${expected.height}`);
      }
      for (const [label, cssVal, expVal] of [
        ['minWidth', styles.minWidth, expected.minWidth],
        ['maxWidth', styles.maxWidth, expected.maxWidth],
        ['minHeight', styles.minHeight, expected.minHeight],
        ['maxHeight', styles.maxHeight, expected.maxHeight],
      ]) {
        if (expVal != null) {
          const n = firstNumberPx(cssVal);
          if (n !== null && !nearlyEqual(n, expVal, 2))
            errors.push(`${label} actual=${cssVal} expected=${expVal}px`);
        }
      }
    }
    if (item.checks.includes('overflow') && expected.overflow) {
      if (styles.overflow !== expected.overflow)
        errors.push(`overflow actual=${styles.overflow} expected=${expected.overflow}`);
    }
    if (item.checks.includes('blend') && expected.blendMode) {
      if (styles.mixBlendMode !== expected.blendMode)
        errors.push(`blendMode actual=${styles.mixBlendMode} expected=${expected.blendMode}`);
    }
    if (item.checks.includes('radius') && expected.cornerRadius !== null) {
      const r = firstNumberPx(styles.borderRadius);
      if (r === null || !nearlyEqual(r, expected.cornerRadius, 2))
        errors.push(`radius actual=${styles.borderRadius} expected=${expected.cornerRadius}px`);
    }
    if (item.checks.includes('text') && expected.text) {
      if (!text.includes(expected.text))
        errors.push(`text actual="${text}" expected contains "${expected.text}"`);
    }

    if (errors.length > 0) {
      failed++;
      console.log(`FAIL ${item.name}`);
      for (const err of errors) console.log(`  - ${err}`);
    } else {
      console.log(`PASS ${item.name}`);
    }
  }

  await browser.close();
  return failed === 0;
}
