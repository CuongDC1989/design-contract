import fs from 'node:fs/promises';
import path from 'node:path';
import { CHECKS_STRICT } from './constants.mjs';

function toApiNodeId(nodeId) {
  return nodeId.replace(/-/g, ':');
}

function rgbaToCss(color, opacity = 1) {
  if (!color) return null;
  const r = Math.round((color.r ?? 0) * 255);
  const g = Math.round((color.g ?? 0) * 255);
  const b = Math.round((color.b ?? 0) * 255);
  const a = Number(((color.a ?? 1) * opacity).toFixed(3));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function firstSolidPaint(paints = []) {
  return paints.find((p) => p?.visible !== false && p?.type === 'SOLID');
}

function firstDropShadow(effects = []) {
  return effects.find((e) => e?.visible !== false && e?.type === 'DROP_SHADOW');
}

function firstTextNode(node) {
  if (!node) return null;
  if (node.type === 'TEXT') return node;
  for (const child of node.children ?? []) {
    const found = firstTextNode(child);
    if (found) return found;
  }
  return null;
}

function mapCounterAxisAlign(value) {
  const map = { MIN: 'flex-start', CENTER: 'center', MAX: 'flex-end', BASELINE: 'baseline', STRETCH: 'stretch' };
  return map[value] ?? null;
}

function mapPrimaryAxisAlign(value) {
  const map = { MIN: 'flex-start', CENTER: 'center', MAX: 'flex-end', SPACE_BETWEEN: 'space-between' };
  return map[value] ?? null;
}

function mapTextDecoration(value) {
  if (value === 'UNDERLINE') return 'underline';
  if (value === 'STRIKETHROUGH') return 'line-through';
  return 'none';
}

function mapTextCase(value) {
  if (value === 'UPPER') return 'uppercase';
  if (value === 'LOWER') return 'lowercase';
  if (value === 'TITLE') return 'capitalize';
  return 'none';
}

function mapBlendMode(value) {
  // PASS_THROUGH is a Figma-only concept (layer compositing) with no CSS equivalent
  if (!value || value === 'NORMAL' || value === 'PASS_THROUGH') return null;
  return value.toLowerCase().replace(/_/g, '-');
}

function extractNodeSpec(node) {
  const bounds = node.absoluteBoundingBox ?? { width: 0, height: 0 };
  const solidFill = firstSolidPaint(node.fills ?? []);
  const solidStroke = firstSolidPaint(node.strokes ?? []);
  const dropShadow = firstDropShadow(node.effects ?? []);
  const textNode = firstTextNode(node);
  const textPaint = firstSolidPaint(textNode?.fills ?? []);

  return {
    nodeId: node.id,
    nodeName: node.name,
    width: Math.round(bounds.width ?? 0),
    height: Math.round(bounds.height ?? 0),
    cornerRadius:
      typeof node.cornerRadius === 'number'
        ? node.cornerRadius
        : typeof node.rectangleCornerRadii?.[0] === 'number'
          ? node.rectangleCornerRadii[0]
          : null,
    backgroundColorRgba: rgbaToCss(solidFill?.color, solidFill?.opacity ?? 1),
    opacity: typeof node.opacity === 'number' ? Number(node.opacity.toFixed(3)) : 1,
    border:
      solidStroke && typeof node.strokeWeight === 'number'
        ? {
            width: Number(node.strokeWeight.toFixed(2)),
            color: rgbaToCss(solidStroke.color, solidStroke.opacity ?? 1),
            style: Array.isArray(node.strokeDashes) && node.strokeDashes.length > 0 ? 'dashed' : 'solid',
          }
        : null,
    shadow: dropShadow
      ? {
          x: Number((dropShadow.offset?.x ?? 0).toFixed(2)),
          y: Number((dropShadow.offset?.y ?? 0).toFixed(2)),
          blur: Number((dropShadow.radius ?? 0).toFixed(2)),
          color: rgbaToCss(dropShadow.color, 1),
        }
      : null,
    layout:
      node.layoutMode && node.layoutMode !== 'NONE'
        ? {
            mode: node.layoutMode,
            flexDirection: node.layoutMode === 'HORIZONTAL' ? 'row' : 'column',
            alignItems: mapCounterAxisAlign(node.counterAxisAlignItems),
            justifyContent: mapPrimaryAxisAlign(node.primaryAxisAlignItems),
            wrap: node.layoutWrap === 'WRAP' ? 'wrap' : 'nowrap',
            gap: node.itemSpacing ?? 0,
            paddingTop: node.paddingTop ?? 0,
            paddingRight: node.paddingRight ?? 0,
            paddingBottom: node.paddingBottom ?? 0,
            paddingLeft: node.paddingLeft ?? 0,
          }
        : null,
    overflow: node.clipsContent === true ? 'hidden' : node.clipsContent === false ? 'visible' : null,
    blendMode: mapBlendMode(node.blendMode),
    minWidth: typeof node.minWidth === 'number' ? node.minWidth : null,
    maxWidth: typeof node.maxWidth === 'number' ? node.maxWidth : null,
    minHeight: typeof node.minHeight === 'number' ? node.minHeight : null,
    maxHeight: typeof node.maxHeight === 'number' ? node.maxHeight : null,
    typography: textNode
      ? {
          fontFamily: textNode.style?.fontFamily ?? null,
          fontWeight: textNode.style?.fontWeight ?? null,
          fontSize: textNode.style?.fontSize ?? null,
          lineHeightPx: typeof textNode.style?.lineHeightPx === 'number' ? textNode.style.lineHeightPx : null,
          letterSpacing: typeof textNode.style?.letterSpacing === 'number' ? textNode.style.letterSpacing : null,
          textAlign:
            typeof textNode.style?.textAlignHorizontal === 'string'
              ? textNode.style.textAlignHorizontal.toLowerCase()
              : null,
          color: rgbaToCss(textPaint?.color, textPaint?.opacity ?? 1),
          textDecoration: mapTextDecoration(textNode.style?.textDecoration),
          textTransform: mapTextCase(textNode.style?.textCase),
          fontStyle: textNode.style?.italic ? 'italic' : 'normal',
        }
      : null,
    text: textNode?.characters?.trim() ?? null,
  };
}

export async function fetchFigmaSpec(config) {
  const { figmaToken, figmaFileKey, cases, contractCases } = config;
  if (!figmaToken) throw new Error('Missing figmaToken in config');
  if (!figmaFileKey) throw new Error('Missing figmaFileKey in config');

  const contractMap = new Map((contractCases ?? []).map((c) => [c.name, c]));
  const ids = [...new Set(cases.map((c) => toApiNodeId(c.figmaNodeId)))];

  const url = `https://api.figma.com/v1/files/${figmaFileKey}/nodes?ids=${encodeURIComponent(ids.join(','))}`;
  const response = await fetch(url, { headers: { 'X-Figma-Token': figmaToken } });
  if (!response.ok) throw new Error(`Figma API error ${response.status}`);

  const data = await response.json();
  const specs = {};

  for (const item of cases) {
    const id = toApiNodeId(item.figmaNodeId);
    const document = data.nodes?.[id]?.document;
    if (!document) throw new Error(`Missing Figma node for ${item.name} (${id})`);

    const contract = contractMap.get(item.name) ?? {};
    const entry = {
      name: item.name,
      storyId: item.storyId,
      figmaNodeId: id,
      viewport: item.viewport,
      selector: contract.selector ?? '#storybook-root > *:visible',
      checks: contract.checks ?? CHECKS_STRICT,
      expected: extractNodeSpec(document),
    };
    if (contract.typographySelector) entry.typographySelector = contract.typographySelector;
    specs[item.name] = entry;
  }

  const outputPath = path.resolve(process.cwd(), config.specOutputPath ?? './visual-tests/design-spec.json');
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify({ generatedAt: new Date().toISOString(), specs }, null, 2));
  console.log(`Wrote design spec → ${outputPath}`);
}
