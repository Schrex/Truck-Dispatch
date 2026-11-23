import type { ReactNode } from 'react';

/** The Hub's home. Under the Hub prefix this leaves the app; standalone it is the Board. */
const HUB_HOME = '/';

/**
 * The header every page shares, in the Hub's style: a "← Hub" link (or the
 * page's own way back in its place, as the Driver view's "← Drivers"), an
 * Oswald uppercase title and a subtitle. The page's own controls go on the right;
 * anything that needs the full width (the Board's week strip) goes below.
 */
export function PageHeader({
  title,
  subtitle,
  children,
  below,
  back,
}: {
  title: string;
  subtitle: string;
  children?: ReactNode;
  below?: ReactNode;
  /** Shown top left instead of "← Hub". */
  back?: ReactNode;
}) {
  return (
    <header className="relative border-b bg-background shadow-xs">
      {/* The Hub's hi-vis stripe, as on a truck's tailgate: the one decoration every page shares. */}
      <div aria-hidden className="hivis-rule" />
      <div className="container pb-6 pt-3">
        {back ?? (
          <a href={HUB_HOME} className="-ml-2 inline-flex min-h-11 items-center rounded-md px-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
            ← Hub
          </a>
        )}
        <div className="mt-1 flex flex-wrap items-end justify-between gap-4">
          <div className="animate-rise">
            <h1 className="font-display text-3xl font-semibold uppercase leading-none tracking-wide">{title}</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>
          </div>
          {children && <div className="flex flex-wrap items-end gap-3">{children}</div>}
        </div>
        {below && <div className="mt-4">{below}</div>}
      </div>
    </header>
  );
}
