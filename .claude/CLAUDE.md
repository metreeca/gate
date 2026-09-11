---
title: Project Guidelines
description: Development guidelines and conventions for the @metreeca/gate package.
---

# References

## Dependencies

- [@metreeca/core](https://github.com/metreeca/core) - Core utilities and shared types
- [@metreeca/qest](https://github.com/metreeca/qest) - Linked data models and query languages
- [@metreeca/blue](https://github.com/metreeca/blue) - Model-driven linked data modeling
- [@metreeca/keep](https://metreeca.github.io/keep/) - Model-driven linked data storage

# NPM Scripts

- **`npm run clean`** - Remove dependencies and build artefacts
- **`npm run prime`** - Install dependencies from the lockfile
- **`npm run setup`** - Install dependencies and link sibling `@metreeca/*` repositories
- **`npm run build`** - Compile sources and generate docs
- **`npm run check`** - Run the test suite
- **`npm run proof`** - Serve live docs

> [!CAUTION]
> **`prime` and `setup` are not interchangeable.** Run `prime` when finalising a public release: `@metreeca/*` imports
> resolve to the published releases recorded in the lockfile. Run `setup` for local development against unpublished
> sibling branches: imports resolve to the working copies in the neighbouring repositories.
