import { Button, Menu } from '@mantine/core';
import { IconDownload, IconFileSpreadsheet, IconFileText } from '@tabler/icons-react';
import { useState } from 'react';
import { downloadFile, queryString } from '../api/client.js';
import { notifyError } from '../lib/notify.js';

export interface DatabaseExportMenuProps {
  /** The list filters: empty = the whole database. */
  filters: {
    customerId?: string;
    siteId?: string;
    equipmentTypeId?: string;
    status?: string;
    due?: string;
    lastInspection?: string;
    incomplete?: string;
    noNumber?: string;
  };
}

/** Export of the records (items with fields and the last inspection) as XLSX or CSV. */
export function DatabaseExportMenu({ filters }: DatabaseExportMenuProps) {
  const [busy, setBusy] = useState(false);
  const filtered = Object.values(filters).some(Boolean);
  // The whole database: also the items removed from the records.
  const query = queryString({ ...filters, includeRetired: 'true' });
  const download = (file: string, name: string) => {
    setBusy(true);
    const [base, ext] = name.split('.');
    downloadFile(
      `/exports/${file}${query}`,
      `${base}-${new Date().toISOString().slice(0, 10)}.${ext}`,
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
        <Menu.Item
          leftSection={<IconFileSpreadsheet size={16} />}
          onClick={() => download('items.xlsx', 'evidence.xlsx')}
        >
          Excel (XLSX) – evidence a historie kontrol
        </Menu.Item>
        <Menu.Item
          leftSection={<IconFileText size={16} />}
          onClick={() => download('items.csv', 'evidence.csv')}
        >
          CSV – evidence
        </Menu.Item>
        <Menu.Item
          leftSection={<IconFileText size={16} />}
          onClick={() => download('history.csv', 'historie-kontrol.csv')}
        >
          CSV – historie kontrol
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
