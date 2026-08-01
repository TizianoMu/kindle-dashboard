import { execFileSync } from "node:child_process";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

const botToken = args.get("--bot-token") || process.env.TELEGRAM_BOT_TOKEN;
// One chat ID or a comma-separated list; the webhook accepts any of them.
const chatIds = (args.get("--chat-id") || process.env.TELEGRAM_ALLOWED_CHAT_ID || "")
  .split(",")
  .map((id) => id.trim())
  .filter((id) => id.length > 0);
const chatId = chatIds.join(",");
const baseUrl = args.get("--base-url") || process.env.INSFORGE_BASE_URL || "";
const webhookUrl =
  args.get("--webhook-url") ||
  process.env.TELEGRAM_WEBHOOK_URL ||
  (baseUrl ? `${baseUrl.replace(/\/+$/, "")}/functions/telegram-webhook` : "");

if (!botToken || !chatId || !webhookUrl) {
  console.error("Usage: npm run telegram:configure -- --bot-token <token> --chat-id <id>[,<id>...] --webhook-url <url>");
  process.exit(1);
}

// A malformed ID never matches, and the webhook answers 200 with
// reason="chat_not_allowed" — the bot just goes quiet. Catch it here instead.
const invalidIds = chatIds.filter((id) => !/^-?\d+$/.test(id));
if (invalidIds.length > 0) {
  console.error(`Invalid chat ID(s): ${invalidIds.join(", ")} (expected integers, negative for groups)`);
  process.exit(1);
}

setSecret("TELEGRAM_BOT_TOKEN", botToken);
setSecret("TELEGRAM_ALLOWED_CHAT_ID", chatId);

const webhookSecret = getSecret("TELEGRAM_WEBHOOK_SECRET");
const response = postTelegramWebhook(botToken, webhookUrl, webhookSecret);

if (!response.ok) {
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}

console.log(`Telegram webhook registered: ${webhookUrl}`);
console.log(`Allowed chat ID(s) set: ${chatIds.join(", ")}`);

function setSecret(key, value) {
  try {
    run(["secrets", "add", key, value]);
  } catch (error) {
    const output = String(error.stdout || "") + String(error.stderr || "") + String(error.message || "");
    if (!output.includes("Secret already exists")) {
      throw error;
    }
    run(["secrets", "update", key, "--value", value]);
  }
}

function getSecret(key) {
  const output = run(["secrets", "get", key, "--json"]);
  return JSON.parse(output).value;
}

function postTelegramWebhook(token, url, secretToken) {
  const body = new URLSearchParams({
    url,
    secret_token: secretToken,
    drop_pending_updates: "true"
  });

  const response = fetchSync(`https://api.telegram.org/bot${token}/setWebhook`, body);
  return JSON.parse(response);
}

function fetchSync(url, body) {
  return execFileSync(
    "curl",
    ["-sS", "--fail-with-body", "-X", "POST", url, "-H", "Content-Type: application/x-www-form-urlencoded", "--data", body.toString()],
    { encoding: "utf8" }
  );
}

function run(args) {
  return execFileSync("npx", ["@insforge/cli", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}
