const axios = require("axios");

async function getRepos() {
  try {
    const res = await axios.get(
      "https://api.github.com/user/repos",
      {
        headers: {
          Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json"
        }
      }
    );

    return res.data;
  } catch (error) {
    console.error("GitHub error:", error.response?.data || error.message);
    return [];
  }
}

async function getRepoFiles(repoName) {
  try {
    const res = await axios.get(
      `https://api.github.com/repos/pReM124157/${repoName}/contents`,
      {
        headers: {
          Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json"
        }
      }
    );

    return res.data;
  } catch (error) {
    console.error("GitHub repo files error:", error.response?.data || error.message);
    return [];
  }
}

module.exports = { getRepos, getRepoFiles };

