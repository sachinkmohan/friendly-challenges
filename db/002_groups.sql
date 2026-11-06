CREATE TABLE IF NOT EXISTS groups (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  CONSTRAINT groups_name_not_blank CHECK (char_length(btrim(name)) BETWEEN 1 AND 40)
);

CREATE TABLE IF NOT EXISTS memberships (
  group_id uuid NOT NULL REFERENCES groups (id),
  user_id uuid NOT NULL REFERENCES users (id),
  joined_on date NOT NULL,
  left_on date,
  PRIMARY KEY (group_id, user_id),
  CONSTRAINT memberships_left_after_join CHECK (left_on IS NULL OR left_on >= joined_on)
);

CREATE INDEX IF NOT EXISTS memberships_user_id_idx ON memberships (user_id);

CREATE OR REPLACE VIEW active_memberships AS
  SELECT group_id, user_id, joined_on
  FROM memberships
  WHERE left_on IS NULL;

CREATE OR REPLACE FUNCTION active_member_cap() RETURNS integer
LANGUAGE sql IMMUTABLE AS $$ SELECT 5 $$;

CREATE OR REPLACE FUNCTION memberships_reject_sixth() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  active_count integer;
BEGIN
  -- Lock this group so two joins cannot both pass the cap.
  PERFORM 1 FROM groups WHERE id = NEW.group_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'group_missing' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM active_memberships
    WHERE group_id = NEW.group_id AND user_id = NEW.user_id
  ) THEN
    RETURN NEW;
  END IF;
  SELECT count(*) INTO active_count
  FROM active_memberships
  WHERE group_id = NEW.group_id;
  IF active_count >= active_member_cap() THEN
    RAISE EXCEPTION 'group_full' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

-- WHEN matches the view predicate. A row that sets left_on does not take the cap lock.
DROP TRIGGER IF EXISTS memberships_reject_sixth ON memberships;
CREATE TRIGGER memberships_reject_sixth
  BEFORE INSERT OR UPDATE OF left_on ON memberships
  FOR EACH ROW
  WHEN (NEW.left_on IS NULL)
  EXECUTE FUNCTION memberships_reject_sixth();
