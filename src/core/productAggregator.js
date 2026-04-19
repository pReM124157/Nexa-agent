const axios = require('axios');

/**
 * Aggregates product data from multiple sources (Amazon + Google Shopping)
 * via SerpAPI.
 */
async function aggregateProductSearch(query) {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    throw new Error("SERPER_API_KEY missing in environment variables. Web search aborted.");
  }

  const sources = [
    {
      name: "google_shopping",
      params: {
        engine: "google_shopping",
        q: query,
        api_key: apiKey,
        hl: "en",
        gl: "in"
      },
      extractor: (data) => (data.shopping_results || []).map(r => ({
        title: r.title,
        price: r.price,
        link: r.link,
        source: r.source || "Google Shopping",
        rating: r.rating || 0,
        reviews: r.reviews || 0,
        thumbnail: r.thumbnail
      }))
    },
    {
      name: "amazon",
      params: {
        engine: "amazon",
        q: query,
        api_key: apiKey,
        type: "search",
        amazon_domain: "amazon.in"
      },
      extractor: (data) => (data.shopping_results || data.search_results || []).map(r => ({
        title: r.title,
        price: r.price ? r.price.raw || r.price : "N/A",
        link: r.link,
        source: "Amazon",
        rating: r.rating || 0,
        reviews: r.reviews || 0,
        thumbnail: r.thumbnail
      }))
    }
  ];

  try {
    const requests = sources.map(source => 
      axios.get('https://serpapi.com/search.json', { 
        params: source.params,
        timeout: 10000 
      }).then(res => source.extractor(res.data)).catch(err => {
        console.error(`[Aggregator] Error fetching from ${source.name}:`, err.message);
        return [];
      })
    );

    const results = await Promise.all(requests);
    const flattened = results.flat();

    // Basic de-duplication based on title similarity/link
    const seenLinks = new Set();
    const unique = flattened.filter(item => {
      if (seenLinks.has(item.link)) return false;
      seenLinks.add(item.link);
      return true;
    });

    return unique;
  } catch (err) {
    console.error("[Aggregator] Global error:", err.message);
    return [];
  }
}

module.exports = { aggregateProductSearch };
