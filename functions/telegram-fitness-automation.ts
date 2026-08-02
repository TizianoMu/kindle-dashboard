import { createAdminClient } from "npm:@insforge/sdk";

type Participant = "gaia" | "tiziano";
type Settings = {
  participant: Participant;
  steps_target: number;
  weekly_workout_target: number;
  rest_weekdays: string;
  reminders_enabled: boolean;
  reminder_hour: number;
  last_reminder_date: string | null;
  last_weekly_summary_date: string | null;
};

export default async function(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  if (req.headers.get("x-automation-token") !== requiredEnv("TELEGRAM_WEBHOOK_SECRET")) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  const admin = createAdminClient({
    baseUrl: requiredEnv("INSFORGE_BASE_URL"),
    apiKey: requiredEnv("INSFORGE_API_KEY")
  });
  const now = romeNow();
  const { data, error } = await admin.database
    .from("participant_fitness_settings")
    .select("participant,steps_target,weekly_workout_target,rest_weekdays,reminders_enabled,reminder_hour,last_reminder_date,last_weekly_summary_date")
    .in("participant", ["gaia", "tiziano"]);
  if (error) return json({ ok: false, error: errorMessage(error) }, 500);

  const results: string[] = [];
  for (const settings of (data ?? []) as Settings[]) {
    const chatId = requiredEnv(settings.participant === "gaia" ? "TELEGRAM_GAIA_CHAT_ID" : "TELEGRAM_TIZIANO_CHAT_ID");
    if (settings.reminders_enabled && now.hour === Number(settings.reminder_hour) && settings.last_reminder_date !== now.date) {
      const today = await dailyRow(admin, settings.participant, now.date);
      const isRestDay = parseWeekdays(settings.rest_weekdays).has(now.weekday);
      const missing = [
        Number(today?.steps ?? 0) < Number(settings.steps_target) ? `passi ${Number(today?.steps ?? 0)}/${settings.steps_target}` : "",
        !isRestDay && Number(today?.workouts ?? 0) === 0 ? "allenamento non registrato" : ""
      ].filter(Boolean);
      if (missing.length > 0) await sendTelegram(chatId, `PROMEMORIA ${participantName(settings.participant)}\n${missing.join("\n")}`);
      await updateSettings(admin, settings.participant, { last_reminder_date: now.date });
      results.push(`reminder:${settings.participant}`);
    }

    if (now.weekday === 0 && now.hour === 20 && settings.last_weekly_summary_date !== now.date) {
      const week = await weeklyRows(admin, settings.participant, now.date);
      const workouts = week.reduce((sum, row) => sum + Math.max(0, Number(row.workouts) || 0), 0);
      const steps = week.reduce((sum, row) => sum + Math.max(0, Number(row.steps) || 0), 0);
      const minutes = week.reduce((sum, row) => sum + Math.max(0, Number(row.workout_minutes) || 0), 0);
      await sendTelegram(chatId, [
        `SETTIMANA ${participantName(settings.participant).toUpperCase()}`,
        `Allenamenti: ${workouts} / ${settings.weekly_workout_target}`,
        `Tempo: ${minutes} minuti`,
        `Passi: ${new Intl.NumberFormat("it-IT").format(steps)}`
      ].join("\n"));
      await updateSettings(admin, settings.participant, { last_weekly_summary_date: now.date });
      results.push(`weekly:${settings.participant}`);
    }
  }
  return json({ ok: true, results });
}

async function dailyRow(admin: any, participant: Participant, date: string): Promise<any> {
  const { data, error } = await admin.database.from("challenge_daily_logs")
    .select("steps,workouts").eq("participant", participant).eq("date", date).limit(1);
  if (error) throw error;
  return Array.isArray(data) ? data[0] : null;
}

async function weeklyRows(admin: any, participant: Participant, date: string): Promise<any[]> {
  const start = addDays(date, -6);
  const { data, error } = await admin.database.from("challenge_daily_logs")
    .select("steps,workouts,workout_minutes").eq("participant", participant)
    .gte("date", start).lte("date", date);
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

async function updateSettings(admin: any, participant: Participant, values: Record<string, unknown>): Promise<void> {
  const { error } = await admin.database.from("participant_fitness_settings").update(values).eq("participant", participant);
  if (error) throw error;
}

function romeNow(): { date: string; hour: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", hourCycle: "h23", weekday: "short"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { date: `${values.year}-${values.month}-${values.day}`, hour: Number(values.hour), weekday: weekdays[values.weekday] };
}

function addDays(date: string, offset: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + offset)).toISOString().slice(0, 10);
}
function parseWeekdays(value: string): Set<number> { return new Set(String(value).split(",").filter(Boolean).map(Number)); }
function participantName(value: Participant): string { return value === "gaia" ? "Gaia" : "Tiziano"; }
async function sendTelegram(chatId: string, text: string): Promise<void> {
  const response = await fetch(`https://api.telegram.org/bot${requiredEnv("TELEGRAM_BOT_TOKEN")}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chatId, text })
  });
  if (!response.ok) throw new Error(`Telegram send failed: ${response.status}`);
}
function requiredEnv(key: string): string { const value = Deno.env.get(key); if (!value) throw new Error(`Missing ${key}`); return value; }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
