export type Config = {
  origin: string;
  rpId: string;
  port: number;
  dbPath: string;
  ownerName?: string;
  setupToken?: string;
  anthropicApiKey?: string;
  captureModel: string;
  openaiApiKey?: string;
  transcribeModel: string;
  todoistApiToken?: string;
  planningModel: string;
  googleClientId?: string;
  googleClientSecret?: string;
};

export function readConfig(env: Record<string, string | undefined>): Config {
  const origin = (env.HUM_ORIGIN ?? "http://localhost:3000").replace(/\/$/, "");
  return {
    origin,
    rpId: new URL(origin).hostname,
    port: Number(env.PORT ?? 3000),
    dbPath: env.HUM_DB_PATH ?? "data/hum.sqlite",
    ownerName: present(env.HUM_OWNER_NAME),
    setupToken: present(env.HUM_SETUP_TOKEN),
    anthropicApiKey: present(env.ANTHROPIC_API_KEY),
    captureModel: present(env.HUM_CAPTURE_MODEL) ?? "claude-sonnet-5-5",
    openaiApiKey: present(env.OPENAI_API_KEY),
    transcribeModel: present(env.HUM_TRANSCRIBE_MODEL) ?? "whisper-1",
    todoistApiToken: present(env.TODOIST_API_TOKEN),
    planningModel: present(env.HUM_PLANNING_MODEL) ?? "claude-opus-5-5",
    googleClientId: present(env.GOOGLE_CLIENT_ID),
    googleClientSecret: present(env.GOOGLE_CLIENT_SECRET),
  };
}

function present(value: string | undefined): string | undefined {
  return value && value.trim() !== "" ? value.trim() : undefined;
}
