export type ChannelStateNetwork = 'mainnet' | 'sepolia' | 'anvil';

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
  network: ChannelStateNetwork;
  participants: ChannelParticipantConfig[];
  storageConfigs: ChannelStorageConfig[];
  callCodeAddresses: `0x${string}`[];
  blockNumber: number;
}

export type ChannelFunctionConfig = {
  selector: `0x${string}`;
  entryContractAddress: `0x${string}`;
};

export type ChannelTxConfig = {
  txNonce: number;
  calldata: `0x${string}`;
  function: ChannelFunctionConfig;
};

export type ChannelErc20TransferTxConfig = ChannelTxConfig;

export type ChannelErc20TransferTxSimulationConfig = 
  ChannelStateConfig & ChannelTxConfig;
