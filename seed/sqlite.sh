#!/usr/bin/env bash
# Seed a sample SQLite database for the Baklava SQLite workspace.
# Output: /tmp/baklava-data/demo.sqlite — point the Baklava SQLite connection
# at that path. Re-running this script overwrites the file.

set -euo pipefail

DEST="${1:-/tmp/baklava-data/demo.sqlite}"
mkdir -p "$(dirname "$DEST")"
rm -f "$DEST"

sqlite3 "$DEST" <<'SQL'
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_users_status ON users(status);

CREATE TABLE posts (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  body TEXT,
  published INTEGER DEFAULT 0,
  view_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_posts_user_id ON posts(user_id);
CREATE INDEX idx_posts_published ON posts(published) WHERE published = 1;

CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL,
  payload TEXT,
  ts TEXT DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO users(email, name, status) VALUES
  ('ava@example.com',    'Ava Stone',     'active'),
  ('noah@example.com',   'Noah Reyes',    'active'),
  ('liam@example.com',   'Liam Park',     'suspended'),
  ('olivia@example.com', 'Olivia Chen',   'active'),
  ('elijah@example.com', 'Elijah Watts',  'active');

INSERT INTO posts(user_id, title, body, published, view_count) VALUES
  (1, 'Hello world',         'First post body',  1,  142),
  (1, 'Sequel',               'Second post',      0,    0),
  (2, 'Thoughts on rust',     'long form essay',  1,  904),
  (4, 'How I ship faster',    'Lessons learned',  1, 2310),
  (5, 'Untitled draft',       NULL,                0,    0);

INSERT INTO events(type, payload) VALUES
  ('user.signup',     '{"userId":1}'),
  ('user.signup',     '{"userId":2}'),
  ('post.published',  '{"postId":1}'),
  ('post.published',  '{"postId":3}'),
  ('post.viewed',     '{"postId":3,"ip":"10.0.0.5"}');

CREATE VIEW active_users AS
  SELECT id, email, name FROM users WHERE status = 'active';

CREATE TRIGGER posts_audit AFTER INSERT ON posts
BEGIN
  INSERT INTO events(type, payload)
  VALUES ('post.created', json_object('postId', NEW.id));
END;
SQL

echo "Seeded $DEST — point the Baklava SQLite connection at this file."
