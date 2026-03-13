import { Common, type CommonOpts, Mainnet, Sepolia } from "@ethereumjs/common";
import {
  bytesToHex,
  createAddressFromString,
  hexToBytes,
  setLengthLeft,
  utf8ToBytes,
} from "@ethereumjs/util";
import { jubjub } from "@noble/curves/misc.js";
import { getEddsaPublicKey, poseidon } from "../../crypto/index.js";
import {
  storageKeysForAddress,
  TokamakL2StateManagerOpts,
} from "../../stateManager/types.js";
import { fromEdwardsToAddress, getUserStorageKey } from "../../utils/index.js";
import { deriveL2KeysFromSignature } from "../wallet/index.js";
import { ChannelStateConfig } from "./types.js";

export const DEFAULT_ANVIL_CHAIN_ID = 31337;

export type CreateStateManagerOptsFromChannelConfigOptions = {
  anvilChainId?: number;
};

const getAnvilChainId = (value: number | undefined): number => {
  const chainId = value ?? DEFAULT_ANVIL_CHAIN_ID;
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error(`anvilChainId must be a positive safe integer; got ${chainId}`);
  }
  return chainId;
};

export function createStateManagerOptsFromChannelConfig(
  config: ChannelStateConfig,
  options: CreateStateManagerOptsFromChannelConfigOptions = {}
): TokamakL2StateManagerOpts {
  const privateSignatures = config.participants.map((entry) =>
    bytesToHex(jubjub.utils.randomPrivateKey(setLengthLeft(utf8ToBytes(entry.prvSeedL2), 32)))
  );

  const derivedPublicKeyListL2 = privateSignatures.map((sig) => {
    const keySet = deriveL2KeysFromSignature(sig);
    return jubjub.Point.fromBytes(keySet.publicKey);
  });

  const initStorageKeys: storageKeysForAddress[] = [];
  for (const entryByAddress of config.storageConfigs) {
    const keyPairs: { L1: Uint8Array; L2: Uint8Array }[] = [];
    for (const preAllocatedKey of entryByAddress.preAllocatedKeys) {
      const keyBytes = setLengthLeft(hexToBytes(preAllocatedKey), 32);
      keyPairs.push({ L1: keyBytes, L2: keyBytes });
    }
    for (const slot of entryByAddress.userStorageSlots) {
      for (let userIdx = 0; userIdx < config.participants.length; userIdx++) {
        const participant = config.participants[userIdx];
        const L1key = getUserStorageKey([participant.addressL1, slot], "L1");
        const L2key = getUserStorageKey(
          [fromEdwardsToAddress(derivedPublicKeyListL2[userIdx]), slot],
          "TokamakL2"
        );
        keyPairs.push({
          L1: L1key,
          L2: L2key,
        });
      }
    }
    initStorageKeys.push({
      address: createAddressFromString(entryByAddress.address),
      keyPairs,
    });
  }

  const chain =
    config.network === "sepolia"
      ? Sepolia
      : config.network === "anvil"
        ? {
            ...Mainnet,
            name: "anvil",
            chainId: getAnvilChainId(options.anvilChainId),
          }
        : Mainnet;
  const commonOpts: CommonOpts = {
    chain: {
      ...chain,
    },
    customCrypto: { keccak256: poseidon, ecrecover: getEddsaPublicKey },
  };
  const common = new Common(commonOpts);

  return {
    common,
    blockNumber: config.blockNumber,
    entryContractAddress: createAddressFromString(config.entryContractAddress),
    initStorageKeys,
    callCodeAddresses: config.callCodeAddresses.map((str) =>
      createAddressFromString(str)
    ),
  };
}
