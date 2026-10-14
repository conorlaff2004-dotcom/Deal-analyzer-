/*
 * Sync saved rents, sales and the current deal across devices through a
 * private GitHub gist. The gist holds one JSON file; every device merges
 * its own data with it (union by id, deletions kept as tombstones), so
 * nothing added on one device is lost by another.
 */
(function (root) {
  'use strict';

  const API = 'https://api.github.com';
  const FILE = 'deal-analyzer.json';
  const DESCRIPTION = 'Deal Analyzer data (synced by the app; do not edit by hand)';

  // ---------------------------------------------------------------------------
  // Merging (pure, tested)
  // ---------------------------------------------------------------------------

  function emptyData() {
    return { version: 1, rents: [], sales: [], deleted: {}, deal: null };
  }

  function mergeLists(a, b, deleted) {
    const byId = new Map();
    for (const item of [...(a || []), ...(b || [])]) {
      if (!item || !item.id || deleted[item.id]) continue;
      if (!byId.has(item.id)) byId.set(item.id, item);
    }
    return Array.from(byId.values());
  }

  /** Combine two copies of the data. Newest deal form wins; lists are unioned. */
  function merge(local, remote) {
    local = { ...emptyData(), ...(local || {}) };
    remote = { ...emptyData(), ...(remote || {}) };
    const deleted = { ...remote.deleted, ...local.deleted };
    // Forget tombstones after a year so the file doesn't grow forever.
    const cutoff = Date.now() - 365 * 864e5;
    for (const [id, t] of Object.entries(deleted)) if (t < cutoff) delete deleted[id];
    const deals = [local.deal, remote.deal].filter(Boolean).sort((x, y) => (y.updated || 0) - (x.updated || 0));
    return {
      version: 1,
      rents: mergeLists(local.rents, remote.rents, deleted),
      sales: mergeLists(local.sales, remote.sales, deleted),
      deleted,
      deal: deals[0] || null,
    };
  }

  // ---------------------------------------------------------------------------
  // GitHub gist storage
  // ---------------------------------------------------------------------------

  async function gh(token, path, opts = {}) {
    const res = await fetch(API + path, {
      ...opts,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      },
      cache: 'no-store',
    });
    if (res.status === 401) throw new Error('GitHub rejected the access key. Check it was copied fully and hasn’t expired.');
    if (res.status === 403 || res.status === 404) throw new Error('The access key can’t use gists. Create it with the “gist” box ticked.');
    if (!res.ok) throw new Error(`GitHub error ${res.status}`);
    return res.json();
  }

  async function findGist(token) {
    for (let page = 1; page <= 5; page++) {
      const list = await gh(token, `/gists?per_page=100&page=${page}`);
      const hit = list.find((g) => g.files && g.files[FILE]);
      if (hit) return hit.id;
      if (list.length < 100) break;
    }
    return null;
  }

  async function createGist(token, data) {
    const g = await gh(token, '/gists', {
      method: 'POST',
      body: JSON.stringify({ description: DESCRIPTION, public: false, files: { [FILE]: { content: JSON.stringify(data) } } }),
    });
    return g.id;
  }

  async function readGist(token, id) {
    const g = await gh(token, `/gists/${id}`);
    const f = g.files && g.files[FILE];
    if (!f) return emptyData();
    let text = f.content;
    if (f.truncated && f.raw_url) text = await (await fetch(f.raw_url, { cache: 'no-store' })).text();
    try { return JSON.parse(text); } catch (e) { return emptyData(); }
  }

  async function writeGist(token, id, data) {
    await gh(token, `/gists/${id}`, { method: 'PATCH', body: JSON.stringify({ files: { [FILE]: { content: JSON.stringify(data) } } }) });
  }

  /**
   * Pull, merge with `local`, push the result if it differs, and return it.
   * Creates the gist the first time.
   */
  async function sync(token, gistId, local) {
    if (!gistId) gistId = await findGist(token);
    if (!gistId) {
      const data = merge(local, null);
      gistId = await createGist(token, data);
      return { gistId, data };
    }
    const remote = await readGist(token, gistId);
    const data = merge(local, remote);
    if (JSON.stringify(data) !== JSON.stringify(merge(remote, null))) await writeGist(token, gistId, data);
    return { gistId, data };
  }

  const api = { merge, emptyData, sync, FILE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DealSync = api;
})(typeof window !== 'undefined' ? window : globalThis);
