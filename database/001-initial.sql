-- New acceptance application only. Do not apply this as a migration to a retired app.
CREATE TABLE IF NOT EXISTS publishing_checks(
  id uuid PRIMARY KEY,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS publishing_checks_owner_created ON publishing_checks(created_by,created_at DESC,id);
