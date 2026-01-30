---
name: gunjs-manager
description: Manages the Gun.js relay server for iinpublic.com. Use this when the user asks to start the server or check its status.
---

# Gun.js Manager Protocol

## When to use this skill
- When the user asks "Is my chat server running?"
- When the user says "Start my Gun.js relay."
- Before testing the chatroom website to ensure the backend is alive.

## Instructions
1. Default to port `8765` unless the user specifies otherwise.
2. Run the script `manage_gun.py` using the local Python interpreter.
3. If the script output says "Starting Gun.js...", tell the user: "The relay wasn't running, so I've launched it in a new terminal for you."
4. If the script says "already active," tell the user: "Your relay is already up and running."

## Command
python {{SKILL_ROOT}}/manage_gun.py {{port}}