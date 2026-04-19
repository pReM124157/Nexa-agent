require('dotenv').config();
const { searchWeb } = require('./src/core/webSearch');

(async () => {
  const results = await searchWeb("rcb jersey under 1000");
  console.log("RESULTS:\n", results);
})();
