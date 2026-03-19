export type StateSnapshot = {
  stateRoots: string[];
  storageAddresses: string[];
  registeredKeys: RegisteredKeysJson;
  entryContractAddress: string;
  channelId: number;
}

export type RegisteredKeysJson = {key: string, value: string}[][]

export type TxSnapshot = {
  nonce: number;
  to: string;
  data: string;
  senderPubKey: string;
  v?: string;
  r?: string;
  s?: string;
}
