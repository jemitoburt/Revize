import { Button, Menu } from '@mantine/core';
import { IconDownload, IconFileSpreadsheet, IconFileText } from '@tabler/icons-react';
import { useState } from 'react';
import { downloadFile, queryString } from '../api/client.js';
import { notifyError } from '../lib/notify.js';

export interface DatabaseExportMenuProps {
  /** The list filters: empty = the whole database. */
  filters: { customerId?: string; siteId?: string; equipmentTypeId?: string };
}

/** Export of the records (items with fields and the last inspection) as XLSX or CSV. */
export function DatabaseExportMenu({ filters }: DatabaseExportMenuProps) {
  const [busy, setBusy] = useState(false);
  const filtered = Boolean(filters.customerId || filters.equipmentTypeId);
  const download = (format: 'xlsx' | 'csv') => {
    setBusy(true);
    downloadFile(
      `/exports/items.${format}${queryString(filters)}`,
      `evidence-${new Date().toISOString().slice(0, 10)}.${format}`,
    )
      .catch(notifyError)
      .finally(() => setBusy(false));
  };
  return (
    <Menu position="bottom-end">
      <Menu.Target>
        <Button variant="light" loading={busy} leftSection={<IconDownload size={18} />}>
          Export evidence
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>{filtered ? 'Podle zvoleného filtru' : 'Celá evidence'}</Menu.Label>
        <Menu.Item leftSection={<IconFileSpreadsheet size={16} />} onClick={() => download('xlsx')}>
          Excel (XLSX)
        </Menu.Item>
        <Menu.Item leftSection={<IconFileText size={16} />} onClick={() => download('csv')}>
          CSV
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
