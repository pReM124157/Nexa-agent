const fs = require("fs");
const path = require("path");

const filePath = path.join(__dirname, "../../data/reminders.json");

function safeReadReminders() {
  try {
    const raw = fs.readFileSync(filePath, "utf-8").trim();

    if (!raw) return [];

    return JSON.parse(raw);
  } catch (error) {
    console.error("Reminder file read error:", error);
    return [];
  }
}

function extractTime(text) {
  const lower = text.toLowerCase();

  // supports 2 pm / 2:15 pm / 2.15 pm
  const match = lower.match(
    /at\s+(\d{1,2})([:.](\d{1,2}))?\s*(am|pm)/
  );

  if (!match) return null;

  let hour = parseInt(match[1], 10);
  let minute = match[3] ? parseInt(match[3], 10) : 0;
  const period = match[4];

  if (period === "pm" && hour !== 12) hour += 12;
  if (period === "am" && hour === 12) hour = 0;

  const now = new Date();
  const target = new Date();

  target.setHours(hour, minute, 0, 0);

  if (target < now) {
    target.setDate(target.getDate() + 1);
  }

  return target.toISOString();
}

function saveReminder(text, sender) {
  const existing = safeReadReminders();

  const reminder = {
    id: Date.now(),
    sender,
    text,
    triggerAt: extractTime(text),
    createdAt: new Date().toISOString(),
    status: "pending"
  };

  existing.push(reminder);

  fs.writeFileSync(filePath, JSON.stringify(existing, null, 2));

  return reminder;
}

module.exports = { saveReminder };