ALTER TABLE public.challenge_daily_logs
  ADD COLUMN IF NOT EXISTS workout_minutes INTEGER NOT NULL DEFAULT 0
    CHECK (workout_minutes >= 0),
  ADD COLUMN IF NOT EXISTS sport_minutes JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.participant_fitness_settings (
  participant TEXT PRIMARY KEY CHECK (participant IN ('gaia', 'tiziano')),
  steps_target INTEGER NOT NULL DEFAULT 10000 CHECK (steps_target > 0),
  weekly_workout_target INTEGER NOT NULL DEFAULT 3 CHECK (weekly_workout_target > 0),
  rest_weekdays TEXT NOT NULL DEFAULT '',
  reminders_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  reminder_hour INTEGER NOT NULL DEFAULT 20 CHECK (reminder_hour BETWEEN 0 AND 23),
  last_reminder_date DATE,
  last_weekly_summary_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.participant_fitness_settings (participant)
VALUES ('gaia'), ('tiziano')
ON CONFLICT (participant) DO NOTHING;

DROP TRIGGER IF EXISTS participant_fitness_settings_updated_at
  ON public.participant_fitness_settings;
CREATE TRIGGER participant_fitness_settings_updated_at
  BEFORE UPDATE ON public.participant_fitness_settings
  FOR EACH ROW
  EXECUTE FUNCTION system.update_updated_at();

ALTER TABLE public.participant_fitness_settings ENABLE ROW LEVEL SECURITY;
