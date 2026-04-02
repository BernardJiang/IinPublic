const { exec } = require("child_process");

exec('/bin/bash -lc "pwd"', (error, stdout, stderr) => {
  if (error) {
    console.error("Error:", error.message);
    return;
  }

  if (stderr) {
    console.error("Stderr:", stderr);
    return;
  }

  console.log("Output:", stdout);
});

