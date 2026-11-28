// A step of `npm run deploy`, after the build and strip and before the data preflight and the publish: refuses to publish a build that did not come from `npm run deploy:live`
// or that does not match the production configuration (scripts/deploy-config.js). Values are never printed; only names.
//   node scripts/check-dist.js [dist folder, default dist]
import path from 'node:path';
import { PRODUCTION_FLAGS, PROFILE_VAR, PROFILE_VALUE, checkDist } from './deploy-config.js';

const dist = path.resolve(import.meta.dirname, '..', process.argv[2] ?? 'dist');
const errors = [];
if (process.env[PROFILE_VAR] !== PROFILE_VALUE) {
  errors.push('This build was not started by `npm run deploy:live`, so its production configuration was not applied or validated and it could publish the legacy UI. Run `npm run deploy:live`.');
}
for (const [name, value] of Object.entries(PRODUCTION_FLAGS)) {
  if (process.env[name] !== value) errors.push(`${name} is not the approved production value "${value}" in the build environment.`);
}
errors.push(...checkDist(dist, process.env));
if (errors.length) {
  console.error('Refusing to publish:');
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log('check-dist ok: the build has the approved production flags, the public values are embedded and no private secret is in the bundle');
