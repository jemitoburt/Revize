import { AppShell, Burger, Group, Menu, NavLink, Text, UnstyledButton } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconBuildingWarehouse,
  IconChevronDown,
  IconClipboardCheck,
  IconClipboardList,
  IconFileImport,
  IconHistory,
  IconLadder,
  IconListDetails,
  IconLogout,
  IconSettings,
  IconUser,
  IconUsers,
} from '@tabler/icons-react';
import { ROLE_LABELS, type CurrentUser, type Permission } from '@revize/shared';
import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { DEMO } from '../api/client.js';
import { useLogout, useOutbox } from '../api/hooks.js';
import { DemoBadge, DemoResetItem } from '../demo/DemoParts.js';
import { AuthGate } from './AuthGate.js';

const NAV: { to: string; label: string; icon: typeof IconUser; permission: Permission }[] = [
  {
    to: '/zakaznici',
    label: 'Zákazníci',
    icon: IconBuildingWarehouse,
    permission: 'customer.read',
  },
  { to: '/artikly', label: 'Artikly', icon: IconListDetails, permission: 'item.read' },
  { to: '/kontroly', label: 'Kontroly', icon: IconClipboardList, permission: 'inspection.read' },
  { to: '/import', label: 'Import', icon: IconFileImport, permission: 'item.import' },
  { to: '/typy', label: 'Typy vybavení', icon: IconLadder, permission: 'equipmentType.read' },
  { to: '/uzivatele', label: 'Uživatelé', icon: IconUsers, permission: 'user.manage' },
  { to: '/nastaveni', label: 'Nastavení', icon: IconSettings, permission: 'settings.manage' },
  { to: '/historie-zmen', label: 'Historie změn', icon: IconHistory, permission: 'audit.read' },
  {
    to: '/teren',
    label: 'Kontroly v terénu',
    icon: IconClipboardCheck,
    permission: 'inspection.perform',
  },
];

/** User name with "my account", logout (and the demo reset) – office and field header. */
export function UserMenu({ user }: { user: CurrentUser }) {
  const logout = useLogout();
  const navigate = useNavigate();
  const outbox = useOutbox();
  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <UnstyledButton aria-label="Uživatelské menu">
          <Group gap={6} wrap="nowrap">
            <IconUser size={18} />
            <Text size="sm" visibleFrom="sm">
              {user.displayName} · {ROLE_LABELS[user.role]}
            </Text>
            <IconChevronDown size={14} />
          </Group>
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label hiddenFrom="sm">
          {user.displayName} · {ROLE_LABELS[user.role]}
        </Menu.Label>
        <Menu.Item
          leftSection={<IconUser size={16} />}
          onClick={() => void navigate({ to: '/ucet' })}
        >
          Můj účet
        </Menu.Item>
        <Menu.Item
          leftSection={<IconLogout size={16} />}
          onClick={() => {
            const unsent = outbox.filter((c) => c.userId === user.id).length;
            if (
              unsent > 0 &&
              !window.confirm(
                `V zařízení čeká na odeslání ${unsent} změn. Zůstanou uložené a odešlou se po ` +
                  'vašem dalším přihlášení na tomto zařízení. Odhlásit?',
              )
            ) {
              return;
            }
            logout.mutate(undefined, {
              onSettled: () => void navigate({ to: '/prihlaseni' }),
            });
          }}
        >
          Odhlásit
        </Menu.Item>
        {DEMO && <DemoResetItem />}
      </Menu.Dropdown>
    </Menu>
  );
}

/** Office shell: navigation, user menu; redirects to the login page when signed out. */
export function Layout() {
  return <AuthGate>{(user) => <OfficeShell user={user} />}</AuthGate>;
}

function OfficeShell({ user }: { user: CurrentUser }) {
  const [opened, { toggle, close }] = useDisclosure();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 230, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group gap="sm">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" aria-label="Menu" />
            <Text fw={700} size="lg">
              Revize
            </Text>
            {DEMO && <DemoBadge />}
          </Group>
          <UserMenu user={user} />
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="xs">
        {NAV.filter((n) => user.permissions.includes(n.permission)).map((n) => (
          <NavLink
            key={n.to}
            component={Link}
            to={n.to}
            label={n.label}
            leftSection={<n.icon size={18} />}
            active={pathname === n.to || pathname.startsWith(`${n.to}/`)}
            onClick={close}
          />
        ))}
      </AppShell.Navbar>
      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
