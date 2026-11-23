import { lazy, Suspense, useEffect, type ComponentType } from 'react';
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
/**
 * A page whose code loads on its own. Until it has arrived it suspends (the
 * fallback shows); once it has, it renders at once, so going to a page that
 * was prefetched never waits.
 */
function lazyPage(load: () => Promise<ComponentType>) {
  let Loaded: ComponentType | null = null;
  let loading: Promise<ComponentType> | null = null;
  const preload = () =>
    (loading ??= load().then(
      (page) => (Loaded = page),
      (error: unknown) => {
        loading = null; // A failed download is tried again on the next visit.
        throw error;
      },
    ));
  const Lazy = lazy(() => preload().then((page) => ({ default: page })));
  const Page = () => (Loaded ? <Loaded /> : <Lazy />);
  return Object.assign(Page, { preload });
}

const DriverPage = lazyPage(() => import('@/pages/DriverPage').then((m) => m.DriverPage));
const SettingsPage = lazyPage(() => import('@/pages/SettingsPage').then((m) => m.SettingsPage));
const FleetImportsPage = lazyPage(() => import('@/pages/FleetImportsPage').then((m) => m.FleetImportsPage));
const SimulatePage = lazyPage(() => import('@/pages/SimulatePage').then((m) => m.SimulatePage));

/**
 * Fetches the Driver view and Settings once the first page is up: when the
 * browser is idle, or right after it where the browser cannot say (Safari).
 */
function usePrefetchPages() {
  useEffect(() => {
    const prefetch = () => {
      void DriverPage.preload().catch(() => {});
      void SettingsPage.preload().catch(() => {});
    };
    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(prefetch, { timeout: 2000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = setTimeout(prefetch, 0);
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
        {/* Where Dave drops each HCSS Fleet export; only this page loads the export readers. */}
        <Route path="/fleet-imports" element={<FleetImportsPage />} />
        {/* One Truck's day with fake data, to see how Trips are built (phase 3 design). */}
        <Route path="/simulate" element={<SimulatePage />} />
      </Routes>
      </Suspense>
      {/* Save and failure messages, raised from any page with toast(). */}
      <Toaster />
    </BrowserRouter>
  );
}
