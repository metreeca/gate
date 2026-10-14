# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased](https://github.com/metreeca/gate/compare/v0.9.1...HEAD)

### Added

- `server`: HTTP server hosting an Express router behind a proxy, with request tracing, bodiless error responses and
  graceful shutdown on `SIGINT` and `SIGTERM`

### Changed

- requires `@metreeca/blue` `^0.12.0`, `@metreeca/core` `^0.12.0`, `@metreeca/keep` `^0.11.0` and `@metreeca/qest`
  `^0.12.0`
- requires `@metreeca/http` `^0.4.0`, `@metreeca/tape` `^0.11.0` and `express` `^5.3.0`

## [0.9.1](https://github.com/metreeca/gate/compare/v0.9.0...v0.9.1) - 2026-09-09

### Changed

- requires `@metreeca/blue` `^0.10.0`, `@metreeca/core` `^0.10.0`, `@metreeca/keep` `^0.10.0` and `@metreeca/qest`
  `^0.10.0`, so that the package resolves the storage framework rather than the placeholder `@metreeca/keep` `0.9.0`
  claimed the name with
