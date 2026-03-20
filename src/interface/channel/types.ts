export type StateSnapshot = {
  stateRoots: string[];
  storageAddresses: string[];
  storageEntries: StorageEntriesJson;
  channelId: number;
}

export type StorageEntriesJson = { key: string; value: string }[][]

export type TxSnapshot = {
  nonce: number;
  to: string;
  data: string;
  senderPubKey: string;
  v?: string;
  r?: string;
  s?: string;
}
