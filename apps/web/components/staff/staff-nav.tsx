'use client';

import { cn } from '@syntara/ui';
import { usePathname } from '@/i18n/navigation';
import { AppLink } from '../app-link';

export function StaffNav({ label, items }: { label: string; items: Array<{ href: string; label: string }> }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label}>
      <ul className="flex flex-wrap gap-1">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href}>
              <AppLink
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'inline-flex min-h-11 items-center rounded-[var(--radius-pill)] px-4 text-sm',
                  active
                    ? 'bg-[var(--text)] text-[var(--bg)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text)]',
                )}
              >
                {item.label}
              </AppLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
