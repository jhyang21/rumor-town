/**
 * Small JSON helpers shared by the /api route handlers (server only).
 * Every response is JSON with `Cache-Control: no-store`. Bodies carry codes, never model text.
 */
import { ACCOUNT_ERROR_CODES, classifyAiError, type AiErrorInfo } from './gateway';

export const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' } as const;

/** Server-side budget for one route's AI work; the client gives up at 8 s. */
export const SERVER_AI_TIMEOUT_MS = 7_000;

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE_HEADERS });
}

/** Codes a route may send with a non-200 status. */
export type RouteErrorCode = 'bad_request' | 'token' | 'cap' | 'busy' | AiErrorInfo['code'];

export function errorJson(code: RouteErrorCode, status: number, actionUrl?: string): Response {
  return json(actionUrl ? { code, actionUrl } : { code }, status);
}

/** Parse the request body as JSON; undefined when it is not JSON. */
export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}

/** The token field of an unvalidated body, if it is a non-empty string. */
export function rawToken(body: unknown): string | undefined {
  const t = (body as { token?: unknown } | null | undefined)?.token;
  return typeof t === 'string' && t.length > 0 ? t : undefined;
}

export function isAccountError(info: AiErrorInfo): boolean {
  return ACCOUNT_ERROR_CODES.includes(info.code);
}

/** 502 for any AI failure that ends a whole request. */
export function aiFailureResponse(err: unknown): Response {
  const info = classifyAiError(err);
  return errorJson(info.code, 502, info.actionUrl);
}
