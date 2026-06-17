/**
 * build.js — Tab Hibernator Pro packaging script
 * Creates a zip ready for Chrome Web Store submission.
 *
 * Usage: npm run build
 *
 * The script reads manifest.json to determine which files are required,
 * then verifies they all exist before creating the zip.
 * Uses Node.js zlib to preserve directory structure in the zip.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const version = manifest.version;
const outName = `tab-hibernator-pro-v${version}.zip`;
const outPath = path.join(ROOT, outName);

// Collect all files referenced by manifest.json
const requiredFiles = new Set();

// manifest itself
requiredFiles.add('manifest.json');

// background service worker
if (manifest.background?.service_worker) {
  requiredFiles.add(manifest.background.service_worker);
}

// content scripts
if (manifest.content_scripts) {
  for (const cs of manifest.content_scripts) {
    if (cs.js) cs.js.forEach(f => requiredFiles.add(f));
    if (cs.css) cs.css.forEach(f => requiredFiles.add(f));
  }
}

// popup
if (manifest.action?.default_popup) {
  requiredFiles.add(manifest.action.default_popup);
}

// options page
if (manifest.options_page) {
  requiredFiles.add(manifest.options_page);
}

// icons
if (manifest.action?.default_icon) {
  Object.values(manifest.action.default_icon).forEach(f => requiredFiles.add(f));
}
if (manifest.icons) {
  Object.values(manifest.icons).forEach(f => requiredFiles.add(f));
}

// Additional extension files that should be included
const extraFiles = [
  'popup.js',
  'popup.css',
  'options.js',
  'options.css',
  'suspended.html',
  'suspended.js',
  'dashboard.html',
  'dashboard.css',
  'dashboard.js',
  'changelog.html',
  'changelog.css',
  'changelog.js',
  'bg/constants.js',
  'bg/hibernation.js',
  'bg/snapshot.js',
  'bg/stash.js',
  'bg/storage.js',
];

for (const f of extraFiles) {
  if (fs.existsSync(path.join(ROOT, f))) {
    requiredFiles.add(f);
  }
}

// Verify all required files exist
const missing = [];
for (const file of requiredFiles) {
  if (!fs.existsSync(path.join(ROOT, file))) {
    missing.push(file);
  }
}

if (missing.length > 0) {
  console.error('\n\u274C BUILD FAILED \u2014 Missing files referenced in manifest.json:\n');
  missing.forEach(f => console.error(`   \u2022 ${f}`));
  console.error('\nFix these before submitting to the Chrome Web Store.\n');
  process.exit(1);
}

// Remove old zip if it exists
if (fs.existsSync(outPath)) {
  fs.unlinkSync(outPath);
}

// Create zip preserving directory structure using PowerShell with a temp folder
const tempDir = path.join(ROOT, '_build_temp');

// Clean temp dir if leftover
if (fs.existsSync(tempDir)) {
  fs.rmSync(tempDir, { recursive: true });
}
fs.mkdirSync(tempDir, { recursive: true });

// Copy files preserving relative paths
for (const file of requiredFiles) {
  const src = path.join(ROOT, file);
  const dest = path.join(tempDir, file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

// Zip the temp folder contents
const psScriptPath = path.join(ROOT, '_build_zip.ps1');
const psContent = `Compress-Archive -Path '${tempDir}\\*' -DestinationPath '${outPath}' -Force`;
fs.writeFileSync(psScriptPath, psContent, 'utf8');

try {
  execSync(`powershell -ExecutionPolicy Bypass -File "${psScriptPath}"`, { stdio: 'pipe' });
} catch (e) {
  console.error('\u274C Failed to create zip:', e.message);
  process.exit(1);
} finally {
  // Clean up
  if (fs.existsSync(psScriptPath)) fs.unlinkSync(psScriptPath);
  if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true });
}

console.log(`\n\u2705 Build successful: ${outName}`);
console.log(`   ${requiredFiles.size} files packaged`);
console.log(`   Version: ${version}\n`);

// Final summary
console.log('Included files:');
[...requiredFiles].sort().forEach(f => console.log(`   \u2022 ${f}`));
console.log('');


