import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { storeView, type View } from '@/lib/deviceView';

/** Each view, its word on the toggle and the page it opens. */
const VIEWS: { view: View; label: string; to: string }[] = [
  { view: 'scheduler', label: 'Scheduler', to: '/' },
  { view: 'driver', label: 'Driver', to: '/driver' },
];

/**
 * Scheduler | Driver in the header: the device remembers the choice, so a
 * Driver's phone keeps opening on his day and Dave's iPad on the board.
 */
export function ViewToggle({ current }: { current: View }) {
  const navigate = useNavigate();
  return (
    <div role="group" aria-label="View" className="inline-flex h-12 items-center rounded-md border bg-background p-1">
      {VIEWS.map(({ view, label, to }) => (
        <Button
          key={view}
          type="button"
          size="sm"
          className="h-10 px-4 text-sm"
          variant={view === current ? 'default' : 'ghost'}
          aria-pressed={view === current}
          onClick={() => {
            storeView(view);
            navigate(to);
          }}
        >
          {label}
        </Button>
      ))}
    </div>
  );
}
