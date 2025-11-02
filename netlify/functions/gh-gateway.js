// /netlify/functions/gh-gateway.js
// Gateway minimaliste: /api/gh-gateway/*  (mappe via netlify.toml)
// Auth entrante: X-Gateway-Secret (simple, côté GPT)
// Auth sortante GitHub: App (JWT→installation token) OU PAT

import crypto from "crypto";

// ENV
const GATEWAY_SECRET = process.env.GATEWAY_SECRET || "";
const GITHUB_PAT = process.env.GITHUB_PAT || "";
const GITHUB_APP_ID = process.env.GITHUB_APP_ID ? Number(process.env.GITHUB_APP_ID) : 0;
const GITHUB_INSTALLATION_ID = process.env.GITHUB_INSTALLATION_ID ? Number(process.env.GITHUB_INSTALLATION_ID) : 0;
const GITHUB_APP_PRIVATE_KEY = process.env.GITHUB_APP_PRIVATE_KEY || "";

// --- utils
const ok = (body, code=200) => new Response(JSON.stringify(body), { status: code, headers: { "content-type":"application/json" } });
const bad = (msg, code=400, extra={}) => ok({ error: msg, ...extra }, code);

async function githubHeaders() {
  if (GITHUB_PAT) {
    return {
      Authorization: `Bearer ${GITHUB_PAT}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "parlios-ua-gateway",
    };
  }
  if (GITHUB_APP_ID && GITHUB_INSTALLATION_ID && GITHUB_APP_PRIVATE_KEY) {
    // GitHub App → JWT
    const now = Math.floor(Date.now()/1000);
    const header = { alg: "RS256", typ: "JWT" };
    const payload = { iat: now - 60, exp: now + 600, iss: GITHUB_APP_ID };

    const base64url = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
    const signInput = `${base64url(header)}.${base64url(payload)}`;
    const sign = crypto.createSign("RSA-SHA256").update(signInput).end().sign(GITHUB_APP_PRIVATE_KEY, "base64url");
    const appJWT = `${signInput}.${sign}`;

    // Installation token
    const res = await fetch(`https://api.github.com/app/installations/${GITHUB_INSTALLATION_ID}/access_tokens`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${appJWT}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "parlios-ua-gateway",
      },
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`AccessTokenFail ${res.status}: ${t}`);
    }
    const data = await res.json();
    return {
      Authorization: `Bearer ${data.token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "parlios-ua-gateway",
    };
  }
  throw new Error("No auth configured (set GITHUB_PAT or GitHub App ENV)");
}

// --- handlers
async function handleGetFile(headers, { owner, repo, path, ref="main" }) {
  const u = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(ref)}`;
  const r = await fetch(u, { headers });
  const t = await r.text();
  if (!r.ok) return bad("github_get_file_failed", r.status, { raw: t });
  return ok(JSON.parse(t));
}

async function handleCreatePR(headers, { owner, repo, base, head, title, body }) {
  const u = `https://api.github.com/repos/${owner}/${repo}/pulls`;
  const r = await fetch(u, {
    method: "POST",
    headers: { ...headers, "content-type":"application/json" },
    body: JSON.stringify({ base, head, title, body }),
  });
  const t = await r.text();
  if (!r.ok) return bad("github_create_pr_failed", r.status, { raw: t });
  return ok(JSON.parse(t), 201);
}

async function handleCreateBranch(headers, { owner, repo, newBranch, from }) {
  // Read base ref
  const r1 = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${from}`, { headers });
  const t1 = await r1.text();
  if (!r1.ok) return bad("github_get_ref_failed", r1.status, { raw: t1 });
  const { object } = JSON.parse(t1);
  const sha = object && object.sha;
  if (!sha) return bad("missing_sha_from_ref");

  // Create new ref
  const r2 = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs`, {
    method: "POST",
    headers: { ...headers, "content-type":"application/json" },
    body: JSON.stringify({ ref: `refs/heads/${newBranch}`, sha }),
  });
  const t2 = await r2.text();
  if (!r2.ok) return bad("github_create_ref_failed", r2.status, { raw: t2 });
  return ok(JSON.parse(t2), 201);
}

