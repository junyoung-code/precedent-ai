/**
 * 법제처(law.go.kr) HTTP 호출 계층.
 *
 * korean-law-mcp(MIT, https://github.com/chrisryugj/korean-law-mcp)의
 * `lib/fetch-with-retry.ts`와 `lib/law-antibot.ts` 접근을 이식했다.
 *
 * 이 계층이 막는 실패는 네 가지이며, 넷 다 OC 승인 이후에야 드러난다.
 *  1. Referer/User-Agent 누락 — OC가 유효해도 법제처가 인증 거절 문서를 돌려준다.
 *  2. 200 + 빈 본문 또는 점검 HTML — JSON 파서가 터진다. 일시 장애이므로 재시도한다.
 *  3. 클라우드 IP에서 오는 JS 안티봇 리다이렉트 — 배포 환경에서만 나타난다.
 *  4. 일시적 429/503/504.
 *
 * 오류 메시지와 로그에 OC가 섞여 나가지 않도록 URL을 마스킹한다(설계 §9).
 */

const DEFAULTS = {
  timeoutMs: 30_000,
  retries: 3,
  retryDelayMs: 1_000,
  retryOn: [429, 503, 504],
  maxAntibotHops: 3,
};

// 법제처는 Node 기본 UA(undici)를 봇으로 분류해 거부한다.
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
  + "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Referer가 없으면 OC가 유효해도 "사용자 정보 검증에 실패하였습니다"를 돌려준다.
// 메시지가 IP·도메인 등록 문제로 읽혀 승인 상태를 오해하기 쉬운 지점이다.
const REFERER = "https://www.law.go.kr/";

/** 오류 메시지·로그로 새어나갈 수 있는 인증키를 가린다. */
export function maskSensitiveUrl(value) {
  return String(value ?? "").replace(/([?&](?:oc|apikey|api_key|authkey|key)=)[^&]+/gi, "$1***");
}

export function isLawHost(url) {
  try {
    return /(^|\.)law\.go\.kr$/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * 안티봇 JS가 난독화해 둔 리다이렉트 경로를 복원한다.
 * - 패턴 A(concat): `x={t:'..',h:'..',o:'..'}` → t + h + o
 * - 패턴 B(substr): `x={o:'..',c:N},z=M` → o를 c/z 위치로 잘라 붙임
 */
export function parseAntibotUrl(html) {
  const concat = html.match(/t:'([^']*)',h:'([^']*)'/);
  if (concat) {
    const tail = html.match(/o:'([^']*)'/);
    if (tail) return concat[1] + concat[2] + tail[1];
  }

  const substr = html.match(/o:'([^']*)',c:(\d+)},z=(\d+)/);
  if (substr) {
    const [, body, cut, skip] = substr;
    return body.slice(0, Number(cut)) + body.slice(Number(cut) + Number(skip));
  }

  return null;
}

/**
 * 200 응답인데 실제로는 장애인 경우를 구분한다.
 * 정상 응답은 JSON(`{`/`[`) 또는 XML(`<`)로 시작한다.
 */
export function detectBadBody(text) {
  const trimmed = text.trim();
  if (!trimmed) return "empty";
  if (/^<!doctype html/i.test(trimmed) || /^<html[\s>]/i.test(trimmed)) return "html";
  return null;
}

export class LawHttpError extends Error {
  constructor(code, detail, cause) {
    super(detail ? `${code}: ${maskSensitiveUrl(detail)}` : code, { cause });
    this.code = code;
    /** true면 재시도해도 결과가 달라지지 않는다 (예: 400). */
    this.terminal = false;
  }
}

function terminal(error) {
  error.terminal = true;
  return error;
}

