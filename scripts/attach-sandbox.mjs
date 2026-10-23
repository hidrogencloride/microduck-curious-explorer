#!/usr/bin/env node
// Attach the optional development session to a local, pinned official Sandbox.
// This does not install a robot persona or change a policy, model, or package.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync, lstatSync, mkdirSync, openSync, closeSync, readSync, readFileSync,
  readdirSync, realpathSync, rmdirSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REVISION = 'ad9d41a763f30dc770817c33d92dcfec0205db1e';
const IMPORT = "import './curious-explorer/sandbox-session.mjs';\n";
const MAIN = 'app/src/main.jsx';
const DIRECTORY = 'app/src/curious-explorer';
const MANIFEST = '.curious-explorer-attachment.json';
const SOURCES = {
  'engine.js': 'src/engine.js',
  'sandbox-adapter.js': 'src/sandbox-adapter.js',
  'sandbox-session.mjs': 'scripts/sandbox-session.mjs',
};
const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = (data) => createHash('sha256').update(data).digest('hex');

function fail(message) { throw new Error(message); }
function git(root, ...args) {
  try {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    fail(`Git could not inspect ${root}. Supply the root of a local Sandbox checkout.`);
  }
}

// Do not follow a symlink into another checkout or an unrelated directory.
function safePath(root, name, allowMissing = false) {
  const full = resolve(root, name);
  const parts = relative(root, full).split('/');
  if (parts[0] === '..' || isAbsolute(relative(root, full))) fail(`Path leaves checkout: ${name}`);
  let current = root;
  for (const part of parts) {
    current = join(current, part);
    let stat;
    try { stat = lstatSync(current); } catch (error) {
      if (allowMissing && error.code === 'ENOENT') return full;
      fail(`Missing required path: ${name}`);
    }
    if (stat.isSymbolicLink()) fail(`Refusing symbolic link: ${name}`);
  }
  return full;
}

function readRegular(root, name) {
  const path = safePath(root, name);
  if (!lstatSync(path).isFile()) fail(`Expected a regular file: ${name}`);
  return readFileSync(path);
}

function checkAssets(root) {
  const paths = git(root, 'ls-tree', '-r', '--name-only', REVISION, '--', 'app/public/').trim().split('\n').filter(Boolean);
  const requiredProblems = [];
  const optionalProblems = [];
  for (const name of paths) {
    const problems = /^app\/public\/(robot|policies)\//.test(name) ? requiredProblems : optionalProblems;
    let path;
    try { path = safePath(root, name); } catch (error) {
      // A symlink is never an acceptable substitute for an asset in this setup.
      if (error.message.startsWith('Refusing symbolic')) throw error;
      problems.push(name);
      continue;
    }
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size === 0) { problems.push(name); continue; }
    const fd = openSync(path, 'r');
    const prefix = Buffer.alloc(150);
    let length;
    try { length = readSync(fd, prefix, 0, prefix.length, 0); } finally { closeSync(fd); }
    if (prefix.subarray(0, length).toString('utf8').startsWith('version https://git-lfs.github.com/spec/v1')) problems.push(name);
  }
  if (requiredProblems.length) {
    fail(`Robot or policy assets are missing, empty, or still Git LFS pointers:\n  ${requiredProblems.slice(0, 8).join('\n  ')}${requiredProblems.length > 8 ? '\n  …' : ''}\nFetch the checkout's Git LFS assets, then retry. No files were changed.`);
  }
  if (optionalProblems.length) {
    console.warn(`Warning: ${optionalProblems.length} other public assets are missing, empty, or Git LFS pointers. The Sandbox may not render or play audio correctly. Fetch its Git LFS assets before running it.`);
  }
}

