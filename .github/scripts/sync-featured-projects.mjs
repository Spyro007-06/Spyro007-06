// Regenerates the "FEATURED PROJECTS & BUILDS" section of README.md from
// live GitHub data: the account's pinned repositories (as chosen on the
// GitHub profile), falling back to the most-starred/most-recently-pushed
// repos if nothing is pinned or the query fails.
//
// Run by .github/workflows/sync-readme.yml. Requires GH_TOKEN (a PAT with
// `repo` scope covers private pinned repos too; the default GITHUB_TOKEN
// only sees public data).

import { readFileSync, writeFileSync } from "node:fs";

const USERNAME = process.env.GH_USERNAME || "Spyro007-06";
const TOKEN = process.env.GH_TOKEN;
const README_PATH = "README.md";
const START_MARKER = "<!-- START_SECTION:pinned-projects -->";
const END_MARKER = "<!-- END_SECTION:pinned-projects -->";
const SELF_REPO = USERNAME.toLowerCase();

const PALETTE = ["00F2FE", "B388FF", "F59E0B", "10B981", "58A6FF", "FF6B9D"];

function escapeHtml(unsafe) {
  if (typeof unsafe !== 'string') return unsafe;
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function ghHeaders(extra = {}) {
  const headers = { Accept: "application/vnd.github+json", ...extra };
  if (TOKEN) headers.Authorization = `bearer ${TOKEN}`;
  return headers;
}

async function fetchPinnedRepos() {
  if (!TOKEN) return [];
  const query = `
    query ($login: String!) {
      user(login: $login) {
        pinnedItems(first: 6, types: REPOSITORY) {
          nodes {
            ... on Repository {
              name
              description
              url
              stargazerCount
              primaryLanguage { name }
              repositoryTopics(first: 5) { nodes { topic { name } } }
            }
          }
        }
      }
    }
  `;
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: ghHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ query, variables: { login: USERNAME } }),
  });
  if (!res.ok) return [];
  const json = await res.json();
  if (json.errors) {
    console.warn("GraphQL pinnedItems query failed:", JSON.stringify(json.errors));
    return [];
  }
  return json.data?.user?.pinnedItems?.nodes ?? [];
}

async function fetchTopRepos() {
  const res = await fetch(
    `https://api.github.com/users/${USERNAME}/repos?per_page=100&type=owner`,
    { headers: ghHeaders() }
  );
  if (!res.ok) throw new Error(`GitHub REST API error: ${res.status}`);
  const repos = await res.json();
  return repos
    .filter((r) => !r.fork && !r.archived && r.name.toLowerCase() !== SELF_REPO)
    .sort(
      (a, b) =>
        b.stargazers_count - a.stargazers_count ||
        new Date(b.pushed_at) - new Date(a.pushed_at)
    )
    .slice(0, 6)
    .map((r) => ({
      name: r.name,
      description: r.description,
      url: r.html_url,
      stargazerCount: r.stargazers_count,
      primaryLanguage: r.language ? { name: r.language } : null,
      repositoryTopics: { nodes: (r.topics || []).slice(0, 5).map(t => ({ topic: { name: t } })) },
    }));
}

function renderCard(repo, index) {
  const color = PALETTE[index % PALETTE.length];
  const topics = (repo.repositoryTopics?.nodes ?? []).map((n) => n.topic.name);
  const stack = [repo.primaryLanguage?.name, ...topics].filter(Boolean);
  const stackHtml = stack.length
    ? stack.map((t) => `<code>${escapeHtml(t)}</code>`).join(" &nbsp;")
    : "<code>—</code>";
  const description = escapeHtml(repo.description) || "No description provided yet.";
  const stars = repo.stargazerCount ? ` &nbsp;<code>★ ${repo.stargazerCount}</code>` : "";
  const safeName = escapeHtml(repo.name);

  return `<table width="100%" bgcolor="#050811" style="border: 1px solid #30363D; border-left: 6px solid #${color}; border-radius: 8px; margin-bottom: 16px;">
  <tr>
    <td style="padding: 20px 24px;">
      <table width="100%">
        <tr>
          <td align="left">
            <h3 style="margin: 0; color: #${color};"><b>${safeName}</b></h3>
          </td>
          <td align="right" valign="top">
            <a href="${repo.url}">
              <img src="https://img.shields.io/badge/EXPLORE_MISSION-161B22?style=for-the-badge&logo=github&logoColor=${color}" alt="View ${safeName}" />
            </a>
          </td>
        </tr>
      </table>
      <p style="color: #F0F6FC; font-size: 15px; margin: 8px 0 14px 0; line-height: 1.5;">
        ${description}
      </p>
      <p style="margin: 0;">
        ${stackHtml}${stars}
      </p>
    </td>
  </tr>
</table>`;
}

async function main() {
  let repos = await fetchPinnedRepos();
  let source = "pinned repositories";
  if (repos.length === 0) {
    repos = await fetchTopRepos();
    source = "top active repositories (no pinned repos found)";
  }
  if (repos.length === 0) {
    console.warn("No repositories found to feature; leaving README untouched.");
    return;
  }

  console.log(`Featuring ${repos.length} repos from ${source}: ${repos.map((r) => r.name).join(", ")}`);

  const body = repos.map((r, i) => renderCard(r, i)).join("\n\n<br/>\n\n");
  const readme = readFileSync(README_PATH, "utf8");
  const startIdx = readme.indexOf(START_MARKER);
  const endIdx = readme.indexOf(END_MARKER);
  if (startIdx === -1 || endIdx === -1) {
    throw new Error(`README.md is missing ${START_MARKER} / ${END_MARKER} markers`);
  }

  const updated =
    readme.slice(0, startIdx + START_MARKER.length) +
    "\n\n" +
    body +
    "\n\n" +
    readme.slice(endIdx);

  writeFileSync(README_PATH, updated);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
