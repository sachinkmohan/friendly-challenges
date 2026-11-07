ALTER TABLE groups ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users (id);

-- Groups made before this column existed: the first member to join made the group.
UPDATE groups g
SET created_by = (
  SELECT m.user_id FROM memberships m
  WHERE m.group_id = g.id
  ORDER BY m.joined_on, m.user_id
  LIMIT 1
)
WHERE g.created_by IS NULL;

ALTER TABLE groups ALTER COLUMN created_by SET NOT NULL;
