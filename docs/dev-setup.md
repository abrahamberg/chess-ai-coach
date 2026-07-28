# Local dev setup

Local dev uses `docker-compose.yml` for **postgres + engine + header-stub auth**
(architecture.md §11) — no Kubernetes needed for daily work. `api`/`worker`/`web-dev`
run via bind mount + `node --experimental-strip-types`, so edits on the host are
picked up immediately (no image rebuild).

## Prerequisites

- Node.js ≥ 22, npm, and a working `docker compose` (or Docker Compose v2 on top
  of Podman — see "Podman instead of Docker" below).
- Run `npm install` at the repo root once, before bringing the stack up — `api`,
  `worker`, and `web-dev` bind-mount the repo and expect `node_modules` to
  already exist on the host.

## Quick start

```sh
npm install
docker compose up -d --build postgres engine migrate api worker web-dev
```

This starts:

| Service    | What                                            | Port |
|------------|--------------------------------------------------|------|
| `postgres` | Postgres 16                                       | 5432 |
| `engine`   | Stockfish HTTP service (`docker/Dockerfile.engine`) | 8081 |
| `migrate`  | Runs `kysely` migrations once, then exits         | —    |
| `api`      | Fastify API (`apps/api`)                          | 3000 |
| `worker`   | graphile-worker job runner (`apps/api/src/worker.ts`) | —    |
| `web-dev`  | Vite dev server (`apps/web`)                      | 5173 |

Open http://localhost:5173. `AUTH_MODE=dev-stub` (the default — see below)
means every request is treated as a single fixed `dev@local.test` user; no login
flow is needed.

Tear down with `docker compose down` (add `-v` to also drop the Postgres
volume).

## Auth: `AUTH_MODE=dev-stub` vs. the real oauth2-proxy

By default the compose file sets `AUTH_MODE=dev-stub` on `api`: every request
without proxy headers is treated as one fixed local user
(`apps/api/src/plugins/auth-headers.ts`). This is what daily dev and
`scripts/smoke.sh` use — no OAuth app registration required.

To test the real proxy-auth path (Google OIDC + Lichess OAuth2, per
architecture.md §11), start the `auth` profile instead:

```sh
cp .env.example .env   # then fill in the OAUTH2_PROXY_* values below
docker compose --profile auth up -d
```

You'll need, in `.env`:

- `OAUTH2_PROXY_CLIENT_ID` / `OAUTH2_PROXY_CLIENT_SECRET` — from a real Google
  OAuth 2.0 client (console.cloud.google.com → Credentials). Authorized
  redirect URI: `http://localhost:4180/oauth2/callback`.
- `OAUTH2_PROXY_COOKIE_SECRET` — a random 32-byte value:
  `python3 -c "import secrets,base64;print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())"`

With the profile up, hit http://localhost:4180 instead of :3000 directly —
oauth2-proxy forwards `X-Auth-Request-*` identity headers to `api` once you've
signed in. None of this is needed for normal feature work.

## `LLM_FAKE`: local dev / smoke testing without real LLM keys

Set `LLM_FAKE=1` to make **every** model call (`llm/gateway.ts`'s
`getModelForUser` — used by the coach chat, the analysis planner, and the
session summarizer) return a canned `MockLanguageModelV1` stream instead of
calling Anthropic/OpenAI. No `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` is needed in
this mode; `LLM_STANDARD_MODEL_*`/`LLM_LIGHT_MODEL_*` still need *some* value
(the compose file defaults them to placeholder strings) since they're read
unconditionally, but they're never actually sent anywhere when faked.

```sh
LLM_FAKE=1 docker compose up -d postgres engine migrate api worker
```

This is what `scripts/smoke.sh` uses. To use real models instead, set
`ANTHROPIC_API_KEY` and/or `OPENAI_API_KEY` and real `LLM_*_MODEL_*` ids in
your `.env`, and leave `LLM_FAKE` unset (or `0`).

## Smoke test

```sh
scripts/smoke.sh            # brings the stack up, runs the flow, tears it down
scripts/smoke.sh --keep-up  # leaves the stack running afterward, for poking around
```

Exercises the real services end to end: import a PGN → poll the analysis job
until `ready` (engine + worker + graphile-worker, all real) → create a
coaching session → send a chat message and confirm the `LLM_FAKE` canned
reply streams back. It always runs with `AUTH_MODE=dev-stub` and `LLM_FAKE=1`,
so it needs no external credentials at all.

## Migrations

`migrate` runs once as part of `docker compose up` and exits
(`npm run migrate --workspace=@chess-coach/api`, i.e.
`apps/api/src/db/migrate-cli.ts`). To re-run it by hand (e.g. after adding a
new migration file):

```sh
docker compose run --rm migrate
```

## Podman instead of Docker

If your `docker` CLI is actually a Podman shim (`docker --version` reports
`podman`), point `DOCKER_HOST` at Podman's rootless socket before running any
`docker compose` command:

```sh
systemctl --user enable --now podman.socket
export DOCKER_HOST="unix:///run/user/$(id -u)/podman/podman.sock"
```

`docker compose` (Compose v2) works against this exactly as it would against
real Docker — used to develop and verify this compose file.
