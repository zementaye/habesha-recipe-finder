const TelegramBot = require("node-telegram-bot-api");

const TOKEN = process.env.BOT_TOKEN;
const WEB_APP_URL = process.env.WEB_APP_URL; // your Vercel URL, e.g. https://habesha-recipe-finder.vercel.app

if (!TOKEN) {
  console.error("Missing BOT_TOKEN environment variable. Get one from @BotFather.");
  process.exit(1);
}
if (!WEB_APP_URL) {
  console.error("Missing WEB_APP_URL environment variable. Set it to your deployed frontend URL.");
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });

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
        ],
      },
    }
  );
});

bot.onText(/\/help/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    "Just tap *Find a Recipe* (or the menu button) to open the app, add the ingredients you have, and see what you can cook. 🍽️",
    { parse_mode: "Markdown" }
  );
});

// Friendly fallback for any other message
bot.on("message", (msg) => {
  if (msg.text && msg.text.startsWith("/")) return; // let command handlers deal with it
  bot.sendMessage(
    msg.chat.id,
    "Tap the button below to find a recipe 👇",
    {
      reply_markup: {
        inline_keyboard: [[{ text: "🍲 Find a Recipe", web_app: { url: WEB_APP_URL } }]],
      },
    }
  );
});

bot.on("polling_error", (err) => console.error("Polling error:", err.message));

console.log("Bot is running with polling...");
