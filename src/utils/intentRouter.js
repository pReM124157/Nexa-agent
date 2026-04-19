function detectIntent(message) {
  const msg = message.toLowerCase().trim();

  // smarter reminder detection
  if (
    msg.includes("remind me") ||
    msg.includes("set a reminder") ||
    msg.includes("set reminder") ||
    msg.includes("reminder at")
  ) {
    return "reminder";
  }

  // greeting
  if (
    msg.includes("hello") ||
    msg.includes("hi") ||
    msg.includes("hey")
  ) {
    return "greeting";
  }

  // task
  if (
    msg.includes("task") ||
    msg.includes("todo")
  ) {
    return "task";
  }

  return "chat";
}

module.exports = { detectIntent };