export type GmailMessage = {
  id: string;
  internalDate: string;
  labelIds?: string[];
  snippet?: string;
  payload?: { headers?: { name: string; value: string }[] };
};

export type GmailThread = { id: string; messages?: GmailMessage[] };

export type Address = { name?: string; email: string };

export type MailCandidate = {
  kind: "waiting" | "unanswered";
  account: string;
  threadId: string;
  messageId: string;
  counterpart: Address;
  subject: string;
  snippet: string;
  at: string;
};

export const WAIT_DAYS = 10;
export const WAIT_MAX_DAYS = 30;
export const REPLY_DAYS = 2;
export const REPLY_MAX_DAYS = 14;

const DAY_MS = 86_400_000;
const AUTOMATED = /(^|[.+_-])(no-?reply|do-?not-?reply|notifications?|mailer-daemon|bounces?|postmaster)([.+_-]|@)/i;

export function classifyThread(thread: GmailThread, account: string, now: Date): MailCandidate | undefined {
  const messages = [...(thread.messages ?? [])].sort((a, b) => Number(a.internalDate) - Number(b.internalDate));
  const last = messages.at(-1);
  if (!last) return undefined;
  const age = (now.getTime() - Number(last.internalDate)) / DAY_MS;
  const base = {
    account,
    threadId: thread.id,
    messageId: last.id,
    subject: header(last, "Subject")?.trim() || "(no subject)",
    snippet: decodeEntities(last.snippet ?? ""),
    at: new Date(Number(last.internalDate)).toISOString(),
  };
  if (fromMe(last, account)) {
    if (age < WAIT_DAYS || age > WAIT_MAX_DAYS) return undefined;
    const counterpart = recipients(last).find((address) => address.email !== account.toLowerCase() && !isAutomated(address));
    return counterpart ? { kind: "waiting", counterpart, ...base } : undefined;
  }
  if (age < REPLY_DAYS || age > REPLY_MAX_DAYS || !last.labelIds?.includes("INBOX") || isBulk(last)) return undefined;
  const sender = parseAddress(header(last, "From") ?? "");
  return sender && !isAutomated(sender) ? { kind: "unanswered", counterpart: sender, ...base } : undefined;
}

export function parseAddress(value: string): Address | undefined {
  const first = value.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)[0]?.trim() ?? "";
  const angled = /^(.*)<([^>]+)>$/.exec(first);
  const email = (angled ? angled[2]! : first).trim().toLowerCase();
  if (!email.includes("@")) return undefined;
  const name = angled?.[1]?.trim().replace(/^"|"$/g, "").trim();
  return name ? { name, email } : { email };
}

function recipients(message: GmailMessage): Address[] {
  return ["To", "Cc"]
    .flatMap((name) => (header(message, name) ?? "").split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/))
    .flatMap((part) => parseAddress(part) ?? []);
}

function fromMe(message: GmailMessage, account: string): boolean {
  return message.labelIds?.includes("SENT") === true || parseAddress(header(message, "From") ?? "")?.email === account.toLowerCase();
}

function isAutomated(address: Address): boolean {
  return AUTOMATED.test(address.email.split("@")[0]! + "@");
}

function isBulk(message: GmailMessage): boolean {
  if (header(message, "List-Unsubscribe") || header(message, "List-Id")) return true;
  const auto = header(message, "Auto-Submitted")?.toLowerCase();
  if (auto && auto !== "no") return true;
  return /^(bulk|list|junk)$/i.test(header(message, "Precedence")?.trim() ?? "");
}

function header(message: GmailMessage, name: string): string | undefined {
  return message.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;
}

function decodeEntities(text: string): string {
  return text.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}
