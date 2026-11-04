import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const gitDirectory = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git');
const shell = process.platform === 'win32' ? path.join(gitDirectory, 'bin', 'sh.exe') : '/bin/sh';
const posix = (value: string) => value.replaceAll('\\', '/').replace(/^([a-z]):/i, (_, drive: string) => '/' + drive.toLowerCase());

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'salmon-shell-'));
  fs.mkdirSync(path.join(root, 'scripts')); fs.mkdirSync(path.join(root, 'bin')); fs.mkdirSync(path.join(root, 'data'));
  fs.writeFileSync(path.join(root, 'data/content.txt'), 'original private content');
  fs.writeFileSync(path.join(root, '.env'), 'SALMON_WEB_IMAGE=ghcr.io/duguiyu07/salmon-isle:1.0.0\nSALMON_ORIGIN=https://salmon-isle.com\n');
  fs.writeFileSync(path.join(root, 'compose.yml'), 'services:\n  blog:\n    image: ${SALMON_WEB_IMAGE}\n');
  for (const [from, to] of [['deploy/backup-site.sh', 'backup-site.sh'], ['deploy/restore-site.sh', 'restore-site.sh'], ['scripts/update-site.sh', 'update-site.sh']]) {
    // Exercise the delivered bytes; newline conversion here hides broken Linux scripts.
    fs.copyFileSync(from, path.join(root, 'scripts', to));
  }
  fs.copyFileSync('scripts/cleanup-site.sh',path.join(root,'scripts','cleanup-site.sh'));
  fs.copyFileSync('deploy/cleanup-data.cjs',path.join(root,'scripts','cleanup-data.cjs'));
  const docker = `#!/bin/sh
printf '%s\\n' "$*" >> "$SALMON_TEST_DOCKER_LOG"
case "$*" in
  'compose images -q blog') echo 'sha256:old-image' ;;
  'compose config --images blog') echo 'ghcr.io/duguiyu07/salmon-isle:1.0.0' ;;
  'compose config') printf 'services:\\n  blog:\\n    image: test\\n' ;;
  'compose up -d --no-deps --wait --wait-timeout 120 blog')
    if [ "\${SALMON_TEST_FAIL_UP:-}" = 1 ] && [ ! -f "$SALMON_TEST_FAIL_MARKER" ]; then touch "$SALMON_TEST_FAIL_MARKER"; exit 1; fi ;;
esac
`;
  fs.writeFileSync(path.join(root, 'bin/docker'), docker, {mode: 0o755});
  // Tests run as the current account, while production restore runs as root.
  fs.writeFileSync(path.join(root, 'bin/chown'), '#!/bin/sh\nexit 0\n', {mode: 0o755});
  const env = {...process.env, PATH: [path.join(root, 'bin'), ...(process.platform === 'win32' ? [path.join(gitDirectory, 'usr/bin')] : []), process.env.PATH || ''].join(path.delimiter),
    SALMON_TEST_DOCKER_LOG: posix(path.join(root, 'docker.log')), SALMON_TEST_FAIL_MARKER: posix(path.join(root, 'failed-once'))};
  const run = (script: string, args: string[] = [], fail = false) => spawnSync(shell, ['scripts/' + script, ...args],
    {cwd: root, env: {...env, SALMON_TEST_FAIL_UP: fail ? '1' : ''}, encoding: 'utf8', windowsHide: true});
  const remove = () => {assert.ok(root.startsWith(path.join(os.tmpdir(), 'salmon-shell-'))); fs.rmSync(root, {recursive: true, force: true});};
  return {root, run, remove};
}

test('Linux maintenance scripts create consistent backups and restore without losing the previous data', {skip: !fs.existsSync(shell)}, () => {
  const f = fixture();
  try {
    const backup = f.run('backup-site.sh'); assert.equal(backup.status, 0, backup.stderr);
    const archive = path.join(f.root, 'backups', fs.readdirSync(path.join(f.root, 'backups'))[0], 'data.tar.gz');
    const listing = spawnSync('tar', ['-tzf', archive], {encoding: 'utf8', windowsHide: true});
    assert.equal(listing.status, 0); assert.match(listing.stdout, /data\/content.txt/);
    fs.writeFileSync(path.join(f.root, 'data/content.txt'), 'content before restore');
    const restored = f.run('restore-site.sh', [posix(archive)]); assert.equal(restored.status, 0, restored.stderr);
    assert.equal(fs.readFileSync(path.join(f.root, 'data/content.txt'), 'utf8'), 'original private content');
    const previous = fs.readdirSync(path.join(f.root, 'backups')).find(name => name.startsWith('restore-'))!;
    assert.equal(fs.readFileSync(path.join(f.root, 'backups', previous, 'previous-data/content.txt'), 'utf8'), 'content before restore');
    assert.match(fs.readFileSync(path.join(f.root, 'docker.log'), 'utf8'), /compose stop blog/);
  } finally {f.remove();}
});

test('Linux image update failure restores the old image and environment while retaining the data backup', {skip: !fs.existsSync(shell)}, () => {
  const f = fixture();
  try {
    const updated = f.run('update-site.sh', ['--image', 'ghcr.io/duguiyu07/salmon-isle:1.1.0'], true);
    assert.notEqual(updated.status, 0);
    assert.match(fs.readFileSync(path.join(f.root, '.env'), 'utf8'), /SALMON_WEB_IMAGE=ghcr.io\/duguiyu07\/salmon-isle:1.0.0/);
    assert.equal(fs.readFileSync(path.join(f.root, 'data/content.txt'), 'utf8'), 'original private content');
    const backup = path.join(f.root, 'backups', fs.readdirSync(path.join(f.root, 'backups'))[0]);
    assert.ok(fs.existsSync(path.join(backup, 'data.tar.gz')));
    assert.match(fs.readFileSync(path.join(f.root, 'docker.log'), 'utf8'), /rollback.yml up -d/);
  } finally {f.remove();}
});

test('an offline update uses the imported image and never pulls from a registry', {skip: !fs.existsSync(shell)},()=>{
 const f=fixture();try{const result=f.run('update-site.sh',['--image','ghcr.io/duguiyu07/salmon-isle:2.1.0','--local']);assert.equal(result.status,0,result.stderr);const log=fs.readFileSync(path.join(f.root,'docker.log'),'utf8');assert.doesNotMatch(log,/^pull |compose pull/m);assert.match(log,/image inspect ghcr.io/);assert.match(log,/--pull never/);assert.deepEqual(fs.readdirSync(path.join(f.root,'backups')),[]);}finally{f.remove();}
});