function backoff(attempt, retryDelayMs, retryAfterHeader) {
  const retryAfter = Number(retryAfterHeader);
  if (retryAfterHeader && Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000;
  const base = retryDelayMs * 2 ** attempt;
  return base + Math.random() * base * 0.5;
}

function sleep(ms) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

function requestHeaders(url) {
  const headers = { "user-agent": USER_AGENT };
  if (isLawHost(url)) headers.referer = REFERER;
  return headers;
}

/**
 * 안티봇 페이지면 우회한 응답을, 아니면 null(원본 유지)을 반환한다.
 * 홉 대상은 원본과 같은 호스트여야 한다 — 응답 하나로 임의 호스트 요청을 유도당하지 않기 위해서다.
 */
async function followAntibot(response, url, { fetchImpl, timeoutMs, maxAntibotHops }) {
  let current = response;
  let hopped = false;

  for (let hop = 0; hop < maxAntibotHops; hop += 1) {
    let html;
    try {
      html = await current.clone().text();
    } catch {
      return hopped ? current : null;
    }
    if (!html.includes("location.assign")) return hopped ? current : null;

    const path = parseAntibotUrl(html);
    if (!path) return hopped ? current : null;

    let next;
    try {
      const resolved = new URL(path, url);
      if (resolved.hostname !== new URL(url).hostname) return hopped ? current : null;
      next = resolved.toString();
    } catch {
      return hopped ? current : null;
    }

    const hopResponse = await fetchImpl(next, {
      headers: requestHeaders(next),
      signal: AbortSignal.timeout(timeoutMs),
    });
    hopped = true;

    // 토큰 URL이 404면 홉이 세션을 심었을 수 있으니 원본을 한 번 더 시도한다.
    if (hopResponse.status === 404) {
      return fetchImpl(url, { headers: requestHeaders(url), signal: AbortSignal.timeout(timeoutMs) });
    }
    current = hopResponse;
  }

  return current;
}

/**
 * 법제처 API를 호출해 본문 텍스트를 반환한다.
 * 재시도를 모두 소진하면 마지막 실패를 `LawHttpError`로 던진다.
 */
export async function fetchLawText(url, options = {}) {
  const config = { ...DEFAULTS, fetchImpl: fetch, sleepImpl: sleep, ...options };
  const target = String(url);
  let lastError = null;

  for (let attempt = 0; attempt <= config.retries; attempt += 1) {
    const hasRetryLeft = attempt < config.retries;
    try {
      let response = await config.fetchImpl(target, {
        headers: requestHeaders(target),
        signal: AbortSignal.timeout(config.timeoutMs),
      });

      if (!response.ok) {
        if (config.retryOn.includes(response.status) && hasRetryLeft) {
          lastError = new LawHttpError("LAW_HTTP_STATUS", `HTTP_${response.status} ${target}`);
          await config.sleepImpl(backoff(attempt, config.retryDelayMs, response.headers?.get?.("Retry-After")));
          continue;
        }
        throw terminal(new LawHttpError("LAW_HTTP_STATUS", `HTTP_${response.status} ${target}`));
      }

      if (isLawHost(target)) {
        try {
          const bypassed = await followAntibot(response, target, config);
          if (bypassed) response = bypassed;
        } catch { /* 우회 실패 시 원본 응답으로 진행한다 */ }
      }

      const text = await response.text();
      const bad = detectBadBody(text);
      if (bad && hasRetryLeft) {
        lastError = new LawHttpError("LAW_BAD_BODY", `${bad} ${target}`);
        await config.sleepImpl(backoff(attempt, config.retryDelayMs));
        continue;
      }
      if (bad) throw new LawHttpError("LAW_BAD_BODY", `${bad} ${target}`);

      return text;
    } catch (error) {
      if (error?.terminal || !hasRetryLeft) {
        throw error instanceof LawHttpError
          ? error
          : new LawHttpError("LAW_REQUEST_FAILED", error?.message, error);
      }
      lastError = error;
      await config.sleepImpl(backoff(attempt, config.retryDelayMs));
    }
  }

  throw lastError instanceof LawHttpError
    ? lastError
    : new LawHttpError("LAW_REQUEST_FAILED", lastError?.message, lastError);
}
