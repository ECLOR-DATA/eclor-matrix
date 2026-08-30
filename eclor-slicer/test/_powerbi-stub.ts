// Minimal stub for `powerbi-visuals-api`. Test code only references
// types, never runtime symbols, so an empty default export is enough
// to satisfy the import resolver under Jest.
const stub = {
  visuals: {},
  extensibility: { visual: {} },
  DataView: undefined,
  DataViewCategoryColumn: undefined,
  DataViewValueColumn: undefined
};

export default stub;
export const visuals = stub.visuals;
export const extensibility = stub.extensibility;
