import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appSource = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");

test("shows the required human-readable AI disclosures", () => {
  assert.match(
    appSource,
    /이 서비스는 AI를 사용하여 공개 판례를 검색·비교하며 일부 설명을 생성합니다/,
  );
  assert.match(appSource, /AI 생성 요약/);
  assert.match(
    appSource,
    /AI가 판결문을 요약한 내용입니다\. 정확한 내용은 공식 원문을 확인하십시오/,
  );
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
