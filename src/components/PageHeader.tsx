import type { ReactNode } from 'react';

/** The Hub's home. Under the Hub prefix this leaves the app; standalone it is the Board. */
const HUB_HOME = '/';

/**
 * The header every page shares, in the Hub's style, laid out the same way on
 * every page (docs/design/ui-standards.md):
 * - top left, always "← Hub", the one way out of the app, never replaced;
 * - the Oswald uppercase title, and under it the subtitle: what the page is
 *   showing, or who is using it (the Driver view's Driver, with Change);
 * - on the right, going to another view or page (Scheduler | Driver, Settings,
 *   Board) and the page's own controls;
 * - below, anything that needs the full width (the Board's week strip).
 */
export function PageHeader({
  title,
  subtitle,
  children,
  below,
}: {
  title: string;
  /** A line of text, or who is using the page with a way to change it. */
  subtitle: ReactNode;
  children?: ReactNode;
  below?: ReactNode;
}) {
  return (
    <header className="relative border-b bg-background shadow-xs">
      {/* The Hub's hi-vis stripe, as on a truck's tailgate: the one decoration every page shares. */}
      <div aria-hidden className="hivis-rule" />
      <div className="container pb-6 pt-3">
        <a
          href={HUB_HOME}
          className="-ml-2 inline-flex min-h-11 items-center rounded-md px-2 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          ← Hub
        </a>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-4">
          <div className="animate-rise">
            <h1 className="font-display text-3xl font-semibold uppercase leading-none tracking-wide">{title}</h1>
            {typeof subtitle === 'string' ? <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p> : <div className="mt-1.5">{subtitle}</div>}
          </div>
          {children && <div className="flex flex-wrap items-end gap-3">{children}</div>}
        </div>
        {below && <div className="mt-4">{below}</div>}
      </div>
    </header>
  );
}
