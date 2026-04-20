const mongoose = require("mongoose");

async function connectDB() {
  if (!process.env.MONGO_URI) {
    console.error("MongoDB Error: MONGO_URI environment variable is missing.");
    process.exit(1);
  }

  try {
    if (mongoose.connection.readyState === 1) {
      return mongoose;
    }

    if (!global.__mongooseConnectPromise) {
      global.__mongooseConnectPromise = mongoose.connect(process.env.MONGO_URI);
      await global.__mongooseConnectPromise;
      console.log("MongoDB connected ✅");
      return mongoose;
    }

    await global.__mongooseConnectPromise;
    return mongoose;
  } catch (error) {
    global.__mongooseConnectPromise = null;
    console.error(`MongoDB Connection Error: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { connectDB, mongoose };
