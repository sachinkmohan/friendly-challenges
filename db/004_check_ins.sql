CREATE TABLE IF NOT EXISTS check_ins (
  group_id uuid NOT NULL,
  user_id uuid NOT NULL,
  day date NOT NULL,
  color text NOT NULL,
  PRIMARY KEY (group_id, user_id, day),
  CONSTRAINT check_ins_membership
    FOREIGN KEY (group_id, user_id) REFERENCES memberships (group_id, user_id),
  CONSTRAINT check_ins_challenge
    FOREIGN KEY (group_id) REFERENCES challenges (group_id),
  CONSTRAINT check_ins_color CHECK (color IN ('green', 'red'))
);
