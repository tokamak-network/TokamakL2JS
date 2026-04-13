export type StateSnapshot = {
  stateRoots: string[];
  storageAddresses: string[];
  storageKeys: StorageKeysJson;
  storageTrieRoots: string[];
  storageTrieDb: StorageTrieDbJson;
  channelId: number;
}

export type StorageKeysJson = string[][]

export type StorageTrieDbEntryJson = {
  key: string;
  value: string;
}

export type StorageTrieDbJson = StorageTrieDbEntryJson[][]

export type TxSnapshot = {
  nonce: number;
  to: string;
  data: string;
  senderPubKey: string;
  v?: string;
  r?: string;
  s?: string;
}
