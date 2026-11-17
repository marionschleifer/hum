import { parseDuration } from "../../src/planning/duration.ts";
import { formatMinutes, h, toast } from "../dom.ts";

export function minutesField(options: { minutes: number; label: string; onChange: (minutes: number) => void }): HTMLInputElement {
  const shown = options.minutes ? formatMinutes(options.minutes) : "";
  const input = h("input", {
    type: "text",
    class: "minutes-field",
    inputmode: "decimal",
    autocomplete: "off",
    placeholder: "0",
    value: shown,
    "aria-label": options.label,
  });
  input.addEventListener("focus", () => input.select());
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      input.blur();
    }
  });
  input.addEventListener("change", () => {
    const minutes = parseDuration(input.value);
    if (minutes === undefined) {
      toast("Type hours like 2, 1.5, 1h30 or 45m", "error");
      input.value = shown;
      return;
    }
    options.onChange(minutes);
  });
  return input;
}
