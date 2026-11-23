import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Toaster } from '@/components/ui/sonner';
import { basePath } from '@/lib/basePath';
import { storedView } from '@/lib/deviceView';
import { BoardPage } from '@/pages/BoardPage';

/*
 * The Board is in the first download; the other pages load on their own, so a
 * Driver's phone, Dave's iPad and the Simulation each fetch only what they
 * show. Once the first page is up, the rest are fetched while the browser is
 * idle, so moving between pages stays instant.
 */
const loadDriver = () => import('@/pages/DriverPage');
const loadSettings = () => import('@/pages/SettingsPage');
const loadSimulate = () => import('@/pages/SimulatePage');
const DriverPage = lazy(() => loadDriver().then((m) => ({ default: m.DriverPage })));
const SettingsPage = lazy(() => loadSettings().then((m) => ({ default: m.SettingsPage })));
const SimulatePage = lazy(() => loadSimulate().then((m) => ({ default: m.SimulatePage })));

/** Fetches the pages not yet loaded once the browser is idle. */
function usePrefetchPages() {
  useEffect(() => {
    const prefetch = () => {
      void loadDriver();
      void loadSettings();
    };
    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(prefetch, { timeout: 3000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = setTimeout(prefetch, 1500);
    return () => clearTimeout(id);
  }, []);
}

/** While a page's code arrives: the page's background and the Hub's stripe, so nothing jumps. */
function PageLoading() {
  return (
    <div className="min-h-screen bg-surface" aria-busy="true">
      <div aria-hidden className="hivis-rule" />
    </div>
  );
}

/**
 * The Board, or the Driver view on a device that chose it (Scheduler |
 * Driver), so a Driver's phone opens on his day every morning.
 */
function Home() {
  return storedView() === 'driver' ? <Navigate to="/driver" replace /> : <BoardPage />;
}

/** The pages, Board, Driver view and Settings, at the root or under the Hub prefix. */
export function App() {
  usePrefetchPages();
  // The trailing slash keeps the Board's own link at /truck-dispatch/, not /truck-dispatch.
  return (
    <BrowserRouter basename={`${basePath()}/`}>
      <Suspense fallback={<PageLoading />}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/driver" element={<DriverPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        {/* One Truck's day with fake data, to see how Trips are built (phase 3 design). */}
        <Route path="/simulate" element={<SimulatePage />} />
      </Routes>
      </Suspense>
      {/* Save and failure messages, raised from any page with toast(). */}
      <Toaster />
    </BrowserRouter>
  );
}
