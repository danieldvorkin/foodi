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
  {
    name: 'media-and-avatars',
    sql: `
      ALTER TABLE users ADD COLUMN avatar_emoji TEXT NOT NULL DEFAULT '🧑‍🍳';

      -- Uploaded photos and videos. Bytes live on disk under the uploads dir, named by id.
      CREATE TABLE media (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('image','video')),
        mime TEXT NOT NULL,
        ext TEXT NOT NULL,
        bytes INTEGER NOT NULL,
        width INTEGER,
        height INTEGER,
        recipe_id TEXT REFERENCES recipes(id) ON DELETE CASCADE,
        post_id TEXT REFERENCES posts(id) ON DELETE CASCADE,
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX media_owner ON media(owner_id);
      CREATE INDEX media_recipe ON media(recipe_id, position);
      CREATE INDEX media_post ON media(post_id, position);
    `,
  },
  {
    name: 'passwords',
    sql: `
      -- Email + password sign-in. The identity row (provider 'password', subject = email)
      -- links the login to a user; the hash lives here, never in identities.
      CREATE TABLE passwords (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        hash TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    name: 'notifications',
    sql: `
      CREATE TABLE notifications (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('like','comment','save','role','system')),
        actor_id TEXT REFERENCES users(id) ON DELETE CASCADE,
        post_id TEXT REFERENCES posts(id) ON DELETE CASCADE,
        recipe_id TEXT REFERENCES recipes(id) ON DELETE CASCADE,
        comment_id TEXT REFERENCES comments(id) ON DELETE CASCADE,
        message TEXT,
        read_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX notifications_user ON notifications(user_id, created_at DESC);
      CREATE INDEX notifications_unread ON notifications(user_id, read_at);
    `,
  },
  {
    name: 'community',
    sql: `
      CREATE TABLE follows (
        follower_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        followee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY (follower_id, followee_id)
      );
      CREATE INDEX follows_followee ON follows(followee_id, created_at DESC);

      -- Longer-form writing. Drafts are only visible to their author.
      CREATE TABLE blog_posts (
        id TEXT PRIMARY KEY,
        author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
        cover_media_id TEXT,
        published_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX blog_author ON blog_posts(author_id, created_at DESC);
      CREATE INDEX blog_published ON blog_posts(status, published_at DESC);

      CREATE TABLE blog_post_recipes (
        blog_id TEXT NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
        recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
        position INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (blog_id, recipe_id)
      );
      CREATE TABLE blog_likes (
        blog_id TEXT NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY (blog_id, user_id)
      );
      CREATE TABLE blog_comments (
        id TEXT PRIMARY KEY,
        blog_id TEXT NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
        author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX blog_comments_blog ON blog_comments(blog_id, created_at);

      ALTER TABLE media ADD COLUMN blog_id TEXT REFERENCES blog_posts(id) ON DELETE CASCADE;
      CREATE INDEX media_blog ON media(blog_id, position);

      -- Recipe books: curated, ordered collections on a person's profile.
      CREATE TABLE recipe_books (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        emoji TEXT NOT NULL DEFAULT '📚',
        description TEXT NOT NULL DEFAULT '',
        visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('private','public')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX books_owner ON recipe_books(owner_id, created_at DESC);
      CREATE TABLE recipe_book_items (
        book_id TEXT NOT NULL REFERENCES recipe_books(id) ON DELETE CASCADE,
        recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
        position INTEGER NOT NULL DEFAULT 0,
        note TEXT NOT NULL DEFAULT '',
        added_at TEXT NOT NULL,
        PRIMARY KEY (book_id, recipe_id)
      );

      -- Adapted recipes remember where they came from, even if the original is later deleted.
      ALTER TABLE recipes ADD COLUMN forked_from_id TEXT;
      ALTER TABLE recipes ADD COLUMN forked_from_title TEXT;
      ALTER TABLE recipes ADD COLUMN forked_from_handle TEXT;
      ALTER TABLE recipes ADD COLUMN revision_notes TEXT NOT NULL DEFAULT '';
      CREATE INDEX recipes_forked_from ON recipes(forked_from_id);

      -- Last few characters of an API key, so people can tell which key is connected.
      ALTER TABLE credentials ADD COLUMN hint TEXT;

      -- Notifications gain kinds and references; SQLite can't widen a CHECK in place.
      CREATE TABLE notifications_v2 (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('like','comment','save','role','system','follow','book','remix','post')),
        actor_id TEXT REFERENCES users(id) ON DELETE CASCADE,
        post_id TEXT REFERENCES posts(id) ON DELETE CASCADE,
        recipe_id TEXT REFERENCES recipes(id) ON DELETE CASCADE,
        comment_id TEXT,
        blog_id TEXT REFERENCES blog_posts(id) ON DELETE CASCADE,
        book_id TEXT REFERENCES recipe_books(id) ON DELETE CASCADE,
        message TEXT,
        read_at TEXT,
        created_at TEXT NOT NULL
      );
      INSERT INTO notifications_v2 (id, user_id, kind, actor_id, post_id, recipe_id, comment_id, message, read_at, created_at)
        SELECT id, user_id, kind, actor_id, post_id, recipe_id, comment_id, message, read_at, created_at FROM notifications;
      DROP TABLE notifications;
      ALTER TABLE notifications_v2 RENAME TO notifications;
      CREATE INDEX notifications_user ON notifications(user_id, created_at DESC);
      CREATE INDEX notifications_unread ON notifications(user_id, read_at);
    `,
  },
  {
    name: 'book-item-snapshots',
    sql: `
      -- Remember what a shelved recipe was called when it was added, so a book can still list it
      -- after the author un-shares it without revealing the recipe's current (private) content.
      ALTER TABLE recipe_book_items ADD COLUMN title_snapshot TEXT NOT NULL DEFAULT '';
      ALTER TABLE recipe_book_items ADD COLUMN emoji_snapshot TEXT NOT NULL DEFAULT '🔒';
    `,
  },
  {
    name: 'house-account',
    sql: `
      -- The house kitchen (@foodi) is a system account: it owns the starter recipes, nobody can
      -- sign in as it, and its posts don't take comments.
      ALTER TABLE users ADD COLUMN is_system INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    name: 'commerce',
    sql: `
      ALTER TABLE recipe_books ADD COLUMN for_sale INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE recipe_books ADD COLUMN price_cents INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE recipe_books ADD COLUMN sales_pitch TEXT NOT NULL DEFAULT '';
      ALTER TABLE recipe_books ADD COLUMN preview_count INTEGER NOT NULL DEFAULT 2;

      -- A buyer's access to a book. The book name is snapshotted so receipts survive deletion.
      CREATE TABLE purchases (
        id TEXT PRIMARY KEY,
        buyer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        seller_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        book_id TEXT REFERENCES recipe_books(id) ON DELETE SET NULL,
        book_name TEXT NOT NULL,
        book_emoji TEXT NOT NULL DEFAULT '📚',
        amount_cents INTEGER NOT NULL,
        platform_fee_cents INTEGER NOT NULL,
        currency TEXT NOT NULL,
        provider TEXT NOT NULL,
        provider_ref TEXT,
        status TEXT NOT NULL CHECK (status IN ('pending','paid','refunded','cancelled')),
        created_at TEXT NOT NULL,
        paid_at TEXT,
        refunded_at TEXT
      );
      CREATE INDEX purchases_buyer ON purchases(buyer_id, status);
      CREATE INDEX purchases_seller ON purchases(seller_id, status);
      CREATE INDEX purchases_book ON purchases(book_id, status);

      -- Paid placements of a book in the feed and rail.
      CREATE TABLE promotions (
        id TEXT PRIMARY KEY,
        book_id TEXT NOT NULL REFERENCES recipe_books(id) ON DELETE CASCADE,
        owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        package_id TEXT NOT NULL,
        amount_cents INTEGER NOT NULL,
        currency TEXT NOT NULL,
        provider TEXT NOT NULL,
        provider_ref TEXT,
        status TEXT NOT NULL CHECK (status IN ('pending','active','expired','cancelled','refunded')),
        starts_at TEXT,
        ends_at TEXT,
        impressions INTEGER NOT NULL DEFAULT 0,
        clicks INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX promotions_active ON promotions(status, ends_at);
      CREATE INDEX promotions_owner ON promotions(owner_id, created_at DESC);

      -- Sellers ask for their balance; an admin pays it out by hand and records it here.
      CREATE TABLE payouts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        amount_cents INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('requested','paid','rejected')),
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        resolved_at TEXT,
        resolved_by TEXT
      );
      CREATE INDEX payouts_user ON payouts(user_id, created_at DESC);

      -- Notification kinds are validated in code from now on; the CHECK kept needing widening.
      CREATE TABLE notifications_v3 (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        actor_id TEXT REFERENCES users(id) ON DELETE CASCADE,
        post_id TEXT REFERENCES posts(id) ON DELETE CASCADE,
        recipe_id TEXT REFERENCES recipes(id) ON DELETE CASCADE,
        comment_id TEXT,
        blog_id TEXT REFERENCES blog_posts(id) ON DELETE CASCADE,
        book_id TEXT REFERENCES recipe_books(id) ON DELETE CASCADE,
        message TEXT,
        read_at TEXT,
        created_at TEXT NOT NULL
      );
      INSERT INTO notifications_v3 SELECT id, user_id, kind, actor_id, post_id, recipe_id, comment_id, blog_id, book_id, message, read_at, created_at FROM notifications;
      DROP TABLE notifications;
      ALTER TABLE notifications_v3 RENAME TO notifications;
      CREATE INDEX notifications_user ON notifications(user_id, created_at DESC);
      CREATE INDEX notifications_unread ON notifications(user_id, read_at);
    `,
  },
  {
    name: 'shop',
    sql: `
      -- Granular admin rights. Base role stays 'admin'; these unlock specific panels.
      CREATE TABLE admin_permissions (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        permission TEXT NOT NULL,
        granted_by TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY (user_id, permission)
      );

      -- Anything people sell that isn't a recipe book: gear, jars, classes, services.
      CREATE TABLE shop_listings (
        id TEXT PRIMARY KEY,
        seller_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        category TEXT NOT NULL,
        condition TEXT,
        price_cents INTEGER NOT NULL,
        currency TEXT NOT NULL,
        quantity INTEGER,
        ships_from TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL CHECK (status IN ('draft','pending','approved','rejected','sold_out','archived')),
        rejection_reason TEXT,
        reviewed_by TEXT,
        reviewed_at TEXT,
        submitted_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX shop_listings_status ON shop_listings(status, reviewed_at DESC);
      CREATE INDEX shop_listings_seller ON shop_listings(seller_id, created_at DESC);

      ALTER TABLE media ADD COLUMN listing_id TEXT REFERENCES shop_listings(id) ON DELETE CASCADE;
      CREATE INDEX media_listing ON media(listing_id, position);

      CREATE TABLE shop_orders (
        id TEXT PRIMARY KEY,
        listing_id TEXT REFERENCES shop_listings(id) ON DELETE SET NULL,
        listing_title TEXT NOT NULL,
        listing_category TEXT NOT NULL,
        buyer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        seller_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        quantity INTEGER NOT NULL,
        amount_cents INTEGER NOT NULL,
        platform_fee_cents INTEGER NOT NULL,
        currency TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        provider TEXT NOT NULL,
        provider_ref TEXT,
        status TEXT NOT NULL CHECK (status IN ('pending','paid','fulfilled','refunded','cancelled')),
        created_at TEXT NOT NULL,
        paid_at TEXT,
        fulfilled_at TEXT,
        refunded_at TEXT
      );
      CREATE INDEX shop_orders_buyer ON shop_orders(buyer_id, status);
      CREATE INDEX shop_orders_seller ON shop_orders(seller_id, status);
      CREATE INDEX shop_orders_listing ON shop_orders(listing_id, status);
    `,
  },
  {
    name: 'jobs',
    sql: `
      -- Background work (recipe generation). Claimed by the in-process worker; survives restarts.
      CREATE TABLE jobs (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        payload TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('queued','running','done','failed','cancelled')),
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        last_error TEXT,
        last_error_code TEXT,
        result_recipe_id TEXT REFERENCES recipes(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        run_after TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT
      );
      CREATE INDEX jobs_queue ON jobs(status, run_after);
      CREATE INDEX jobs_user ON jobs(user_id, created_at DESC);
    `,
  },
  {
    name: 'recipe-photos',
    sql: `
      ALTER TABLE media ADD COLUMN generated INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE generations ADD COLUMN kind TEXT NOT NULL DEFAULT 'recipe';
      ALTER TABLE users ADD COLUMN auto_photos INTEGER NOT NULL DEFAULT 1;
    `,
  },
  {
    name: 'photo-sources',
    sql: `
      ALTER TABLE media ADD COLUMN source TEXT NOT NULL DEFAULT 'upload';
      ALTER TABLE media ADD COLUMN credit TEXT;
      ALTER TABLE media ADD COLUMN license TEXT;
      ALTER TABLE media ADD COLUMN source_url TEXT;
      UPDATE media SET source = 'ai' WHERE generated = 1;
      CREATE TABLE photo_seen (
        recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
        source_url TEXT NOT NULL,
        outcome TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (recipe_id, source_url)
      );
    `,
  },
  {
    name: 'shopping-list',
    sql: `
      CREATE TABLE shopping_items (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        text TEXT NOT NULL,
        quantity REAL,
        unit TEXT,
        ingredient_id TEXT,
        category TEXT NOT NULL DEFAULT 'other',
        checked INTEGER NOT NULL DEFAULT 0,
        recipe_id TEXT REFERENCES recipes(id) ON DELETE SET NULL,
        recipe_title TEXT,
        plan_entry_id TEXT,
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX shopping_user ON shopping_items(user_id, checked, position);
    `,
  },
];
