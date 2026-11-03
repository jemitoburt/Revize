import {
  Alert,
  Button,
  Group,
  Loader,
  Menu,
  Modal,
  MultiSelect,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Text,
} from '@mantine/core';
import { DEFAULT_APPENDIX_COLUMNS } from '@revize/shared';
import { IconDownload, IconPrinter } from '@tabler/icons-react';
import { useRef, useState } from 'react';
import { DEMO, downloadFile, queryString } from '../api/client.js';
import { useOutbox, useProtocolColumns, useProtocolHtml } from '../api/hooks.js';
import { notifyError } from '../lib/notify.js';

const COLUMNS_KEY = 'revize.protocol-columns';

/** The last chosen appendix columns of this browser (a convenience, not stored data). */
function loadColumns(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(COLUMNS_KEY) ?? 'null') as unknown;
    if (Array.isArray(saved) && saved.every((v) => typeof v === 'string')) return saved;
  } catch {
    // Blocked or broken storage: fall back to the defaults.
  }
  return [...DEFAULT_APPENDIX_COLUMNS];
}

function saveColumns(columns: string[]) {
  try {
    localStorage.setItem(COLUMNS_KEY, JSON.stringify(columns));
  } catch {
    // Not remembered, nothing else depends on it.
  }
}

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
  const columnOptions = useProtocolColumns(inspectionId, opened);
  const [withList, setWithList] = useState(false);
  /** Defects with cards and photos: all, red and yellow, or only red. */
  const [defects, setDefects] = useState<'all' | 'red-amber' | 'red'>('all');
  const [columns, setColumns] = useState<string[]>(loadColumns);
  const html = useProtocolHtml(inspectionId, typeId, opened, columns, withList, defects);
  const frame = useRef<HTMLIFrameElement>(null);
  const [downloading, setDownloading] = useState(false);
  const base = fileName.replace(/\.pdf$/, '');
  const download = (file: string, query: Record<string, string>, name: string) => {
    setDownloading(true);
    downloadFile(
      `/inspections/${inspectionId}/${file}${queryString({
        equipmentTypeId: typeId,
        columns: columns.join(',') || undefined,
        appendix: withList ? 'always' : undefined,
        defects: defects === 'all' ? undefined : defects,
        ...query,
      })}`,
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
                <Menu.Divider />
                <Menu.Label>Jen příloha 1 – tabulka vybavení</Menu.Label>
                {!DEMO && (
                  <Menu.Item
                    onClick={() =>
                      download(
                        'protocol.pdf',
                        { part: 'appendix' },
                        `${base.replace(/^protokol/, 'priloha-1')}.pdf`,
                      )
                    }
                  >
                    Příloha 1 – PDF
                  </Menu.Item>
                )}
                <Menu.Item
                  onClick={() =>
                    download(
                      'protocol.docx',
                      { part: 'appendix' },
                      `${base.replace(/^protokol/, 'priloha-1')}.docx`,
                    )
                  }
                >
                  Příloha 1 – Word
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Group>
        <Stack gap={6}>
          <Text size="sm" c="dimmed">
            Když se tabulka vybavení nevejde na první stranu, protokol na ni jen odkáže a vytiskne
            ji jako Přílohu 1 na A4 na šířku se zvolenými sloupci. Velikost fotek a počet sloupců
            závad se volí tak, aby měl protokol co nejméně stran.
          </Text>
          <SegmentedControl
            aria-label="Závady s fotkami v protokolu"
            data={[
              { value: 'all', label: 'Všechny závady' },
              { value: 'red-amber', label: 'Červené a žluté' },
              { value: 'red', label: 'Jen červené' },
            ]}
            value={defects}
            onChange={(v) => setDefects(v as typeof defects)}
          />
          <Switch
            label="Tabulku vybavení vždy jako Přílohu 1"
            checked={withList}
            onChange={(e) => setWithList(e.currentTarget.checked)}
          />
          <MultiSelect
            label="Sloupce přílohy 1"
            description="V pořadí, v jakém je vyberete. Výběr se zapamatuje."
            data={(columnOptions.data ?? []).map((c) => ({ value: c.key, label: c.label }))}
            value={columns}
            onChange={(next) => {
              setColumns(next);
              saveColumns(next);
            }}
            searchable
            clearable
          />
        </Stack>
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
