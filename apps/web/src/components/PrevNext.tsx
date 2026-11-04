import { ActionIcon, Group, Text, Tooltip } from '@mantine/core';
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';

export interface PrevNextProps {
  /** Position in the list (0-based); -1 = not in the list (e.g. filtered out). */
  index: number;
  total: number;
  onMove: (index: number) => void;
}

/** "‹ 3 / 9 ›": going through the items of a list in its order and with its filters. */
export function PrevNext({ index, total, onMove }: PrevNextProps) {
  if (index < 0 || total < 2) return null;
  return (
    <Group gap={4} wrap="nowrap">
      <Tooltip label="Předchozí artikl">
        <ActionIcon
          variant="default"
          aria-label="Předchozí artikl"
          disabled={index === 0}
          onClick={() => onMove(index - 1)}
        >
          <IconChevronLeft size={18} />
        </ActionIcon>
      </Tooltip>
      <Text size="sm" c="dimmed" miw={48} ta="center" data-testid="item-position">
        {index + 1} / {total}
      </Text>
      <Tooltip label="Další artikl">
        <ActionIcon
          variant="default"
          aria-label="Další artikl"
          disabled={index === total - 1}
          onClick={() => onMove(index + 1)}
        >
          <IconChevronRight size={18} />
        </ActionIcon>
      </Tooltip>
    </Group>
  );
}
