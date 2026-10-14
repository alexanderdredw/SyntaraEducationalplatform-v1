'use client';

import { useState } from 'react';
import { LogOut } from 'lucide-react';
import { Button } from '@syntara/ui';
import { useRouter } from '@/i18n/navigation';
import { apiRequest } from '@/lib/api/browser';

/** API-AUTH-02: выход и переход на главную. */
export function LogoutButton({ label }: { label: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <Button
      variant="secondary"
      disabled={pending}
      data-testid="logout"
      onClick={async () => {
        setPending(true);
        await apiRequest('/api/auth/logout', { method: 'POST' });
        router.replace('/');
        router.refresh();
      }}
    >
      <LogOut aria-hidden="true" className="size-4" />
      {label}
    </Button>
  );
}
