import { useEffect, useMemo, useRef, useState } from "react";
import { VERIFIED_PRECEDENTS } from "./lib/precedents.js";
import { extractCaseFacts, rankPrecedents } from "./lib/search.js";

const FACT_LABELS = {
  medium: {
    bank_transfer: "송금메모",
    kakao: "카카오톡",
    game_chat: "게임 채팅",
    sns_mention: "SNS 멘션",
    direct_delivery: "직접 전달",
    digital_message: "디지털 메시지",
    unknown: "매체 미확인",
  },
  relationship: {
    game_user: "게임 이용자",
    acquaintance: "지인",
    partner_or_ex: "연인·전 연인",
    neighbor: "이웃",
    stranger: "모르는 사이",
    online_user: "온라인 이용자",
    unknown: "관계 미확인",
  },
  context: {
    conflict: "다툼 상황",
    sexual_conversation: "성적 대화 맥락",
    one_sided: "일방적 전달",
    unknown: "맥락 미확인",
  },
  messageForm: { text: "글", image: "이미지" },
  repetition: { once: "한 차례", repeated: "반복", unknown: "횟수 미확인" },
};

function SideNavigation({ view, onHome }) {
  const items = [
    { icon: "⌂", label: "사례 분석", active: true },
    { icon: "◎", label: "판례 범위" },
    { icon: "↻", label: "검증 기록" },
    { icon: "?", label: "이용 안내" },
  ];

  return (
    <aside className="side-navigation" aria-label="주요 메뉴">
      <button className="brand-mark" type="button" onClick={onHome} aria-label="판례AI 홈">
        <span className="brand-spark">✦</span>
      </button>
      <nav className="nav-stack">
        {items.map((item) => (
          <button
            className={`nav-item ${item.active ? "is-active" : ""}`}
            key={item.label}
            type="button"
            onClick={item.active ? onHome : undefined}
            aria-current={item.active && view === "home" ? "page" : undefined}
            title={item.label}
          >
            <span aria-hidden="true">{item.icon}</span>
            <span className="nav-label">{item.label}</span>
          </button>
        ))}
      </nav>
      <div className="nav-bottom">
        <div className="privacy-dot" title="서버 저장 없음">
          <span aria-hidden="true">◉</span>
          <span className="nav-label">로컬 처리</span>
        </div>
      </div>
    </aside>
  );
}

function TopBar({ view, onHome }) {
  return (
    <header className="top-bar">
      <button className="product-switcher" type="button" onClick={onHome}>
        <span className="tiny-spark" aria-hidden="true">✦</span>
        <span>판례AI · 통매음</span>
        <span className="chevron" aria-hidden="true">⌄</span>
      </button>
      <div className="top-actions">
        <div className="verified-status">
          <span className="status-dot" aria-hidden="true" />
          공식 판례 {VERIFIED_PRECEDENTS.length}건 검증
        </div>
        {view === "results" && (
          <button className="new-case-button" type="button" onClick={onHome}>
            <span aria-hidden="true">＋</span> 새 사례
          </button>
        )}
      </div>
    </header>
  );
}

