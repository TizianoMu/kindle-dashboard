ALTER TABLE public.challenge_daily_logs
  ADD COLUMN IF NOT EXISTS participant TEXT,
  ADD COLUMN IF NOT EXISTS steps INTEGER NOT NULL DEFAULT 0
    CHECK (steps >= 0);

UPDATE public.challenge_daily_logs
SET participant = 'tiziano'
WHERE participant IS NULL;

ALTER TABLE public.challenge_daily_logs
  ALTER COLUMN participant SET DEFAULT 'tiziano',
  ALTER COLUMN participant SET NOT NULL;

ALTER TABLE public.challenge_daily_logs
  DROP CONSTRAINT IF EXISTS challenge_daily_logs_participant_check;

ALTER TABLE public.challenge_daily_logs
  ADD CONSTRAINT challenge_daily_logs_participant_check
  CHECK (participant IN ('gaia', 'tiziano'));

ALTER TABLE public.challenge_daily_logs
  DROP CONSTRAINT IF EXISTS challenge_daily_logs_pkey;

ALTER TABLE public.challenge_daily_logs
  ADD CONSTRAINT challenge_daily_logs_pkey PRIMARY KEY (date, participant);

CREATE INDEX IF NOT EXISTS challenge_daily_logs_participant_date_idx
  ON public.challenge_daily_logs (participant, date DESC);
