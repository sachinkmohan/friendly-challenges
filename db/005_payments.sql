DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'challenges_group_currency') THEN
    ALTER TABLE challenges ADD CONSTRAINT challenges_group_currency UNIQUE (group_id, currency);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION payment_minor_cap() RETURNS bigint
LANGUAGE sql IMMUTABLE AS $$ SELECT 1000000000000::bigint $$;

-- A payment happened outside the app. The app records it and never moves money.
CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY,
  group_id uuid NOT NULL,
  payer_id uuid NOT NULL,
  payee_id uuid NOT NULL,
  amount_minor bigint NOT NULL,
  currency char(3) NOT NULL,
  paid_on date NOT NULL,
  paypal_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payments_payer_membership
    FOREIGN KEY (group_id, payer_id) REFERENCES memberships (group_id, user_id),
  CONSTRAINT payments_payee_membership
    FOREIGN KEY (group_id, payee_id) REFERENCES memberships (group_id, user_id),
  CONSTRAINT payments_challenge_currency
    FOREIGN KEY (group_id, currency) REFERENCES challenges (group_id, currency),
  CONSTRAINT payments_two_people CHECK (payer_id <> payee_id),
  CONSTRAINT payments_amount_bounds CHECK (amount_minor BETWEEN 1 AND payment_minor_cap()),
  CONSTRAINT payments_paypal_ref_shape CHECK (
    paypal_ref IS NULL OR char_length(btrim(paypal_ref)) BETWEEN 1 AND 64
  )
);

CREATE INDEX IF NOT EXISTS payments_group_id_idx ON payments (group_id);
