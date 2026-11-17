import type { JudgeMail } from "../ai/mail.ts";
import { isoNow, type Ctx } from "../context.ts";
import type { GoogleApi } from "../google/google.ts";
import { completeTask, createTask } from "../tasks/tasks.ts";
import { mailSettings, type MailAccount } from "./settings.ts";
import { classifyThread, REPLY_DAYS, REPLY_MAX_DAYS, WAIT_DAYS, WAIT_MAX_DAYS, type Address, type GmailThread, type MailCandidate } from "./threads.ts";

export type MailDeps = {
  ctx: Ctx;
  api?: GoogleApi;
  judge?: JudgeMail;
  now?: () => Date;
  log?: (message: string, error: unknown) => void;
};

export type AccountRun = { email: string; checked: number; created: number; closed: number; error?: string };

export type MailRun = { at: string; accounts: AccountRun[] };

type Verdict = { task: boolean; reason: string };

const LAST_RUN_KEY = "mail_last_run";
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const THREADS_PER_QUERY = "50";
const SUBJECT_LENGTH = 80;
const QUERIES = [
  `in:sent older_than:${WAIT_DAYS}d newer_than:${WAIT_MAX_DAYS + 1}d`,
  `in:inbox older_than:${REPLY_DAYS}d newer_than:${REPLY_MAX_DAYS + 1}d -category:promotions -category:social -category:updates -category:forums`,
];

