import { sql, type Kysely } from 'kysely';

/** Full schema of architecture.md §3, including the §8.1/§8.3 amendments
 * (sessions.context_digest/digest_through_message_id, llm_call_log.cached_input_tokens). */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`.execute(db);

  await sql`
    CREATE TABLE users (
      id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email              text UNIQUE NOT NULL,
      display_name       text NOT NULL,
      rating_band        text NOT NULL CHECK (rating_band IN
                           ('novice','improving','club','advanced')) DEFAULT 'improving',
      lichess_username   text,
      chesscom_username  text,
      self_assessment    text,
      created_at         timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db);

  await sql`
    CREATE TABLE user_llm_keys (
      user_id        uuid NOT NULL REFERENCES users(id),
      provider       text NOT NULL CHECK (provider IN ('anthropic','openai')),
      key_ciphertext bytea NOT NULL,
      key_iv         bytea NOT NULL,
      created_at     timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, provider)
    )
  `.execute(db);

  await sql`
    CREATE TABLE games (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id      uuid NOT NULL REFERENCES users(id),
      pgn          text NOT NULL,
      source       text NOT NULL CHECK (source IN ('paste','upload','lichess')),
      user_color   text NOT NULL CHECK (user_color IN ('white','black')),
      white_name   text,
      black_name   text,
      result       text,
      time_control text,
      eco          text,
      played_at    timestamptz,
      created_at   timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db);

  await sql`
    CREATE TABLE analyses (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      game_id       uuid UNIQUE NOT NULL REFERENCES games(id),
      status        text NOT NULL CHECK (status IN
                      ('queued','engine_running','planning','ready','failed')),
      error         text,
      engine_evals  jsonb,
      coaching_plan jsonb,
      created_at    timestamptz NOT NULL DEFAULT now(),
      completed_at  timestamptz
    )
  `.execute(db);

  await sql`
    CREATE TABLE sessions (
      id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      game_id                   uuid NOT NULL REFERENCES games(id),
      user_id                   uuid NOT NULL REFERENCES users(id),
      status                    text NOT NULL CHECK (status IN
                                  ('active','completed','paused_no_credits')),
      current_ply               int NOT NULL DEFAULT 0,
      threads                   jsonb NOT NULL DEFAULT '[]',
      context_digest            text,
      digest_through_message_id bigint,
      started_at                timestamptz NOT NULL DEFAULT now(),
      ended_at                  timestamptz
    )
  `.execute(db);

  await sql`
    CREATE TABLE session_messages (
      id         bigserial PRIMARY KEY,
      session_id uuid NOT NULL REFERENCES sessions(id),
      role       text NOT NULL CHECK (role IN ('user','assistant','tool')),
      content    jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db);

  await sql`
    CREATE TABLE findings (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     uuid NOT NULL REFERENCES users(id),
      session_id  uuid REFERENCES sessions(id),
      game_id     uuid REFERENCES games(id),
      category    text NOT NULL,
      severity    text NOT NULL CHECK (severity IN ('minor','significant','critical')),
      ply         int,
      description text NOT NULL,
      is_positive boolean NOT NULL DEFAULT false,
      created_at  timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db);
  await sql`CREATE INDEX findings_user_category ON findings(user_id, category, created_at)`.execute(
    db
  );

  await sql`
    CREATE TABLE focus_areas (
      id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id        uuid NOT NULL REFERENCES users(id),
      category       text NOT NULL,
      status         text NOT NULL CHECK (status IN ('active','improving','resolved')),
      note           text NOT NULL,
      evidence_count int NOT NULL DEFAULT 1,
      last_seen_at   timestamptz NOT NULL DEFAULT now(),
      created_at     timestamptz NOT NULL DEFAULT now(),
      UNIQUE (user_id, category)
    )
  `.execute(db);

  await sql`
    CREATE TABLE credit_ledger (
      id              bigserial PRIMARY KEY,
      user_id         uuid NOT NULL REFERENCES users(id),
      delta           int NOT NULL,
      reason          text NOT NULL CHECK (reason IN
                        ('signup_grant','purchase','session_usage','refund')),
      session_id      uuid,
      stripe_event_id text UNIQUE,
      created_at      timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db);

  await sql`
    CREATE TABLE llm_call_log (
      id                  bigserial PRIMARY KEY,
      user_id             uuid NOT NULL,
      session_id          uuid,
      provider            text NOT NULL,
      model               text NOT NULL,
      input_tokens        int NOT NULL,
      output_tokens       int NOT NULL,
      cached_input_tokens int NOT NULL DEFAULT 0,
      credits_metered     int NOT NULL DEFAULT 0,
      purpose             text NOT NULL,
      created_at          timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS llm_call_log`.execute(db);
  await sql`DROP TABLE IF EXISTS credit_ledger`.execute(db);
  await sql`DROP TABLE IF EXISTS focus_areas`.execute(db);
  await sql`DROP TABLE IF EXISTS findings`.execute(db);
  await sql`DROP TABLE IF EXISTS session_messages`.execute(db);
  await sql`DROP TABLE IF EXISTS sessions`.execute(db);
  await sql`DROP TABLE IF EXISTS analyses`.execute(db);
  await sql`DROP TABLE IF EXISTS games`.execute(db);
  await sql`DROP TABLE IF EXISTS user_llm_keys`.execute(db);
  await sql`DROP TABLE IF EXISTS users`.execute(db);
}
