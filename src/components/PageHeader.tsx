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
    <header className="border-b bg-background">
      <div className="container py-6">
        {back ?? (
          <a href={HUB_HOME} className="-ml-2 inline-flex min-h-11 items-center px-2 text-sm text-muted-foreground hover:text-foreground">
            ← Hub
          </a>
        )}
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-semibold uppercase tracking-wide">{title}</h1>
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          </div>
          {children && <div className="flex flex-wrap items-end gap-3">{children}</div>}
        </div>
        {below && <div className="mt-4">{below}</div>}
      </div>
    </header>
  );
}
