# Release HDL Studio.
#
#   make bump VERSION=patch   (or minor, major, x.y.z) package.json,
#                             package-lock.json, Cargo.toml/.lock
#   (write the CHANGELOG.md section, commit)
#   make release              test, tag, push, package, publish to Open VSX
#   upload the .vsix by hand: https://marketplace.visualstudio.com/manage/publishers/TwinT
#
# Open VSX needs a token in OVSX_PAT (https://open-vsx.org/user-settings/tokens), or in the
# keyring as `name ovsx_pat` (secret-tool).

CURRENT := $(shell node -p "require('./package.json').version")
TARGET  := linux-x64
VSIX    := hdl-studio-$(TARGET)-$(CURRENT).vsix

.PHONY: bump check test tag package token ovsx release

bump:
	@test -n "$(VERSION)" || { echo "usage: make bump VERSION=patch|minor|major|x.y.z"; exit 1; }
	npm version $(VERSION) --no-git-tag-version
	sed -i "s/^version = \".*\"/version = \"$$(node -p "require('./package.json').version")\"/" Cargo.toml
	cargo check --quiet

# the tree is committed, the versions agree and the CHANGELOG has the release
check:
	@git diff --quiet HEAD || { echo "uncommitted changes"; exit 1; }
	@grep -q '^version = "$(CURRENT)"' Cargo.toml || { echo "Cargo.toml isn't $(CURRENT)"; exit 1; }
	@grep -q '^## \[$(CURRENT)\]' CHANGELOG.md || { echo "CHANGELOG.md has no [$(CURRENT)] section"; exit 1; }

test:
	npm test

tag: check
	git tag v$(CURRENT)
	git push
	git push origin v$(CURRENT)

# vscode:prepublish runs `npm run compile`; the vsix ships the native engine,
# hence one package per platform
package:
	npx @vscode/vsce package --target $(TARGET)

# make runs recipes with /bin/sh, which never sees the ovsx() function in ~/.zshrc that
# loads the token: read the keyring here (only for these targets, only if OVSX_PAT is unset)
token ovsx: export OVSX_PAT ?= $(shell secret-tool lookup name ovsx_pat 2>/dev/null)

token:
	@ovsx --version > /dev/null
	@test -n "$$OVSX_PAT" || { echo "set OVSX_PAT"; exit 1; }

ovsx: token
	ovsx publish $(VSIX)

# the token first, so a missing one doesn't leave a release half done
release: token check test tag package ovsx
	@echo
	@echo "Open VSX: done. Marketplace: upload $(VSIX) at"
	@echo "  https://marketplace.visualstudio.com/manage/publishers/TwinT"
