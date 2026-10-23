# A good guest on your duck

Curious Explorer is being built to add character while respecting everything an owner has already installed. Its first release makes that boundary small and inspectable.

## What works in this release

| Environment | Status | What it means |
| --- | --- | --- |
| Local browser preview | Available | Run the app, supply synthetic observations, and explore the character’s decisions. No robot connection. |
| Local official Microduck simulator | Experimental bridge | Protocol-fixture tests only. A running official simulator has not been validated. Requires separate setup. |
| Physical Microduck | Unsupported | No hardware operation has been tested. This release is for the browser rehearsal and simulator development. |
| Permanent installation on a duck | Planned | No one-click installer, boot service, or owner-ready onboarding yet. |
| Real camera or microphone input | Not included | The preview receives events from its controls, not from sensors. |

## What the preview touches

The application serves files from this project on your computer and uses its own browser data for the explorer’s name, preferences, allowed skill choices, and simple encounter memories. The default startup does not discover a robot, ask for account credentials, install a system service, or write to robot configuration.

The browser storage key is `curious-explorer:v1`. **Begin a fresh field journal** clears encounter memories while preserving settings and skill choices. Clearing this app’s site data clears all of its saved browser data. The preview does not access a camera or microphone, and it does not play its sound cues as audio.

Deleting the project and clearing the app’s browser site data removes the local preview. Unrelated files, other websites’ data, and robot software are outside that removal path.

## Skills remain the owner’s

Explorer does not ship a replacement walking policy. It does not add, rename, delete, or download robot skills. Its optional adapter is limited to requesting actions through an existing service.

Preserving files does not guarantee that every future third-party skill can be used by the character. A skill must expose a compatible action and be selected deliberately before Explorer can rely on it. Missing abilities should produce a smaller reaction or a clear explanation, never an unexpected installation.

The full compatibility goal includes both file preservation and behavior compatibility. File preservation can be checked now; a hardware compatibility promise must wait for hardware testing.

## One session, one controller

An active character may issue action commands. Pausing ends its decisions and asks the endpoint to stop continuous movement. A discrete skill already running may finish. Pause is not an emergency stop.

For simulator development, give Explorer a dedicated session and stop other control programs first. Pause or stop Explorer before using another controller. Do not assume that a gamepad press automatically pauses the character: that handoff is not implemented or verified in this release.

The bridge requires Microduck API 44, an explicit `--simulator` declaration, and confirmation of an exclusive session in the interface before it enables control. This flag is the operator’s attestation; the protocol cannot prove that an endpoint is simulated. Physical operation is unsupported. Without `--simulator`, a supplied socket remains read-only.

The active bridge session requires a browser heartbeat and expires after five seconds without renewal. This limits continued command generation; it is not proof of the endpoint’s actual stopping behavior after a network or process failure.

The upstream [robot daemon design](https://github.com/pollen-robotics/microduck/blob/main/docs/design/robotd-design.md) describes its control model. Our adapter should remain explicit about ownership rather than infer that another client has taken over.

## A removal check you can repeat

1. Before starting, note the existing files in your robot or simulator setup. Keep this project in its own folder.
2. Run the local preview, try a few observations, and save any preferences you want to keep.
3. Stop the server with Control-C. Clear the preview’s browser site data and delete the project folder.
4. Verify that the original robot or simulator files are unchanged and its existing controls still work.

For bridge testing, take a separate snapshot of the simulator’s skill and configuration directories before the session. Compare them afterward. Include active, paused, disconnect, and process-exit cases. Passing a mocked adapter test is useful evidence for software boundaries; it does not replace this integration check or a later hardware test.

[Back to Curious Explorer](../README.md)
