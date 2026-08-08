const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");
const path = require("path");

const TOKEN = process.env.BOT_TOKEN;
const WEB_APP_URL = process.env.WEB_APP_URL; // your Vercel URL, e.g. https://habesha-recipe-finder.vercel.app
// Optional: a chat ID (your own, or a group) that "Report a problem"
// messages get forwarded to in real time. Get yours from @userinfobot.
// Feedback is still saved locally either way — see feedback.json.
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;

if (!TOKEN) {
  console.error("Missing BOT_TOKEN environment variable. Get one from @BotFather.");
  process.exit(1);
}
if (!WEB_APP_URL) {
  console.error("Missing WEB_APP_URL environment variable. Set it to your deployed frontend URL.");
  process.exit(1);
}
if (!ADMIN_CHAT_ID) {
  console.warn("ADMIN_CHAT_ID not set — feedback will only be saved to feedback.json, not forwarded.");
}

const bot = new TelegramBot(TOKEN, { polling: true });

// Tracks which chats are mid-way through "/feedback" (i.e. their next
// message should be treated as a report, not a normal command/chat).
const awaitingFeedback = new Set();

const FEEDBACK_PATH = path.join(__dirname, "feedback.json");
function saveFeedback(entry) {
  let all = [];
  try {
    all = JSON.parse(fs.readFileSync(FEEDBACK_PATH, "utf8"));
  } catch (err) {
    if (err.code !== "ENOENT") console.error("Failed to read feedback.json:", err.message);
  }
  all.push(entry);
  try {
    fs.writeFileSync(FEEDBACK_PATH, JSON.stringify(all, null, 2));
  } catch (err) {
    console.error("Failed to save feedback.json:", err.message);
  }
}

const reportButton = { text: "📝 Report a problem", callback_data: "start_feedback" };

function promptForFeedback(chatId) {
  awaitingFeedback.add(chatId);
  bot.sendMessage(
    chatId,
    "Sure — send me the dish name (if any) and what looked wrong, all in one message. I'll pass it along. 🙏"
  );
}

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const firstName = msg.from.first_name || "there";

  bot.sendMessage(
    chatId,
    `👋 Selam ${firstName}!\n\nWelcome to *Habesha & World Kitchen* — tell me what's in your kitchen and I'll find dishes you can cook, from doro wat to pad thai.\n\nTap the button below to get started.`,
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "🍲 Find a Recipe", web_app: { url: WEB_APP_URL } }],
          [reportButton],
        ],
      },
    }
  );
});

bot.onText(/\/help/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    "Just tap *Find a Recipe* (or the menu button) to open the app, add the ingredients you have, and see what you can cook. 🍽️\n\nSpotted something wrong with a recipe? Send /feedback and tell me what looked off.",
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/feedback/, (msg) => {
  promptForFeedback(msg.chat.id);
});

// Handles taps on the "📝 Report a problem" inline button, wherever it appears.
bot.on("callback_query", (query) => {
  if (query.data === "start_feedback") {
    promptForFeedback(query.message.chat.id);
  }
  bot.answerCallbackQuery(query.id).catch(() => {});
});

bot.on("message", (msg) => {
  if (msg.text && msg.text.startsWith("/")) return; // let command handlers deal with it
  const chatId = msg.chat.id;

  // If we're mid-/feedback, this message IS the report — not a normal chat.
  if (awaitingFeedback.has(chatId)) {
    awaitingFeedback.delete(chatId);
    const text = (msg.text || "").trim();

    if (!text) {
      bot.sendMessage(chatId, "That came through empty — mind sending it as text? You can also try /feedback again.");
      return;
    }

    const entry = {
      id: `${Date.now()}-${chatId}`,
      dishName: null, // free-form: the user includes the dish name in their message, if any
      message: text.slice(0, 2000),
      contact: msg.from.username ? `@${msg.from.username}` : null,
      source: "telegram",
      chatId,
      createdAt: new Date().toISOString(),
    };
    saveFeedback(entry);

    if (ADMIN_CHAT_ID) {
      const lines = [
        "🐞 New feedback (Telegram)",
        `From: ${entry.contact || `chat ${chatId}`}`,
        `Message: ${entry.message}`,
      ];
      bot.sendMessage(ADMIN_CHAT_ID, lines.join("\n")).catch((err) => {
        console.error("Failed to forward feedback to ADMIN_CHAT_ID:", err.message);
      });
    }

    bot.sendMessage(chatId, "Thanks — got it! 🙏");
    return;
  }

  // Friendly fallback for any other message
  bot.sendMessage(
    chatId,
    "Tap the button below to find a recipe, or let me know if something's wrong with a recipe 👇",
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🍲 Find a Recipe", web_app: { url: WEB_APP_URL } }],
          [reportButton],
        ],
      },
    }
  );
});

bot.on("polling_error", (err) => console.error("Polling error:", err.message));

console.log("Bot is running with polling...");
