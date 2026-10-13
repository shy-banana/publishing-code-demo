CREATE TABLE IF NOT EXISTS publishing_checks(id uuid PRIMARY KEY,title text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
