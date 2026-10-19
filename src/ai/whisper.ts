import type { Transcribe } from "./types.ts";

type WhisperOptions = { apiKey: string; model: string; fetch?: typeof fetch };

export function createTranscribe(options: WhisperOptions): Transcribe {
  const send = options.fetch ?? fetch;
  return async (audio) => {
    const form = new FormData();
    form.append("file", audio, fileName(audio.type));
    form.append("model", options.model);
    form.append("language", "en");
    const response = await send("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { authorization: `Bearer ${options.apiKey}` },
      body: form,
    });
    const body = (await response.json()) as { text?: string; error?: { message?: string } };
    if (!response.ok) throw new Error(`Whisper ${response.status}: ${body.error?.message ?? "unknown error"}`);
    return (body.text ?? "").trim();
  };
}

function fileName(type: string): string {
  if (type.includes("mp4") || type.includes("m4a") || type.includes("aac")) return "audio.m4a";
  if (type.includes("ogg")) return "audio.ogg";
  if (type.includes("wav")) return "audio.wav";
  if (type.includes("mpeg") || type.includes("mp3")) return "audio.mp3";
  return "audio.webm";
}
