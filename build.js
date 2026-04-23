/**
 * Design System Token Build
 *
 * Reads:
 *   tokens.json          — base (light) token definitions
 *   themes/*.json        — per-theme color overrides
 *
 * Writes:
 *   dist/base.css        — all tokens, no overrides
 *   dist/<theme>.css     — all tokens with theme overrides merged in
 *
 * Usage: node build.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ── Token helpers ──────────────────────────────────────────────────────────

/**
 * Recursively collect every CSS custom property (-- prefixed key)
 * from a (possibly deeply nested) token object into a flat map.
 * Keys beginning with _ are skipped (they hold metadata, not tokens).
 */
function flattenTokens(obj, result = {}) {
  for (const [key, value] of Object.entries(obj)) {
    if (key.startsWith('_')) continue;
    if (key.startsWith('--') && typeof value === 'string') {
      result[key] = value;
    } else if (value !== null && typeof value === 'object') {
      flattenTokens(value, result);
    }
  }
  return result;
}

/**
 * Walk a token tree in definition order, building CSS declaration lines.
 * Groups that contain only sub-groups (no direct -- keys) produce a
 * section comment only when their children are finally emitted.
 *
 * @param {object} obj       — token subtree
 * @param {object} overrides — flat { '--prop': 'value' } override map
 * @param {string} crumb     — accumulated breadcrumb label for comments
 * @returns {string[]}       — CSS lines (indented, no surrounding braces)
 */
function walkTokens(obj, overrides, crumb = '') {
  const lines  = [];
  const vars   = [];
  const groups = [];

  for (const [key, value] of Object.entries(obj)) {
    if (key.startsWith('_')) continue;
    if (key.startsWith('--') && typeof value === 'string') {
      vars.push([key, value]);
    } else if (value !== null && typeof value === 'object') {
      groups.push([key, value]);
    }
  }

  // Emit any direct CSS custom properties, preceded by a section comment
  if (vars.length > 0) {
    lines.push('');
    if (crumb) lines.push(`  /* ── ${crumb} ── */`);
    for (const [prop, baseVal] of vars) {
      const finalVal = Object.prototype.hasOwnProperty.call(overrides, prop)
        ? overrides[prop]
        : baseVal;
      lines.push(`  ${prop}: ${finalVal};`);
    }
  }

  // Recurse into sub-groups
  for (const [key, child] of groups) {
    const nextCrumb = crumb ? `${crumb} › ${key}` : key;
    lines.push(...walkTokens(child, overrides, nextCrumb));
  }

  return lines;
}

// ── CSS generation ─────────────────────────────────────────────────────────

function formatDate() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

/**
 * Build a complete CSS string with a :root block containing all tokens.
 *
 * @param {object} base   — parsed tokens.json
 * @param {object} theme  — parsed theme file (may be empty object for base)
 * @returns {string}
 */
function buildCSS(base, theme = {}) {
  const overrides   = flattenTokens(theme);
  const meta        = theme._meta ?? {};
  const scheme      = meta.scheme ?? 'base';
  const overrideCount = Object.keys(overrides).length;
  const totalCount  = Object.keys(flattenTokens(base)).length;

  const isBase = overrideCount === 0;

  const usageHint = isBase
    ? ` * Usage  : <link rel="stylesheet" href="base.css">`
    : [
        ` * Usage  : Standalone dark theme —`,
        ` *            <link rel="stylesheet" href="${scheme}.css">`,
        ` *          Or as a layer on top of base.css —`,
        ` *            <link rel="stylesheet" href="base.css">`,
        ` *            <link rel="stylesheet" href="${scheme}.css"`,
        ` *                  media="(prefers-color-scheme: dark)">`,
      ].join('\n');

  const header = [
    `/* ${'='.repeat(64)}`,
    ` * Design System — CSS Custom Properties`,
    ` * Theme   : ${scheme}`,
    ` * Tokens  : ${totalCount} total${isBase ? '' : `, ${overrideCount} overridden`}`,
    ` * Built   : ${formatDate()}`,
    ` * Source  : tokens.json${isBase ? '' : ` + themes/${scheme}-mode.json`}`,
    usageHint,
    ` * Do not edit — regenerate with: node build.js`,
    ` * ${'='.repeat(64)} */`,
  ].join('\n');

  const bodyLines = walkTokens(base, overrides);
  const body      = bodyLines.join('\n');

  return `${header}\n\n:root {${body}\n}\n`;
}

// ── Build pipeline ─────────────────────────────────────────────────────────

const ROOT      = __dirname;
const distDir   = path.join(ROOT, 'dist');
const themesDir = path.join(ROOT, 'themes');

// Ensure output directory exists
fs.mkdirSync(distDir, { recursive: true });

// Load base tokens
let base;
try {
  base = JSON.parse(fs.readFileSync(path.join(ROOT, 'tokens.json'), 'utf-8'));
} catch (err) {
  console.error('Error: could not read tokens.json —', err.message);
  process.exit(1);
}

const totalTokens = Object.keys(flattenTokens(base)).length;

console.log('\nDesign System Token Build');
console.log('─'.repeat(44));

// ── base.css ──────────────────────────────────────────────────────
const baseOut = path.join(distDir, 'base.css');
fs.writeFileSync(baseOut, buildCSS(base, {}));
console.log(`  ✓  dist/base.css       (${totalTokens} tokens)`);

// ── theme files ───────────────────────────────────────────────────
if (fs.existsSync(themesDir)) {
  const themeFiles = fs.readdirSync(themesDir)
    .filter(f => f.endsWith('.json'))
    .sort();

  for (const file of themeFiles) {
    let theme;
    try {
      theme = JSON.parse(fs.readFileSync(path.join(themesDir, file), 'utf-8'));
    } catch (err) {
      console.warn(`  ✗  ${file} — skipped (invalid JSON: ${err.message})`);
      continue;
    }

    const meta   = theme._meta ?? {};
    const scheme = meta.scheme ?? path.basename(file, '.json').replace(/-mode$/, '');
    const overrideCount = Object.keys(flattenTokens(theme)).length;
    const outFile = path.join(distDir, `${scheme}.css`);

    fs.writeFileSync(outFile, buildCSS(base, theme));

    const padding = ' '.repeat(Math.max(0, 16 - `${scheme}.css`.length));
    console.log(`  ✓  dist/${scheme}.css${padding}(${totalTokens} tokens, ${overrideCount} overridden)`);
  }
} else {
  console.log('  —  no themes/ directory found, skipping theme files');
}

console.log('─'.repeat(44));
console.log(`  Output: ${distDir}`);
console.log();
