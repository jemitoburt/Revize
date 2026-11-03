import { Loader, Stack, Text } from '@mantine/core';
import type { CurrentUser } from '@revize/shared';
import { Navigate, useRouterState } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { DEMO } from '../api/client.js';
import { useMe } from '../api/hooks.js';

/** Renders its children for a signed-in user, otherwise sends them to the login page. */
export function AuthGate({ children }: { children: (user: CurrentUser) => ReactNode }) {
  const me = useMe();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const href = useRouterState({ select: (s) => s.location.href });

  if (me.isPending) {
    return (
      <Stack align="center" mt="xl">
        <Loader />
        {DEMO && <Text c="dimmed">Spouštím ukázkovou databázi v prohlížeči…</Text>}
      </Stack>
    );
  }
  if (!me.data) {
    // While the router is already moving to the login page this shell may render once more;
    // do not overwrite the original address (incl. filters) that the user should return to.
    if (pathname.startsWith('/prihlaseni')) return null;
    return <Navigate to="/prihlaseni" search={{ next: href }} replace />;
  }
  return children(me.data);
}
