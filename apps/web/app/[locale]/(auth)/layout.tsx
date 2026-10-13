import { type ReactNode } from 'react';
import { PublicShell } from '@/components/shell/public-shell';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return <PublicShell>{children}</PublicShell>;
}
