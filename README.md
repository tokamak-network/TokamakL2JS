# TokamakL2JS

TokamakL2JS defines the specification for Tokamak Network's Layer-2 ZKP. TokamakL2JS is built on top of EthereumJS.

# How TokamakL2JS differs from EthereumJS
- It targets Tokamak Network's Layer-2/ZKP requirements, rather than general-purpose Ethereum protocol tooling.
- It replaces core cryptography with ZKP-friendly primitives (Poseidon hashing and Jubjub EDDSA) instead of Keccak/ECDSA.
- Transactions include an explicit sender public key (since EDDSA has no public key recovery) and EDDSA signature flow, with a custom message layout and serialization.
- State management extends EthereumJS with a Poseidon-based Merkle tree, L2 storage key derivation, and snapshot/RPC initialization paths.
- It provides L2-specific utilities and constants to support Tokamak Network's execution model.

# Examples
## TokamakL2StateManager
[create-state-manager.ts](./examples/stateManager/create-state-manager.ts) provides an example script that creates a [TokamakL2StateManager](./src/stateManager/TokamakL2StateManager.ts).

```bash
cd ./examples/stateManager
tsx ./create-state-manager.ts ./config.json
```

## TokamakL2Transaction
[create-tx.ts](./examples/transaction/create-tx.ts) provides an example script that creates a [TokamakL2Tx](./src/tx/TokamakL2Tx.ts).

```bash
cd ./examples/transaction
tsx ./create-tx.ts ./config.json
```

# License
TokamakL2JS is dual-licensed under MIT or Apache-2.0 at your option.
See `LICENSE-MIT` and `LICENSE-APACHE` for details.
