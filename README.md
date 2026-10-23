# Curious Explorer

**Small discoveries. Great company.**

![Version 0.1.0 — preview](web/assets/preview-badge.svg)

A thoughtful little character for Microduck. Curious Explorer notices a small change, takes a closer look, and gives the moment a little space. Sometimes the most interesting thing in the room is a leaf.

![An original moss-green duck robot leaning toward a small leaf on an ivory floor.](web/assets/hero-explorer.svg)

## Meet your explorer

Curious Explorer is an **add-on character**, designed to work alongside the skills a duck already has. The character chooses an intention; the robot’s existing software carries it out. It does not replace firmware, train a walking model, or overwrite an owner’s installed skills.

This first preview lets you try the character on your computer. Introduce a discovery, watch its attention change, and read the field notes behind its reactions. Its behavior comes from a small, understandable set of rules; there is no AI subscription or model download.

**Release status:** the browser experience is an illustrated behavior rehearsal with synthetic inputs. It is not a physics simulator and does not see through a camera. The optional local connector is experimental and targets Microduck API 44. Physical robot operation is unsupported, and this release does not include an installer for the duck.

## Take a first look

Try the [Hugging Face preview](https://huggingface.co/spaces/hidrogencloride/curious-explorer) in your browser. Access is private during this first review.

You need **Python 3.11 or later**. The preview has no third-party Python dependencies and needs no GitHub or Hugging Face account to run locally.

For a local copy, choose **Code → Download ZIP** on GitHub, unzip the download, open a terminal in its folder, and run:

```sh
python3 -m explorer
```

Open [http://127.0.0.1:8765](http://127.0.0.1:8765), choose **Let’s explore**, and introduce something to notice. Choose **Take over · pause Explorer** whenever you want to take the lead.

[Your first five minutes →](docs/getting-started.md)

## Your duck stays yours

- **Existing skills stay in place.** Explorer has no install, delete, or replacement operation for robot skills.
- **You choose when it acts.** Sessions have explicit active and paused states.
- **Its belongings stay separate.** The preview’s preferences, skill choices, and simple encounter memories stay in its own browser storage.
- **You can leave cleanly.** Stop the app, clear its browser data if desired, and remove the project folder.

The default local preview never connects to a robot. Connecting to a simulator is a separate, deliberate developer step: the operator must declare that the endpoint is simulated and confirm exclusive control. The connector cannot verify that the endpoint is actually a simulator. It has been checked against protocol fixtures, not a running official simulator or physical robot. Use one controller at a time; pause stops new character actions, while a skill already underway may finish.

[Compatibility and removal →](docs/compatibility.md)

## A character, with room to grow

Explorer is observant, patient, and quietly playful. It does not need to perform constantly to feel present. This release establishes that temperament before adding real perception or physical movement.

The next milestones are to validate the bridge in the official simulator, introduce verified perception, and test on hardware before offering an owner-ready installation flow. These are development goals, not features of this preview.

- [Character and voice](docs/character-and-voice.md) — how Explorer moves, sounds, and speaks through its interface.
- [Architecture](docs/architecture.md) — the boundary between a character, an adapter, and an existing robot skill.
- [Release notes](CHANGELOG.md) — what is included in this preview and what comes later.
- [Official Microduck project](https://github.com/pollen-robotics/microduck) — the robot platform this project is being developed for.

---

Curious Explorer is an independent community project by **hidrogencloride**. It is not an official product of Pollen Robotics, Hugging Face, or NVIDIA. The illustrations are original character artwork, not photographs or engineering diagrams of a robot.

Code, documentation, and original artwork are available under the [Apache 2.0 license](LICENSE).
