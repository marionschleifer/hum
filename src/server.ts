import index from "../web/index.html";
import { createStructureCapture } from "./ai/claude.ts";
import { createFindLearning, createSuggestForTasks } from "./ai/evening.ts";
import { createChoosePlan, createParseBudgets } from "./ai/planning.ts";
import { createTranscribe } from "./ai/whisper.ts";
import { createApp } from "./app.ts";
import { readConfig } from "./config.ts";
import { openDatabase } from "./db/open.ts";
import { createGoogleApi } from "./google/google.ts";
import { createTodoistFetcher } from "./import/todoist.ts";

const config = readConfig(process.env);
const ctx = { db: openDatabase(config.dbPath), now: () => new Date(), newId: () => crypto.randomUUID() };

const app = createApp({
  ctx,
  config,
  structure: config.anthropicApiKey
    ? createStructureCapture({ apiKey: config.anthropicApiKey, model: config.captureModel, ownerName: config.ownerName })
    : undefined,
  transcribe: config.openaiApiKey
    ? createTranscribe({ apiKey: config.openaiApiKey, model: config.transcribeModel })
    : undefined,
  fetchTodoist: config.todoistApiToken ? createTodoistFetcher(config.todoistApiToken) : undefined,
  google: googleDeps(),
  choosePlan: config.anthropicApiKey
    ? createChoosePlan({ apiKey: config.anthropicApiKey, model: config.planningModel, ownerName: config.ownerName })
    : undefined,
  parseBudgets: config.anthropicApiKey
    ? createParseBudgets({ apiKey: config.anthropicApiKey, model: config.captureModel, ownerName: config.ownerName })
    : undefined,
  suggest: config.anthropicApiKey
    ? createSuggestForTasks({ apiKey: config.anthropicApiKey, model: config.planningModel, ownerName: config.ownerName })
    : undefined,
  findLearning: config.anthropicApiKey
    ? createFindLearning({ apiKey: config.anthropicApiKey, model: config.planningModel, ownerName: config.ownerName })
    : undefined,
});

const server = Bun.serve({
  port: config.port,
  development: process.env.NODE_ENV !== "production",
  routes: {
    "/": index,
    "/sw.js": staticFile("web/sw.js", "text/javascript"),
    "/manifest.webmanifest": staticFile("web/manifest.webmanifest", "application/manifest+json"),
    "/icon.svg": staticFile("web/icon.svg", "image/svg+xml"),
  },
  fetch: async (request) => (await app.fetch(request)) ?? new Response("Not found", { status: 404 }),
});

console.log(`Hum is running at ${server.url} (passkeys bound to ${config.origin})`);
if (!config.anthropicApiKey) console.log("ANTHROPIC_API_KEY is not set: captures go straight to the inbox.");
if (!config.openaiApiKey) console.log("OPENAI_API_KEY is not set: voice capture is off.");
if (!config.googleClientId || !config.googleClientSecret) console.log("GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is not set: calendar is off.");

function googleDeps() {
  if (!config.googleClientId || !config.googleClientSecret) return undefined;
  const oauth = {
    clientId: config.googleClientId,
    clientSecret: config.googleClientSecret,
    redirectUri: `${config.origin}/api/google/callback`,
  };
  return { oauth, api: createGoogleApi(ctx, oauth) };
}

function staticFile(path: string, type: string): Response {
  return new Response(Bun.file(new URL(`../${path}`, import.meta.url).pathname), {
    headers: { "content-type": type, "cache-control": "no-cache" },
  });
}
