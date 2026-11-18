import type { Driver, NewOrder, Order } from '../../shared/types';

// Relative URLs: "api/..." resolves to /api/... standalone and to
// /truck-dispatch/api/... under the Hub, with no configuration.

export class FieldErrors extends Error {
  constructor(public fields: Record<string, string>) {
    super('Some fields need fixing.');
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { Accept: 'application/json', ...init?.headers } });
  const body = await response.json().catch(() => ({}));
  if (response.status === 400 && body.fields) throw new FieldErrors(body.fields);
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return body as T;
}

export async function fetchDrivers(): Promise<Driver[]> {
  return (await request<{ drivers: Driver[] }>('api/drivers')).drivers;
}

export async function fetchOrders(date: string): Promise<Order[]> {
  return (await request<{ orders: Order[] }>(`api/orders?date=${encodeURIComponent(date)}`)).orders;
}

export async function createOrder(order: NewOrder): Promise<Order> {
  return (
    await request<{ order: Order }>('api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(order),
    })
  ).order;
}
