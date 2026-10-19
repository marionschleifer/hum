import { api, type CaptureResponse } from "../api.ts";
import { h, toast, today } from "../dom.ts";
import { refresh } from "../state.ts";
import { icon, recordButton } from "./recorder.ts";

export function quickAdd(): HTMLElement {
  const input = h("input", {
    type: "text",
    placeholder: "Add anything, Hum sorts it",
    "aria-label": "Quick add",
    enterkeyhint: "send",
    autocomplete: "off",
  });

  const send = async (body: { text: string } | FormData) => {
    try {
      const result =
        body instanceof FormData
          ? await api<CaptureResponse>("POST", "/api/capture/voice", body)
          : await api<CaptureResponse>("POST", "/api/capture", { ...body, today: today() });
      toast(result.usedFallback ? "Saved to the inbox" : result.message);
      await refresh();
    } catch (error) {
      toast((error as Error).message, "error");
    }
  };

  const submit = async (event: Event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    input.disabled = true;
    await send({ text });
    input.disabled = false;
    input.focus();
  };

  const mic = recordButton("Record a voice note", async (audio) => {
    const form = new FormData();
    form.append("audio", audio, "voice");
    form.append("today", today());
    toast("Listening back...");
    await send(form);
  });

  return h(
    "form",
    { class: "quick-add", onsubmit: submit },
    input,
    mic,
    h("button", { type: "submit", class: "icon-btn", "aria-label": "Add" }, icon('<path d="M5 12h14M13 6l6 6-6 6"/>')),
  );
}
