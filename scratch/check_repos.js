require("dotenv").config();
const { getRepos } = require("../src/services/githubService");

getRepos().then(repos => {
  console.log("Repositories found:");
  repos.forEach(r => console.log(`- ${r.name} (full_name: ${r.full_name})`));
}).catch(err => {
  console.error("Error:", err);
});
