/**
 * Finds words real complaints use that our rules cannot read.
 *
 * The extraction vocabulary was guessed once and has been wrong twice: it knew
 * six clinical terms for a sexual expression and none of the words anyone
 * actually types, and it could not name a game the way half the posts name it.
 * Both gaps cost the fact-tag term outright, which is 45% of the score.
 *
 * This does not change anything. It collects the phrasings people use, runs
 * them through the current rules, and prints the ones that come back unread —
 * candidates for a human to look at, not a verdict. Nothing is stored: the
 * posts belong to whoever wrote them.
 */
import { extractFactTags } from "../src/lib/fact-tags.js";

const MODEL = process.env.ANALYSIS_MODEL;
if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY_REQUIRED");
if (!MODEL) throw new Error("ANALYSIS_MODEL_REQUIRED");

const COUNT = Number(process.argv[2]) || 24;

const INSTRUCTIONS = [
  "웹에서 통신매체이용음란(통매음) 관련 글을 찾아, 사람들이 자기 상황을 설명할 때 실제로 쓰는 문장을 모으세요.",
  "네이버 지식iN, 디시인사이드, 로톡 상담 질문, 카페·블로그 글에서 찾으세요.",
  "각 문장은 원문의 말투와 단어를 살려 한 문장으로 다시 쓰되, 이름·계정·학교·연락처·지역은 넣지 마세요.",
  "매체를 부르는 말(롤, 배그, 디엠, 오픈카톡 등)과 표현을 부르는 말(패드립, 성드립 등)이 문장에 그대로 남아 있어야 합니다.",
  "medium은 kakao·game_chat·sns_mention·digital_message·bank_transfer·other 중에서, expression은 sexual_text·insult_with_sexual_terms·sexual_image·other 중에서 고르세요.",
].join(" ");

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["phrases"],
  properties: {
    phrases: {
      type: "array",
      maxItems: COUNT,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "medium", "expression"],
        properties: {
          text: { type: "string", minLength: 10, maxLength: 200 },
          medium: { type: "string", enum: ["kakao", "game_chat", "sns_mention", "digital_message", "bank_transfer", "other"] },
          expression: { type: "string", enum: ["sexual_text", "insult_with_sexual_terms", "sexual_image", "other"] },
        },
      },
    },
  },
};

const started = Date.now();
const response = await fetch("https://api.openai.com/v1/responses", {
  method: "POST",
  headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "content-type": "application/json" },
  body: JSON.stringify({
    model: MODEL,
    store: false,
    instructions: INSTRUCTIONS,
    input: `서로 다른 상황 ${COUNT}개를 모으세요.`,
    tools: [{ type: "web_search" }],
    text: { format: { type: "json_schema", name: "vocabulary_probe", strict: true, schema } },
  }),
  signal: AbortSignal.timeout(180_000),
});
if (!response.ok) throw new Error(`PROBE_FAILED_${response.status}`);
const payload = await response.json();
const text = payload.output?.flatMap((item) => item.content || []).find((item) => item.type === "output_text")?.text;
if (!text) throw new Error("PROBE_EMPTY");
const { phrases } = JSON.parse(text);

const gaps = [];
for (const phrase of phrases) {
  const facts = extractFactTags(phrase.text);
  const missed = [];
  if (facts.medium === "unknown" || facts.medium !== phrase.medium) missed.push(`매체 ${phrase.medium} → ${facts.medium}`);
  if (facts.expressionType === "other" && phrase.expression !== "other") missed.push(`표현 ${phrase.expression} → ${facts.expressionType}`);
  if (missed.length > 0) gaps.push({ ...phrase, missed });
}

console.log(`${MODEL} · ${Math.round((Date.now() - started) / 1000)}초 · 문장 ${phrases.length}개 · 토큰 ${payload.usage?.input_tokens}/${payload.usage?.output_tokens}\n`);
console.log(`규칙이 읽어낸 문장: ${phrases.length - gaps.length} / ${phrases.length}\n`);

if (gaps.length === 0) {
  console.log("이번 표본에서는 못 읽는 문장이 없습니다.");
} else {
  console.log("아래는 규칙이 놓친 문장입니다. 웹에서 온 라벨이므로 정답이 아니라 확인할 후보입니다.\n");
  for (const gap of gaps) console.log(`  ${gap.text}\n    ${gap.missed.join(" · ")}\n`);
  console.log("고칠 곳: src/lib/fact-tags.js 의 MEDIUM_RULES · MEDIUM_PATTERNS · SEXUAL_SLUR_TERMS");
  console.log("넓힐 때마다 '일상어를 성적 표현으로 읽지 않는다' 테스트에 반례를 함께 추가하십시오.");
}
