import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import {parseDocument} from 'yaml';
test('website release waits for validation, image and complete portable assets',()=>{
 const document=parseDocument(fs.readFileSync('.github/workflows/release.yml','utf8'));assert.deepEqual(document.errors,[]);const workflow=document.toJS();
 assert.deepEqual(Object.keys(workflow.jobs),['verify','website','release','publish']);assert.deepEqual(workflow.jobs.publish.needs,['verify','website','release']);
 assert.ok(workflow.jobs.verify.steps.some((step:any)=>step.run==='npm run test:standalone'));
 const upload=workflow.jobs.release.steps.find((step:any)=>step.name==='Upload draft release').run;assert.match(upload,/Salmon-Isle-Source/);assert.match(upload,/Salmon-Isle-Server/);assert.match(upload,/release.json/);assert.match(upload,/--draft --notes-file/);
 assert.doesNotMatch(fs.readFileSync('.github/workflows/release.yml','utf8'),/desktop|electron|latest.yml/i);
});
