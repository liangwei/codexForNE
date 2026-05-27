# npm releases

Use the staging helper in the repo root to generate npm tarballs for an NE-CLI
release:

```bash
./scripts/stage_npm_packages.py \
  --release-version 1.0.3 \
  --package codex
```

When `--package codex` is provided, the staging helper builds the lightweight
`@noteexpress/cli` package plus the platform-native alias packages used by npm
optional dependencies.

Direct `build_npm_package.py` invocations are useful for package-specific
debugging, but native packages expect `--vendor-src` to point at a prehydrated
`vendor/` tree.
