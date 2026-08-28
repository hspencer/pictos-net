import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { exportSchema } from './export-schema.mjs';
import { fileURLToPath } from 'node:url';

function fixture(t, product = 'nlu-schema') {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'schema-export-test-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const repoRoot = path.join(base, 'repo');
  const source = path.join(repoRoot, 'schemas', product);
  fs.mkdirSync(source, { recursive: true });
  const runGit = (...args) => execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  runGit('init', '--initial-branch=main');
  runGit('config', 'user.name', 'Export fixture');
  runGit('config', 'user.email', 'fixture@example.invalid');
  fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ name: `@mediafranca/${product}`, version: '1.0.0' }));
  fs.writeFileSync(path.join(source, 'example.schema.json'), '{"type":"object"}\n');
  fs.writeFileSync(path.join(source, 'README.md'), 'Canonical contract\n');
  runGit('add', '.');
  runGit('commit', '-m', 'fixture');
  return { base, repoRoot, product, source, runGit, ref: runGit('rev-parse', 'HEAD') };
}

test('preview is deterministic, visibly dirty and excludes secrets, corpus, dependencies and unsafe names', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.source, 'READMEVRTX.md'), 'not allowlisted');
  fs.writeFileSync(path.join(f.source, '.env'), 'API_KEY=not-exported');
  fs.writeFileSync(path.join(f.source, '$(touch PWNED).schema.json'), '{}');
  fs.mkdirSync(path.join(f.source, 'tests'));
  fs.writeFileSync(path.join(f.source, 'tests', 'valid.json'), '{}');
  fs.writeFileSync(path.join(f.source, 'tests', 'secrets.json'), '{"password":"privatepassword"}');
  fs.writeFileSync(path.join(f.source, 'tests', 'corpus.json'), '["private data"]');
  fs.mkdirSync(path.join(f.source, 'node_modules'));
  fs.writeFileSync(path.join(f.source, 'node_modules', 'index.js'), 'private');
  const one = exportSchema({ ...f, ref: undefined, output: path.join(f.base, 'one') });
  const two = exportSchema({ ...f, ref: undefined, output: path.join(f.base, 'two') });
  assert.deepEqual(one.manifest, two.manifest);
  assert.equal(one.manifest.source.dirty, true);
  assert.equal(one.manifest.release, false);
  assert.equal(one.manifest.validation, 'not-run');
  assert.deepEqual(one.manifest.files.map(file => file.path), ['README.md', 'example.schema.json', 'package.json', 'tests/valid.json']);
  assert.equal(fs.existsSync(path.join(f.repoRoot, 'PWNED')), false);
  assert.throws(() => exportSchema({ ...f, ref: undefined, output: one.directory }), /EEXIST/);
  assert.throws(() => exportSchema({ ...f, product: '../nlu-schema' }), /Unknown/);
  assert.throws(() => exportSchema({ ...f, ref: undefined, output: path.join(f.repoRoot, 'export') }), /outside/);
});

test('committed snapshot only reads selected commit, preserving reproducibility despite dirty workspace', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.source, 'README.md\tunsafe'), 'Do not export under a truncated name');
  f.runGit('add', '.');
  f.runGit('commit', '-m', 'unsafe filename fixture');
  f.ref = f.runGit('rev-parse', 'HEAD');
  fs.writeFileSync(path.join(f.source, 'README.md'), 'Uncommitted changes\n');
  const result = exportSchema({ ...f, mode: 'committed', output: path.join(f.base, 'release-candidate') });
  assert.equal(fs.readFileSync(path.join(result.directory, 'README.md'), 'utf8'), 'Canonical contract\n');
  assert.equal(result.manifest.source.commit, f.ref);
  assert.equal(result.manifest.source.dirty, false);
  assert.equal(result.manifest.release, false);
  const again = exportSchema({ ...f, mode: 'committed', output: path.join(f.base, 'again') });
  assert.deepEqual(result.manifest, again.manifest);
  assert.throws(() => exportSchema({ ...f, ref: 'HEAD', mode: 'committed' }), /full commit SHA/);
  assert.throws(() => exportSchema({ ...f, mode: 'preview', ref: f.ref }), /does not accept/);
});

test('symlinks fail closed in working snapshots and Git snapshots', t => {
  const f = fixture(t);
  fs.symlinkSync('/etc/passwd', path.join(f.source, 'index.js'));
  assert.throws(() => exportSchema({ ...f, ref: undefined }), /Symlink/);
  f.runGit('add', '.');
  f.runGit('commit', '-m', 'unsafe symlink fixture');
  assert.throws(() => exportSchema({ ...f, mode: 'committed', ref: f.runGit('rev-parse', 'HEAD') }), /Symlink/);
  fs.unlinkSync(path.join(f.source, 'index.js'));
  fs.symlinkSync(f.base, path.join(f.source, 'tests'));
  assert.throws(() => exportSchema({ ...f, ref: undefined }), /Symlink/);
});

