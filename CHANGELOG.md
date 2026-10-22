# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.12.0](https://github.com/metreeca/gate/compare/v0.11.0...HEAD)

### Added

- Add `@metreeca/gate/driver`: `driver()` serves the resources a `@metreeca/blue` shape describes as a REST/JSON API,
  enabling retrieval, creation, replacement and removal per route, with no handler code to write
- Let `server()` take the `@metreeca/keep` store holding the resources served by every driver of the application
- Add `ServerOpts.base`, the canonical IRI identifying served resources wherever the server runs; IRIs sharing its
  scheme and authority are exchanged with clients in root-relative form, in payloads and `Location` headers alike

### Changed

- Declare `express` as a peer dependency and `@types/express` as an optional one: applications now install `express`
  themselves, choosing the Express release their own routes build on alongside the package
- Depend on `@metreeca/blue` `^0.13.0`, `@metreeca/keep` `^0.12.2` and `@metreeca/qest` `^0.13.0`, imported by drivers

### Security

- Upgrade `vite` to `8.3.5`, `vitest` to `4.1.12` and `markdown-it` to `14.3.3`, clearing the advisories `npm audit`
  raised against them (development dependencies only, so applications installing the package are unaffected)

## [0.11.0](https://github.com/metreeca/gate/compare/v0.10.0...v0.11.0) - 2026-10-19

### Added

- `Server` and `ServerOpts`: the type of the applications created by `server()`, and the options of their `listen()`
- `ServerOpts.signal`: closes the server on demand when aborted, as `SIGINT` or `SIGTERM` would
- `@metreeca/gate/client`: `client()` serves a browser client from the same origin as the API; client-side addresses
  survive reloads, and HTTP caches keep pages apart from API responses for the same address
- `@metreeca/gate/worker`: `worker()` runs an asynchronous action on each request, answering `200 OK` once it
  completes and passing its failures on to the error middleware of the surrounding stack

### Changed

- `server()` creates an Express application served over HTTP by its own `listen()`, replacing `server.start()` and
  `server.stop()`; `listen()` returns a promise that settles once the server is closed by its signal or by the process
- `ServerOpts.host` rejects addresses containing whitespace as malformed
- `ServerOpts.port` defaults to a free port assigned by the operating system instead of `8080`
- `ServerOpts.proxies` defaults to `0` instead of `1`, trusting no forwarded caller address unless proxies are declared
- `shutdown` option renamed to `ServerOpts.grace`, and also applied when the server is closed through its signal
- Upgrade `@metreeca/core` to `^0.13.0`
- Upgrade `@metreeca/http` to `^0.5.0`
- Upgrade `@metreeca/tape` to `^0.12.0`

### Removed

- Dependencies on `@metreeca/blue`, `@metreeca/keep` and `@metreeca/qest`, which no module of the package imports

## [0.10.0](https://github.com/metreeca/gate/compare/v0.9.1...v0.10.0) - 2026-10-14

### Added

- `server`: HTTP server hosting an Express router behind a proxy, with request tracing, bodiless error responses and
  graceful shutdown on `SIGINT` and `SIGTERM`

### Changed

- Upgrade `@metreeca/blue` to `^0.12.1`
- Upgrade `@metreeca/core` to `^0.12.1`
- Upgrade `@metreeca/http` to `^0.4.1`
- Upgrade `@metreeca/keep` to `^0.11.1`
- Upgrade `@metreeca/qest` to `^0.12.1`
- Upgrade `@metreeca/tape` to `^0.11.1`
- requires `@metreeca/blue` `^0.12.0`, `@metreeca/core` `^0.12.0`, `@metreeca/keep` `^0.11.0` and `@metreeca/qest`
  `^0.12.0`
- requires `@metreeca/http` `^0.4.0`, `@metreeca/tape` `^0.11.0` and `express` `^5.3.0`

## [0.9.1](https://github.com/metreeca/gate/compare/v0.9.0...v0.9.1) - 2026-09-09

### Changed

- requires `@metreeca/blue` `^0.10.0`, `@metreeca/core` `^0.10.0`, `@metreeca/keep` `^0.10.0` and `@metreeca/qest`
  `^0.10.0`, so that the package resolves the storage framework rather than the placeholder `@metreeca/keep` `0.9.0`
  claimed the name with
