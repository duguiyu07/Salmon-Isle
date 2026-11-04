import type { NextConfig } from 'next';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const assetHashes=Object.fromEntries(['/brand/logo.png','/media-deleted.svg'].map(url=>[url,createHash('sha256').update(fs.readFileSync('public'+url)).digest('hex').slice(0,20)]));
const config: NextConfig = {
  env:{NEXT_PUBLIC_STATIC_ASSET_HASHES:JSON.stringify(assetHashes)},
  output: 'standalone',
  // Keep dynamically loaded metadata helpers in the standalone bundle.
  outputFileTracingIncludes: { '/*': ['./node_modules/next/dist/lib/metadata/**/*.js'] },
  // Match application routes only. A bare '*' also targets Next's own server trace,
  // whose contains-matching would mistake node_modules/next/dist for our dist folder.
  outputFileTracingExcludes: { '/*': ['./原网站内容/**/*', './data/**/*', './backups/**/*', './.qa-data/**/*', './.qa-artifacts/**/*', './.npm-cache/**/*', './deploy-input/**/*', './restored-data/**/*', './content-test/**/*', './dist/**/*', './publish-workspace/**/*'] },
  serverExternalPackages: ['node:sqlite'],
  async headers() {
    return [{source: '/:path*', headers: [
      {key: 'X-Content-Type-Options', value: 'nosniff'},
      {key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin'},
      {key: 'X-Frame-Options', value: 'SAMEORIGIN'},
      {key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()'}
    ]},
    {source:'/fonts/:file([a-f0-9]{20}\\.woff2)',headers:[{key:'Cache-Control',value:'public, max-age=31536000, immutable'}]},
    ...Object.entries(assetHashes).map(([source,hash])=>({source,has:[{type:'query' as const,key:'v',value:hash}],headers:[{key:'Cache-Control',value:'public, max-age=31536000, immutable'}]}))];
  }
};
export default config;
