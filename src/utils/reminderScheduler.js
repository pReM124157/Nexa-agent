const fs = require("fs");
const path = require("path");

const filePath = path.join(__dirname, "../../data/reminders.json");

// Ensure file exists
function ensureFile() {
  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify([]));
  }
}

// Safe read
function getReminders() {
  ensureFile();
  try {
    const data = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(data || "[]");
  } catch (err) {
    console.error("Error reading reminders:", err);
    return [];
  }
}

function startReminderScheduler(client) {

  setInterval(async () => {
    try {
      const reminders = getReminders();

      const now = new Date();

      let updated = false;

      for (let reminder of reminders) {
        if (
          reminder.status === "pending" &&
          reminder.triggerAt &&
          new Date(reminder.triggerAt) <= now
        ) {
          await client.sendMessage(
            reminder.sender,
            `Reminder: ${reminder.text}`
          );

          reminder.status = "completed";
          updated = true;
        }
      }

      if (updated) {
        fs.writeFileSync(
          filePath,
          JSON.stringify(reminders, null, 2)
        );
      }
    } catch (error) {
      console.error("Scheduler error:", error);
    }
  }, 60000);
}

module.exports = { startReminderScheduler };