// Production bundle for the engine image. The runtime image receives only this
// self-contained artifact; npm installation and TypeScript compilation happen
// on the build runner.
import { build } from 'esbuild';

await build({
  entryPoints: ['services/engine/src/server.ts'],
  outfile: 'services/engine/dist-bundle/server.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // Fastify is CommonJS and uses dynamic requires internally. Keep runtime
  // packages external; first-party TypeScript is still bundled by esbuild.
  external: ['fastify', 'fastify/*', 'chess.js', 'chess.js/*'],
  sourcemap: true,
  logLevel: 'info'
});
