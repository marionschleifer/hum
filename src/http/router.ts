import { fail } from "../context.ts";

export type Params = Record<string, string>;
export type Handler = (request: Request, params: Params) => Response | Promise<Response>;
export type Route = { method: string; path: string; handler: Handler };

export function createRouter(routes: Route[]): (request: Request) => Promise<Response | undefined> {
  const compiled = routes.map((route) => ({ ...route, segments: route.path.split("/").filter(Boolean) }));
  return async (request) => {
    const segments = new URL(request.url).pathname.split("/").filter(Boolean);
    let pathMatched = false;
    for (const route of compiled) {
      const params = matchSegments(route.segments, segments);
      if (!params) continue;
      pathMatched = true;
      if (route.method === request.method) return route.handler(request, params);
    }
    return pathMatched ? json({ error: "Method not allowed" }, 405) : undefined;
  };
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    const body = await request.json();
    if (typeof body !== "object" || body === null) fail(400, "Expected a JSON object");
    return body as T;
  } catch (error) {
    if (error instanceof SyntaxError) fail(400, "Invalid JSON");
    throw error;
  }
}

function matchSegments(pattern: string[], actual: string[]): Params | undefined {
  if (pattern.length !== actual.length) return undefined;
  const params: Params = {};
  for (const [i, part] of pattern.entries()) {
    const value = actual[i]!;
    if (part.startsWith(":")) params[part.slice(1)] = decodeURIComponent(value);
    else if (part !== value) return undefined;
  }
  return params;
}
