// StateSnapshot type definition (matches usage in adapter)
export type StateSnapshot = {
  stateRoots: string[];
  storageAddresses: string[];
  registeredKeys: string[][];
  storageEntries: { key: string; value: string }[][];
  preAllocatedLeaves: { key: string; value: string }[][];
  entryContractAddress: string;
  channelId: number;
}