// The client typecheck follows SpacetimeDB's published types into the package
// source, including the server runtime. These modules exist only inside that
// host, so declare them here so `tsc` can see the imports.
declare module "spacetime:sys@2.0" {
  export type u16 = number;
  export type u32 = number;
  export type u128 = bigint;
  export type u256 = bigint;
  export type ModuleHooks = any;
  export type ModuleDefaultExport = any;

  export const moduleHooks: any;
  export const console_log: any;
  export const console_timer_end: any;
  export const console_timer_start: any;
  export const datastore_clear: any;
  export const datastore_delete_all_by_eq_bsatn: any;
  export const datastore_delete_by_index_scan_point_bsatn: any;
  export const datastore_delete_by_index_scan_range_bsatn: any;
  export const datastore_index_scan_point_bsatn: any;
  export const datastore_index_scan_range_bsatn: any;
  export const datastore_insert_bsatn: any;
  export const datastore_table_row_count: any;
  export const datastore_table_scan_bsatn: any;
  export const datastore_update_bsatn: any;
  export const get_jwt_payload: any;
  export const identity: any;
  export const index_id_from_name: any;
  export const procedure_abort_mut_tx: any;
  export const procedure_commit_mut_tx: any;
  export const procedure_http_request: any;
  export const procedure_start_mut_tx: any;
  export const row_iter_bsatn_advance: any;
  export const row_iter_bsatn_close: any;
  export const table_id_from_name: any;
}

declare module "spacetime:sys@2.1" {
  export const console_log: any;
  export const console_timer_end: any;
  export const console_timer_start: any;
  export const datastore_clear: any;
  export const datastore_delete_all_by_eq_bsatn: any;
  export const datastore_delete_by_index_scan_point_bsatn: any;
  export const datastore_delete_by_index_scan_range_bsatn: any;
  export const datastore_index_scan_point_bsatn: any;
  export const datastore_index_scan_range_bsatn: any;
  export const datastore_insert_bsatn: any;
  export const datastore_table_row_count: any;
  export const datastore_table_scan_bsatn: any;
  export const datastore_update_bsatn: any;
  export const get_jwt_payload: any;
  export const identity: any;
  export const index_id_from_name: any;
  export const procedure_abort_mut_tx: any;
  export const procedure_commit_mut_tx: any;
  export const procedure_http_request: any;
  export const procedure_start_mut_tx: any;
  export const row_iter_bsatn_advance: any;
  export const row_iter_bsatn_close: any;
  export const table_id_from_name: any;
}

declare module "object-inspect" {
  const inspect: (value: unknown) => string;
  export default inspect;
}

declare module "statuses" {
  const status: any;
  export default status;
}
