import { Button, Group, Modal, SimpleGrid, Stack, Text } from '@mantine/core';
import { IconBackspace } from '@tabler/icons-react';
import { useState } from 'react';

export interface NumberPadProps {
  opened: boolean;
  onClose: () => void;
  /**
   * Called with the typed digits after each key (`confirmed: false`) and on OK (`true`).
   * Returns true when the number was found and the pad can close (ADR-0012: after the 5th
   * digit an existing item opens by itself; 4-digit numbers are typed with a leading 0).
   */
  onNumber: (digits: string, confirmed: boolean) => boolean;
  /**
   * Letter parts of the designations in the inspection ("Ž", "NH", "ŽLS"): quick keys, so a
   * designation like "AG01" or "01-ŽLS" is typed without the keyboard (dashes do not matter).
   */
  tokens?: readonly string[];
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

export function NumberPad({ opened, onClose, onNumber, tokens = [] }: NumberPadProps) {
  const [digits, setDigits] = useState('');
  const [notFound, setNotFound] = useState(false);

  const close = () => {
    setDigits('');
    setNotFound(false);
    onClose();
  };
  const type = (key: string) => {
    if (digits.length >= 16) return;
    const next = digits + key;
    setDigits(next);
    setNotFound(false);
    // A 5-digit číslo TZ opens by itself; a designation with letters when it is unambiguous.
    const letters = /\p{L}/u.test(next);
    if ((letters || next.length === 5) && onNumber(next, false)) close();
  };
  const confirm = () => {
    if (digits === '') return;
    if (onNumber(digits, true)) close();
    else setNotFound(true);
  };

  const big = { size: 'xl', h: 72, fz: 28 } as const;
  return (
    <Modal
      opened={opened}
      onClose={close}
      title={tokens.length ? 'Číslo TZ nebo označení' : 'Číslo TZ'}
      centered
      size="sm"
      zIndex={260}
    >
      <Stack>
        <Text
          ta="center"
          ff="monospace"
          fz={40}
          fw={700}
          mih={56}
          data-testid="number-display"
          c={notFound ? 'red' : undefined}
        >
          {digits || '–'}
        </Text>
        {notFound && (
          <Text ta="center" c="red" size="sm">
            Artikl {digits} v této kontrole není.
          </Text>
        )}
        {tokens.length > 0 && (
          <Group gap="xs" justify="center" data-testid="designation-keys">
            {tokens.map((token) => (
              <Button
                key={token}
                variant="light"
                size="lg"
                miw={64}
                aria-label={`Označení ${token}`}
                onClick={() => type(token)}
              >
                {token}
              </Button>
            ))}
          </Group>
        )}
        <SimpleGrid cols={3} spacing="xs">
          {KEYS.map((key) => (
            <Button key={key} variant="default" {...big} onClick={() => type(key)}>
              {key}
            </Button>
          ))}
          <Button
            variant="default"
            {...big}
            aria-label="Smazat číslici"
            onClick={() => {
              setDigits(digits.slice(0, -1));
              setNotFound(false);
            }}
          >
            <IconBackspace />
          </Button>
          <Button variant="default" {...big} onClick={() => type('0')}>
            0
          </Button>
          <Button {...big} onClick={confirm}>
            OK
          </Button>
        </SimpleGrid>
        <Text size="xs" c="dimmed" ta="center">
          Pětimístné číslo se otevře samo. Čtyřmístné zadejte s nulou na začátku (04001), jiné
          potvrďte OK.
          {tokens.length > 0 &&
            ' Označení zadejte v pořadí, jak je na štítku (AG + 01, nebo 01 + ŽLS); otevře se samo.'}
        </Text>
      </Stack>
    </Modal>
  );
}
