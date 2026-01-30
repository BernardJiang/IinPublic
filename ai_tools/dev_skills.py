import subprocess
from antigravity.skills import Skill, skill_action

class ProjectManagerSkill(Skill):
    """A skill to manage local development for iinpublic.com."""

    @skill_action
    def check_service_status(self, port: int) -> str:
        """
        Checks if a service is running on a specific local port.
        :param port: The port number to check (e.g., 8765 for Gun.js).
        """
        try:
            # Using Ubuntu command to check for listening ports
            result = subprocess.check_output(f"lsof -i :{port}", shell=True).decode()
            if result:
                return f"Service is active on port {port}."
        except subprocess.CalledProcessError:
            return f"Nothing is currently running on port {port}."