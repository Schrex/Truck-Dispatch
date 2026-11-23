import { useNavigate } from 'react-router-dom';
import { SegmentedToggle } from '@/components/SegmentedToggle';
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
    <SegmentedToggle
      ariaLabel="View"
      options={VIEWS.map(({ view, label }) => ({ value: view, label }))}
      value={current}
      onChange={(view) => {
        storeView(view);
        navigate(VIEWS.find((v) => v.view === view)!.to);
      }}
    />
  );
}
