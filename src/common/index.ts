import { Common, Mainnet } from "@ethereumjs/common";
import { getEddsaPublicKey, poseidon } from "../crypto/index.js";

export const createTokamakL2Common = (): Common => {
  return new Common({
    chain: {
      ...Mainnet,
    },
    customCrypto: { keccak256: poseidon, ecrecover: getEddsaPublicKey },
  });
};