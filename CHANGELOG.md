# Field notes from the workshop

## 0.1.0 — Preview · October 23, 2026

Our first small world for Curious Explorer: a place to meet the character, try a few encounters, and establish how it can be a good guest alongside a duck’s existing skills.

### In this preview

- An illustrated practice field with four synthetic encounters: movement, an object, a greeting, and a blocked path.
- One coherent character with a name, curiosity level, adventure pace, and visible sound cues. The browser preview does not play audio.
- An explicit start-and-pause flow, field notes, and simple encounter memories stored in the browser.
- An example skill library with an optional greeting bow. The preview’s library is illustrative, not a reading of a robot.
- A local companion with no third-party Python dependencies. Ordinary startup stays in browser preview mode.
- An experimental Microduck API 44 connector with read-only inspection, individual skill permission, and an expiring control session for operator-declared simulators.
- Original artwork and a field guide, with setup, removal, compatibility, and developer documentation.

### Still ahead

The practice field is an illustrated rehearsal, not a physics simulation. It has no real camera perception, microphone input, or conversational AI.

The connector has protocol-fixture tests; it has not been validated with the official MuJoCo simulator or physical hardware. Declaring a simulator does not prove the target type. Physical robot operation is unsupported. There is no installer for the duck in this release.

The add-on preserves the boundary around the owner’s skills: no firmware replacement, skill installation or removal, policy changes, or controller-button edits. Establishing behavior compatibility on a real duck remains future work.

[Meet Curious Explorer](README.md) · [Compatibility](docs/compatibility.md)
