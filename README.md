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
- State manager from RPC example:
  [`examples/stateManager/fromRPC/create-state-manager.ts`](./examples/stateManager/fromRPC/create-state-manager.ts)
  ```bash
  RPC_URL=https://your-rpc.example npx tsx examples/stateManager/fromRPC/create-state-manager.ts examples/stateManager/fromRPC/config.json
  ```

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
