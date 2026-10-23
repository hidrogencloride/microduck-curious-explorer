# Bringing Explorer home

Curious Explorer is being developed as a character you choose for your duck. The intended experience is straightforward: install the add-on, choose which compatible skills it may use, and decide when it has control.

**That installation flow is not available yet.** The current source is for development. There is no supported install command, one-click package, or onboard startup integration to recommend today.

## What a future installation should do

- Keep the duck’s firmware, walking policies, installed skills, and controller mappings in place.
- Store Explorer’s preferences and memory separately.
- Ask before using an optional compatible gesture.
- Provide a clear way to pause, update, and remove the character.
- Leave the owner’s other software working after removal.

These are requirements for the future package, not claims about a released installer.

## Where it will come from

**GitHub** holds the source, documentation, and eventual tested releases. A source ZIP is development material; it is not an installable persona.

**Hugging Face** will be considered only if the verified Microduck installation flow uses it for persona distribution. The retired browser Space is not a character package and should not be used for installation.

The HTML demonstration is a separate local development tool. It will not be bundled with the persona or presented as the thing to install.

## Accounts and requirements

The current behavior code does not call a cloud model or require an AI subscription. Accounts, device registration, host software, and permissions for an eventual robot installation must be established against the supported upstream flow before we publish setup instructions.

Until then, we will avoid asking owners to create accounts or download unrelated software on the assumption that it will be needed.

Developers can use [Architecture](architecture.md) to inspect and test the components. For what has and has not been verified, see [Compatibility](compatibility.md).

[Back to Curious Explorer](../README.md)
