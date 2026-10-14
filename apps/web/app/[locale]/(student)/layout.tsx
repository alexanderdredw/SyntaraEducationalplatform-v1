import { type ReactNode } from 'react';
import { PublicShell } from '@/components/shell/public-shell';

/** До появления кабинета (итерации 6–8) — публичная оболочка с заглушкой PH-24. */
export default function Layout({ children }: { children: ReactNode }) {
  return <PublicShell>{children}</PublicShell>;
}
