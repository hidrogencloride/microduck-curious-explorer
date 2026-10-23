# Your first five minutes

You do not need a duck yet. This preview gives Curious Explorer a small world to pay attention to, so you can get to know its temperament while hardware support is still being developed.

## 1. Bring Explorer home

Download and extract the project. Open a terminal in the extracted folder and check your Python version:

```sh
python3 --version
```

Use Python **3.11 or later**, then start the preview:

```sh
python3 -m explorer
```

Open [http://127.0.0.1:8765](http://127.0.0.1:8765). Keep that terminal running while you use Explorer. No sign-in, payment, API key, or additional Python package is required. If the port is already in use, run `python3 -m explorer --port 8766` and use the address printed in the terminal.

## 2. Let it notice something

Choose **Let’s explore** in the practice field. Try **A rustling leaf**, **A new object**, or **Say hello**. Give Explorer a moment to orient, inspect, and settle. **A blocked path** lets you preview a pause in its wandering.

The inputs are deliberately simple. A control represents an event the character might eventually learn about through a sensor. Today, **you supply that event**. The preview does not access your camera, recognize objects, or simulate a robot’s balance.

The activity notes explain what caught Explorer’s attention and what it chose to do. The illustrated duck helps you read that intention; its animation is not a prediction of real robot motion.

## 3. Get a feel for its rhythm

Try a few discoveries with pauses between them. Explorer should leave enough quiet around a reaction for you to notice it. A character that is always performing has no room left to be curious.

Give your explorer a name and adjust **Curiosity** or **Adventure pace** to see how the rhythm changes. **Little creature sounds** adds sound cues to the field notes; the browser preview does not play audio. These preferences stay in this browser, separate from any robot configuration.

## 4. Take the lead

Choose **Take over · pause Explorer** to stop new character actions. Resume when you want Explorer to continue.

This explicit handoff is part of the product: the owner decides when the character has control. It does not establish automatic controller detection on a physical duck.

## 5. Leave things tidy

Choose **Begin a fresh field journal**, then **Start fresh**, to clear encounter memories while keeping the name, preferences, and skill choices. Close the browser tab and press **Control-C** in the terminal to stop the local server.

To remove the preview, delete its project folder. To remove everything it saved in this browser, clear this app’s site data. The preview stores no camera or microphone recordings.

Neither running nor removing the preview changes a robot’s skills or settings.

## When you are ready for the simulator

The optional bridge is for development against a **locally running official Microduck simulator**. It is separate from the illustrated preview and needs the simulator’s dependencies and setup. Its current verification uses protocol fixtures; an official simulator session has not been validated. A Hugging Face account is not needed for this project’s local preview; upstream robot registration or hosted services may have their own requirements.

Read [Compatibility](compatibility.md) before connecting, then follow the developer instructions in [Architecture](architecture.md). The connector requires Microduck API 44 and an operator-declared simulator. Physical robot operation is unsupported, and this release has no installer for the duck.

[Back to Curious Explorer](../README.md)
