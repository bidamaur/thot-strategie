import type { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl">
        <p className="eyebrow text-accent">{eyebrow}</p>
        <h1 className="mt-1.5 text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {description && <p className="mt-2 text-sm leading-6 text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function PageShell({ children, width = "max-w-6xl" }: { children: ReactNode; width?: string }) {
  return (
    <main className={`mx-auto flex w-full ${width} flex-1 flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8`}>
      {children}
    </main>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="card-muted px-5 py-8 text-center">
      <p className="text-sm font-semibold">{title}</p>
      {children && <div className="mt-1.5 text-sm text-ink-muted">{children}</div>}
    </div>
  );
}
