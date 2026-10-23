# A character above the skills

Curious Explorer separates character decisions from the software that moves a robot. The intended add-on should be inspectable and removable without becoming a replacement robot stack.

## Components

```text
Observations supplied by a host integration
    ↓
src/engine.js — character decisions
    ↓
Semantic action requests
    ↓
Host integration and permission/control management — still to complete
    ↓
explorer/bridge.py — experimental local connector
    ↓
Existing Microduck services and skills
```

These are development components, not an onboard runtime or installer. The behavior engine uses deterministic rules. Its normalized positions and energy values are internal behavior-model values, not measured robot pose or battery state. It has no camera, microphone, or object-recognition pipeline.

## Behavior core

`src/engine.js` exports `Explorer` and `DEFAULT_SETTINGS`. A new instance has no skills and starts paused. Supply a real capability inventory with `setSkills()`, then individual consent with `setAllowedSkills()`. `observe()` supplies an event; `tick(seconds)` returns new semantic intentions.

`start()`, `pause()`, `setSettings()`, `resetMemory()`, and `snapshot()` manage the character’s state. Pausing clears pending intentions; the host must also pause its connector. Memory stays in process unless the host deliberately saves a snapshot. No browser or account is required by the module.

Example inventory exists only in `tests/fixtures/skills.js`. The product core must never present that inventory as abilities installed on a duck.

## Development API

Python 3.11 or later is required; no third-party Python packages are needed. To inspect the disconnected local API:

```sh
python3 -m explorer
```

It listens on `127.0.0.1:8765`. `GET /api/status` returns connection status and a local session token. The root URL and browser-demo paths return JSON errors; the server does not serve HTML, JavaScript, directories, or other files.

To inspect an existing local endpoint without enabling control:

```sh
python3 -m explorer --socket /absolute/path/to/simulator.sock
```

For development against an explicitly simulated endpoint:

```sh
python3 -m explorer --socket /absolute/path/to/simulator.sock --simulator
```

Set up the official simulator separately and replace the example socket path. The flag is an operator declaration, not independent simulator detection. Never use it with physical hardware in this development build.

A local development client sends JSON POST requests with `X-Explorer-Token` from `/api/status`. If it supplies `Origin`, it must match the local API origin. Cross-site requests are rejected.

| Route | Purpose |
| --- | --- |
| `/api/permissions` | Explicitly permit reported skill names through a `skills` array. |
| `/api/arm` | Begin a session with `enabled: true` and `exclusive: true`, after stopping other controllers. |
| `/api/heartbeat` | Renew the five-second lease. |
| `/api/action` | Submit a bounded semantic action. |
| `/api/pause` | Disarm and request a stop for continuous movement. |

No owner-facing client or automatic connection between the behavior engine and this API ships in the current tree. An integrator must implement that orchestration, including consent, lease renewal, action sequencing, and reliable pause handling.

## Connector boundaries

The adapter targets **Microduck API 44**, inspected on October 23, 2026. It uses newline-delimited JSON-RPC over a Unix socket, reads inventory, policies, health, and state, and allows a narrow set of action requests. Unsupported versions remain read-only.

Commands require a declared simulator, an explicitly armed exclusive session, healthy state, and fresh state frames. Requests are bounded, skills require permission, and only one action runs at a time. There are no firmware-write, policy-install, skill-delete, or controller-configuration methods.

The connector has protocol-fixture tests. It has not been validated against a running official simulator or physical Microduck. A running discrete skill can finish after pausing; this API is not a physical emergency stop.

## Verification

```sh
npm test
python3 -m unittest discover -s tests -p 'test_*.py'
python3 scripts/check_distribution.py
```

Tests cover deterministic decisions, empty default inventory, opt-in gestures, pause, memory reset, API gates, lease expiry, and failure handling. HTTP boundary tests confirm that no demo or local source files are served.

The distribution check rejects browser pages, demo directories, and the old Spaces builder in the tracked source tree. The GitHub **Development checks** workflow runs these checks without publishing a package.

## Distribution boundary

The HTML rehearsal and its build tools have been removed from this repository. A local snapshot is retained outside the checkout for internal work. It is not part of the persona, CI artifacts, or default source downloads.

The old `v0.1.0` demo tag is withdrawn. Historical private commits remain for traceability; they are not supported downloads. There is no replacement persona release yet.

Future packaging must use an explicit component allowlist and a tested Microduck installation format. GitHub holds source and eventual releases. Hugging Face distribution will be added only if that format calls for it. A Space demo is not an installation mechanism.

## Upstream references to validate

The upstream main branch can change. Pin a tested commit when establishing compatibility.

- [Microduck source](https://github.com/pollen-robotics/microduck)
- [Local simulation](https://github.com/pollen-robotics/microduck/blob/main/docs/robot/simulation.md)
- [Robot daemon design](https://github.com/pollen-robotics/microduck/blob/main/docs/design/robotd-design.md)
- [Policy channels and skills](https://github.com/pollen-robotics/microduck/blob/main/docs/design/policy-channel-design.md)
- [IPC protocol source](https://github.com/pollen-robotics/microduck/blob/main/duck-ipc-proto/src/lib.rs)

[Back to Curious Explorer](../README.md)
