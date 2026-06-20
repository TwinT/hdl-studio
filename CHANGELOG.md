# Changelog

All notable changes to HDL Studio will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.1] - 2026-06-20

### Added
- Initial release of HDL Studio, forked from [digitaljs_code](https://github.com/yuyichao/digitaljs_code) v0.7.3 by Yichao Yu.
- Renamed extension and all internal identifiers from `digitaljs` to `hdl-studio`.
- Replaced GitHub-sourced dependencies (`digitaljs`, `digitaljs_lua`, `svg-pan-zoom`, `yosysjs`) with stable npm registry versions.
- Removed `yosysjs` (WebAssembly Yosys) in favour of native Yosys binary running in the associated dev-container.
- New icon and branding (HDL Studio chip icon).
- Updated `publisher`, `repository` and `version` fields in `package.json`.
