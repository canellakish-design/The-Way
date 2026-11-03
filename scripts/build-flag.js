// Runs as the Netlify build command. Netlify passes the deploy context (production, deploy-preview,
// branch-deploy) only to the build, not to functions at run time, so the build writes it into a file
// the bridge reads: every deploy but production runs as the copy (bridge/sandbox.js, bridge/storage.js).
const fs = require('fs'), path = require('path');
const context = process.env.CONTEXT || '';
const out = { context, branch: process.env.BRANCH || null, sandbox: !!context && context !== 'production' };
fs.writeFileSync(path.join(__dirname, '..', 'bridge', 'build-context.json'), JSON.stringify(out) + '\n');
console.log('[build-flag]', JSON.stringify(out));
