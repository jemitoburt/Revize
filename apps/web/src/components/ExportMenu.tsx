import { Button, Menu } from '@mantine/core';
import { fileNamePart, type Inspection } from '@revize/shared';
import { IconDownload, IconFileSpreadsheet, IconFileText, IconPhoto } from '@tabler/icons-react';
import { useState } from 'react';
import { downloadFile } from '../api/client.js';
import { notifyError } from '../lib/notify.js';

/** Downloads of an inspection: results (XLSX, CSV) and photos (ZIP). */
export function ExportMenu({ inspection }: { inspection: Inspection }) {
  const [busy, setBusy] = useState(false);
  const base = `${fileNamePart(inspection.siteName)}-${inspection.inspectionDate}`;
  const download = (path: string, fileName: string) => {
    setBusy(true);
    downloadFile(`/inspections/${inspection.id}/${path}`, fileName)
      .catch(notifyError)
      .finally(() => setBusy(false));
  };
  return (
    <Menu position="bottom-end">
      <Menu.Target>
        <Button variant="light" loading={busy} leftSection={<IconDownload size={18} />}>
          Export
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item
          leftSection={<IconFileSpreadsheet size={16} />}
          onClick={() => download('export.xlsx', `kontrola-${base}.xlsx`)}
        >
          Výsledky – Excel (XLSX)
        </Menu.Item>
        <Menu.Item
          leftSection={<IconFileText size={16} />}
          onClick={() => download('export.csv', `kontrola-${base}.csv`)}
        >
          Výsledky – CSV
        </Menu.Item>
        <Menu.Item
          leftSection={<IconPhoto size={16} />}
          onClick={() => download('photos.zip', `fotky-${base}.zip`)}
        >
          Fotky (ZIP s popisy)
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
