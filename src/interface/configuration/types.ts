export type ChannelParticipantConfig = {
  addressL1: `0x${string}`;
  prvSeedL2: string;
};

export type ChannelStorageConfig = {
  address: `0x${string}`;
  userStorageSlots: number[];
  preAllocatedKeys: `0x${string}`[];
}

export type ChannelStateConfig = {
  network: 'mainnet' | 'sepolia';
  participants: ChannelParticipantConfig[];
  storageConfigs: ChannelStorageConfig[];
  entryContractAddress: `0x${string}`;
  callCodeAddresses: `0x${string}`[];
  blockNumber: number;
}

export type ChannelErc20TransferTxConfig = {
  txNonce: number;
  senderIndex: number;
  recipientIndex: number;
  amount: `0x${string}`;
  transferSelector: `0x${string}`;
};

export type ChannelErc20TransferTxSimulationConfig = 
  ChannelStateConfig & ChannelErc20TransferTxConfig;