import { Alert, Button, Group, Loader, Modal, Stack } from '@mantine/core';
import { IconDownload, IconPrinter } from '@tabler/icons-react';
import { useRef, useState } from 'react';
import { DEMO, downloadFile } from '../api/client.js';
import { useProtocolHtml } from '../api/hooks.js';
import { notifyError } from '../lib/notify.js';

export interface ProtocolPreviewProps {
  inspectionId: string;
  fileName: string;
  opened: boolean;
  onClose: () => void;
}

/**
 * The protocol exactly as it will be printed, with PDF download (made by the server) and
 * printing from the browser – in the demo printing is the way to get a PDF.
 */
export function ProtocolPreview({ inspectionId, fileName, opened, onClose }: ProtocolPreviewProps) {
  const html = useProtocolHtml(inspectionId, opened);
  const frame = useRef<HTMLIFrameElement>(null);
  const [downloading, setDownloading] = useState(false);

  return (
    <Modal opened={opened} onClose={onClose} title="Protokol kontroly" size="min(1000px, 100%)">
      <Stack>
        <Group justify="flex-end">
          <Button
            variant="default"
            leftSection={<IconPrinter size={18} />}
            disabled={!html.data}
            onClick={() => frame.current?.contentWindow?.print()}
          >
            {DEMO ? 'Tisk / uložit jako PDF' : 'Tisk'}
          </Button>
          {!DEMO && (
            <Button
              leftSection={<IconDownload size={18} />}
              loading={downloading}
              onClick={() => {
                setDownloading(true);
                downloadFile(`/inspections/${inspectionId}/protocol.pdf`, fileName)
                  .catch(notifyError)
                  .finally(() => setDownloading(false));
              }}
            >
              Stáhnout PDF
            </Button>
          )}
        </Group>
        {html.isPending && <Loader m="xl" />}
        {html.error && <Alert color="red">{html.error.message}</Alert>}
        {html.data && (
          <iframe
            ref={frame}
            title="Náhled protokolu"
            srcDoc={html.data}
            style={{
              width: '100%',
              height: '75vh',
              border: '1px solid var(--mantine-color-gray-3)',
              background: 'white',
            }}
          />
        )}
      </Stack>
    </Modal>
  );
}
