const fs = require("fs");
const path = require("path");

const filePath = path.join(__dirname, "../../data/reminders.json");

function startReminderScheduler(client) {

  setInterval(async () => {
    try {
      let reminders = [];

      const raw = fs.readFileSync(filePath, "utf-8").trim();

      if (raw) {
        reminders = JSON.parse(raw);
      }

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