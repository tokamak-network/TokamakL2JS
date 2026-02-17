# Acceptance Checks

- Block creation must fail when `common.customCrypto` is missing.
- Header `gasLimit` must be copied to each tx during block assembly.
- Fixed test vector block hash should remain stable unless explicit breaking change is approved.
- Block constructor output should keep transaction ordering.
