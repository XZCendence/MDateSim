/** Roster keys shared by the module, the personas, and the client. */
export const DATE_IDS = ['bianca', 'rin'] as const;

export type DateId = (typeof DATE_IDS)[number];
