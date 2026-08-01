ALTER TABLE public.challenge_daily_logs
  ADD COLUMN IF NOT EXISTS sports TEXT NOT NULL DEFAULT '';
