'use client';

import { useState } from 'react';
import { Button } from '@syntara/ui';
import { useRouter } from '@/i18n/navigation';
import { apiRequest } from '@/lib/api/browser';

/** API-AUTH-02: выход и переход на главную. */
export function LogoutButton({ label }: { label: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    // Простая текстовая кнопка, как на эталонах хедера (U01–T10).
    <Button
      variant="quiet"
      disabled={pending}
      data-testid="logout"
      onClick={async () => {
        setPending(true);
        await apiRequest('/api/auth/logout', { method: 'POST' });
        router.replace('/');
        router.refresh();
      }}
    >
      {label}
    </Button>
  );
}
