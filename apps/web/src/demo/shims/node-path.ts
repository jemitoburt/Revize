// Browser stand-in for `node:path`; fastify-plugin only names anonymous plugins with it.
export function extname(path: string): string {
  const name = basename(path);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot) : '';
}

export function basename(path: string, ext = ''): string {
  const name = path.split('/').pop() ?? '';
  return ext && name.endsWith(ext) ? name.slice(0, -ext.length) : name;
}
