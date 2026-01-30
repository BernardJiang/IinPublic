# run_agent.py
from antigravity import Agent
from ai_tools.dev_skills import ProjectManagerSkill  # Import the class from your other file

# 1. Initialize the Skill
my_skill = ProjectManagerSkill()

# 2. Initialize the Agent with that skill
dev_assistant = Agent(
    name="DevOpsHelper",
    instructions="You are a senior dev assistant helping with iinpublic.com.",
    skills=[my_skill]
)

# 3. Test it
if __name__ == "__main__":
    response = dev_assistant.chat("Check if port 8765 is active.")
    print(f"Agent Response: {response}")