test('credential markers in allowed files reject export before output creation', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.source, 'index.js'), 'const api_key = "fixture-secret-value";');
  const output = path.join(f.base, 'rejected');
  assert.throws(() => exportSchema({ ...f, ref: undefined, output }), /Possible credential/);
  assert.equal(fs.existsSync(output), false);
});

test('SVG product exports only reviewed legacy resources in both preview and committed modes', t => {
  const f = fixture(t, 'mf-svg-schema');
  const reviewed = ['requirements.txt', 'schemas/metadata.schema.json', 'schemas/styles.css', 'tools/validator.py', 'examples/canonical.svg', 'examples/v2example.svg'];
  const unreviewed = ['schemas/private.schema.json', 'tools/private.py', 'examples/private.svg', 'examples/corpus.svg'];
  for (const name of [...reviewed, ...unreviewed]) {
    fs.mkdirSync(path.dirname(path.join(f.source, name)), { recursive: true });
    fs.writeFileSync(path.join(f.source, name), 'synthetic fixture');
  }
  f.runGit('add', '.');
  f.runGit('commit', '-m', 'reviewed SVG fixture');
  const ref = f.runGit('rev-parse', 'HEAD');
  for (const mode of ['preview', 'committed']) {
    const result = exportSchema({ ...f, mode, ref: mode === 'committed' ? ref : undefined, output: path.join(f.base, mode) });
    const files = result.manifest.files.map(file => file.path);
    for (const name of reviewed) assert.ok(files.includes(name), `${mode}: ${name}`);
    for (const name of unreviewed) assert.ok(!files.includes(name), `${mode}: ${name}`);
    assert.equal(result.manifest.product, '@mediafranca/mf-svg-schema');
  }
  fs.symlinkSync('/etc/passwd', path.join(f.source, 'tools', 'symlink.py'));
  assert.throws(() => exportSchema({ ...f, ref: undefined }), /Symlink/);
});

test('public schema copy includes all three contracts, preserves unrelated files and rejects SVG symlinks', t => {
  const f = fixture(t);
  for (const product of ['pictogram-composition-schema', 'mf-svg-schema']) {
    const directory = path.join(f.repoRoot, 'schemas', product);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'current.schema.json'), '{"type":"object"}');
    fs.writeFileSync(path.join(directory, 'README.md'), 'not a public contract');
  }
  const legacy = path.join(f.repoRoot, 'schemas', 'mf-svg-schema', 'schemas');
  fs.mkdirSync(legacy);
  fs.writeFileSync(path.join(legacy, 'metadata.schema.json'), '{"title":"frozen"}');
  fs.mkdirSync(path.join(f.repoRoot, 'scripts'));
  // Index generation is not under test; avoid requiring a real image corpus.
  fs.writeFileSync(path.join(f.repoRoot, 'scripts', 'generate-libraries-index.cjs'), '');
  fs.mkdirSync(path.join(f.repoRoot, 'public'));
  fs.writeFileSync(path.join(f.repoRoot, 'public', 'keep.txt'), 'unrelated content');
  const script = fileURLToPath(new URL('./copy-submodule-data.sh', import.meta.url));
  const copy = () => execFileSync('sh', [script], { cwd: f.repoRoot, stdio: ['ignore', 'pipe', 'pipe'] });
  copy();
  assert.equal(fs.readFileSync(path.join(f.repoRoot, 'public', 'keep.txt'), 'utf8'), 'unrelated content');
  assert.equal(fs.readFileSync(path.join(f.repoRoot, 'public', 'schemas', 'mf-svg-schema', 'schemas', 'metadata.schema.json'), 'utf8'), '{"title":"frozen"}');
  for (const product of ['nlu-schema', 'pictogram-composition-schema', 'mf-svg-schema']) {
    const contract = product === 'nlu-schema' ? 'example.schema.json' : 'current.schema.json';
    assert.ok(fs.existsSync(path.join(f.repoRoot, 'public', 'schemas', product, contract)));
    assert.equal(fs.existsSync(path.join(f.repoRoot, 'public', 'schemas', product, 'README.md')), false);
  }
  fs.unlinkSync(path.join(legacy, 'metadata.schema.json'));
  fs.symlinkSync('/etc/passwd', path.join(legacy, 'metadata.schema.json'));
  assert.throws(copy, /Refusing non-regular legacy SVG schema/);
});