async function handleCommitFiles(headers, { owner, repo, baseRef, files /* [{path, content, encoding}] */, commitMessage, newBranch }) {
  // 1) base commit
  const refRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${baseRef}`, { headers });
  const refText = await refRes.text();
  if (!refRes.ok) return bad("github_get_ref_failed", refRes.status, { raw: refText });
  const { object: { sha: baseSha } = {} } = JSON.parse(refText) || {};

  // 2) create blobs
  const blobs = [];
  for (const f of files) {
    const br = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/blobs`, {
      method: "POST",
      headers: { ...headers, "content-type":"application/json" },
      body: JSON.stringify({ content: f.content, encoding: f.encoding || "utf-8" }),
    });
    const bt = await br.text();
    if (!br.ok) return bad("github_create_blob_failed", br.status, { raw: bt, file: f.path });
    const b = JSON.parse(bt);
    blobs.push({ path: f.path, mode: "100644", type: "blob", sha: b.sha });
  }

  // 3) create tree
  const tr = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees`, {
    method: "POST",
    headers: { ...headers, "content-type":"application/json" },
    body: JSON.stringify({ base_tree: baseSha, tree: blobs }),
  });
  const tt = await tr.text();
  if (!tr.ok) return bad("github_create_tree_failed", tr.status, { raw: tt });
  const { sha: treeSha } = JSON.parse(tt);

  // 4) create commit
  const cr = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/commits`, {
    method: "POST",
    headers: { ...headers, "content-type":"application/json" },
    body: JSON.stringify({ message: commitMessage, tree: treeSha, parents: [baseSha] }),
  });
  const ct = await cr.text();
  if (!cr.ok) return bad("github_create_commit_failed", cr.status, { raw: ct });
  const { sha: commitSha } = JSON.parse(ct);

  // 5) create/update branch ref
  const rr = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs`, {
    method: "POST",
    headers: { ...headers, "content-type":"application/json" },
    body: JSON.stringify({ ref: `refs/heads/${newBranch}`, sha: commitSha }),
  });
  if (rr.status === 422) {
    // branch exists → update
    const ur = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${newBranch}`, {
      method: "PATCH",
      headers: { ...headers, "content-type":"application/json" },
      body: JSON.stringify({ sha: commitSha, force: true }),
    });
    const ut = await ur.text();
    if (!ur.ok) return bad("github_update_ref_failed", ur.status, { raw: ut });
    return ok({ branch: newBranch, commit: commitSha, updated: true });
  }
  const rt = await rr.text();
  if (!rr.ok) return bad("github_create_ref_failed", rr.status, { raw: rt });
  return ok({ branch: newBranch, commit: commitSha, created: true }, 201);
}

export default async (req) => {
  try {
    // route guard
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/gh-gateway")) return bad("not_found", 404);

    // auth simple côté GPT
    const secret = req.headers.get("X-Gateway-Secret") || "";
    if (!GATEWAY_SECRET || secret !== GATEWAY_SECRET) return bad("forbidden", 403);

    const headers = await githubHeaders();

    if (req.method === "GET" && url.pathname.endsWith("/file/get")) {
      const q = Object.fromEntries(url.searchParams.entries());
      return await handleGetFile(headers, q);
    }
    if (req.method === "POST" && url.pathname.endsWith("/branch/new")) {
      const body = await req.json();
      return await handleCreateBranch(headers, body);
    }
    if (req.method === "POST" && url.pathname.endsWith("/commit/files")) {
      const body = await req.json();
      return await handleCommitFiles(headers, body);
    }
    if (req.method === "POST" && url.pathname.endsWith("/pr/new")) {
      const body = await req.json();
      return await handleCreatePR(headers, body);
    }

    return bad("unknown_route", 404);
  } catch (e) {
    return bad("exception", 500, { detail: String(e) });
  }
};
