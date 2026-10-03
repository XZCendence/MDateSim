/// <reference path="../node_modules/spacetimedb/src/server/sys.d.ts" />

declare module 'object-inspect' {
  export default function inspect(value: unknown): string;
}

declare module 'statuses' {
  export default function status(code: number): string;
}
