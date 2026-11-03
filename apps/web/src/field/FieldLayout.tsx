import { AppShell, Group, Text } from '@mantine/core';
import { IconBuildingWarehouse } from '@tabler/icons-react';
import { Outlet } from '@tanstack/react-router';
import { DEMO } from '../api/client.js';
import { AuthGate } from '../components/AuthGate.js';
import { UserMenu } from '../components/Layout.js';
import { ButtonLink } from '../components/links.js';
import { DemoBadge } from '../demo/DemoParts.js';

/** Field shell for the iPad: no office navigation, large touch targets. */
export function FieldLayout() {
  return (
    <AuthGate>
      {(user) => (
        <AppShell header={{ height: 60 }} padding="md">
          <AppShell.Header>
            <Group h="100%" px="md" justify="space-between">
              <Group gap="sm">
                <Text fw={700} size="lg">
                  Revize · terén
                </Text>
                {DEMO && <DemoBadge />}
              </Group>
              <Group gap="md">
                {user.permissions.includes('customer.read') && (
                  <ButtonLink
                    to="/zakaznici"
                    variant="subtle"
                    leftSection={<IconBuildingWarehouse size={18} />}
                  >
                    Kancelář
                  </ButtonLink>
                )}
                <UserMenu user={user} />
              </Group>
            </Group>
          </AppShell.Header>
          <AppShell.Main>
            <Outlet />
          </AppShell.Main>
        </AppShell>
      )}
    </AuthGate>
  );
}
