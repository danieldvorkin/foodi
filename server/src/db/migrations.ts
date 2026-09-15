export const MIGRATIONS: { name: string; sql: string }[] = [
  {
    name: 'init',
    sql: `
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        role TEXT NOT NULL DEFAULT 'consumer' CHECK (role IN ('admin','consumer')),
        display_name TEXT,
        email TEXT,
        handle TEXT NOT NULL UNIQUE,
        bio TEXT NOT NULL DEFAULT '',
        disabled_at TEXT,
        created_at TEXT NOT NULL,
        last_seen_at TEXT
      );

      -- One identity per (provider, subject). A user may have several identities over time.
      CREATE TABLE identities (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        subject TEXT NOT NULL,
        email TEXT,
        created_at TEXT NOT NULL,
        UNIQUE (provider, subject)
      );

      -- The AI credential we use on the person's behalf. Encrypted with AES-256-GCM.
      CREATE TABLE credentials (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        vendor TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('oauth','api_key')),
        payload_enc TEXT NOT NULL,
        expires_at TEXT,
        updated_at TEXT NOT NULL
      );

      -- Opaque session ids are hashed before storage so a DB read can't hijack a session.
      CREATE TABLE sessions (
        id_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        ip TEXT,
        user_agent TEXT
      );
      CREATE INDEX sessions_user ON sessions(user_id);

      CREATE TABLE profiles (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE pantry_items (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        ingredient_id TEXT NOT NULL,
        added_at TEXT NOT NULL,
        PRIMARY KEY (user_id, ingredient_id)
      );

      CREATE TABLE recipes (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        source TEXT NOT NULL CHECK (source IN ('ai','user')),
        visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','public')),
        title TEXT NOT NULL,
        prompt TEXT NOT NULL DEFAULT '',
        requested_ingredient_ids TEXT NOT NULL DEFAULT '[]',
        provider TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL,
        favorite INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX recipes_user ON recipes(user_id, created_at DESC);

      CREATE TABLE generations (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        vendor TEXT NOT NULL,
        model TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('ok','failed')),
        latency_ms INTEGER NOT NULL,
        input_tokens INTEGER,
        output_tokens INTEGER,
        error_code TEXT,
        recipe_id TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX generations_created ON generations(created_at DESC);
      CREATE INDEX generations_user ON generations(user_id, created_at DESC);

      CREATE TABLE posts (
        id TEXT PRIMARY KEY,
        author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
        caption TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
      CREATE INDEX posts_created ON posts(created_at DESC);
      CREATE INDEX posts_author ON posts(author_id, created_at DESC);

      CREATE TABLE likes (
        post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY (post_id, user_id)
      );

      CREATE TABLE comments (
        id TEXT PRIMARY KEY,
        post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX comments_post ON comments(post_id, created_at);

      CREATE TABLE audit_log (
        id TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL,
        action TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT,
        detail TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX audit_created ON audit_log(created_at DESC);

      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
];
