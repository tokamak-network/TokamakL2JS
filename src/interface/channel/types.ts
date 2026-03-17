export type StateSnapshot = {
  stateRoots: string[];
  storageAddresses: string[];
  registeredKeys: { key: string; value: string }[][];
  channelId: number;
}
