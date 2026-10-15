import { type ReactNode } from 'react';

/** Фон с тонкими линиями для страниц входа, регистрации и /join (эталон student-auth.png). */
export function AuthBackdrop({ children }: { children: ReactNode }) {
  return (
    <div className="relative isolate">
      <div aria-hidden="true" data-decorative="" data-testid="auth-backdrop" className="auth-backdrop" />
      {children}
    </div>
  );
}
