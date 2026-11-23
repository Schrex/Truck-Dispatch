import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Toaster } from '@/components/ui/sonner';
import { basePath } from '@/lib/basePath';
import { storedView } from '@/lib/deviceView';
import { BoardPage } from '@/pages/BoardPage';
import { DriverPage } from '@/pages/DriverPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { SimulatePage } from '@/pages/SimulatePage';

/**
 * The Board, or the Driver view on a device that chose it (Scheduler |
 * Driver), so a Driver's phone opens on his day every morning.
 */
function Home() {
  return storedView() === 'driver' ? <Navigate to="/driver" replace /> : <BoardPage />;
}

/** The pages, Board, Driver view and Settings, at the root or under the Hub prefix. */
export function App() {
  // The trailing slash keeps the Board's own link at /truck-dispatch/, not /truck-dispatch.
  return (
    <BrowserRouter basename={`${basePath()}/`}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/driver" element={<DriverPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        {/* One Truck's day with fake data, to see how Trips are built (phase 3 design). */}
        <Route path="/simulate" element={<SimulatePage />} />
      </Routes>
      {/* Save and failure messages, raised from any page with toast(). */}
      <Toaster />
    </BrowserRouter>
  );
}
