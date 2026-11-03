'use strict';

// Compatibility fix for deployed 1.1.4 images. Only the legacy runtime lock
// is redirected; content files and repository workspace locks are unchanged.
const fs = require('node:fs');
const path = require('node:path');
const runtime = path.resolve(process.env.SALMON_DATA_DIR || './data');
const legacyLock = runtime + '.salmon-lock';
// library-setup is already excluded from backups and content migrations.
const runtimeLock = path.join(runtime, 'library-setup', 'runtime.salmon-lock');
fs.mkdirSync(path.dirname(runtimeLock), { recursive: true });

for (const method of ['openSync', 'readFileSync', 'unlinkSync']) {
  const original = fs[method];
  fs[method] = function (file, ...args) {
    return Reflect.apply(original, this, [file === legacyLock ? runtimeLock : file, ...args]);
  };
}

require('node:module').syncBuiltinESMExports();
