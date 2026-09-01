/**
 * Asks a site whether we may open a page before opening it.
 *
 * The link check used to send a Chrome user-agent string. Nothing it reached
 * was closed off — Lawtalk publishes its Q&A and links a sitemap, wanting the
 * traffic — but a site that names individual bots in its robots.txt plainly
 * cares who is calling, and answering "Chrome" to that is not an answer. This
 * service asks people to trust what it says about where its records come from;
 * it can afford to say who it is on the way in.
 */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

// Says what we are and how to stop us. A site that wants us gone can write this
// name into its own robots.txt and the next check will honour it.
export const USER_AGENT = "PrecedentAI-LinkCheck/1.0 (+https://github.com/junyoung-code/precedent-ai)";
export const AGENT_TOKEN = "precedentai-linkcheck";

const cache = new Map();

/**
 * The subset of the robots.txt grammar that decides this one question.
 *
 * Groups are matched most-specific-first: our own name beats `*`. Within a
 * group the longest matching rule wins, and Allow beats Disallow on a tie,
 * which is what lets a site open one path inside a closed branch.
 */
export function parseRobots(text) {
  const groups = [];
  let current = null;
  let previousWasAgent = false;

  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const match = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;
    const field = match[1].toLowerCase();
    const value = match[2].trim();

    if (field === "user-agent") {
      // Consecutive User-agent lines share one set of rules.
      if (!current || !previousWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      previousWasAgent = true;
      continue;
    }
    previousWasAgent = false;
    if (!current) continue;
    if (field === "disallow" || field === "allow") {
      current.rules.push({ allow: field === "allow", path: value });
    }
  }
  return groups;
}

function pickGroup(groups, agentToken) {
  const named = groups.find((group) => group.agents.includes(agentToken));
  if (named) return named;
  return groups.find((group) => group.agents.includes("*")) || null;
}

function ruleMatches(path, rulePath) {
  if (rulePath === "") return false;
  // robots.txt wildcards: * for any run, $ to anchor the end.
  const escaped = rulePath.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  const pattern = escaped.endsWith("\\$")
    ? `^${escaped.slice(0, -2)}$`
    : `^${escaped}`;
  try {
    return new RegExp(pattern).test(path);
  } catch {
    return path.startsWith(rulePath);
  }
}

export function isAllowedByRobots(groups, path, agentToken = AGENT_TOKEN) {
  const group = pickGroup(groups, agentToken);
  // No group speaks to us, so nothing forbids the request.
  if (!group) return true;

  let decision = null;
  for (const rule of group.rules) {
    if (!ruleMatches(path, rule.path)) continue;
    // Longest match wins; Allow wins a tie.
    if (!decision
      || rule.path.length > decision.path.length
      || (rule.path.length === decision.path.length && rule.allow)) {
      decision = rule;
    }
  }
  if (!decision) return true;
  return decision.allow;
}

/**
 * Fetches and remembers one host's rules.
 *
 * A host that cannot be asked is treated as open. robots.txt is a request from
 * a site, not a lock — refusing to look at a page because its rules were
 * briefly unreachable would drop links the site never objected to.
 */
export async function readRobots({ origin, fetchImpl = fetch, timeoutMs = 6_000, now = Date.now() }) {
  const hit = cache.get(origin);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.groups;

  let groups = [];
  try {
    const response = await fetchImpl(`${origin}/robots.txt`, {
      headers: { "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(timeoutMs),
    });
    // 404 means no rules, which means no objection.
    if (response.ok) groups = parseRobots(await response.text());
  } catch {
    groups = [];
  }
  cache.set(origin, { at: now, groups });
  return groups;
}

export async function mayFetch({ url, fetchImpl = fetch, timeoutMs = 6_000 }) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const groups = await readRobots({ origin: parsed.origin, fetchImpl, timeoutMs });
  return isAllowedByRobots(groups, `${parsed.pathname}${parsed.search}`);
}

export function clearRobotsCache() {
  cache.clear();
}
