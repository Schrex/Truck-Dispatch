import type { FieldErrorsBody } from '../../shared/types';

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

/** A 400 with each field that is wrong and a plain message. */
export function refuse(fields: Record<string, string>): Response {
  return json({ error: 'invalid', fields } satisfies FieldErrorsBody, 400);
}

/** A JSON object from the request body, or the response refusing it. */
export async function readJson<T>(request: Request): Promise<T | Response> {
  if (!request.headers.get('Content-Type')?.includes('application/json')) {
    return json({ error: 'json_required' }, 415);
  }
  try {
    const body: unknown = await request.json();
    if (body && typeof body === 'object' && !Array.isArray(body)) return body as T;
  } catch {
    // Falls through to the refusal below.
  }
  return json({ error: 'invalid_json' }, 400);
}

export function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
