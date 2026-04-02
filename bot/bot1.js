const TelegramBot = require("node-telegram-bot-api");
const { exec } = require("child_process");

// 🔑 put your token here
const token = "8639168961:AAE9BYdCww3PZPc75XmY-ZGSaFpErbnDHIA";

// 🔒 replace with your Telegram user ID (important!)
const ALLOWED_USER_ID = 594959684;

const fs = require("fs");

console.log("Does /bin/sh exist?", fs.existsSync("/bin/sh"));
console.log("Does /bin/bash exist?", fs.existsSync("/bin/bash"));

const bot = new TelegramBot(token, { polling: true });

bot.on("message", (msg) => {
  // 🔒 security check
  if (msg.from.id !== ALLOWED_USER_ID) {
    return bot.sendMessage(msg.chat.id, "Unauthorized");
  }

  const text = msg.text;

  // Only allow commands starting with "run:"
  if (!text.startsWith("run:")) {
    return bot.sendMessage(msg.chat.id, "Use: run: <command>");
  }

  const cmd = text.replace("run:", "").trim();

  // 🧠 wrap with bash (THIS is your Step 1 fix)
  const fullCmd = `/bin/bash -lc "${cmd}"`;

  console.log("About to run ", fullCmd);

  exec(fullCmd, {
    shell: "/bin/bash",
    cwd: "/Users/YOUR_USERNAME/IinPublic",
    timeout: 10 * 60 * 1000, // 10 min
    env: {
      PATH: "/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
    }
  }, (error, stdout, stderr) => {

    let output = "";

    if (error) {
      output += `Error:\n${error.message}\n`;
    }

    if (stderr) {
      output += `Stderr:\n${stderr}\n`;
    }

    if (stdout) {
      output += `Stdout:\n${stdout}\n`;
    }

    if (!output) {
      output = "No output";
    }

    // Telegram message limit ~4096 chars
    bot.sendMessage(msg.chat.id, "```" + output.slice(0, 4000) + "```", {
      parse_mode: "Markdown"
    });
  });
});
