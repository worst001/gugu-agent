# Bundled RTK

Gugu Agent desktop release builds bundle a fixed RTK binary so normal users do
not need a global `rtk` install.

Current version: `0.39.0`

Layout:

```text
desktop/vendor/rtk/
  manifest.json
  x86_64-pc-windows-msvc/rtk.exe
  aarch64-apple-darwin/rtk
```

Every target entry in `manifest.json` must include the exact SHA256 of the
source file. Windows CI/signed builds and `GUGU_REQUIRE_BUNDLED_RTK=1` builds
fail if the entry or file is missing, or if the hash does not match. macOS
bundled RTK is not enforced yet; when the macOS binary is added, use
`GUGU_REQUIRE_BUNDLED_RTK=1` to validate it explicitly.

When adding the macOS Apple Silicon binary, place it at
`desktop/vendor/rtk/aarch64-apple-darwin/rtk`, mark it executable, add its
SHA256 to `manifest.json`, then run:

```bash
cd desktop
GUGU_REQUIRE_BUNDLED_RTK=1 TAURI_ENV_TARGET_TRIPLE=aarch64-apple-darwin bun run build:sidecars
```
