// bot.js
const TelegramBot = require("node-telegram-bot-api");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");

// 🔑 Set your Telegram bot token here
const token = process.env.TELEGRAM_TOKEN || "8639168961:AAE9BYdCww3PZPc75XmY-ZGSaFpErbnDHIA";

// 🔒 Replace with your Telegram user ID (IMPORTANT)
const ALLOWED_USER_ID =  594959684;

// 📁 Your project directory
const WORK_DIR = "/Users/hongyujiang/IinPublic";

// 🚀 Create bot
const bot = new TelegramBot(token, { polling: true });

// 🧪 Startup diagnostics
console.log("Bot starting...");
console.log("bash exists:", fs.existsSync("/bin/bash"));
console.log("sh exists:", fs.existsSync("/bin/sh"));
console.log("Work dir:", WORK_DIR);

// 📨 Handle messages
bot.on("message", (msg) => {
  const chatId = msg.chat.id;

  // 🔒 Security check
  if (msg.from.id !== ALLOWED_USER_ID) {
    return bot.sendMessage(chatId, "Unauthorized");
  }

  const text = msg.text || "";

  // Help message
  if (text === "/start" || text === "/help") {
    return bot.sendMessage(chatId,
      `Usage:
      run: <command>

      Examples:
      run: pwd
      run: whoami
      run: ls
      run: npm run test:e2e`
    );
  }

  // Only allow "run:" commands
  if (!text.startsWith("run:")) {
    return bot.sendMessage(chatId, "Use: run: <command>");
  }

  let cmd = text.replace("run:", "").trim();

  if (!cmd) {
    return bot.sendMessage(chatId, "Empty command.");
  }
  if (cmd === "test") {
    cmd = "./run_e2e_with_summary.sh";
  } 
  if (cmd === "test2") {
    cmd = "./scripts/run_e2e.sh";
  } 
  // 🔐 Escape double quotes
  const safeCmd = cmd.replace(/"/g, '\\"');

  // 🔥 CRITICAL: wrap with bash (fixes your issue)
  const fullCmd = `/bin/bash -lc "${safeCmd}"`;

  console.log("Executing:", fullCmd);

  // ⏳ Let user know it's running
  bot.sendMessage(chatId, "⏳ Running...");

  exec(fullCmd, {
    cwd: WORK_DIR,
    timeout: 10 * 60 * 1000,
    maxBuffer: 50 * 1024 * 1024,
    env: {
      PATH: "/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin",
      HOME: process.env.HOME
    }
  }, (error, stdout, stderr) => {
  
    let output = "";
  
    if (stdout) output += stdout;
    if (stderr) output += "\n[stderr]\n" + stderr;
    if (error) output += "\n[error]\n" + error.message;
  
    if (!output.trim()) {
      output = "No output";
    }
  
    // 📁 Save full log
    const logFile = path.join(WORK_DIR, "logs", `test_${Date.now()}.log`);
    fs.writeFileSync(logFile, output);
  
    // 📤 Send file to Telegram
    bot.sendDocument(chatId, logFile, {}, {
      filename: "test.log",
      contentType: "text/plain"
    });
  
    // ✂️ Also send short preview (first 1000 chars)
    const preview = output.slice(0, 1000);
  
    bot.sendMessage(chatId,
      "📄 Log file sent. Preview:\n```" + preview + "```",
      { parse_mode: "Markdown" }
    );
  });
});

// ❌ Error logging
bot.on("polling_error", (err) => {
  console.error("Polling error:", err.message);
});