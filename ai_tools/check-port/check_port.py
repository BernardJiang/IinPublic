import subprocess
import sys

def check_port(port):
    try:
        # Windows command to check if a port is active
        command = f'netstat -ano | findstr :{port}'
        result = subprocess.check_output(command, shell=True).decode()
        if "LISTENING" in result:
            print(f"Success: Port {port} is active.")
        else:
            print(f"Warning: Port {port} is in use but not listening.")
    except subprocess.CalledProcessError:
        print(f"Error: Port {port} is free (nothing running).")

if __name__ == "__main__":
    # Get the port from the AI's command line argument
    if len(sys.argv) > 1:
        check_port(sys.argv[1])