import { type ReactNode } from 'react';
import { AuthBackdrop } from '@/components/shell/auth-backdrop';

/** Вход и регистрация (/auth/login, /auth/start): общий декоративный фон. */
export default function AuthPagesLayout({ children }: { children: ReactNode }) {
  return <AuthBackdrop>{children}</AuthBackdrop>;
}
