#!/usr/bin/env node
'use strict';

/**
 * Parse every stylesheet in the repo and fail on a syntax error.
 *
 * `npm run check` runs oxlint, tsc and Jest — none of which parse CSS. A
 * single missing brace in `admin-OPD/src/index.css` therefore passed the whole
 * gate while making the app unrenderable: PostCSS refused the file, Vite
 * served it as a 500, and every screen came up blank. The gate said exit 0.
 *
 * The stylesheets are large and hand-written (admin's is ~125KB), and most
 * edits to them are surgical deletions, which is exactly the shape of change
 * that loses a closing brace. This catches that in under a second.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APPS = ['admin-OPD', 'patient-web-OPD', 'landing-OPD'];

/** PostCSS lives in each app's own node_modules; use whichever resolves. */
function loadPostcss() {
  for (const app of APPS) {
    try {
      return require(path.join(ROOT, app, 'node_modules', 'postcss'));
    } catch {
      // try the next app
    }
  }
  try {
    return require('postcss');
  } catch {
    return null;
  }
}

function cssFilesIn(dir, found = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) cssFilesIn(full, found);
    else if (e.name.endsWith('.css')) found.push(full);
  }
  return found;
}

const postcss = loadPostcss();
if (!postcss) {
  // Not a reason to fail the build on a machine that has not installed yet.
  console.log('check-css: postcss not installed, skipping');
  process.exit(0);
}

const files = APPS.flatMap((app) => cssFilesIn(path.join(ROOT, app, 'src')));
const failures = [];

for (const file of files) {
  const css = fs.readFileSync(file, 'utf8');
  try {
    postcss.parse(css, { from: file });
  } catch (err) {
    failures.push({ file: path.relative(ROOT, file), message: err.message });
  }
}

if (failures.length) {
  console.error('\ncheck-css: stylesheet would not parse\n');
  for (const f of failures) console.error(`  ${f.file}\n    ${f.message}\n`);
  process.exit(1);
}

console.log(`check-css: ${files.length} stylesheet(s) parse cleanly`);
