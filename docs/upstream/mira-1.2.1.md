# Mira 1.2.1 firmware audit

This is a read-only audit of the pinned upstream archive. No operation described
here has been executed against a Car Thing.

## Archive verification

- Filename: `mira_firmware_v1.2.1.zip`
- Size: `505935185` bytes — verified
- SHA-256:
  `5533424790d50deec4f7a7ffa07620835f58152db7845de4e543cdf524f7d705`
  — verified against the publisher's release record
- ZIP CRC/integrity test — passed
- Metadata schema: Terbium v1 schema, `metadataVersion: 2`
- Metadata identity: `mira` version `1.2.1`

## What flashing this archive does

The archive is a complete dual-slot replacement, not a web-app-only update. Its
ordered metadata performs these operations:

1. Selects eMMC user area with `amlmmc part 1`.
2. Loads `superbird.dtb` into RAM and runs `store dtb write`, followed by
   `store init 1`, which can rebuild the device partition table.
3. Writes `factory_dtb.bin` directly to user-area LBAs 81920 and 82432.
4. Restores `fip_a`, `fip_b`, `logo`, both DTBO and vbmeta slots, both boot
   slots, both system slots, `misc`, and the named `bootloader` partition.
5. Replaces the environment from `env.txt` and calls `saveenv`.
6. Writes `boot_hwpart_mira.bin` to both eMMC boot hardware partitions.

This is intentionally invasive and explains why the exact archive must be
visible and verified immediately before flashing.

## Payload inventory

| Payload | Uncompressed bytes | SHA-256 |
|---|---:|---|
| `fip_a.dump` | 4,194,304 | `217096c4b3c3435756b8aadc28e80da7e14cc3aff28976fde5978e9964514250` |
| `meta.json` | 2,864 | `fab184ada1e65c9f7a1d633dc25a2e1821f6acf69ae3390f74be31baf0e794f4` |
| `dtbo_a.dump` | 4,194,304 | `29a0a52ffe3244102f502a510328f7ede59e0e4e1eafff025313c2a59174f601` |
| `system_a.ext2` | 541,065,216 | `3973c5558f6b1cb56a14730971d2e773dc1a26a2cf022c9d88527d53369bbd17` |
| `dtbo_b.dump` | 4,194,304 | `29a0a52ffe3244102f502a510328f7ede59e0e4e1eafff025313c2a59174f601` |
| `superbird.dtb` | 105,087 | `18c603571b884e1fe840d44bfecd1aa0426c56a37dc4e5e33ba6dcfb3fb02136` |
| `bootloader.dump` | 4,194,304 | `4def1db43ca4b508464d1496865d46f4702aed5e1b802daf6d320bc1c99b428e` |
| `vbmeta_b.dump` | 1,048,576 | `f4893a26548998258f7e684c03178bb23a1b51e96f179e82ec3a4c54ca4f1aa8` |
| `factory_dtb.bin` | 262,144 | `f4f4118fe5f7db010142ec1412199d36bb20ccf75ca6493735390c566181000f` |
| `fip_b.dump` | 4,194,304 | `217096c4b3c3435756b8aadc28e80da7e14cc3aff28976fde5978e9964514250` |
| `misc.dump` | 8,388,608 | `33560e0e1333bbb4f3ddc3a23cccb4efbb1eb290497984d36c8fed9ad0e38707` |
| `boot_hwpart_mira.bin` | 2,097,152 | `7f062f06dca6f117b8b55e4cf43667271f73d9b57ec09acc61af70fd9e587767` |
| `system_b.ext2` | 541,065,216 | `3973c5558f6b1cb56a14730971d2e773dc1a26a2cf022c9d88527d53369bbd17` |
| `logo.dump` | 1,536,468 | `cc177e6323289388257c4c0bfcd58978a13916b40f3b88048664ed0b354bf457` |
| `boot_a.dump` | 16,777,216 | `0c2a6dab8aa312c4b118f88641d1835c5a2e63d94a58a79c63d540428c069d94` |
| `env.txt` | 3,703 | `b1563dccdfe4544904498c9050bbdcbef9ff85a6e64410ab5f959ec35b080c98` |
| `vbmeta_a.dump` | 1,048,576 | `f4893a26548998258f7e684c03178bb23a1b51e96f179e82ec3a4c54ca4f1aa8` |
| `boot_b.dump` | 16,777,216 | `0c2a6dab8aa312c4b118f88641d1835c5a2e63d94a58a79c63d540428c069d94` |

The A/B payload pairs are byte-identical in this release.

## FlashThing compatibility

FlashThing `v0.6.0` supports metadata versions 1 and 2 and implements every
operation used by this archive: `bulkcmd`, `log`, `writeLargeMemory`,
`writeUserArea`, `restorePartition`, `writeEnv`, and `writeBootPartition`.

It also validates target partition sizes and rejects payloads larger than their
partitions. On Linux it requires libusb access and an installed udev rule. We
have not installed or run the tool yet.

## Recovery position

The verified Mira archive is the known-good recovery image for the HerThing
bring-up cycle: a failed HerThing boot can be recovered by re-entering Amlogic
burn mode and reflashing this pinned archive. This does not preserve or restore
the original Spotify firmware or its user data. A stock backup/readback is not
currently available and should not be implied.
