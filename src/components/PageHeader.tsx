import type { ReactNode } from 'react';

/** The Hub's home. Under the Hub prefix this leaves the app; standalone it is the Board. */
const HUB_HOME = '/';

/**
 * The header every page shares, in the Hub's style: a "← Hub" link, an Oswald
 * uppercase title and a subtitle. The page's own controls go on the right.
 */
export function PageHeader({ title, subtitle, children }: { title: string; subtitle: string; children?: ReactNode }) {
  return (
    <header className="border-b bg-background">
      <div className="container py-6">
        <a href={HUB_HOME} className="text-sm text-muted-foreground hover:text-foreground">
          ← Hub
        </a>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-semibold uppercase tracking-wide">{title}</h1>
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          </div>
          {children && <div className="flex flex-wrap items-end gap-3">{children}</div>}
        </div>
      </div>
    </header>
  );
}
