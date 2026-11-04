import { Badge, Loader, Stack, Table, Text, Title } from '@mantine/core';
import { outcomeLabel } from '@revize/shared';
import { useItemHistory } from '../api/hooks.js';
import { formatDate, formatDateTime } from '../lib/format.js';
import { AnchorLink } from './links.js';

const SEVERITY_COLOR = { green: 'teal', amber: 'yellow', red: 'red' } as const;

/** Every inspection of the item's site that covered it: result or "not checked" (M8). */
export function ItemHistory({
  itemId,
  riskLevels = true,
}: {
  itemId: string;
  riskLevels?: boolean;
}) {
  const history = useItemHistory(itemId);
  return (
    <Stack gap="xs">
      <Title order={4}>Historie kontrol</Title>
      {history.isPending && <Loader size="sm" />}
      {history.data?.length === 0 && (
        <Text size="sm" c="dimmed">
          Artikl zatím nebyl v žádné kontrole.
        </Text>
      )}
      {!!history.data?.length && (
        <Table data-testid="item-history" striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Kontrola</Table.Th>
              <Table.Th>Výsledek</Table.Th>
              <Table.Th>Závada</Table.Th>
              <Table.Th>Zapsal</Table.Th>
              <Table.Th>Fotky</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {history.data.map((h) => (
              <Table.Tr key={h.inspectionId}>
                <Table.Td>
                  <AnchorLink
                    to="/kontroly/$inspectionId"
                    params={{ inspectionId: h.inspectionId }}
                  >
                    {formatDate(h.inspectionDate)}
                  </AnchorLink>
                  {h.inspectionStatus === 'open' && (
                    <Text size="xs" c="dimmed">
                      otevřená
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>
                  {h.result ? (
                    <Badge
                      color={
                        h.result.severity
                          ? riskLevels
                            ? SEVERITY_COLOR[h.result.severity]
                            : h.result.severity === 'green'
                              ? 'yellow'
                              : 'red'
                          : 'green'
                      }
                    >
                      {outcomeLabel(h.result, riskLevels)}
                    </Badge>
                  ) : (
                    <Text size="sm" c="dimmed">
                      Nezkontrolován
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>{h.result?.defectDescription}</Table.Td>
                <Table.Td>
                  {h.result && (
                    <Text size="sm">
                      {h.result.recordedByName}
                      <br />
                      <Text span size="xs" c="dimmed">
                        {formatDateTime(h.result.recordedAt)}
                      </Text>
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>{h.result?.photoCount || ''}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Stack>
  );
}
