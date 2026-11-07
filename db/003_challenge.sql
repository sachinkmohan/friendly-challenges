CREATE TABLE IF NOT EXISTS currency_codes (
  code char(3) PRIMARY KEY,
  minor_digits smallint NOT NULL,
  CONSTRAINT currency_codes_shape CHECK (code ~ '^[A-Z]{3}$'),
  CONSTRAINT currency_codes_digits CHECK (minor_digits BETWEEN 0 AND 4)
);

INSERT INTO currency_codes (code, minor_digits) VALUES
  ('AED', 2), ('AFN', 2), ('ALL', 2), ('AMD', 2), ('AOA', 2), ('ARS', 2), ('AUD', 2), ('AWG', 2),
  ('AZN', 2), ('BAM', 2), ('BBD', 2), ('BDT', 2), ('BHD', 3), ('BIF', 0), ('BMD', 2), ('BND', 2),
  ('BOB', 2), ('BOV', 2), ('BRL', 2), ('BSD', 2), ('BTN', 2), ('BWP', 2), ('BYN', 2), ('BZD', 2),
  ('CAD', 2), ('CDF', 2), ('CHE', 2), ('CHF', 2), ('CHW', 2), ('CLF', 4), ('CLP', 0), ('CNY', 2),
  ('COP', 2), ('COU', 2), ('CRC', 2), ('CUP', 2), ('CVE', 2), ('CZK', 2), ('DJF', 0), ('DKK', 2),
  ('DOP', 2), ('DZD', 2), ('EGP', 2), ('ERN', 2), ('ETB', 2), ('EUR', 2), ('FJD', 2), ('FKP', 2),
  ('GBP', 2), ('GEL', 2), ('GHS', 2), ('GIP', 2), ('GMD', 2), ('GNF', 0), ('GTQ', 2), ('GYD', 2),
  ('HKD', 2), ('HNL', 2), ('HTG', 2), ('HUF', 2), ('IDR', 2), ('ILS', 2), ('INR', 2), ('IQD', 3),
  ('IRR', 2), ('ISK', 0), ('JMD', 2), ('JOD', 3), ('JPY', 0), ('KES', 2), ('KGS', 2), ('KHR', 2),
  ('KMF', 0), ('KPW', 2), ('KRW', 0), ('KWD', 3), ('KYD', 2), ('KZT', 2), ('LAK', 2), ('LBP', 2),
  ('LKR', 2), ('LRD', 2), ('LSL', 2), ('LYD', 3), ('MAD', 2), ('MDL', 2), ('MGA', 2), ('MKD', 2),
  ('MMK', 2), ('MNT', 2), ('MOP', 2), ('MRU', 2), ('MUR', 2), ('MVR', 2), ('MWK', 2), ('MXN', 2),
  ('MXV', 2), ('MYR', 2), ('MZN', 2), ('NAD', 2), ('NGN', 2), ('NIO', 2), ('NOK', 2), ('NPR', 2),
  ('NZD', 2), ('OMR', 3), ('PAB', 2), ('PEN', 2), ('PGK', 2), ('PHP', 2), ('PKR', 2), ('PLN', 2),
  ('PYG', 0), ('QAR', 2), ('RON', 2), ('RSD', 2), ('RUB', 2), ('RWF', 0), ('SAR', 2), ('SBD', 2),
  ('SCR', 2), ('SDG', 2), ('SEK', 2), ('SGD', 2), ('SHP', 2), ('SLE', 2), ('SOS', 2), ('SRD', 2),
  ('SSP', 2), ('STN', 2), ('SVC', 2), ('SYP', 2), ('SZL', 2), ('THB', 2), ('TJS', 2), ('TMT', 2),
  ('TND', 3), ('TOP', 2), ('TRY', 2), ('TTD', 2), ('TWD', 2), ('TZS', 2), ('UAH', 2), ('UGX', 0),
  ('USD', 2), ('USN', 2), ('UYI', 0), ('UYU', 2), ('UYW', 4), ('UZS', 2), ('VED', 2), ('VES', 2),
  ('VND', 0), ('VUV', 0), ('WST', 2), ('XAD', 2), ('XAF', 0), ('XCD', 2), ('XCG', 2), ('XOF', 0),
  ('XPF', 0), ('YER', 2), ('ZAR', 2), ('ZMW', 2), ('ZWG', 2)
ON CONFLICT (code) DO UPDATE SET minor_digits = EXCLUDED.minor_digits;

CREATE OR REPLACE FUNCTION challenge_member_floor() RETURNS integer
LANGUAGE sql IMMUTABLE AS $$ SELECT 3 $$;

