import { Alert, Badge, Button, Group, Menu, Stack, Text } from '@mantine/core';
import { IconRefresh } from '@tabler/icons-react';
import { resetDemo } from '../api/transport.js';

/** Demo accounts created by the in-browser API (`DEMO_ADMIN`, demo seed). */
const ACCOUNTS = [
  { label: 'Administrátor', email: 'admin@revize.local', password: 'demo-heslo' },
  { label: 'Technik', email: 'technik@revize.local', password: 'technik-demo-heslo' },
];

/** Login page note of the GitHub Pages demo, with one-click demo accounts. */
export function DemoLoginHint({ onPick }: { onPick: (email: string, password: string) => void }) {
  return (
    <Alert color="blue" title="Ukázková verze">
      <Stack gap="xs">
        <Text size="sm">
          Vše běží jen v tomto prohlížeči a data se nikam neodesílají. Nezadávejte skutečné údaje
          zákazníků.
        </Text>
        <Group gap="xs">
          {ACCOUNTS.map((a) => (
            <Button
              key={a.email}
              size="xs"
              variant="light"
              onClick={() => onPick(a.email, a.password)}
            >
              {a.label}
            </Button>
          ))}
        </Group>
      </Stack>
    </Alert>
  );
}

export function DemoBadge() {
  return (
    <Badge color="orange" variant="light">
      Demo
    </Badge>
  );
}

/** User menu item: delete the demo database and start again with fresh demo data. */
export function DemoResetItem() {
  const reset = async () => {
    if (!window.confirm('Smazat všechna data v ukázkové verzi a začít znovu s ukázkovými daty?')) {
      return;
    }
    await resetDemo();
    window.location.assign(import.meta.env.BASE_URL);
  };
  return (
    <Menu.Item leftSection={<IconRefresh size={16} />} onClick={() => void reset()}>
      Obnovit ukázková data
    </Menu.Item>
  );
}
