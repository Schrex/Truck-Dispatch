import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Toaster } from '@/components/ui/sonner';
import { basePath } from '@/lib/basePath';
import { BoardPage } from '@/pages/BoardPage';
import { SettingsPage } from '@/pages/SettingsPage';

/** The two pages, Board and Settings, at the root or under the Hub prefix. */
export function App() {
  // The trailing slash keeps the Board's own link at /truck-dispatch/, not /truck-dispatch.
  return (
    <BrowserRouter basename={`${basePath()}/`}>
      <Routes>
        <Route path="/" element={<BoardPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
      {/* Save and failure messages, raised from any page with toast(). */}
      <Toaster />
    </BrowserRouter>
  );
}
