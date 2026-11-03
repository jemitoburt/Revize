import {
  AppShell,
  Burger,
  Group,
  Loader,
  Menu,
  NavLink,
  Stack,
  Text,
  UnstyledButton,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconBuildingWarehouse,
  IconChevronDown,
  IconFileImport,
  IconLadder,
  IconListDetails,
  IconLogout,
  IconUser,
  IconUsers,
} from '@tabler/icons-react';
import { ROLE_LABELS, type Permission } from '@revize/shared';
import { Link, Navigate, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { DEMO } from '../api/client.js';
import { useLogout, useMe } from '../api/hooks.js';
import { DemoBadge, DemoResetItem } from '../demo/DemoParts.js';

const NAV: { to: string; label: string; icon: typeof IconUser; permission: Permission }[] = [
  {
    to: '/zakaznici',
    label: 'Zákazníci',
    icon: IconBuildingWarehouse,
    permission: 'customer.read',
  },
  { to: '/artikly', label: 'Artikly', icon: IconListDetails, permission: 'item.read' },
  { to: '/import', label: 'Import', icon: IconFileImport, permission: 'item.import' },
  { to: '/typy', label: 'Typy vybavení', icon: IconLadder, permission: 'equipmentType.read' },
  { to: '/uzivatele', label: 'Uživatelé', icon: IconUsers, permission: 'user.manage' },
];

/** Office shell: navigation, user menu; redirects to the login page when signed out. */
export function Layout() {
  const me = useMe();
  const logout = useLogout();
  const navigate = useNavigate();
  const [opened, { toggle, close }] = useDisclosure();
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
  const user = me.data;

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
          <Menu position="bottom-end" withinPortal>
            <Menu.Target>
              <UnstyledButton aria-label="Uživatelské menu">
                <Group gap={6}>
                  <IconUser size={18} />
                  <Text size="sm">
                    {user.displayName} · {ROLE_LABELS[user.role]}
                  </Text>
                  <IconChevronDown size={14} />
                </Group>
              </UnstyledButton>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item
                leftSection={<IconUser size={16} />}
                onClick={() => void navigate({ to: '/ucet' })}
              >
                Můj účet
              </Menu.Item>
              <Menu.Item
                leftSection={<IconLogout size={16} />}
                onClick={() =>
                  logout.mutate(undefined, {
                    onSettled: () => void navigate({ to: '/prihlaseni' }),
                  })
                }
              >
                Odhlásit
              </Menu.Item>
              {DEMO && <DemoResetItem />}
            </Menu.Dropdown>
          </Menu>
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
