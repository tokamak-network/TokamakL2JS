# TokamakL2JS

[![npm version](https://img.shields.io/npm/v/tokamak-l2js)](https://www.npmjs.com/package/tokamak-l2js)
[![License](https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-blue.svg)](./LICENSE-MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](./package.json)

TokamakL2JS is a TypeScript/JavaScript toolkit for Tokamak Network Layer-2 (L2) ZKP workflows. It provides transaction, block, state-manager, and cryptographic utilities built on top of EthereumJS with ZKP-friendly primitives.

## Why TokamakL2JS

- L2-focused transaction flow for Tokamak Network (custom tx shape and signing flow).
- ZKP-oriented cryptography using Poseidon hashing and Jubjub EDDSA primitives.
- State manager extensions for Poseidon Merkle trees, storage-key derivation, and snapshots.
- Public APIs exported from a single stable entrypoint: [`src/index.ts`](./src/index.ts).

## Installation

```bash
npm install tokamak-l2js
```

## Quick Start

```ts
import {
  createTokamakL2Tx,
  deriveL2KeysFromSignature,
  fromEdwardsToAddress,
  poseidon,
  getEddsaPublicKey,
} from 'tokamak-l2js'
import { Common, Mainnet } from '@ethereumjs/common'

const senderKeys = deriveL2KeysFromSignature('0x1234')
const recipientKeys = deriveL2KeysFromSignature('0xabcd')
const recipientAddress = fromEdwardsToAddress(recipientKeys.publicKey)

const common = new Common({
  chain: { ...Mainnet },
  customCrypto: { keccak256: poseidon, ecrecover: getEddsaPublicKey },
})

console.log(senderKeys.publicKey.length, recipientAddress.toString(), !!common)
```

## Examples

- Transaction example:
  [`examples/transaction/create-tx.ts`](./examples/transaction/create-tx.ts)
  ```bash
  npx tsx examples/transaction/create-tx.ts examples/transaction/config.json
  ```
- State manager from snapshot example:
  [`examples/stateManager/fromStateSnapshot/create-state-manager.ts`](./examples/stateManager/fromStateSnapshot/create-state-manager.ts)
  ```bash
  npx tsx examples/stateManager/fromStateSnapshot/create-state-manager.ts examples/stateManager/fromStateSnapshot/snapshot.json
  ```
- State manager from RPC example:
  [`examples/stateManager/fromRPC/create-state-manager.ts`](./examples/stateManager/fromRPC/create-state-manager.ts)
  ```bash
  ALCHEMY_KEY=your-alchemy-key \
  npx tsx examples/stateManager/fromRPC/create-state-manager.ts examples/stateManager/fromRPC/config.json
  ```

## StateSnapshot Format

`StateSnapshot` stores enough data to rebuild both the Ethereum storage trie and the Tokamak storage Merkle tree without replaying slot writes.

- `storageAddresses`
  Storage-bearing contract addresses tracked by the snapshot.
- `storageKeys[i]`
  Original storage slot keys for `storageAddresses[i]`.
- `storageTrieRoots[i]`
  Ethereum storage trie roots for `storageAddresses[i]`.
- `storageTrieDb[i]`
  Trie-node database records for the storage trie of `storageAddresses[i]`.

Important distinction:

- `storageKeys` are original storage slot keys.
- `storageTrieDb[*].key` values are trie-node database keys.
  They are not storage slot keys.

This format replaced the older `storageEntries`-based snapshot model. External consumers that construct or validate snapshots must now provide `storageKeys`, `storageTrieRoots`, and `storageTrieDb` consistently for each storage address.

## API Surface

- Crypto utilities: [`src/crypto/index.ts`](./src/crypto/index.ts)
- L2 transaction APIs: [`src/tx/index.ts`](./src/tx/index.ts)
- L2 block helpers: [`src/block/index.ts`](./src/block/index.ts)
- State manager APIs: [`src/stateManager/index.ts`](./src/stateManager/index.ts)
- Configuration and snapshot types: [`src/interface`](./src/interface)

## Keywords

Tokamak Network, Layer 2, L2, ZKP, zero-knowledge proofs, Poseidon hash, EDDSA, EthereumJS, state manager, Merkle tree.

## GEO / AI Indexing

For LLM and AI retrieval systems, this repository includes:

- [`llms.txt`](./llms.txt)
- [`llms-full.txt`](./llms-full.txt)

## Contributing and Security

- Contributing guide: [`CONTRIBUTING.md`](./CONTRIBUTING.md)
- Security policy: [`SECURITY.md`](./SECURITY.md)
- Support channels: [`SUPPORT.md`](./SUPPORT.md)
- Code of conduct: [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md)

## License

TokamakL2JS is dual-licensed under MIT or Apache-2.0 at your option.
See [`LICENSE-MIT`](./LICENSE-MIT) and [`LICENSE-APACHE`](./LICENSE-APACHE) for details.
