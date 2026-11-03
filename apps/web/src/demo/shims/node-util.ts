// Browser stand-in for `node:util`; @fastify/error only formats messages ("Invalid schema: %s").
export function format(message: string, ...args: unknown[]): string {
  let index = 0;
  return message.replace(/%[sdjo]/g, () => String(args[index++]));
}
