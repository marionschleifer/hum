type AddOptions = { url: string; token?: string; fetch?: typeof fetch; today?: string };

export async function addTask(text: string, options: AddOptions): Promise<string> {
  if (!options.token) throw new Error("Set HUM_API_TOKEN (create one in Hum under Settings, iOS Shortcut)");
  if (!text.trim()) throw new Error('Usage: bun run add "<task>"');
  const send = options.fetch ?? fetch;
  const response = await send(`${options.url.replace(/\/$/, "")}/api/cli/capture`, {
    method: "POST",
    headers: { authorization: `Bearer ${options.token}`, "content-type": "application/json" },
    body: JSON.stringify({ text, today: options.today ?? new Date().toLocaleDateString("en-CA") }),
  });
  const body = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
  if (!response.ok) throw new Error(body.error ?? `Hum answered ${response.status}`);
  return body.message ?? "Added.";
}

if (import.meta.main) {
  try {
    console.log(
      await addTask(process.argv.slice(2).join(" "), {
        url: process.env.HUM_URL ?? process.env.HUM_ORIGIN ?? "http://localhost:3000",
        token: process.env.HUM_API_TOKEN,
      }),
    );
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}
