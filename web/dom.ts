type Child = Node | string | undefined | false;
type Children = Child | Children[];
type Attrs = Record<string, string | number | boolean | undefined | ((event: Event) => void)>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Children[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (typeof value === "function") element.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === "class") element.className = String(value);
    else if (key === "value" && "value" in element) (element as HTMLInputElement).value = String(value);
    else if (key === "checked" && element instanceof HTMLInputElement) element.checked = Boolean(value);
    else element.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of flatten(children)) {
    element.append(child);
  }
  return element;
}

export function mount(target: HTMLElement, ...children: Children[]): void {
  target.replaceChildren(...flatten(children));
}

function flatten(children: Children[]): (Node | string)[] {
  return (children.flat(Infinity) as Child[]).filter((c): c is Node | string => c !== undefined && c !== false);
}

export function toast(message: string, kind: "info" | "error" = "info"): void {
  document.querySelector(".toast")?.remove();
  const element = h("div", { class: `toast ${kind === "error" ? "error" : ""}`, role: "status" }, message);
  document.body.append(element);
  setTimeout(() => element.remove(), kind === "error" ? 5000 : 3000);
}

export function today(): string {
  return new Date().toLocaleDateString("en-CA");
}

export function formatDay(day: string): string {
  const date = new Date(`${day}T12:00:00`);
  const diff = Math.round((date.getTime() - new Date(`${today()}T12:00:00`).getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff < 0) return `${-diff} days overdue`;
  if (diff < 7) return date.toLocaleDateString("en-GB", { weekday: "long" });
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function timeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}
