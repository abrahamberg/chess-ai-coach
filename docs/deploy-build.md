# Building the deployment images

The `api`, `web`, and `engine` images are **built outside Docker**. Their Dockerfiles do
nothing but `COPY` finished artifacts into a slim runtime image — no `npm ci`, no
`npm run build`, no compilation in a Docker layer. Compiling on the CI runner is
faster and caches better, and it is what makes the images portable to the arm64
nodes we deploy to.

## One command

```bash
npm run build:images -- --registry <registry> --tag <tag> --push
```

`scripts/build-images.sh` is the executable definition of the flow — CI (Task
9.2) calls it, and it is the only place the step order lives. `--help` lists
every flag; the ones that matter are `--registry`, `--tag`, `--platform`
(default `linux/arm64`; the GitHub publishing workflow uses
`linux/amd64,linux/arm64`), `--push`, and `--restore-dev-deps` (re-runs a full
`npm ci` at the end, which you want on a workstation and not on a CI runner).

Without `--push` the images are `--load`ed into the local Docker daemon
instead. One of the two always happens: **`docker buildx build` with neither
`--push` nor `--load` discards its output**, leaving a build that looks
successful and produces nothing.

## What the script does, and why the order is load-bearing

```bash
# 1. Full install (dev dependencies included — the build steps need them).
npm ci

# 2. Build the artifacts the Dockerfiles will copy.
npm run bundle --workspace=@chess-coach/api   # -> apps/api/dist-bundle/*.mjs
npm run build  --workspace=@chess-coach/web   # -> apps/web/dist/
node services/engine/scripts/bundle.mjs       # -> services/engine/dist-bundle/server.mjs

# 3. Verify the prepared artifacts before building the images.

# 4. Build the images.
docker buildx build --platform linux/amd64,linux/arm64 --push -f docker/Dockerfile.api    -t <registry>/chess-ai-coach:api-<tag>    .
docker buildx build --platform linux/amd64,linux/arm64 --push -f docker/Dockerfile.web    -t <registry>/chess-ai-coach:web-<tag>    .
docker buildx build --platform linux/amd64,linux/arm64 --push -f docker/Dockerfile.engine -t <registry>/chess-ai-coach:engine-<tag> .
```

Run the script rather than these commands — they are here to explain it, and
running step 3 out of order silently breaks the tree. Step 3 also leaves the
working tree without dev dependencies: re-run `npm ci` (or pass
`--restore-dev-deps`) before going back to development or running tests.

### buildx prerequisites for cross-architecture builds

Building `linux/arm64` on an amd64 runner needs more than the `--platform` flag:

```bash
# A builder on the docker-container driver. The default "docker" driver cannot
# build for a foreign platform and cannot --push; it either errors out or
# quietly gives you a host-architecture image.
docker buildx create --name xbuild --driver docker-container --use
docker buildx inspect --bootstrap        # check the Platforms: line lists linux/arm64

# QEMU/binfmt_misc handlers, so foreign-architecture RUN steps can execute.
docker run --privileged --rm tonistiigi/binfmt --install arm64
```

The QEMU part is needed for the engine image's architecture-specific Stockfish
installation. GitHub Actions covers this with
`docker/setup-qemu-action` + `docker/setup-buildx-action`.

Native arm64 runners need neither — but they do still need the
`docker-container` driver for `--push` to produce a proper manifest.

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

The engine application is bundled on the runner and runs with plain `node`; no
npm install, TypeScript compilation, or `tsx` startup dependency is needed in
the runtime image.

## All three images run as uid 1000

`docker/Dockerfile.{api,web,engine}` each end in `USER 1000`, and the Helm
chart's `podSecurityContext` sets `runAsNonRoot: true` **with**
`runAsUser: 1000` (`deploy/helm/chess-ai-coach/values.yaml`). The two must stay
in agreement: with `runAsNonRoot` alone, kubelet has to derive the uid from the
image and refuses to start a container it cannot prove is non-root — an image
with no `USER` fails with *"image will run as root"*, and a *named* user
(`USER node`) fails with *"image has non-numeric user (node), cannot verify user
is non-root"*. Both are admission-time failures that no local `docker run`,
`helm template` or `kubeconform` run can see, so `deploy/helm/test.sh` asserts
the chart side structurally for every Deployment and Job it renders.

1000 is the `node` user's uid in `node:22-slim`. Nothing in the images needs to
write outside `/tmp`: the copied `node_modules`, `dist-bundle`, static assets and
`/usr/games/stockfish` are all world-readable, and nginx-unprivileged keeps its
pid file and every `*_temp_path` in `/tmp`.

## CI

Task 9.2 owns the pipeline. The requirement it inherits from this document: set
up buildx + QEMU as above, then call

```bash
npm run build:images -- --registry <registry> --tag <tag> --push
```

Do not re-implement the steps inline, and never use plain `docker build` — it
cannot cross-build and cannot push.
