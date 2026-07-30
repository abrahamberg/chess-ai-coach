# Building the deployment images

The `api` and `web` images are **built outside Docker**. Their Dockerfiles do
nothing but `COPY` finished artifacts into a slim runtime image — no `npm ci`, no
`npm run build`, no compilation in a Docker layer. Compiling on the CI runner is
faster and caches better, and it is what makes the images portable to the arm64
nodes we deploy to.

## The two-phase flow

Run every step from the repo root, in this order.

```bash
# 1. Full install (dev dependencies included — the build steps need them).
npm ci

# 2. Build the artifacts the Dockerfiles will copy.
npm run bundle --workspace=@chess-coach/api   # -> apps/api/dist-bundle/*.mjs
npm run build  --workspace=@chess-coach/web   # -> apps/web/dist/

# 3. Prune node_modules to apps/api's production dependencies. Must come AFTER
#    step 2: it removes the dev dependencies those builds rely on.
npm ci --omit=dev --workspace=@chess-coach/api --include-workspace-root

# 4. Build the images. Use buildx with an explicit --platform so the output is
#    arm64 regardless of the runner's own architecture.
docker buildx build --platform linux/arm64 -f docker/Dockerfile.api    -t <registry>/chess-ai-coach/api:<tag>    .
docker buildx build --platform linux/arm64 -f docker/Dockerfile.web    -t <registry>/chess-ai-coach/web:<tag>    .
docker buildx build --platform linux/arm64 -f docker/Dockerfile.engine -t <registry>/chess-ai-coach/engine:<tag> .
```

Step 3 leaves the working tree without dev dependencies. Re-run `npm ci` before
going back to development or running tests.

## Why apps/api is bundled

`npm run bundle` (`apps/api/scripts/bundle.mjs`) runs esbuild over three
entrypoints — `src/server.ts`, `src/worker.ts` and `src/db/migrate-cli.ts` —
producing `apps/api/dist-bundle/{server,worker,migrate}.mjs`. The Helm chart runs
those three files with plain `node`; one image, three commands.

The images used to run `tsx` against raw TypeScript at container startup. That
cannot work for cross-architecture builds: `tsx` depends on **esbuild**, which
resolves a platform-specific binary (`@esbuild/linux-x64` vs
`@esbuild/linux-arm64`) as an optional dependency **at npm-install time**, based
on the machine running the install. An amd64 runner's `node_modules` copied into
an arm64 container carries an amd64 esbuild binary, and the container crashes on
startup. Bundling ahead of time removes `tsx`, and with it the only native binary
in the runtime image.

`tsc -b` alone would not have been enough. Workspace packages export raw
TypeScript (`"exports": "./src/index.ts"`) on purpose, so `tsx watch` picks up
source edits with no rebuild step — plain `node` cannot import that, and changing
those `exports` fields would break the dev loop for everyone. esbuild resolves the
same bare specifiers, type-strips the TypeScript it finds, and inlines it into the
bundle, so nothing about the dev workflow changes.

Real npm dependencies stay **external** — they are resolved from `node_modules` at
runtime, not inlined. The externals list is derived from the `dependencies` of
`apps/api` and of every first-party package that gets inlined, so a newly added
dependency is external without anyone editing the build script.

### The copied node_modules is architecture-independent

Every production dependency of `apps/api` is pure JavaScript. Audited with:

```bash
npm ls --omit=dev -w apps/api --all
```

across all 139 packages in that tree: no `binding.gyp`, no `.node` binaries, no
`install`/`preinstall`/`postinstall` scripts, and no `os`/`cpu`/`binary` fields in
any manifest. The only `optionalDependencies` entry anywhere in the tree is
`pg` → `pg-cloudflare`, which is pure JS; **`pg-native` is not installed**, so
`pg` runs its pure-JS protocol implementation.

If a future dependency introduces a native component, this whole approach needs
revisiting — re-run the audit above when adding one.

## Why apps/web needs no special handling

`npm run build --workspace=@chess-coach/web` (`tsc -b && vite build`) emits a
fully self-contained static bundle: Vite inlines the workspace-package imports
into the client bundle already. The result is HTML/JS/CSS that nginx serves and
Node never executes, so it has no architecture dependency at all.

## Why docker/Dockerfile.engine is different

`docker/Dockerfile.engine` (Task 2.1) installs the `stockfish` OS package with
`apt-get` **inside** the Dockerfile, and that is correct — there is no
pre-buildable artifact to hoist onto the runner. Built through
`docker buildx build --platform linux/arm64`, apt runs in an arm64 context and
fetches the arm64 package from Debian's repositories, so the right binary lands in
the image automatically. It does not need the "build outside Docker" treatment.

The engine image still runs `tsx` at startup, but installs its own dependencies
inside the (correct-architecture) build, so the esbuild-binary problem does not
arise there either.

## CI

Task 9.2 owns the pipeline. The requirement it inherits from this document: run
steps 1–3 on the runner, then build **all three** images with
`docker buildx build --platform linux/arm64`, never plain `docker build`.
