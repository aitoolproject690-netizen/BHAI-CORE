import { config } from "./config.js";

function githubConfig() {
  const cfg = config();
  return {
    token: process.env.GITHUB_TOKEN || "",
    url: process.env.GITHUB_API_URL || "https://api.github.com"
  };
}

function safeHeaders(token) {
  return {
    accept: "application/vnd.github+json",
    "content-type": "application/json",
    "x-github-api-version": "2022-11-28",
    ...(token ? { authorization: "Bearer " + token } : {})
  };
}

async function githubFetch(path, options = {}) {
  const { token, url } = githubConfig();
  if (!token) {
    const error = new Error("GitHub connector runtime is not configured: GITHUB_TOKEN is missing");
    error.code = "GITHUB_NOT_CONFIGURED"; error.status = 503; throw error;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.GITHUB_TIMEOUT_MS || 15000));
  try {
    const response = await fetch(url.replace(/\/$/, "") + path, {
      ...options,
      headers: { ...safeHeaders(token), ...(options.headers || {}) },
      signal: controller.signal
    });
    const text = await response.text();
    let body;
    try { body = text ? JSON.parse(text) : null; } catch { body = { message: text }; }
    if (!response.ok) {
      const error = new Error(body?.message || "GitHub API request failed");
      error.code = "GITHUB_API_ERROR"; error.status = response.status;
      throw error;
    }
    return body;
  } finally { clearTimeout(timer); }
}

function repoPath(repository) {
  const value = String(repository || "").trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) throw new Error("repository must be owner/name");
  const parts = value.split("/");
  if (parts.some(part => part === "." || part === "..")) throw new Error("repository path traversal is not allowed");
  return parts.map(encodeURIComponent).join("/");
}

function pathPart(value) {
  const path = String(value || "").trim().replace(/^\/+/, "");
  if (!path || path.split("/").some(part => part === "..")) throw new Error("valid repository path is required");
  return path.split("/").map(encodeURIComponent).join("/");
}

export async function githubRepoList({ owner, pageSize = 20, pageOffset = 0 } = {}) {
  const params = new URLSearchParams({ per_page: String(Math.min(Math.max(Number(pageSize) || 20, 1), 100)), page: String(Math.max(Number(pageOffset) || 0, 0) + 1) });
  if (owner) params.set("affiliation", "owner");
  const items = await githubFetch("/user/repos?" + params);
  return items.map(item => ({
    fullName: item.full_name, name: item.name, owner: item.owner?.login,
    private: item.private, defaultBranch: item.default_branch, url: item.html_url
  }));
}

export async function githubRepoGet(repository) {
  const item = await githubFetch("/repos/" + repoPath(repository));
  return {
    fullName: item.full_name, name: item.name, owner: item.owner?.login,
    private: item.private, defaultBranch: item.default_branch, description: item.description,
    url: item.html_url, permissions: item.permissions
  };
}

export async function githubFileRead({ repository, path, ref } = {}) {
  const params = ref ? "?ref=" + encodeURIComponent(ref) : "";
  const item = await githubFetch("/repos/" + repoPath(repository) + "/contents/" + pathPart(path) + params);
  if (Array.isArray(item)) throw new Error("Path is a directory, not a file");
  if (item.encoding !== "base64" || typeof item.content !== "string") throw new Error("GitHub returned unsupported file encoding");
  return {
    repository, path, sha: item.sha, size: item.size, url: item.html_url,
    content: Buffer.from(item.content.replace(/\s/g, ""), "base64").toString("utf8")
  };
}

export async function githubFileWrite({ repository, path, content, message, branch, sha } = {}) {
  if (typeof content !== "string") throw new Error("content is required");
  if (String(content).length > Number(process.env.GITHUB_MAX_FILE_CHARS || 1_000_000)) throw new Error("GitHub file content too large");
  const body = { message: String(message || "Update file"), content: Buffer.from(content, "utf8").toString("base64") };
  if (branch) body.branch = String(branch);
  if (sha) body.sha = String(sha);
  const result = await githubFetch("/repos/" + repoPath(repository) + "/contents/" + pathPart(path), { method: "PUT", body: JSON.stringify(body) });
  return { repository, path, commitSha: result.commit?.sha, contentSha: result.content?.sha, url: result.content?.html_url };
}

export async function githubRepoCreate({ name, description = "", private: isPrivate = true } = {}) {
  const repoName = String(name || "").trim();
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(repoName)) throw new Error("Invalid GitHub repository name");
  const result = await githubFetch("/user/repos", { method: "POST", body: JSON.stringify({ name: repoName, description: String(description || ""), private: Boolean(isPrivate), auto_init: true }) });
  return { fullName: result.full_name, name: result.name, private: result.private, defaultBranch: result.default_branch, url: result.html_url };
}

export function githubInfo() {
  const { token, url } = githubConfig();
  return { enabled: Boolean(token), url, tokenConfigured: Boolean(token), timeoutMs: Number(process.env.GITHUB_TIMEOUT_MS || 15000) };
}
