import assert from "node:assert/strict";
import test from "node:test";
import { buildPrecedentEmbeddingInput, buildQueryEmbeddingInput, hashEmbeddingInput } from "../server/embedding-input.mjs";

test("keeps embedding input unchanged when only the outcome sentence changes", () => {
  const facts = { medium: "game_chat", messageForm: "text", issueTags: ["통신매체"] };
  const guilty = buildPrecedentEmbeddingInput({
    sourceText: "피고인은 게임 채팅으로 피해자에게 성적인 표현을 전송하였다. 피고인에게 벌금 300만원을 선고한다.",
    facts,
  });
  const notGuilty = buildPrecedentEmbeddingInput({
    sourceText: "피고인은 게임 채팅으로 피해자에게 성적인 표현을 전송하였다. 피고인은 무죄이다.",
    facts,
  });
  assert.equal(guilty, notGuilty);
  assert.doesNotMatch(guilty, /벌금|무죄|선고/);
});

test("normalizes query input and creates a stable sha256 hash", () => {
  const input = buildQueryEmbeddingInput("  카카오톡으로 성적인 글을 한 번 보냈습니다.  ");
  assert.match(input, /카카오톡/);
  assert.match(hashEmbeddingInput(input), /^[a-f0-9]{64}$/);
  assert.equal(hashEmbeddingInput(input), hashEmbeddingInput(input));
});
