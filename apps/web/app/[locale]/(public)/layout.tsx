import { type ReactNode } from 'react';
import { PublicShell } from '@/components/shell/public-shell';

export default function PublicLayout({ children }: { children: ReactNode }) {
  return <PublicShell>{children}</PublicShell>;
}
