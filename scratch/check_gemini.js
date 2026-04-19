require("dotenv").config();
const { GoogleGenerativeAI } = require("@google/generative-ai");

async function checkModels() {
  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    // There isn't a direct listModels in the simple SDK usually, 
    // but we can try a simple generation with a known model.
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });
    const result = await model.generateContent("test");
    console.log("GEMINI-PRO SUCCESS");
  } catch (e) {
    console.log("GEMINI-PRO ERROR:", e.message);
  }

  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent("test");
    console.log("GEMINI-1.5-FLASH SUCCESS");
  } catch (e) {
    console.log("GEMINI-1.5-FLASH ERROR:", e.message);
  }
}

checkModels();
