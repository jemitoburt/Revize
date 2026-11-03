import { Buffer } from 'buffer';

// API modules (import parsing, XLSX template) use Node's Buffer.
(globalThis as { Buffer?: unknown }).Buffer ??= Buffer;
