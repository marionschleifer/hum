import { h, mount, toast } from "../dom.ts";
import { loginWithPasskey, registerPasskey } from "../passkey.ts";

export function renderLogin(root: HTMLElement, hasPasskey: boolean, onDone: () => void): void {
  const setupToken = h("input", { type: "password", placeholder: "Setup token", "aria-label": "Setup token", autocomplete: "off" });
  const run = (action: () => Promise<void>) => async () => {
    try {
      await action();
      onDone();
    } catch (error) {
      toast((error as Error).message, "error");
    }
  };
  const setup = h(
    "div",
    { style: "display:grid;gap:10px;margin-top:24px;text-align:left" },
    h("p", { class: "muted" }, "First time here? Enter the HUM_SETUP_TOKEN from the server's environment to create your passkey."),
    setupToken,
    h(
      "button",
      { class: "btn", onclick: run(() => registerPasskey(deviceLabel(), setupToken.value)) },
      "Create passkey",
    ),
  );
  mount(
    root,
    h(
      "main",
      { class: "login" },
      h("h1", {}, "Hum"),
      h("p", { class: "muted" }, "Your day, by theme."),
      hasPasskey
        ? h("button", { class: "btn primary", style: "width:100%", onclick: run(loginWithPasskey) }, "Sign in with passkey")
        : undefined,
      hasPasskey ? h("details", { style: "margin-top:24px" }, h("summary", { class: "muted" }, "New device"), setup) : setup,
    ),
  );
}

function deviceLabel(): string {
  return /iPhone|iPad/.test(navigator.userAgent) ? "iPhone" : /Mac/.test(navigator.userAgent) ? "Mac" : "Passkey";
}
