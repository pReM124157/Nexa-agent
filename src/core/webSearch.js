const axios = require("axios");

/**
 * High-level web search wrapper.
 * Integration: Serper.dev (https://google.serper.dev/shopping)
 */
async function searchWeb(query) {
  const apiKey = process.env.SERPER_API_KEY;
  
  if (!apiKey) {
    console.error("[Serper] CRITICAL: SERPER_API_KEY is missing from environment.");
    return [];
  }

  try {
    const res = await axios.post(
      "https://google.serper.dev/shopping",
      { q: query, gl: "in", hl: "en" },
      {
        headers: {
          "X-API-KEY": apiKey,
          "Content-Type": "application/json"
        },
        timeout: 15000
      }
    );

    const results = res.data.shopping || [];

    return results.slice(0, 5).map(r => ({
      title: r.title,
      link: r.link,
      price: r.price || "N/A",
      rating: parseFloat(r.rating) || 0,
      reviews: parseInt(r.ratingCount) || parseInt(r.reviews) || 0,
      source: r.source || "Google Shopping",
      thumbnail: r.imageUrl || r.thumbnail
    }));
  } catch (err) {
    console.error(`[Serper] Search Error:`, err.response?.data || err.message);
    return [];
  }
}

module.exports = { searchWeb };
