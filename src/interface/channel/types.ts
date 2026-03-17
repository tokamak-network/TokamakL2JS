export type StateSnapshot = {
  stateRoots: string[];
  storageAddresses: string[];
  registeredKeys: { key: string; value: string }[][];
  channelId: number;
}

export type TransactionSnapshot = {
  nonce: string;
  to: string;
  data: string;
  senderPubKey: string;
  v: string;
  r: string;
  s: string;
}
