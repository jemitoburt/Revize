import { Alert, Button, Group, Loader, Menu, Modal, Select, Stack } from '@mantine/core';
import { IconDownload, IconPrinter } from '@tabler/icons-react';
import { useRef, useState } from 'react';
import { DEMO, downloadFile, queryString } from '../api/client.js';
import { useOutbox, useProtocolHtml } from '../api/hooks.js';
import { notifyError } from '../lib/notify.js';

export interface ProtocolPreviewProps {
  inspectionId: string;
  fileName: string;
  /** Equipment types of the inspection: a protocol can be made for one type only. */
  types: { id: string; name: string }[];
  opened: boolean;
  onClose: () => void;
}

/**
 * The protocol exactly as it will be printed, with PDF download (made by the server) and
 * printing from the browser – in the demo printing is the way to get a PDF.
 */
export function ProtocolPreview({
  inspectionId,
  fileName,
  types,
  opened,
  onClose,
}: ProtocolPreviewProps) {
  const [typeId, setTypeId] = useState<string | null>(null);
  const html = useProtocolHtml(inspectionId, typeId, opened);
  const frame = useRef<HTMLIFrameElement>(null);
  const [downloading, setDownloading] = useState(false);
  const base = fileName.replace(/\.pdf$/, '');
  const download = (file: string, query: Record<string, string>, name: string) => {
    setDownloading(true);
    downloadFile(
      `/inspections/${inspectionId}/${file}${queryString({ equipmentTypeId: typeId, ...query })}`,
      name,
    )
      .catch(notifyError)
      .finally(() => setDownloading(false));
  };
  // Results and photos still in this device's outbox are not in the protocol yet.
  const unsent = useOutbox().length;

  return (
    <Modal opened={opened} onClose={onClose} title="Protokol kontroly" size="min(1000px, 100%)">
      <Stack>
        {unsent > 0 && (
          <Alert color="orange">
            V tomto zařízení čeká na odeslání {unsent} změn z terénu (výsledky, fotky). Do protokolu
            se dostanou, až se odešlou.
          </Alert>
        )}
        <Group justify="space-between">
          {types.length > 1 ? (
            <Select
              aria-label="Typ vybavení protokolu"
              w={260}
              data={[
                { value: '', label: 'Všechny typy v jednom protokolu' },
                ...types.map((t) => ({ value: t.id, label: `Jen ${t.name}` })),
              ]}
              value={typeId ?? ''}
              onChange={(v) => setTypeId(v || null)}
              allowDeselect={false}
            />
          ) : (
            <span />
          )}
          <Group>
            <Button
              variant="default"
              leftSection={<IconPrinter size={18} />}
              disabled={!html.data}
              onClick={() => frame.current?.contentWindow?.print()}
            >
              {DEMO ? 'Tisk / uložit jako PDF' : 'Tisk'}
            </Button>
            <Menu position="bottom-end">
              <Menu.Target>
                <Button leftSection={<IconDownload size={18} />} loading={downloading}>
                  Stáhnout
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                {!DEMO && (
                  <>
                    <Menu.Item onClick={() => download('protocol.pdf', {}, `${base}.pdf`)}>
                      PDF (A4)
                    </Menu.Item>
                    <Menu.Item
                      onClick={() =>
                        download('protocol.pdf', { layout: 'two-up' }, `${base}-2-na-list.pdf`)
                      }
                    >
                      PDF – 2 strany na list (A4 na šířku)
                    </Menu.Item>
                  </>
                )}
                <Menu.Item onClick={() => download('protocol.docx', {}, `${base}.docx`)}>
                  Word (DOCX)
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
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
