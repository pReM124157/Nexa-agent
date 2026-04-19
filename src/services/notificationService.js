const axios = require("axios");

async function sendPushoverAlert(title, message, priority = 0) {
  const userKey = process.env.PUSHOVER_USER_KEY;
  const appToken = process.env.PUSHOVER_APP_TOKEN;

  // Validate presence of keys and that appToken is not the placeholder
  if (!userKey || !appToken || appToken === "your_app_token_here") {
    console.warn("[PUSHOVER] Keys missing or placeholder detected. Skipping alert.");
    return;
  }

  try {
    const response = await axios.post("https://api.pushover.net/1/messages.json", {
      token: appToken,
      user: userKey,
      message: message,
      title: title,
      priority: priority
    });
    console.log("[PUSHOVER] Alert sent successfully:", response.data);
  } catch (error) {
    console.error("[PUSHOVER] Error sending alert:", error.response?.data || error.message);
  }
}

module.exports = { sendPushoverAlert };
