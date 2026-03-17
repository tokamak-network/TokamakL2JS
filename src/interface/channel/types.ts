export type StateSnapshot = {
  stateRoots: string[];
  storageAddresses: string[];
  registeredKeys: { key: string; value: string }[][];
  entryContractAddress: string;
  channelId: number;
}