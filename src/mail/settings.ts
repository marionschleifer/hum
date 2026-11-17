import { fail, type Ctx } from "../context.ts";
import { listThemes } from "../themes/themes.ts";

export type MailAccount = { email: string; themeId?: string };

export type MailSettings = { accounts: MailAccount[]; important: string[]; stakes: string };

const ACCOUNTS_KEY = "mail_accounts";
const IMPORTANT_KEY = "mail_important";
const STAKES_KEY = "mail_stakes";
const MAX_STAKES_LENGTH = 500;

export function mailSettings(ctx: Ctx): MailSettings {
  return {
    accounts: readJson<MailAccount[]>(ctx, ACCOUNTS_KEY) ?? [],
    important: readJson<string[]>(ctx, IMPORTANT_KEY) ?? [],
    stakes: readJson<string>(ctx, STAKES_KEY) ?? "",
  };
}

export function addMailAccount(ctx: Ctx, email: string): void {
  const accounts = mailSettings(ctx).accounts;
  if (!accounts.some((account) => account.email === email)) writeJson(ctx, ACCOUNTS_KEY, [...accounts, { email }]);
}

export function removeMailAccount(ctx: Ctx, email: string): void {
  writeJson(ctx, ACCOUNTS_KEY, mailSettings(ctx).accounts.filter((account) => account.email !== email));
}

export function saveMailSettings(ctx: Ctx, patch: Partial<MailSettings>): MailSettings {
  if (patch.accounts !== undefined) writeJson(ctx, ACCOUNTS_KEY, cleanAccounts(ctx, patch.accounts));
  if (patch.important !== undefined) writeJson(ctx, IMPORTANT_KEY, cleanImportant(patch.important));
  if (patch.stakes !== undefined) writeJson(ctx, STAKES_KEY, String(patch.stakes).trim().slice(0, MAX_STAKES_LENGTH));
  return mailSettings(ctx);
}

function cleanAccounts(ctx: Ctx, accounts: MailAccount[]): MailAccount[] {
  const known = mailSettings(ctx).accounts.map((account) => account.email);
  const themes = listThemes(ctx).map((theme) => theme.id);
  return accounts.map((account) => {
    if (!known.includes(account.email)) fail(400, `${account.email} is not connected`);
    if (account.themeId && !themes.includes(account.themeId)) fail(400, "Unknown theme");
    return account.themeId ? { email: account.email, themeId: account.themeId } : { email: account.email };
  });
}

function cleanImportant(entries: string[]): string[] {
  return [...new Set(entries.map((entry) => String(entry).trim().toLowerCase()).filter(Boolean))];
}

function readJson<T>(ctx: Ctx, key: string): T | undefined {
  const row = ctx.db.query<{ value: string }, [string]>("SELECT value FROM meta WHERE key = ?").get(key);
  return row ? (JSON.parse(row.value) as T) : undefined;
}

function writeJson(ctx: Ctx, key: string, value: unknown): void {
  ctx.db
    .query("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, JSON.stringify(value));
}
