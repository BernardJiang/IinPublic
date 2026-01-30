import subprocess
import sys
import os

def is_port_in_use(port):
    try:
        # Windows command to see if port is active
        output = subprocess.check_output(f'netstat -ano | findstr :{port}', shell=True).decode()
        return "LISTENING" in output
    except subprocess.CalledProcessError:
        return False

def start_relay(port):
    print(f"Port {port} is free. Starting Gun.js relay...")
    # 'start' command in Windows opens a NEW terminal window 
    # so the AI doesn't hang waiting for the server to close.
    # Replace 'npm start' with your actual start command if different.
    cmd = f'start cmd /k "npm run dev -- --port={port}"'
    subprocess.Popen(cmd, shell=True)
    return "Relay start command issued in a new window."

if __name__ == "__main__":
    port_to_check = sys.argv[1] if len(sys.argv) > 1 else "8765"
    
    if is_port_in_use(port_to_check):
        print(f"Status: Port {port_to_check} is already active. No action needed.")
    else:
        result = start_relay(port_to_check)
        print(result)