function readManifest(root) {
  const raw = readRegular(root, `${DIRECTORY}/${MANIFEST}`);
  let manifest;
  try { manifest = JSON.parse(raw); } catch { fail('Attachment manifest is invalid; no files were changed.'); }
  if (manifest.owner !== 'microduck-curious-explorer' || manifest.version !== 1 || manifest.revision !== REVISION
      || !manifest.files || Object.keys(manifest.files).sort().join() !== Object.keys(SOURCES).sort().join()
      || Object.values(manifest.files).some((value) => !/^[a-f0-9]{64}$/.test(value))) {
    fail('Attachment manifest is unrecognized; no files were changed.');
  }
  for (const [name, expected] of Object.entries(manifest.files)) {
    if (hash(readRegular(root, `${DIRECTORY}/${name}`)) !== expected) {
      fail(`Attached file has local edits: ${DIRECTORY}/${name}. Preserve or revert those edits before retrying; no files were changed.`);
    }
  }
  return manifest;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: node scripts/attach-sandbox.mjs [--remove] /absolute/path/to/microduck-simulator\n\nAttaches an optional developer test session to official Sandbox revision ' + REVISION + '.\nNo network, dependency installation, or policy changes are performed.');
    return;
  }
  const remove = args.includes('--remove');
  const paths = args.filter((arg) => arg !== '--remove');
  if (paths.length !== 1 || args.filter((arg) => arg === '--remove').length > 1 || !isAbsolute(paths[0])) {
    fail('Usage: node scripts/attach-sandbox.mjs [--remove] /absolute/path/to/microduck-simulator');
  }
  const root = realpathSync(paths[0]);
  if (!lstatSync(root).isDirectory() || root === realpathSync(project)) fail('Supply a separate Sandbox checkout directory.');
  if (realpathSync(git(root, 'rev-parse', '--show-toplevel').trim()) !== root) fail('Supply the checkout root, not a directory inside it.');
  if (git(root, 'rev-parse', 'HEAD').trim() !== REVISION) fail(`Unsupported Sandbox revision. Expected ${REVISION}; no files were changed.`);
  const mainPath = safePath(root, MAIN);
  const original = git(root, 'show', `${REVISION}:${MAIN}`);
  const current = readRegular(root, MAIN).toString('utf8');
  const directory = safePath(root, DIRECTORY, true);
  const attached = existsSync(directory);
  if (attached && !lstatSync(directory).isDirectory()) fail(`Expected a directory: ${DIRECTORY}`);
  if (attached && !existsSync(safePath(root, `${DIRECTORY}/${MANIFEST}`, true))) {
    if (remove && !current.includes('curious-explorer/sandbox-session.mjs')
        && !Object.keys(SOURCES).some((name) => existsSync(join(directory, name)))) {
      console.log('Curious Explorer is not attached; other files in its former directory were preserved.');
      return;
    }
    fail(`The existing ${DIRECTORY} directory has no attachment manifest. Inspect it manually; no files were changed.`);
  }
  const manifest = attached ? readManifest(root) : null;

  if (remove) {
    if (!attached) {
      if (current.includes('curious-explorer/sandbox-session.mjs')) fail('An attachment import exists without its manifest; inspect it manually. No files were changed.');
      console.log('Curious Explorer is not attached; no files changed.');
      return;
    }
    // Preserve unrelated main.jsx edits and any extra files in the directory.
    if (current.split(IMPORT).length !== 2) fail('The inserted import was changed or duplicated; no files were changed.');
    writeFileSync(mainPath, current.replace(IMPORT, ''));
    for (const name of Object.keys(SOURCES)) unlinkSync(safePath(root, `${DIRECTORY}/${name}`));
    unlinkSync(safePath(root, `${DIRECTORY}/${MANIFEST}`));
    if (readdirSync(directory).length === 0) rmdirSync(directory);
    console.log('Removed the Curious Explorer development session. Other Sandbox files were preserved.');
    return;
  }

  const expected = attached ? IMPORT + original : original;
  if (current !== expected) fail(`${MAIN} has unexpected edits. Preserve or revert them before attaching; no files were changed.`);
  if (!attached && current.includes('curious-explorer/sandbox-session.mjs')) fail('An unrecognized attachment already exists; no files were changed.');
  const copies = Object.fromEntries(Object.entries(SOURCES).map(([name, source]) => [name, readRegular(project, source)]));
  const nextManifest = {
    owner: 'microduck-curious-explorer', version: 1, revision: REVISION,
    files: Object.fromEntries(Object.entries(copies).map(([name, data]) => [name, hash(data)])),
  };
  checkAssets(root);
  if (manifest && JSON.stringify(manifest) === JSON.stringify(nextManifest)) {
    console.log('Curious Explorer is already attached with the same source; no files changed.');
    return;
  }
  // All content and conflicts are checked before the first write. The import
  // is written last so a new session cannot load before its files are present.
  if (!attached) mkdirSync(directory);
  for (const [name, data] of Object.entries(copies)) writeFileSync(safePath(root, `${DIRECTORY}/${name}`, true), data);
  writeFileSync(safePath(root, `${DIRECTORY}/${MANIFEST}`, true), JSON.stringify(nextManifest, null, 2) + '\n');
  if (!attached) writeFileSync(mainPath, IMPORT + original);
  console.log(`Curious Explorer development session ${attached ? 'updated' : 'attached'} at ${directory}.\nStart the Sandbox using its own development instructions. This is a simulator test, not a robot installation.`);
}

try { main(); } catch (error) {
  console.error(`Cannot attach/remove Curious Explorer: ${error.message}`);
  process.exitCode = 1;
}
