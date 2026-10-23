# Field notes from the workshop

## Unreleased — Product and demo separated

The browser rehearsal is now a separate local development tool. It is excluded from the current product repository and intended persona packages.

- Retained the behavior core, experimental connector, tests, and original documentation artwork.
- Moved illustrative skill inventory into test fixtures. New characters start with no installed skills.
- Changed the connector to an API-only development service; no browser pages or source files are served.
- Removed the hosted-demo builder and its CI step. Added a distribution boundary check.
- Reworked setup documentation around the intended persona installation and its outstanding validation.
- Retired the Hugging Face demo and withdrew the `v0.1.0` download tag. Private Git history is retained for traceability.

There is no installable persona release yet. Official simulator integration, hardware behavior, and onboard installation remain unvalidated.

## 0.1.0 — Historical internal demonstration

The original browser demonstration established a visual direction and a rules-based behavior rehearsal, with synthetic encounters and an experimental local connector. It was not a robot persona installer. Its release tag has been withdrawn and it is not a supported download.

[About Curious Explorer](README.md) · [Compatibility](docs/compatibility.md)
