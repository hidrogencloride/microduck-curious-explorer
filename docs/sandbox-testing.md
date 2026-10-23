# A little room to explore

Curious Explorer can be tried in a local copy of the official Microduck Sandbox. This is a developer simulation session: the duck moves through MuJoCo physics using the sandbox’s existing walking policy, while Explorer supplies short movement and head-pose requests.

The session is **sim-only**. Its observations are scripted. It does not test camera recognition, speech, the Python robot connector, or installation on a physical duck.

## Set up the workshop

Use Node.js 22.12 or later, Git, and Git LFS. Clone the two projects into separate folders. From the folder that will contain them:

```sh
git clone https://github.com/hidrogencloride/microduck-curious-explorer.git
git clone https://huggingface.co/spaces/pollen-robotics/microduck-simulator.git
cd microduck-simulator
git checkout ad9d41a763f30dc770817c33d92dcfec0205db1e
git lfs pull
cd app
npm ci
cd ../../microduck-curious-explorer
node scripts/attach-sandbox.mjs "$(cd ../microduck-simulator && pwd)"
cd ../microduck-simulator/app
npm run dev -- --host 127.0.0.1
```

Open the address printed by Vite. Choose **Waddle in**, wait for the entrance to finish, then select **Run checks** in the Explorer panel. Keep the tab visible. Each check begins from a reset and settled simulated duck, runs for 18 simulated seconds, and leaves Explorer paused. **Save results** downloads the measured report.

**Explore** starts an interactive session. Keyboard, gamepad, and existing sandbox controls take priority. **Pause** clears Explorer’s movement request. Resuming requires an explicit start. Changing the tab or leaving the window pauses the session.

The attachment script checks the exact upstream revision and refuses unresolved model/policy LFS pointers. It adds an import, three local source files, and an ownership manifest to your sandbox checkout. It does not change policies, models, firmware, robot settings, or the hosted Space. To remove the attachment, run this from your Curious Explorer checkout:

```sh
node scripts/attach-sandbox.mjs --remove /absolute/path/to/microduck-simulator
```

Removal checks the attachment’s recorded hashes and refuses to discard edited files. Both attach and removal operate on the specified local checkout only.

## Why the simulator has its own movement profile

Our first tests sent the behavior engine’s gentle 0.033 m/s request directly to the stock walking policy. The duck barely moved. We compared stock keyboard input and the adapter under the same starting conditions and measured actual simulated time.

| Input, four simulated seconds | Maximum displacement from start |
| --- | ---: |
| Stock keyboard path, 0.25 m/s | 0.379 m |
| Adapter, 0.25 m/s | 0.374 m |
| Adapter, 0.033 m/s | 0.0014 m |
| Adapter, 0.15 m/s | 0.0075 m |
| Adapter, 0.25 m/s with head yaw | 0.364 m |

These runs isolate a low-speed response in this particular walking policy. They do not establish a universal minimum walking speed. The keyboard baseline replayed ArrowUp events through the stock keyboard source; it did not bypass that source.

The workshop therefore maps positive movement requests to the stock keyboard’s **0.25 m/s command**, while preserving their short duration and stop events. That command is a requested velocity, not measured speed. The behavior engine and Python connector retain their original settings. This profile is only for the pinned browser sandbox, feet mode, and the stock policy; it must not be used as a hardware calibration.

Timing follows the simulation clock. A slow browser must not shorten a step simply because rendering and physics run at different rates. The adapter pauses on clock discontinuities, incompatible modes, manual control, and unsupported actions. Temporary head targets are restored only while Explorer still owns those values.

[Recorded comparison measurements](results/sandbox-comparison-2026-10-23.json) identify the source revision and measured command durations. One set of runs is integration evidence, not a statistical robustness study.

## What these checks establish

Two calibrated 18-second runs completed with about **0.18 m** and **0.21 m** maximum displacement from their starting positions. Both cleared the obstacle command, paused and resumed, left the policy objects unchanged, and restored head targets. In the second run, one second after the final stop, the policy command was zero and additional displacement was about 0.11 mm. [Final run summary](results/sandbox-run-2026-10-23.json).

The scripted sequence requests short steps and looks, sends an obstacle event at eight seconds, pauses for an owner-control event at ten seconds, and explicitly resumes at twelve seconds. It records movement, delivered policy commands, pause/resume, policy-object identity, and head-target restoration. It also measures motion one second after the final stop.

A separate interactive check used a brief ArrowUp press. Explorer yielded immediately, cleared its request, and remained paused after the key was released. This also covers key presses that finish between rendered frames.

The checks do not establish real perception, autonomous obstacle avoidance, arbitrary third-party skill compatibility, emergency stopping, or hardware safety. The Python connector still needs testing against the official daemon simulator. A physical installer, updates, and removal remain future work.

[Back to Curious Explorer](../README.md)
