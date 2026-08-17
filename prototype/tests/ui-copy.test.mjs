import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appSource = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");

test("shows compact pre-use and generated-result AI disclosures", () => {
  assert.match(appSource, /AI가 공개 판례를 검색·비교합니다/);
  assert.equal(
    appSource.includes("이 서비스는 AI를 사용하여 공개 판례를 검색·비교하며 일부 설명을 생성합니다"),
    false,
  );
  assert.match(appSource, /AI 생성 요약/);
  assert.match(
    appSource,
    /정확한 내용은 공식 원문을 확인하십시오/,
  );
});

test("keeps role selection inside the composer and scrolls to results", () => {
  assert.match(appSource, /role-segment/);
  assert.match(appSource, /피해자/);
  assert.match(appSource, /피신고인/);
  assert.match(appSource, /scrollIntoView/);
  assert.match(appSource, /prefers-reduced-motion: reduce/);
});

test("does not use legal-outcome probability labels", () => {
  for (const banned of ["성립 확률", "고소 확률", "유죄 확률", "무죄 가능성", "처벌 예상"]) {
    assert.equal(appSource.includes(banned), false, `banned UI copy: ${banned}`);
  }
  assert.match(appSource, /사실관계 유사도/);
});

test("keeps the no-fabrication empty state visible", () => {
  assert.match(appSource, /없는 판례를 만들어 보여주지 않습니다/);
  assert.match(appSource, /공식 원문 보기/);
});

test("requires explicit external embedding consent and uses the private intake client", () => {
  assert.match(appSource, /OpenAI 임베딩 API로 전송/);
  assert.match(appSource, /allowExternalEmbedding/);
  assert.match(appSource, /createIntake/);
  assert.match(appSource, /completeIntake/);
  assert.match(appSource, /캡처 이미지는 서버 또는 외부 AI에 전송하지 않습니다/);
  assert.match(appSource, /중단된 입력은 최대 1시간 뒤 삭제됩니다/);
  assert.doesNotMatch(appSource, /rankPrecedents/);
  assert.match(appSource, /result\.summary\?\.length/);
  assert.match(appSource, /검색 서버에 연결하지 못했습니다/);
});
