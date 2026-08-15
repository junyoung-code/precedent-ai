import assert from "node:assert/strict";
import test from "node:test";
import {
  LawHttpError,
  detectBadBody,
  fetchLawText,
  isLawHost,
  maskSensitiveUrl,
  parseAntibotUrl,
} from "../server/law-http.mjs";

const LIST_URL = "https://www.law.go.kr/DRF/lawSearch.do?OC=key&target=prec";

test("masks every key-shaped query parameter", () => {
  assert.equal(maskSensitiveUrl("https://x/y?OC=abc&target=prec"), "https://x/y?OC=***&target=prec");
  assert.equal(maskSensitiveUrl("https://x/y?apiKey=abc"), "https://x/y?apiKey=***");
});

test("recognizes law.go.kr subdomains without matching lookalikes", () => {
  assert.equal(isLawHost("https://open.law.go.kr/x"), true);
  assert.equal(isLawHost("https://law.go.kr.evil.test/x"), false);
});

test("restores the redirect path from both antibot obfuscation patterns", () => {
  assert.equal(parseAntibotUrl("var x={t:'/DRF/',h:'lawSearch',o:'.do?tok=1'}"), "/DRF/lawSearch.do?tok=1");
  assert.equal(parseAntibotUrl("var x={o:'/DRF/XXXXok.do',c:5},z=4"), "/DRF/ok.do");
  assert.equal(parseAntibotUrl("<html>plain</html>"), null);
});

test("treats an empty body or a maintenance page as a bad body", () => {
  assert.equal(detectBadBody("   "), "empty");
  assert.equal(detectBadBody("<!DOCTYPE html><html></html>"), "html");
  assert.equal(detectBadBody('{"PrecSearch":{}}'), null);
});

test("follows the antibot redirect on the same host only", async () => {
  const requested = [];
  const text = await fetchLawText(LIST_URL, {
    retryDelayMs: 0,
    fetchImpl: async (url) => {
      requested.push(url);
      return requested.length === 1
        ? new Response("<script>var x={t:'/DRF/',h:'lawSearch',o:'.do?tok=1'};location.assign(x.t+x.h+x.o)</script>")
        : new Response('{"PrecSearch":{}}');
    },
  });
  assert.equal(text, '{"PrecSearch":{}}');
  assert.equal(requested[1], "https://www.law.go.kr/DRF/lawSearch.do?tok=1");
});

test("refuses an antibot hop that points at another host", async () => {
  const antibot = "<script>var x={t:'https://evil.test',h:'/steal',o:'.do'};location.assign(x.t+x.h+x.o)</script>";
  const requested = [];
  const text = await fetchLawText(LIST_URL, {
    retries: 0,
    fetchImpl: async (url) => {
      requested.push(url);
      return new Response(antibot);
    },
  });
  assert.equal(requested.length, 1);
  assert.equal(text, antibot);
});

test("retries retryable statuses and gives up with a masked error", async () => {
  let calls = 0;
  await assert.rejects(
    fetchLawText(LIST_URL, {
      retryDelayMs: 0,
      fetchImpl: async () => { calls += 1; return new Response("", { status: 503 }); },
    }),
    (error) => error instanceof LawHttpError
      && error.code === "LAW_HTTP_STATUS"
      && !error.message.includes("OC=key"),
  );
  assert.equal(calls, 4);
});

test("does not retry a status outside the retry list", async () => {
  let calls = 0;
  await assert.rejects(
    fetchLawText(LIST_URL, {
      retryDelayMs: 0,
      fetchImpl: async () => { calls += 1; return new Response("", { status: 400 }); },
    }),
    (error) => error.code === "LAW_HTTP_STATUS",
  );
  assert.equal(calls, 1);
});

test("honours Retry-After ahead of exponential backoff", async () => {
  const waited = [];
  let calls = 0;
  await fetchLawText(LIST_URL, {
    retryDelayMs: 1_000,
    sleepImpl: async (ms) => { waited.push(ms); },
    fetchImpl: async () => {
      calls += 1;
      return calls === 1
        ? new Response("", { status: 429, headers: { "Retry-After": "2" } })
        : new Response('{"ok":true}');
    },
  });
  assert.deepEqual(waited, [2000]);
});
