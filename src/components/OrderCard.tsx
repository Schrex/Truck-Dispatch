import { Clock, MapPin, Truck, User } from 'lucide-react';
import type { Order } from '../../shared/types';
import { Card, CardContent } from '@/components/ui/card';
import { formatTime } from '@/lib/dates';

/** One order on the board. */
export function OrderCard({ order }: { order: Order }) {
  const route = [order.pickup, order.dropoff].filter(Boolean).join(' → ');
  return (
    <Card data-testid="order">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-display text-lg font-semibold uppercase tracking-wide">{order.job}</p>
            <p className="text-sm">{order.work}</p>
          </div>
          {order.startTime && (
            <span className="flex shrink-0 items-center gap-1 rounded-md bg-surface px-2 py-1 text-sm tabular-nums">
              <Clock className="h-3.5 w-3.5" /> {formatTime(order.startTime)}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <User className="h-4 w-4" /> <span className="text-foreground">{order.driverName}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <Truck className="h-4 w-4" /> {order.truckNumber ? <span className="text-foreground">{order.truckNumber}</span> : 'No truck'}
          </span>
          {route && (
            <span className="flex items-center gap-1.5">
              <MapPin className="h-4 w-4" /> {route}
            </span>
          )}
        </div>
        {order.notes && <p className="text-sm text-muted-foreground">{order.notes}</p>}
      </CardContent>
    </Card>
  );
}
