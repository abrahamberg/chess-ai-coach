# Chess AI Coach — Architecture


## 1. System overview

```
                        ┌─────────────────────────────────────────────┐
 Internet ──► Ingress ──► oauth2-proxy (Google + Lichess OIDC/OAuth2) │
                        └───────────────┬─────────────────────────────┘
                                        │ X-Auth-Request-* headers
                       ┌────────────────┼──────────────────┐
                       ▼                ▼                   │
                  ┌─────────┐     ┌──────────┐              │
                  │  web    │     │   api    │◄─────────────┘
                  │ (React, │     │(Fastify) │
                  │ static) │     └──┬───┬───┘
                  └─────────┘        │   │ SQL
                   serves SPA;       │   ▼
                   WASM Stockfish    │ ┌────────────┐   ┌──────────────┐
                   runs in-browser   │ │ PostgreSQL │◄──│ worker        │
                                     │ └────────────┘   │(graphile-    │
                                     │        ▲         │ worker jobs) │
                                     ▼        │         └──────┬───────┘
                              ┌────────────┐  └────────────────┤
                              │  engine    │◄──────────────────┘
                              │(Stockfish  │   HTTP (cluster-internal)
                              │ HTTP svc)  │
                              └────────────┘
             External: Anthropic API · OpenAI API · Stripe · Lichess API
```

Five deployables: `web`, `api`, `worker`, `engine`, plus `oauth2-proxy` and
`postgresql` from upstream charts.

Everything behind the ingress requires an authenticated oauth2-proxy session,
with two exceptions carved out via `--skip-auth-route`: `/` (the public
landing page, `apps/web/public/landing.html`) and `/robots.txt`, so
logged-out visitors and search-engine crawlers can reach the site before
signing in.

# Architectural Principles

### 1. Clear boundaries

```text
UI
 ↓
Routes
 ↓
Services
 ↓
Repositories
 ↓
Database
```

Rules:

- Routes contain transport logic only
- Services contain business logic
- Repositories contain all SQL
- Agent tools call services, never repositories

### 2. Shared contracts

`packages/shared` is the single source of truth for:

- API schemas
- Database JSON schemas
- Shared types

No duplicated interfaces.

### 3. Pure domain logic

`packages/chess-analysis`

Contains:

- PGN parsing
- Critical moment detection
- CP-loss classification

No network, database, or framework dependencies.

### 4. Stateless infrastructure

Services should remain stateless where possible:

- API
- Worker
- Engine

PostgreSQL is the primary state store.

---

# Core Components

## Web

Responsibilities:

- Game import
- Dashboard
- Coaching session UI
- Chessboard interaction
- Streaming chat

Browser Stockfish is UX-only and never authoritative.

## API

Responsibilities:

- Authentication
- Session management
- Agent orchestration
- Credit metering
- LLM gateway
- SSE streaming

The API owns the coaching experience.

## Worker

Responsibilities:

- Background game analysis
- Session summarization
- Long-running tasks

## Engine

Responsibilities:

- Stockfish evaluation
- Position analysis
- Game analysis

Single purpose service.

---

# Analysis Flow

```text
Import PGN
    ↓
Queue Analysis
    ↓
Engine Evaluation
    ↓
Move Classification
    ↓
LLM Planning
    ↓
Coaching Plan Ready
```

Output:

- Engine evaluations
- Coaching plan
- Learning themes

---

# Coaching Flow

```text
User Message
      ↓
Coach Agent
      ↓
Tools
      ↓
Service Layer
      ↓
Database / Engine
```

The coach follows a Socratic teaching model:

- Ask questions first
- Guide discovery
- Explain only after student reasoning

---

# Agent Design

The coaching agent is the product's core capability.

### Model tiers

**Standard**

- Live coaching conversations

**Light**

- Analysis planning
- Summarization
- Context compression
- Engine interpretation

### Tool constraints

Tools may:

- Read profile data
- Query engine analysis
- Record findings
- Update coaching state

Tools may not:

- Execute SQL
- Bypass services
- Access infrastructure directly

---

# Data Ownership

| Data | Owner |
|--------|--------|
| Users | API |
| Games | API |
| Analyses | Worker |
| Sessions | Coach Agent |
| Findings | Progress Service |
| Credits | Billing Service |

---

# Key Invariants

### Session history is append-only

Messages are never edited or deleted.

### One analysis per game

A game cannot have multiple completed analyses.

### Coaching state is durable

Sessions can be resumed after disconnects or restarts.

### Engine is authoritative

Only server-side Stockfish evaluations are trusted.

Browser analysis is advisory only.

### Context remains bounded

Large conversations are summarized and compacted.

Raw history remains stored.

---

# Deployment Units

```text
web
api
worker
engine
postgres
oauth2-proxy
```

Each service is independently deployable.

---

# Repository Structure

```text
apps/
  web/
  api/

services/
  engine/

packages/
  shared/
  chess-analysis/
  prompts/
```

Dependency rules:

```text
packages/*
    ↑
apps/*
```

Packages never depend on applications.

---

# Future Evolution

Expected growth areas:

- Additional chess providers
- New coaching modes
- Stronger progress tracking
- Multi-game training plans
- Mobile clients

Core architecture should remain:

```text
Web
 ↓
API
 ↓
Services
 ↓
Repositories
 ↓
Database
```
