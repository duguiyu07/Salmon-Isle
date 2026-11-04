import fs from 'node:fs';

const root = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
for (const file of ['package-lock.json']) {
  const lock = JSON.parse(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'));
  if (lock.version !== root.version || lock.packages[''].version !== root.version) throw new Error(file + ' 的版本必须与程序版本一致');
}
if (process.env.RELEASE_REF_TYPE === 'tag' && process.env.RELEASE_REF_NAME !== `v${root.version}`) {
  throw new Error(`标签 ${process.env.RELEASE_REF_NAME} 与程序版本 ${root.version} 不一致；请从修复后的提交推送 v${root.version}`);
}
console.log(`Release version verified: ${root.version}`);
