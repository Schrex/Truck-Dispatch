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

/** The request's JSON object, or the response that refuses it. */
export async function readBody<T>(request: Request): Promise<{ body: Partial<T> } | { refusal: Response }> {
  if (!request.headers.get('Content-Type')?.includes('application/json')) {
    return { refusal: json({ error: 'json_required' }, 415) };
  }
  try {
    const body: unknown = await request.json();
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return { refusal: json({ error: 'invalid_json' }, 400) };
    return { body: body as Partial<T> };
  } catch {
    return { refusal: json({ error: 'invalid_json' }, 400) };
  }
}

export function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
