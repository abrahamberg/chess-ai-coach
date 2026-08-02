// Production build for apps/api (see docs/deploy-build.md).
//
// Bundles the three entrypoints into standalone ESM that plain `node` can run.
// The point is to keep `tsx` out of the runtime image: tsx pulls in esbuild,
// whose platform binary (@esbuild/linux-x64 vs @esbuild/linux-arm64) is picked
// at npm-install time by the *build* machine's architecture. Compiling ahead of
// time removes every native binary from the shipped image, so an amd64 CI
// runner can produce a working arm64 container.
//
// This is a production-only artifact. Dev still runs `tsx watch` against raw
// TypeScript; nothing here changes any workspace package's `exports`.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..');

/** Workspace packages deliberately export raw `./src/index.ts` so `tsx watch`
 * picks up source edits with no rebuild. Plain `node` cannot import that, so
 * their source is inlined into the bundle (esbuild type-strips it on the way
 * in) rather than resolved from node_modules at runtime. */
const FIRST_PARTY_SCOPE = '@chess-coach/';

/** Manifests whose `dependencies` end up reachable from an entrypoint: the api
 * itself plus every first-party package that gets inlined into the bundle. */
const BUNDLED_MANIFESTS = [
  'apps/api/package.json',
  'packages/shared/package.json',
  'packages/chess-analysis/package.json',
  'packages/prompts/package.json'
];

function readDependencyNames(manifestPath) {
  const manifest = JSON.parse(readFileSync(join(REPO_ROOT, manifestPath), 'utf8'));
  return Object.keys(manifest.dependencies ?? {});
}

/** Real npm packages stay bare imports resolved from node_modules at runtime —
 * it keeps the bundle small and avoids mangling packages that do dynamic
 * requires. Derived from the manifests so a newly added dependency is external
 * without anyone editing this file. The `/*` twin covers subpath imports such
 * as `ai/test`, which esbuild does not infer from the bare name. */
function collectExternalPackages() {
  const names = BUNDLED_MANIFESTS.flatMap(readDependencyNames)
    .filter((name) => !name.startsWith(FIRST_PARTY_SCOPE));
  return [...new Set(names)].flatMap((name) => [name, `${name}/*`]);
}

await build({
  entryPoints: {
    // The api Deployment's command.
    server: 'src/server.ts',
    // The worker Deployment's command (same image, different entrypoint).
    worker: 'src/worker.ts',
    // The Helm migrate-job hook's command. Safe to bundle: migrations are
    // statically imported by src/db/migrate.ts, never read off disk.
    migrate: 'src/db/migrate-cli.ts'
  },
  // Deliberately not `dist/` — that belongs to `tsc -b` (npm run typecheck).
  outdir: 'dist-bundle',
  bundle: true,
  platform: 'node',
  format: 'esm',
  // `.mjs`, so the output is unambiguously ESM on its own. A `.js` bundle would
  // only load if a package.json declaring `"type": "module"` sat next to it —
  // an easy thing to get wrong in a runtime image that ships nothing else.
  outExtension: { '.js': '.mjs' },
  target: 'node22',
  external: collectExternalPackages(),
  sourcemap: true,
  logLevel: 'info'
});
