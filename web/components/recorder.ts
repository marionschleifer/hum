import { h, toast } from "../dom.ts";

export function recordButton(label: string, onAudio: (audio: Blob) => Promise<void>): HTMLButtonElement {
  let recorder: MediaRecorder | undefined;
  const button = h("button", { type: "button", class: "icon-btn", "aria-label": label }, micIcon());
  button.addEventListener("click", async () => {
    if (recorder?.state === "recording") {
      recorder.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      recorder = new MediaRecorder(stream);
      recorder.addEventListener("dataavailable", (event) => chunks.push(event.data));
      recorder.addEventListener("stop", async () => {
        stream.getTracks().forEach((track) => track.stop());
        button.classList.remove("recording");
        button.setAttribute("aria-label", label);
        await onAudio(new Blob(chunks, { type: recorder?.mimeType || "audio/mp4" }));
      });
      recorder.start();
      button.classList.add("recording");
      button.setAttribute("aria-label", "Stop recording");
    } catch (error) {
      toast(`Microphone unavailable: ${(error as Error).message}`, "error");
    }
  });
  return button;
}

export function icon(paths: string): SVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "20");
  svg.setAttribute("height", "20");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = paths;
  return svg;
}

function micIcon(): SVGElement {
  return icon('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>');
}
