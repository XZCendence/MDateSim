/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SPACETIMEDB_HOST: string;
  readonly VITE_SPACETIMEDB_DB_NAME: string;
  readonly VITE_DATE_LINE_NUMBER: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
