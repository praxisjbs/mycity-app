-- Keep updated_at current on every mutable table that exposes the column.
-- UP
DO $$
DECLARE target record;
BEGIN
  FOR target IN
    SELECT table_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'updated_at' AND table_name <> 'audit_ledger'
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_updated_at ON %I', target.table_name);
    EXECUTE format('CREATE TRIGGER set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', target.table_name);
  END LOOP;
END;
$$;

-- DOWN
DO $$
DECLARE target record;
BEGIN
  FOR target IN
    SELECT table_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'updated_at'
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_updated_at ON %I', target.table_name);
  END LOOP;
END;
$$;