CREATE TABLE IF NOT EXISTS challenges (
  group_id uuid PRIMARY KEY REFERENCES groups (id),
  name text NOT NULL,
  type_kind text NOT NULL,
  custom_label text,
  currency char(3) NOT NULL REFERENCES currency_codes (code),
  stake_minor integer NOT NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  phase text NOT NULL,
  CONSTRAINT challenges_name_not_blank CHECK (char_length(btrim(name)) BETWEEN 1 AND 40),
  CONSTRAINT challenges_type_shape CHECK (
    (type_kind IN ('no_sugar', 'coding', 'writing') AND custom_label IS NULL)
    OR (type_kind = 'custom' AND custom_label IS NOT NULL AND char_length(btrim(custom_label)) BETWEEN 1 AND 40)
  ),
  CONSTRAINT challenges_stake_bounds CHECK (stake_minor BETWEEN 1 AND 1000000000),
  CONSTRAINT challenges_dates CHECK (ends_on >= starts_on),
  CONSTRAINT challenges_phase CHECK (phase IN ('draft', 'active'))
);

CREATE TABLE IF NOT EXISTS logging_rhythms (
  group_id uuid NOT NULL,
  user_id uuid NOT NULL,
  kind text NOT NULL,
  anchor_on date NOT NULL,
  PRIMARY KEY (group_id, user_id),
  CONSTRAINT logging_rhythms_membership
    FOREIGN KEY (group_id, user_id) REFERENCES memberships (group_id, user_id),
  CONSTRAINT logging_rhythms_challenge
    FOREIGN KEY (group_id) REFERENCES challenges (group_id),
  CONSTRAINT logging_rhythms_kind CHECK (
    kind IN ('every_day', 'every_2_days', 'every_3_days', 'alternate_days')
  )
);

CREATE OR REPLACE FUNCTION challenges_reject_early_start() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  active_count integer;
BEGIN
  PERFORM 1 FROM groups WHERE id = NEW.group_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'group_missing' USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO active_count
  FROM active_memberships
  WHERE group_id = NEW.group_id;
  IF active_count < challenge_member_floor() OR active_count > active_member_cap() THEN
    RAISE EXCEPTION 'outside_headcount' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS challenges_reject_early_start ON challenges;
CREATE TRIGGER challenges_reject_early_start
  BEFORE INSERT OR UPDATE OF phase ON challenges
  FOR EACH ROW
  WHEN (NEW.phase = 'active')
  EXECUTE FUNCTION challenges_reject_early_start();

CREATE OR REPLACE FUNCTION challenges_reject_frozen_terms() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.phase = 'active' AND (
    NEW.name IS DISTINCT FROM OLD.name
    OR NEW.type_kind IS DISTINCT FROM OLD.type_kind
    OR NEW.custom_label IS DISTINCT FROM OLD.custom_label
    OR NEW.currency IS DISTINCT FROM OLD.currency
    OR NEW.stake_minor IS DISTINCT FROM OLD.stake_minor
    OR NEW.starts_on IS DISTINCT FROM OLD.starts_on
    OR NEW.ends_on IS DISTINCT FROM OLD.ends_on
  ) THEN
    RAISE EXCEPTION 'frozen' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.phase = 'draft'
    AND (NEW.starts_on IS DISTINCT FROM OLD.starts_on OR NEW.ends_on IS DISTINCT FROM OLD.ends_on)
    AND EXISTS (
      SELECT 1 FROM logging_rhythms
      WHERE group_id = NEW.group_id AND anchor_on > NEW.ends_on
    ) THEN
    RAISE EXCEPTION 'anchor_after_end' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS challenges_reject_frozen_terms ON challenges;
CREATE TRIGGER challenges_reject_frozen_terms
  BEFORE UPDATE OF name, type_kind, custom_label, currency, stake_minor, starts_on, ends_on
  ON challenges
  FOR EACH ROW
  EXECUTE FUNCTION challenges_reject_frozen_terms();

CREATE OR REPLACE FUNCTION logging_rhythms_share_challenge() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  terms challenges%ROWTYPE;
BEGIN
  SELECT * INTO terms FROM challenges WHERE group_id = NEW.group_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no_challenge' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.anchor_on > terms.ends_on THEN
    RAISE EXCEPTION 'anchor_after_end' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'UPDATE' AND terms.phase = 'active' AND (
    NEW.kind IS DISTINCT FROM OLD.kind OR NEW.anchor_on IS DISTINCT FROM OLD.anchor_on
  ) THEN
    RAISE EXCEPTION 'frozen' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS logging_rhythms_guard ON logging_rhythms;
DROP FUNCTION IF EXISTS logging_rhythms_guard();
DROP TRIGGER IF EXISTS logging_rhythms_share_challenge ON logging_rhythms;
CREATE TRIGGER logging_rhythms_share_challenge
  BEFORE INSERT OR UPDATE ON logging_rhythms
  FOR EACH ROW
  EXECUTE FUNCTION logging_rhythms_share_challenge();
