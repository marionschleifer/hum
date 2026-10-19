import type { Db } from "./db/open.ts";

export type Ctx = {
  db: Db;
  now: () => Date;
  newId: () => string;
};

export type HttpError = Error & { status: number };

export function fail(status: number, message: string): never {
  throw Object.assign(new Error(message), { status });
}

export function isHttpError(error: unknown): error is HttpError {
  return error instanceof Error && typeof (error as HttpError).status === "number";
}

export function isoNow(ctx: Ctx): string {
  return ctx.now().toISOString();
}
