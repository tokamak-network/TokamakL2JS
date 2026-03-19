export type StateSnapshot = {
  stateRoots: string[];
  storageEntries: {storageAddress: string, members: {key: string, value: string}[]}[];
  channelId: number;
}

export type TxSnapshot = {
  nonce: number;
  to: string;
  data: string;
  senderPubKey: string;
  v?: string;
  r?: string;
  s?: string;
}