function RoleSelector({ value, onChange }) {
  const roles = [
    { value: "victim", label: "피해자" },
    { value: "reported", label: "피신고인" },
  ];

  return (
    <div className="role-segment" role="group" aria-label="사례를 살펴볼 입장">
      {roles.map((item) => (
        <button
          type="button"
          key={item.value}
          className={`role-segment-button ${value === item.value ? "is-selected" : ""}`}
          aria-pressed={value === item.value}
          onClick={() => onChange(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function CaseComposer({ role, onRoleChange, description, onDescriptionChange, onSubmit, analyzing }) {
  const fileInputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [fileError, setFileError] = useState("");
  const ready = role && description.trim().length >= 15 && !analyzing;

  function handleFile(event) {
    const nextFile = event.target.files?.[0];
    setFileError("");
    if (!nextFile) return;
    if (!/^image\/(png|jpeg|webp)$/.test(nextFile.type)) {
      setFileError("PNG, JPG, WEBP 이미지만 첨부할 수 있습니다.");
      event.target.value = "";
      return;
    }
    if (nextFile.size > 10 * 1024 * 1024) {
      setFileError("이미지 크기는 10MB 이하여야 합니다.");
      event.target.value = "";
      return;
    }
    setFile(nextFile);
  }

  function removeFile() {
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function submit(event) {
    event.preventDefault();
    if (!ready) return;
    onSubmit();
    removeFile();
  }

  return (
    <div className="composer-stack">
      <form className="composer" onSubmit={submit}>
        <textarea
          id="case-description"
          aria-label="사례 설명"
          value={description}
          onChange={(event) => onDescriptionChange(event.target.value.slice(0, 2000))}
          placeholder="상황·매체·관계·횟수를 시간 순서대로 적어주세요."
          rows={7}
        />
        <div className="composer-toolbar">
          <div className="composer-tools-primary">
            <input
              ref={fileInputRef}
              className="visually-hidden"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={handleFile}
              id="case-image"
            />
            <label className="attach-button" htmlFor="case-image">
              <span aria-hidden="true">⌕</span> 대화 캡처 첨부
            </label>
            <RoleSelector value={role} onChange={onRoleChange} />
            {file && (
              <button className="file-chip" type="button" onClick={removeFile} aria-label={`${file.name} 삭제`}>
                {file.name} <span aria-hidden="true">×</span>
              </button>
            )}
          </div>
          <div className="submit-area">
            <span className="character-count">{description.length}/2,000</span>
            <button
              className="analyze-button"
              type="submit"
              disabled={!ready}
              aria-label={analyzing ? "판례 비교 중" : "비슷한 판례 찾기"}
            >
              <span aria-hidden="true">{analyzing ? "…" : "↑"}</span>
            </button>
          </div>
        </div>
      </form>
      {fileError && <p className="file-error" role="alert">{fileError}</p>}
      {analyzing && <p className="analysis-status" role="status">검증된 공개 판례와 사실관계를 비교하고 있습니다.</p>}
      <div className="composer-notices" aria-label="서비스 안내">
        <p><span aria-hidden="true">✦</span> AI가 공개 판례를 검색·비교합니다.</p>
        <p><span aria-hidden="true">◉</span> 입력과 첨부 파일을 서버로 보내거나 저장하지 않습니다.</p>
      </div>
    </div>
  );
}

function HomeView({ role, setRole, description, setDescription, onSubmit, analyzing, homeStartRef }) {
  return (
    <section className="home-view" ref={homeStartRef}>
      <div className="hero">
        <div className="hero-medallion" aria-hidden="true">
          <img src="/assets/gavel.png" alt="" />
        </div>
        <p className="eyebrow">검증된 공개 판례 기반</p>
        <h1>내 사례와 닮은 판례를<br /><span>사실관계로 비교해보세요</span></h1>
        <p className="hero-copy">법적 결론을 예측하지 않습니다. 공식 판례와 닮은 점·다른 점을 확인할 수 있습니다.</p>
      </div>
      <CaseComposer
        role={role}
        onRoleChange={setRole}
        description={description}
        onDescriptionChange={setDescription}
        onSubmit={onSubmit}
        analyzing={analyzing}
      />
    </section>
  );
}

function ScoreRing({ score }) {
  return (
    <div className="score-ring" style={{ "--score": `${score * 3.6}deg` }} aria-label={`사실관계 유사도 ${score}점`}>
      <div><strong>{score}</strong><span>/100</span></div>
    </div>
  );
}

function PrecedentCard({ result, rank }) {
  return (
    <article className="precedent-card">
      <div className="card-topline">
        <span className="rank-badge">{rank}</span>
        <div className="case-identity">
          <div className="verified-label"><span aria-hidden="true">✓</span> 공식 출처 확인</div>
          <h3>{result.court} {result.caseNumber}</h3>
          <p>{result.decisionDate} · {result.caseName}</p>
        </div>
        <ScoreRing score={result.similarity.total} />
      </div>

      <div className="score-breakdown" aria-label="유사도 구성">
        <span>의미 <strong>{result.similarity.semantic}</strong></span>
        <span>사실 태그 <strong>{result.similarity.facts}</strong></span>
        <span>쟁점 <strong>{result.similarity.issues}</strong></span>
        <small>45% + 45% + 10%</small>
      </div>

      <div className="comparison-grid">
        <section className="comparison-box similarities-box">
          <h4><span aria-hidden="true">≈</span> 닮은 점</h4>
          {result.similarities.length ? (
            <ul>{result.similarities.map((item) => <li key={item}>{item}</li>)}</ul>
          ) : <p>명확히 일치하는 구조화 사실이 적습니다.</p>}
        </section>
        <section className="comparison-box differences-box">
          <h4><span aria-hidden="true">≠</span> 다른 점</h4>
          {result.differences.length ? (
            <ul>{result.differences.map((item) => <li key={item}>{item}</li>)}</ul>
          ) : <p>입력에서 확인된 주요 사실은 대체로 유사합니다.</p>}
        </section>
      </div>

      <section className="summary-box" aria-labelledby={`summary-${result.id}`}>
        <div className="summary-heading">
          <div>
            <span className="ai-summary-badge">AI 생성 요약</span>
            <h4 id={`summary-${result.id}`}>판례에서 중요하게 본 부분</h4>
          </div>
          <span className="grounded-badge">근거 위치 연결됨</span>
        </div>
        <ul className="summary-list">
          {result.summary.map((sentence) => (
            <li key={sentence.text}>
              <p>{sentence.text}</p>
              <span>{sentence.sourceAnchor}</span>
            </li>
          ))}
        </ul>
        <p className="source-reminder">AI가 판결문을 요약한 내용입니다. 정확한 내용은 공식 원문을 확인하십시오.</p>
      </section>

      <div className="card-actions">
        <span>국가법령정보센터 · {result.verifiedAt} 확인</span>
        <a href={result.officialUrl} target="_blank" rel="noopener noreferrer">
          공식 원문 보기 <span aria-hidden="true">↗</span>
        </a>
      </div>
    </article>
  );
}

function Coverage({ resultCount }) {
  return (
    <div className="coverage-panel">
      <div className="coverage-stat">
        <span>비교 범위</span>
        <strong>{VERIFIED_PRECEDENTS.length}건</strong>
      </div>
      <div className="coverage-divider" />
      <div className="coverage-copy">
        <strong>국가법령정보센터 공식 공개 판례</strong>
        <p>사건번호·법원·선고일·공식 URL을 직접 확인한 판례만 비교했습니다.</p>
      </div>
      <div className="coverage-result">기준 이상 <strong>{resultCount}건</strong></div>
    </div>
  );
}

function EmptyResults({ onHome }) {
  return (
    <div className="empty-results">
      <div className="empty-orb" aria-hidden="true">∅</div>
      <h2>기준 이상으로 비슷한 판례가 없습니다</h2>
      <p>현재 검증된 {VERIFIED_PRECEDENTS.length}건 안에서 사실관계 유사도 55점 이상인 판례를 찾지 못했습니다. 없는 판례를 만들어 보여주지 않습니다.</p>
      <button type="button" onClick={onHome}>사례를 더 구체적으로 작성하기</button>
    </div>
  );
}

function ResultsView({ description, results, onHome, resultsStartRef }) {
  const [showAll, setShowAll] = useState(false);
  const facts = useMemo(() => extractCaseFacts(description), [description]);
  const visibleResults = showAll ? results : results.slice(0, 3);
  const tags = [
    FACT_LABELS.medium[facts.medium],
    FACT_LABELS.relationship[facts.relationship],
    FACT_LABELS.context[facts.context],
    FACT_LABELS.messageForm[facts.messageForm],
    FACT_LABELS.repetition[facts.repetition],
  ].filter(Boolean);

  return (
    <section className="results-view" ref={resultsStartRef}>
      <div className="results-header">
        <button className="back-button" type="button" onClick={onHome}><span aria-hidden="true">←</span> 입력으로 돌아가기</button>
        <div className="results-title-row">
          <div>
            <p className="eyebrow">비교 결과</p>
            <h1>사실관계가 닮은 판례</h1>
            <div className="fact-chips">{tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
          </div>
          <button className="print-button" type="button" onClick={() => window.print()}><span aria-hidden="true">⇩</span> 결과 저장</button>
        </div>
      </div>

      <div className="legal-notice" role="note">
        <span aria-hidden="true">!</span>
        <div><strong>이 결과는 법적 판단이나 결과 예측이 아닙니다.</strong><p>숫자는 공개 판례와의 사실관계 유사도이며, 법적 결론이나 형량을 의미하지 않습니다.</p></div>
      </div>
      <Coverage resultCount={results.length} />

      {results.length === 0 ? <EmptyResults onHome={onHome} /> : (
        <div className="results-list">
          {visibleResults.map((result, index) => <PrecedentCard result={result} rank={index + 1} key={result.id} />)}
          {!showAll && results.length > 3 && (
            <button className="show-more" type="button" onClick={() => setShowAll(true)}>
              판례 {results.length - 3}건 더 보기 <span aria-hidden="true">↓</span>
            </button>
          )}
        </div>
      )}
    </section>
  );
}

export function App() {
  const [view, setView] = useState("home");
  const [role, setRole] = useState("");
  const [description, setDescription] = useState("");
  const [results, setResults] = useState([]);
  const [analyzing, setAnalyzing] = useState(false);
  const homeStartRef = useRef(null);
  const resultsStartRef = useRef(null);

  function motionBehavior() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  }

  useEffect(() => {
    if (view !== "results" || !resultsStartRef.current) return;
    resultsStartRef.current.scrollIntoView({ behavior: motionBehavior(), block: "start" });
  }, [view]);

  function goHome() {
    setView("home");
    setResults([]);
    window.requestAnimationFrame(() => {
      homeStartRef.current?.scrollIntoView({ behavior: motionBehavior(), block: "start" });
    });
  }

  function startNewCase() {
    setRole("");
    setDescription("");
    goHome();
  }

  function submitCase() {
    setAnalyzing(true);
    window.setTimeout(() => {
      setResults(rankPrecedents({ role, description }));
      setView("results");
      setAnalyzing(false);
    }, 650);
  }

  return (
    <div className="page-background">
      <div className={`app-shell ${view === "home" ? "is-home" : "has-results"}`}>
        <SideNavigation view={view} onHome={startNewCase} />
        <div className="app-content">
          <TopBar view={view} onHome={startNewCase} />
          <main className="main-content">
            <HomeView
              role={role}
              setRole={setRole}
              description={description}
              setDescription={setDescription}
              onSubmit={submitCase}
              analyzing={analyzing}
              homeStartRef={homeStartRef}
            />
            {view === "results" && (
              <ResultsView
                description={description}
                results={results}
                onHome={goHome}
                resultsStartRef={resultsStartRef}
              />
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
