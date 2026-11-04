import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {mediaCacheHeaders,mediaNotModified} from '../src/lib/media-cache';
test('media validators support weak/list tags, dates and ETag precedence without caching shared responses',()=>{
  const headers=mediaCacheHeaders('public/fonts/fonts.css',fs.statSync('public/fonts/fonts.css',{bigint:true}));
  const request=(input:Record<string,string>)=>new Request('https://site.test/api/media/x',{headers:input});
  assert.equal(headers['Cache-Control'],'private, no-cache');assert.equal(headers.Vary,'Cookie');assert.ok(mediaNotModified(request({'if-none-match':headers.ETag}),headers));assert.ok(mediaNotModified(request({'if-none-match':'"old", '+headers.ETag.replace('W/','')}),headers));assert.ok(mediaNotModified(request({'if-none-match':'*'}),headers));assert.ok(mediaNotModified(request({'if-modified-since':headers['Last-Modified']}),headers));assert.equal(mediaNotModified(request({'if-none-match':'"old"','if-modified-since':headers['Last-Modified']}),headers),false);assert.equal(mediaNotModified(request({'if-modified-since':'bad'}),headers),false);
});
