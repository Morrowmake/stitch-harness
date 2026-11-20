# native/

English | [中文](README.zh.md)

Native source and packages maintained with Stitch. The [`system/` workspace](system/README.md) owns the Landlock launcher and POSIX flock binding and their platform packages.

## Workspace and release boundary

`system/` and its packages belong to the repository's root pnpm workspace and lockfile. Harness consumers use the current workspace entry package during development and CI, so a launcher contract change and its consumer update can land and be tested together.

The main repository's `Node Addon System` workflow builds and tests each supported architecture on Node 24. Stitch does not publish these packages to npm; the desktop build packs them from the workspace. The entry package retains platform packages as optional dependencies, so an install receives only the package matching the user's operating system and CPU.
