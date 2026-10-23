# A good guest on your duck

Curious Explorer is being built to add character while respecting the software an owner already uses. Its boundaries should be explicit and testable.

## Current status

| Component | Status |
| --- | --- |
| Behavior core | Development code, exercised with synthetic observations and fixture skills. No real perception. |
| Local connector | Experimental, targets Microduck API 44; verified against protocol fixtures only. |
| Official browser sandbox | Sim-only adapter and reproducible scripted workshop; stock walking policy, pinned upstream revision. [Evidence and limits](sandbox-testing.md). |
| Official daemon simulator | Python connector integration validation outstanding. |
| Physical Microduck | Unsupported; no hardware operation has been tested. |
| Onboard installation, updates, and removal | Not implemented or validated. |
| Original HTML rehearsal | Separated from the current product repository and download path. Local development tool only. |

## Skills remain the owner’s

Explorer does not ship a replacement walking policy. Its connector cannot add, rename, delete, or download robot skills. It also cannot edit robot configuration or controller buttons.

A fresh behavior core has no installed skills. An integration must supply the endpoint’s actual inventory and separately grant permission for a compatible gesture. Test fixtures are never the default inventory.

Preserving files does not guarantee that every third-party skill can be used by the character. Missing or incompatible abilities should produce a smaller reaction, not an unexpected installation.

## Control is a separate responsibility

The experimental connector requires an explicit session and an operator-declared simulator before enabling commands. Other controllers must be stopped for that session. The `--simulator` flag is an operator attestation; the connector cannot independently prove the target type.

A five-second lease must be renewed by the development client. Pause stops new requests and asks the endpoint to stop continuous movement. A discrete skill already underway may finish. This is not an emergency stop or evidence of physical stopping behavior.

Automatic controller takeover has not been implemented or verified for the Python connector. The browser sandbox adapter yields to the sandbox’s existing inputs and requires explicit resume. This does not validate hardware handoff. Physical operation remains unsupported.

## Data and removal

The behavior core keeps its state in memory and returns detached snapshots. Persistence is the host integration’s responsibility. The source components do not create an account, install a background service, or write robot settings.

If you attached the browser workshop, first follow the [sandbox removal instructions](sandbox-testing.md) to remove its copied files and import from the separate sandbox checkout. Then stop the development processes and remove the Curious Explorer project folder. Existing robot software is outside those paths. A future installer must have a separately tested removal procedure before it is offered to owners.

## Evidence needed before release

Validate the supported add-on installation mechanism and pin a compatible upstream version. Compare skill and configuration snapshots before and after simulator sessions, including pause, disconnect, and process-exit cases. Then test the same boundaries on hardware, along with updates and removal.

Protocol fixtures support development; they do not replace integration or hardware testing.

[Back to Curious Explorer](../README.md)
