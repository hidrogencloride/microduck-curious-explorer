# A character above the skills

Curious Explorer separates a character’s decisions from the software that moves a robot. The character should be portable, inspectable, and removable without becoming a replacement robot stack.

## The boundary

```text
Observation
    ↓
Curious Explorer behavior rules
    ↓
Character intention
    ├── Illustrated browser preview
    └── Optional experimental local adapter
              ↓
       Existing Microduck services and skills
```

The preview supplies synthetic observations. The behavior engine chooses a small reaction. A presentation layer shows that reaction in the browser; an optional adapter can translate supported intentions to an existing simulator interface.

The behavior engine does not need a language model. It should not depend on a specific camera, locomotion model, cloud provider, or user account. Later perception work can supply observations through the same boundary without rewriting the character.

The browser stores settings, allowed skill choices, and simple encounter memory in `localStorage` under `curious-explorer:v1`. Clearing encounter memory preserves settings and skill choices. It stores no raw camera or microphone input. The browser’s sound setting controls emitted sound intentions and their field notes; this preview does not play audio.

## Run modes

The Python server requires Python 3.11 or later and uses the standard library. Run it from the complete project folder:

```sh
python3 -m explorer
```

It binds to `127.0.0.1:8765`. Use `--port` to choose another local port. With no socket argument, there is no robot connection.

To inspect an existing local simulator endpoint without enabling control, provide its Unix socket:

```sh
python3 -m explorer --socket /absolute/path/to/simulator.sock
```

For an explicitly simulated endpoint, provide the actual simulator socket and the simulator declaration:

```sh
python3 -m explorer --socket /absolute/path/to/simulator.sock --simulator
```

Set up the [official simulator](https://github.com/pollen-robotics/microduck/blob/main/docs/robot/simulation.md) separately. The paths above are examples to replace with your endpoint’s path. `--simulator` attests to the target type; it does not verify it. Never use that flag for a physical robot in this release.

In **Bring your simulator along**, check the connection, confirm other controllers are paused, and choose **Enable simulator control**. Starting Explorer begins character decisions. The illustrated practice field remains a rehearsal view and does not become a live visualization of the simulator’s body or sensors.

## Experimental bridge contract

The adapter targets **Microduck API 44**, inspected on October 23, 2026. It uses newline-delimited JSON-RPC over a local Unix socket and reads the endpoint’s skill inventory, policies, health, and state. Control is gated on the inspected API version, a declared simulator, an explicitly armed session, healthy state, and recent state frames.

Its method allowlist includes read methods and a narrow set of look, head, move, sound, skill, and stop commands. It has no file-write, policy-install, skill-delete, or controller-configuration operation. Optional skills require individual permission and must be reported by the endpoint. Missing or unsupported skills do not trigger downloads.

The browser renews an active control lease. The bridge pauses when that lease expires after five seconds, when its state checks fail, or when the session ends. Movement requests are bounded and brief; these software bounds still require validation in the official simulator before they establish physical behavior.

The bridge currently has fixture-based protocol tests. It has **not been validated with a running official MuJoCo simulator or physical Microduck**. Physical robot operation is unsupported, including when inspecting a read-only endpoint.

## The additive contract

1. The default process runs locally and does not connect to a robot.
2. A connection requires an explicit developer action and a specific target.
3. An adapter can request supported actions; it cannot install, remove, or replace robot skills.
4. Character preferences and memory remain in application-owned storage.
5. Unsupported capabilities degrade to a smaller behavior or a clear status.
6. Paused sessions do not continue autonomous decisions.
7. Removing the application does not require changing robot firmware or configuration.

Keep filesystem and configuration writes out of the robot adapter. Do not grant a generic remote shell or policy-install interface merely to make a new gesture possible.

## Control ownership

Preserving skills and arbitrating control are separate responsibilities. Explorer currently uses an explicit session model. A simulator experiment should have one active controller; the operator pauses or stops Explorer before giving control to another client.

Do not infer manual takeover from the lack of a command, and do not describe pause as a physical emergency stop. Pause ends new character decisions and requests a stop for continuous movement; a discrete skill already underway may complete. Disconnect behavior and command persistence must be verified against the selected upstream version before any hardware release.

## Development stages

| Stage | Evidence required |
| --- | --- |
| Behavior preview | Deterministic reactions, pause behavior, understandable activity notes, clear synthetic-input labeling. |
| Simulator integration | Confirmed wire format, supported commands, explicit session boundaries, unchanged skills and configuration. |
| Physical pilot | Observed hardware behavior, tested interruption and recovery, conservative movement limits, versioned compatibility. |
| Owner installation | Documented setup and removal, accountable updates, clear permissions, a tested recovery path. |

This release covers the behavior preview and includes an experimental adapter for further work. It does not establish physical or permanent-install compatibility.

## Useful upstream references

These links identify the platform surfaces to validate. The upstream `main` branch can change; pin a tested commit when establishing compatibility.

- [Microduck source](https://github.com/pollen-robotics/microduck): the platform repository.
- [Local simulation](https://github.com/pollen-robotics/microduck/blob/main/docs/robot/simulation.md): running the official simulated body and services.
- [Robot daemon design](https://github.com/pollen-robotics/microduck/blob/main/docs/design/robotd-design.md): control responsibilities and intent handling.
- [Policy channels and skills](https://github.com/pollen-robotics/microduck/blob/main/docs/design/policy-channel-design.md): movement-policy boundaries and skill concepts.
- [IPC protocol source](https://github.com/pollen-robotics/microduck/blob/main/duck-ipc-proto/src/lib.rs): source-level command definitions.

## Verification priorities

Test decisions with a controlled clock and synthetic observations. Confirm that pause blocks further actions, a missing capability does not trigger a replacement or download, and the default server makes no robot connection.

Test adapters with a fake endpoint for message shape and failure handling, then repeat against the pinned official simulator. Record pre- and post-session skill/configuration snapshots. Include interrupted connections and process exits, not only successful actions.

Browser presentation checks should include keyboard access, a narrow viewport, reduced motion, refresh behavior, and an empty or cleared journal. A polished preview should accurately describe what the software does at every stage.

## Build the hosted preview

The editable browser files live in `web/`. The release builder embeds their CSS, JavaScript, and original SVG artwork into two standalone pages. It also creates a Hugging Face Spaces README with `sdk: static` and `app_file: index.html`, and includes the project license. Python’s standard library is sufficient; no package installation or network access is needed.

From the project folder, choose an output directory outside the checkout:

```sh
python3 scripts/build-space.py --output ../curious-explorer-space
```

For this project’s initial workspace, the release staging command is:

```sh
python3 scripts/build-space.py --output ../../work/hf-space
```

Upload the generated `index.html`, `guide.html`, `README.md`, and `LICENSE` to the Space. Keep editing the source files in `web/`, then rebuild; do not maintain a separate copy of the character in the generated HTML. The builder checks that scripts, styles, icons, and illustrations have been embedded. Navigation between the practice field and field guide remains local to the Space.

The hosted version retains the browser character, preferences, memories, and field notes. Simulator control remains a local-companion capability: the hosted page makes no calls to a robot or to a visitor’s local server.

The GitHub **Preview checks** workflow runs the Node behavior tests, Python bridge tests, and the standalone build for pushes and pull requests. It does not publish or deploy the result.

[Back to Curious Explorer](../README.md)
