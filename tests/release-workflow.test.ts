import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseDocument} from 'yaml';
test('release workflow is valid YAML and publishes complete assets after all checks',()=>{const document=parseDocument(fs.readFileSync('.github/workflows/release.yml','utf8'));assert.deepEqual(document.errors,[]);const workflow=document.toJS();assert.deepEqual(Object.keys(workflow.jobs),['verify','website','desktop','publish']);assert.deepEqual(workflow.on.push.tags,['v*']);const step=workflow.jobs.desktop.steps.find((step:any)=>step.name==='Upload draft release');assert.equal(typeof step.run,'string');assert.ok(step.run.includes("@('latest.yml','release.json','SHA256SUMS.txt','升级到2.0.md')"));assert.ok(step.run.includes('--draft --notes-file'));assert.deepEqual(workflow.jobs.publish.needs,['verify','website','desktop']);assert.equal(workflow.jobs.desktop.steps.filter((step:any)=>step.run==='npm run test:upgrade').length,1);});
