# Check Port Skill

## Description
Use this skill to check if a specific local port (like 8765 for Gun.js) is currently active on Windows.

## Instructions
When the user asks if a port is running:
1. Extract the port number from their message.
2. Run the script `check_port.py` using Python.
3. Pass the port number as the first argument.

## Command
python {{SKILL_ROOT}}/check_port.py {{port}}