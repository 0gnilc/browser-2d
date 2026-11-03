export const limits = {
  importBytes: 5 * 1024 * 1024,
  importLines: 10_000,
  importBatchRows: 100,
  fieldLength: 16_384,
  pageSize: 200,
  concurrentTasks: 64,
} as const;
