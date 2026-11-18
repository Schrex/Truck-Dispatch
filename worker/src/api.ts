import type { Env } from './app';
import type { Driver, NewOrder, Order } from '../../shared/types';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The JSON API under /api/ (or /truck-dispatch/api/). */
export async function handleApi(request: Request, env: Env, route: string, query: URLSearchParams): Promise<Response> {
  const method = request.method;

  if (route === 'health' && (method === 'GET' || method === 'HEAD')) {
    return json({ ok: true, environment: env.ENVIRONMENT ?? 'unknown', commit: env.COMMIT_SHA ?? null });
  }

  if (route === 'drivers' && (method === 'GET' || method === 'HEAD')) {
    const { results } = await env.DB.prepare('SELECT id, name FROM drivers ORDER BY name').all<Driver>();
    return json({ drivers: results });
  }

  if (route === 'orders') {
    if (method === 'GET' || method === 'HEAD') {
      const date = query.get('date');
      if (!date || !DATE.test(date)) return json({ error: 'date_required', hint: 'YYYY-MM-DD' }, 400);
      const { results } = await env.DB.prepare(`${SELECT_ORDER} WHERE o.work_date = ? ORDER BY o.start_time IS NULL, o.start_time, o.created_at`)
        .bind(date)
        .all<Order>();
      return json({ orders: results });
    }
    if (method === 'POST') return createOrder(request, env);
    return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET, HEAD, POST' });
  }

  if (['health', 'drivers'].includes(route)) return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET, HEAD' });
  return json({ error: 'not_found' }, 404);
}

const SELECT_ORDER = `SELECT o.id, o.work_date AS workDate, o.start_time AS startTime, o.job, o.work, o.pickup, o.dropoff,
       o.driver_id AS driverId, d.name AS driverName, o.truck_number AS truckNumber, o.notes, o.created_at AS createdAt
  FROM orders o JOIN drivers d ON d.id = o.driver_id`;

async function createOrder(request: Request, env: Env): Promise<Response> {
  if (!request.headers.get('Content-Type')?.includes('application/json')) {
    return json({ error: 'json_required' }, 415);
  }
  let body: Partial<NewOrder>;
  try {
    body = (await request.json()) as Partial<NewOrder>;
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const errors = validate(body);
  if (Object.keys(errors).length > 0) return json({ error: 'invalid', fields: errors }, 400);

  const driver = await env.DB.prepare('SELECT id FROM drivers WHERE id = ?').bind(body.driverId).first();
  if (!driver) return json({ error: 'invalid', fields: { driverId: 'Pick a driver from the list.' } }, 400);

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO orders (id, work_date, start_time, job, work, pickup, dropoff, driver_id, truck_number, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      body.workDate,
      text(body.startTime) || null,
      text(body.job),
      text(body.work),
      text(body.pickup),
      text(body.dropoff),
      body.driverId,
      text(body.truckNumber) || null,
      text(body.notes),
    )
    .run();
  const order = await env.DB.prepare(`${SELECT_ORDER} WHERE o.id = ?`).bind(id).first<Order>();
  return json({ order }, 201);
}

/** Field name to a plain message, for each field that is wrong. */
export function validate(body: Partial<NewOrder>): Record<string, string> {
  const errors: Record<string, string> = {};
  if (typeof body.workDate !== 'string' || !DATE.test(body.workDate)) errors.workDate = 'Pick a date.';
  const time = text(body.startTime);
  if (time && !TIME.test(time)) errors.startTime = 'Use a time like 07:30.';
  if (!text(body.job)) errors.job = 'Enter the job.';
  if (!text(body.work)) errors.work = 'Describe the work.';
  if (typeof body.driverId !== 'string' || !body.driverId) errors.driverId = 'Assign a driver.';
  const limits: [keyof NewOrder, number][] = [['job', 120], ['work', 500], ['pickup', 200], ['dropoff', 200], ['truckNumber', 20], ['notes', 1000]];
  for (const [field, max] of limits) {
    if (text(body[field]).length > max) errors[field] = `Keep it under ${max} characters.`;
  }
  return errors;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}
