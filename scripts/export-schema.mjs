#!/usr/bin/env node
// Local snapshots only. Publication and release approval are separate operations.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const products = new Set(['nlu-schema', 'pictogram-composition-schema', 'mf-svg-schema']);
const rootFiles = new Set(['package.json', 'package-lock.json', 'README.md', 'LICENSE', 'CHANGELOG.md', 'FROZEN_RELEASES.json', 'index.js', 'validators.js', 'test-runner.js', '.gitignore']);
// Reviewed legacy resources of the SVG product, not permission to export
// arbitrary SVGs, Python programs, stylesheets or nested schema directories.
const mfSvgFiles = new Set(['requirements.txt', 'schemas/metadata.schema.json', 'schemas/styles.css', 'tools/validator.py', 'examples/canonical.svg', 'examples/v2example.svg']);
const forbiddenName = /^(?:\.env(?:\..*)?|node_modules|\.git|dist|coverage|corpus(?:[._-].*)?|libraries|secrets?(?:[._-].*)?|credentials?(?:[._-].*)?)$/i;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function allowed(name, product) {
  const parts = name.split('/');
  if (parts.some(part => forbiddenName.test(part))) return false;
  if (name === '.github/workflows/validate.yml') return true;
  if (parts.some(part => !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(part)) && name !== '.gitignore') return false;
  return rootFiles.has(name) || (product === 'mf-svg-schema' && mfSvgFiles.has(name)) || /^[^/]+\.schema\.json$/.test(name)
    || /^(?:scripts|tests)\/.+\.(?:m?js|json)$/.test(name)
    || /^docs\/.+\.md$/.test(name);
}

function assertSafeContent(name, bytes) {
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk-(?:proj-)?[a-zA-Z0-9_-]{20,}|(?:api[_-]?key|access[_-]?token|password)\s*["']?\s*[:=]\s*["'][^"'\s]{8,}/i.test(bytes.toString('utf8'))) {
    throw new Error(`Possible credential in allowed file: ${name}`);
  }
}

export function exportSchema({ repoRoot, product, mode = 'preview', ref, output }) {
  if (!products.has(product)) throw new Error('Unknown schema product');
  if (!['preview', 'committed'].includes(mode)) throw new Error('Mode must be preview or committed');
  if (mode === 'preview' && ref) throw new Error('Preview does not accept a commit reference');
  if (mode === 'committed' && !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(ref || '')) throw new Error('Committed export requires a full commit SHA');
  const root = fs.realpathSync(repoRoot);
  const sourceCommit = git(root, 'rev-parse', '--verify', mode === 'preview' ? 'HEAD' : `${ref}^{commit}`);
  const prefix = `schemas/${product}`;
  const files = [];
  function add(name, bytes, executable) {
    assertSafeContent(name, bytes);
    files.push({ path: name, bytes, executable });
  }
  if (mode === 'preview') {
    const source = path.join(root, prefix);
    if (fs.lstatSync(source).isSymbolicLink() || fs.realpathSync(source) !== source) throw new Error('Canonical product path must not contain symlinks');
    function walk(directory, relative = '') {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const name = relative ? `${relative}/${entry.name}` : entry.name;
        if (forbiddenName.test(entry.name)) continue;
        if (entry.isSymbolicLink()) throw new Error(`Symlink cannot be exported: ${name}`);
        if (entry.isDirectory()) {
          const permittedDirectory = /^(scripts|tests|docs)(\/|$)|^\.github(?:\/workflows)?$/.test(name)
            || (product === 'mf-svg-schema' && ['schemas', 'tools', 'examples'].includes(name));
          if (permittedDirectory && !name.split('/').some(p => p === '..')) walk(path.join(directory, entry.name), name);
        } else if (allowed(name, product)) {
          const target = path.join(directory, entry.name);
          if (entry.isSymbolicLink() || !entry.isFile()) throw new Error(`Only regular files can be exported: ${name}`);
          add(name, fs.readFileSync(target), Boolean(fs.statSync(target).mode & 0o111));
        }
      }
    }
    walk(source);
  } else {
    // Read immutable Git blobs; never copy uncommitted bytes into a committed snapshot.
    const listing = execFileSync('git', ['-C', root, 'ls-tree', '-rz', `${sourceCommit}:${prefix}`], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    for (const entry of listing.split('\0').filter(Boolean)) {
      const separator = entry.indexOf('\t');
      const metadata = entry.slice(0, separator);
      const name = entry.slice(separator + 1);
      const [fileMode, kind, object] = metadata.split(' ');
      if (fileMode === '120000' && !name.split('/').some(part => forbiddenName.test(part))) throw new Error(`Symlink cannot be exported: ${name}`);
      if (!allowed(name, product)) continue;
      if (kind !== 'blob' || !['100644', '100755'].includes(fileMode)) throw new Error(`Only regular files can be exported: ${name}`);
      add(name, execFileSync('git', ['-C', root, 'cat-file', 'blob', object]), fileMode === '100755');
    }
  }
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const packageFile = files.find(file => file.path === 'package.json');
  if (!packageFile) throw new Error('Export needs package.json');
  const pkg = JSON.parse(packageFile.bytes.toString('utf8'));
  if (pkg.name !== `@mediafranca/${product}` || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(pkg.version || '')) throw new Error('Package identity/version does not match product');
  const entries = files.map(file => ({ path: file.path, sha256: sha256(file.bytes), size: file.bytes.length, executable: file.executable }));
  const manifest = {
    formatVersion: 1, product: pkg.name, version: pkg.version, mode,
    source: { repository: 'https://github.com/hspencer/pictos-net', commit: sourceCommit, path: prefix, dirty: mode === 'preview' && Boolean(git(root, 'status', '--porcelain', '--untracked-files=all')) },
    contentHash: sha256(JSON.stringify(entries)), files: entries,
    validation: 'not-run', release: false, publication: 'requires-separate-approval',
  };
  const destination = output ? path.resolve(output) : path.join(os.tmpdir(), `pictos-${product}-${mode}-${randomUUID()}`);
  const parent = fs.realpathSync(path.dirname(destination));
  const resolved = path.join(parent, path.basename(destination));
  if (resolved === root || resolved.startsWith(root + path.sep)) throw new Error('Export destination must be outside the source repository');
  fs.mkdirSync(resolved); // Fail on existing destinations; never overwrite or delete user files.
  for (const file of files) {
    const target = path.join(resolved, file.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file.bytes, { flag: 'wx', mode: file.executable ? 0o755 : 0o644 });
  }
  fs.writeFileSync(path.join(resolved, 'EXPORT_MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  return { directory: resolved, manifest };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const [mode, product, ...args] = process.argv.slice(2);
    const options = {};
    for (let i = 0; i < args.length; i += 2) {
      if (!['--ref', '--output'].includes(args[i]) || !args[i + 1] || options[args[i]]) throw new Error('Usage: export-schema.mjs <preview|committed> <product> [--ref full-SHA] [--output new-directory]');
      options[args[i]] = args[i + 1];
    }
    const result = exportSchema({ repoRoot: git(process.cwd(), 'rev-parse', '--show-toplevel'), product, mode, ref: options['--ref'], output: options['--output'] });
    console.log(JSON.stringify({ directory: result.directory, mode, contentHash: result.manifest.contentHash, validation: 'not-run', release: false }, null, 2));
  } catch (error) {
    console.error(`Export refused: ${error.message}`);
    process.exitCode = 1;
  }
}