export async function runMailCheck(deps: MailDeps, today: string): Promise<MailRun> {
  const settings = mailSettings(deps.ctx);
  const accounts: AccountRun[] = [];
  for (const account of settings.accounts) {
    try {
      accounts.push(await checkAccount(deps, account, settings.important, settings.stakes, today));
    } catch (error) {
      (deps.log ?? console.error)(`Mail check failed for ${account.email}`, error);
      accounts.push({ email: account.email, checked: 0, created: 0, closed: 0, error: error instanceof Error ? error.message : String(error) });
    }
  }
  const run = { at: isoNow(deps.ctx), accounts };
  deps.ctx.db
    .query("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(LAST_RUN_KEY, JSON.stringify(run));
  return run;
}

export function lastMailRun(ctx: Ctx): MailRun | undefined {
  const row = ctx.db.query<{ value: string }, [string]>("SELECT value FROM meta WHERE key = ?").get(LAST_RUN_KEY);
  return row ? (JSON.parse(row.value) as MailRun) : undefined;
}

async function checkAccount(deps: MailDeps, account: MailAccount, important: string[], stakes: string, today: string): Promise<AccountRun> {
  const api = deps.api ?? fail("Google is not set up");
  const now = (deps.now ?? (() => new Date()))();
  const closed = await closeFinished(deps.ctx, api, account.email, today);
  const ids = new Set<string>();
  for (const q of QUERIES) {
    const list = await api.get<{ threads?: { id: string }[] }>(account.email, `${GMAIL}/threads?${new URLSearchParams({ q, maxResults: THREADS_PER_QUERY })}`);
    for (const thread of list.threads ?? []) ids.add(thread.id);
  }
  const candidates: MailCandidate[] = [];
  for (const id of ids) {
    const candidate = classifyThread(await getThread(api, account.email, id), account.email, now);
    if (candidate) candidates.push(candidate);
  }
  const fresh = candidates.filter((candidate) => !hasTask(deps.ctx, candidate));
  const verdicts = await decide(deps, fresh, important, stakes, today);
  let created = 0;
  for (const candidate of fresh) {
    const verdict = verdicts.get(key(candidate));
    if (!verdict?.task) continue;
    createMailTask(deps.ctx, account, candidate, verdict.reason);
    created++;
  }
  return { email: account.email, checked: candidates.length, created, closed };
}

async function decide(deps: MailDeps, candidates: MailCandidate[], important: string[], stakes: string, today: string): Promise<Map<string, Verdict>> {
  const verdicts = new Map<string, Verdict>();
  const toJudge: MailCandidate[] = [];
  for (const candidate of candidates) {
    const remembered = rememberedVerdict(deps.ctx, candidate);
    if (candidate.kind === "unanswered" && isImportant(candidate.counterpart, important)) {
      verdicts.set(key(candidate), { task: true, reason: `${displayName(candidate.counterpart)} is on your Always important list.` });
    } else if (remembered) {
      verdicts.set(key(candidate), remembered);
    } else {
      toJudge.push(candidate);
    }
  }
  if (toJudge.length === 0 || !deps.judge) return verdicts;
  try {
    const raw = (await deps.judge({
      today,
      stakes,
      items: toJudge.map((candidate) => ({
        id: judgeId(candidate),
        kind: candidate.kind,
        from: candidate.kind === "waiting" ? "me" : formatAddress(candidate.counterpart),
        to: candidate.kind === "waiting" ? formatAddress(candidate.counterpart) : "me",
        subject: candidate.subject,
        snippet: candidate.snippet,
        at: candidate.at.slice(0, 10),
      })),
    })) as { verdicts?: { id?: unknown; task?: unknown; reason?: unknown }[] };
    for (const item of Array.isArray(raw?.verdicts) ? raw.verdicts : []) {
      const candidate = toJudge.find((c) => judgeId(c) === item?.id);
      if (!candidate || typeof item.task !== "boolean") continue;
      const verdict = { task: item.task, reason: typeof item.reason === "string" && item.reason.trim() ? item.reason.trim() : "Claude flagged this mail." };
      remember(deps.ctx, candidate, verdict);
      verdicts.set(key(candidate), verdict);
    }
  } catch (error) {
    (deps.log ?? console.error)("Claude could not judge the mails, trying again next time", error);
  }
  return verdicts;
}

async function closeFinished(ctx: Ctx, api: GoogleApi, account: string, today: string): Promise<number> {
  const open = ctx.db
    .query<{ id: string; source_ref: string }, [string, string]>(
      "SELECT id, source_ref FROM tasks WHERE source = 'gmail' AND status IN ('open', 'inbox') AND (source_ref LIKE ? OR source_ref LIKE ?)",
    )
    .all(`waiting:${account}:%`, `unanswered:${account}:%`);
  let closed = 0;
  for (const task of open) {
    const [kind, , threadId] = splitRef(task.source_ref);
    const thread = await getThread(api, account, threadId).catch(() => undefined);
    if (!thread) continue;
    const lastFromMe = isLastFromMe(thread, account);
    if ((kind === "waiting" && !lastFromMe) || (kind === "unanswered" && lastFromMe)) {
      completeTask(ctx, task.id, today);
      closed++;
    }
  }
  return closed;
}

function createMailTask(ctx: Ctx, account: MailAccount, candidate: MailCandidate, reason: string): void {
  const subject = candidate.subject.length > SUBJECT_LENGTH ? `${candidate.subject.slice(0, SUBJECT_LENGTH - 1)}…` : candidate.subject;
  const verb = candidate.kind === "waiting" ? "Follow up with" : "Reply to";
  createTask(ctx, {
    title: `${verb} ${displayName(candidate.counterpart)}: ${subject}`,
    notes: `${reason}\n\nOpen in Gmail: https://mail.google.com/mail/u/${account.email}/#all/${candidate.threadId}`,
    themeId: account.themeId,
    size: "S",
    source: "gmail",
    sourceRef: key(candidate),
  });
}

function getThread(api: GoogleApi, account: string, id: string): Promise<GmailThread> {
  const params = new URLSearchParams({ format: "metadata" });
  for (const name of ["From", "To", "Cc", "Subject", "List-Unsubscribe", "List-Id", "Auto-Submitted", "Precedence"]) params.append("metadataHeaders", name);
  return api.get<GmailThread>(account, `${GMAIL}/threads/${encodeURIComponent(id)}?${params}`);
}

function isLastFromMe(thread: GmailThread, account: string): boolean {
  const last = [...(thread.messages ?? [])].sort((a, b) => Number(a.internalDate) - Number(b.internalDate)).at(-1);
  if (!last) return false;
  const from = last.payload?.headers?.find((h) => h.name.toLowerCase() === "from")?.value ?? "";
  return last.labelIds?.includes("SENT") === true || from.toLowerCase().includes(account.toLowerCase());
}

function hasTask(ctx: Ctx, candidate: MailCandidate): boolean {
  return ctx.db.query("SELECT 1 FROM tasks WHERE source = 'gmail' AND source_ref = ?").get(key(candidate)) !== null;
}

function rememberedVerdict(ctx: Ctx, candidate: MailCandidate): Verdict | undefined {
  const row = ctx.db
    .query<{ message_id: string; task: number; reason: string }, [string, string, string]>(
      "SELECT message_id, task, reason FROM mail_checks WHERE account = ? AND thread_id = ? AND kind = ?",
    )
    .get(candidate.account, candidate.threadId, candidate.kind);
  return row && row.message_id === candidate.messageId ? { task: row.task === 1, reason: row.reason } : undefined;
}

function remember(ctx: Ctx, candidate: MailCandidate, verdict: Verdict): void {
  ctx.db
    .query(
      `INSERT INTO mail_checks (account, thread_id, kind, message_id, task, reason, checked_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(account, thread_id, kind) DO UPDATE SET message_id = excluded.message_id, task = excluded.task,
         reason = excluded.reason, checked_at = excluded.checked_at`,
    )
    .run(candidate.account, candidate.threadId, candidate.kind, candidate.messageId, verdict.task ? 1 : 0, verdict.reason, isoNow(ctx));
}

function isImportant(address: Address, important: string[]): boolean {
  const name = address.name?.toLowerCase() ?? "";
  const domain = address.email.split("@")[1] ?? "";
  return important.some((entry) =>
    entry.includes("@") ? entry === address.email || (entry.startsWith("@") && entry.slice(1) === domain) : entry === domain || (name !== "" && name.includes(entry)),
  );
}

function key(candidate: MailCandidate): string {
  return `${candidate.kind}:${candidate.account}:${candidate.threadId}`;
}

function judgeId(candidate: MailCandidate): string {
  return `${candidate.kind}:${candidate.threadId}`;
}

function splitRef(ref: string): [string, string, string] {
  const [kind = "", ...rest] = ref.split(":");
  const threadId = rest.pop() ?? "";
  return [kind, rest.join(":"), threadId];
}

function displayName(address: Address): string {
  return address.name?.split(/\s+/)[0] || address.email;
}

function formatAddress(address: Address): string {
  return address.name ? `${address.name} <${address.email}>` : address.email;
}

function fail(message: string): never {
  throw new Error(message);
}
