import type { NextConfig } from 'next';
const config: NextConfig = {
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
    ]}];
  }
};
export default config;
