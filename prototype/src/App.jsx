import { useEffect, useMemo, useRef, useState } from "react";
import { extractCaseFacts } from "./lib/search.js";
import { redactSensitiveText } from "./lib/privacy-redaction.js";
import { abandonIntake, answerIntake, cancelIntake, completeIntake, createIntake } from "./lib/intake-api.js";

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
        <div className="privacy-dot" title="가려진 입력만 최대 1시간 임시 저장">
          <span aria-hidden="true">◉</span>
          <span className="nav-label">1시간 내 삭제</span>
        </div>
      </div>
    </aside>
  );
}

function TopBar({ view, onHome, availableCount }) {
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
          {availableCount == null ? "공식 판례 DB 연결" : `공식 판례 ${availableCount}건 검색 가능`}
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

function CaseComposer({
  role,
  onRoleChange,
  description,
  onDescriptionChange,
  onSubmit,
  analyzing,
  allowExternalEmbedding,
  onExternalEmbeddingChange,
  intake,
  onStartIntake,
  onSubmitAnswers,
  onCancelIntake,
}) {
  const fileInputRef = useRef(null);
  const captureNoticeRef = useRef(null);
  const [file, setFile] = useState(null);
  const [fileError, setFileError] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [transcript, setTranscript] = useState("");
  const [answers, setAnswers] = useState({});
  const [dragging, setDragging] = useState(false);
  const [captureNotice, setCaptureNotice] = useState(false);
  const [captureConfirmed, setCaptureConfirmed] = useState(false);
  const ready = role && description.trim().length >= 15 && !analyzing;

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  // The notice can sit below the fold, where a blocked submit would look like nothing happened.
  useEffect(() => {
    if (!captureNotice || !captureNoticeRef.current) return;
    captureNoticeRef.current.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "nearest",
    });
  }, [captureNotice]);

  function acceptFile(nextFile) {
    setFileError("");
    if (!nextFile) return false;
    if (!/^image\/(png|jpeg|webp)$/.test(nextFile.type)) {
      setFileError("PNG, JPG, WEBP 이미지만 첨부할 수 있습니다.");
      return false;
    }
    if (nextFile.size > 10 * 1024 * 1024) {
      setFileError("이미지 크기는 10MB 이하여야 합니다.");
      return false;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(nextFile);
    setPreviewUrl(URL.createObjectURL(nextFile));
    setCaptureNotice(false);
    setCaptureConfirmed(false);
    return true;
  }

  function handleFile(event) {
    if (!acceptFile(event.target.files?.[0])) event.target.value = "";
  }

  // Screenshots usually live on the clipboard, not on disk, so accept Ctrl+V too.
  function handlePaste(event) {
    const image = [...(event.clipboardData?.items || [])]
      .find((item) => item.kind === "file" && item.type.startsWith("image/"));
    if (!image) return;
    const pasted = image.getAsFile();
    if (!pasted) return;
    event.preventDefault();
    acceptFile(pasted);
  }

  function handleDrop(event) {
    event.preventDefault();
    setDragging(false);
    acceptFile([...(event.dataTransfer?.files || [])].find((item) => item.type.startsWith("image/")));
  }

  function handleDragOver(event) {
    if (![...(event.dataTransfer?.types || [])].includes("Files")) return;
    event.preventDefault();
    setDragging(true);
  }

  function removeFile() {
    setFile(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl("");
    // The transcript panel disappears with the capture, so keeping its text would
    // submit something the user can no longer see or edit.
    setTranscript("");
    setCaptureNotice(false);
    setCaptureConfirmed(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function runSubmit() {
    onStartIntake(redactSensitiveText([description, transcript].filter(Boolean).join("\n")).text);
  }

  function submit(event) {
    event.preventDefault();
    if (!ready) return;
    // The capture never leaves the browser, so an untranscribed one contributes nothing.
    if (file && !transcript.trim() && !captureConfirmed) {
      setCaptureNotice(true);
      return;
    }
    runSubmit();
  }

  function submitWithoutTranscript() {
    setCaptureConfirmed(true);
    setCaptureNotice(false);
    runSubmit();
  }

  return (
    <div className="composer-stack">
      <form
        className={`composer${dragging ? " is-dragging" : ""}`}
        onSubmit={submit}
        onPaste={handlePaste}
        onDragOver={handleDragOver}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
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
            <label className="attach-button" htmlFor="case-image" title="캡처를 붙여넣거나(Ctrl+V) 끌어다 놓아도 됩니다">
              <span aria-hidden="true">⌕</span> 대화 캡처 첨부
            </label>
            <RoleSelector value={role} onChange={onRoleChange} />
            {file && (
              <button className="file-chip" type="button" onClick={removeFile} aria-label={`${file.name} 삭제`} title="클릭하면 첨부가 삭제됩니다">
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
      {file && <section className="capture-review" aria-label="대화 캡처 검토">
        {previewUrl && <div className="capture-preview">
          <img src={previewUrl} alt="선택한 대화 캡처 미리보기" />
          <button type="button" className="capture-remove" onClick={removeFile} aria-label="첨부한 캡처 삭제" title="첨부한 캡처 삭제">
            <span aria-hidden="true">×</span>
          </button>
        </div>}
        <label htmlFor="capture-transcript">캡처의 필요한 내용을 직접 입력하거나 수정하세요</label>
        <textarea id="capture-transcript" value={transcript} onChange={(event) => { setTranscript(event.target.value.slice(0, 4000)); setCaptureNotice(false); }} placeholder="캡처의 필요한 문장을 입력하세요. 이름·연락처는 가려집니다." rows={4} />
        <p>캡처 이미지는 서버 또는 외부 AI에 전송하지 않습니다. 옮겨 적은 문장만 검색에 사용됩니다.</p>
        {captureNotice && <div className="capture-notice" role="alert" ref={captureNoticeRef}>
          <p>캡처를 아직 옮겨 적지 않았습니다. 이미지는 읽지 않으므로 지금 검색하면 캡처 내용은 반영되지 않습니다.</p>
          <button type="button" onClick={submitWithoutTranscript}>캡처 없이 검색</button>
        </div>}
      </section>}
      {intake.questions.length > 0 && <section className="intake-questions" aria-label="추가 사실 확인">
        <h2>몇 가지만 더 확인할게요</h2>
        {intake.questions.map((question) => <label key={question.id} htmlFor={`intake-${question.id}`}>{question.prompt}
          <input id={`intake-${question.id}`} value={answers[question.id] || ""} onChange={(event) => setAnswers({ ...answers, [question.id]: event.target.value })} />
        </label>)}
        <div className="intake-actions"><button type="button" onClick={onCancelIntake}>취소하고 입력 지우기</button><button type="button" className="analyze-button intake-complete" disabled={analyzing} onClick={() => onSubmitAnswers(answers)}>확인 후 검색</button></div>
      </section>}
      {analyzing && <p className="analysis-status" role="status">검증된 공개 판례와 사실관계를 비교하고 있습니다.</p>}
      <label className="embedding-consent">
        <input
          type="checkbox"
          checked={allowExternalEmbedding}
          onChange={(event) => onExternalEmbeddingChange(event.target.checked)}
        />
        <span>
          <strong>의미 검색 사용</strong>
          입력 문장을 OpenAI 임베딩 API로 전송해 의미 검색을 사용합니다.
          <small>동의하지 않으면 키워드·사실 태그 검색을 사용합니다. 입력은 서비스 DB에 저장하지 않습니다.</small>
        </span>
      </label>
      <div className="composer-notices" aria-label="서비스 안내">
        <p><span aria-hidden="true">✦</span> AI가 공개 판례를 검색·비교합니다.</p>
        <p><span aria-hidden="true">◉</span> 입력은 검색 후 바로 삭제되며, 중단된 입력은 최대 1시간 뒤 삭제됩니다.</p>
      </div>
    </div>
  );
}

function HomeView({
  role,
  setRole,
  description,
  setDescription,
  onSubmit,
  analyzing,
  allowExternalEmbedding,
  setAllowExternalEmbedding,
  intake,
  onStartIntake,
  onSubmitAnswers,
  onCancelIntake,
  homeStartRef,
}) {
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
        allowExternalEmbedding={allowExternalEmbedding}
        onExternalEmbeddingChange={setAllowExternalEmbedding}
        intake={intake}
        onStartIntake={onStartIntake}
        onSubmitAnswers={onSubmitAnswers}
        onCancelIntake={onCancelIntake}
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

// A summary is only generated for precedents about this offence alone. Mixing
// other charges into one summary risks presenting their reasoning as this one's.
const SUMMARY_ABSENCE_REASON = {
  mixed: "다른 죄명이 함께 판단된 판례여서 요약을 제공하지 않습니다. 공식 원문을 확인하세요.",
  peripheral: "이 사건의 주된 죄명이 통신매체이용음란이 아니어서 요약을 제공하지 않습니다. 공식 원문을 확인하세요.",
  focused: "이 판례는 아직 요약이 준비되지 않았습니다. 공식 원문을 확인하세요.",
};

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

      {result.summary?.length > 0 && (
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
      )}

      {!result.summary?.length && (
        <p className="summary-absent">{SUMMARY_ABSENCE_REASON[result.focus] || SUMMARY_ABSENCE_REASON.focused}</p>
      )}

      <div className="card-actions">
        <span>국가법령정보센터 · {result.verifiedAt ? `${result.verifiedAt} 확인` : "공식 링크 확인"}</span>
        <a href={result.officialUrl} target="_blank" rel="noopener noreferrer">
          공식 원문 보기 <span aria-hidden="true">↗</span>
        </a>
      </div>
    </article>
  );
}

const SEARCH_MODE_LABELS = {
  hybrid_embeddings: "임베딩·사실 태그 검색",
  fallback_without_embeddings: "키워드·사실 태그 fallback",
  provisional_without_embeddings: "키워드·사실 태그 검색",
};

function Coverage({ resultCount, coverage }) {
  return (
    <div className="coverage-panel">
      <div className="coverage-stat">
        <span>검색 가능</span>
        <strong>{coverage.availableCount}건</strong>
      </div>
      <div className="coverage-divider" />
      <div className="coverage-copy">
        <strong>국가법령정보센터 공식 공개 판례</strong>
        <p>{SEARCH_MODE_LABELS[coverage.scoring?.status] || "검증된 DB 검색"} · 이번 요청에서 {coverage.comparedCount}건을 비교했습니다.</p>
      </div>
      <div className="coverage-result">기준 이상 <strong>{resultCount}건</strong></div>
    </div>
  );
}

function EmptyResults({ onHome, availableCount }) {
  return (
    <div className="empty-results">
      <div className="empty-orb" aria-hidden="true">∅</div>
      <h2>기준 이상으로 비슷한 판례가 없습니다</h2>
      <p>현재 검색 가능한 {availableCount}건 안에서 기준 이상인 판례를 찾지 못했습니다. 없는 판례를 만들어 보여주지 않습니다.</p>
      <button type="button" onClick={onHome}>사례를 더 구체적으로 작성하기</button>
    </div>
  );
}

function ErrorResults({ onRetry }) {
  return (
    <div className="empty-results error-results" role="alert">
      <div className="empty-orb" aria-hidden="true">!</div>
      <h2>검색 서버에 연결하지 못했습니다</h2>
      <p>판례를 임의로 만들어 대신 보여주지 않습니다. 연결 상태를 확인한 뒤 다시 시도해주세요.</p>
      <button type="button" onClick={onRetry}>다시 검색하기</button>
    </div>
  );
}

function ResultsView({ description, results, coverage, searchFailed, onRetry, onHome, resultsStartRef }) {
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
      {!searchFailed && <Coverage resultCount={results.length} coverage={coverage} />}

      {searchFailed ? <ErrorResults onRetry={onRetry} /> : results.length === 0 ? (
        <EmptyResults onHome={onHome} availableCount={coverage.availableCount} />
      ) : (
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
  const [caseKey, setCaseKey] = useState(0);
  const [role, setRole] = useState("");
  const [description, setDescription] = useState("");
  const [allowExternalEmbedding, setAllowExternalEmbedding] = useState(false);
  const [results, setResults] = useState([]);
  const [coverage, setCoverage] = useState({ availableCount: null, comparedCount: 0, scoring: null });
  const [searchFailed, setSearchFailed] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [intake, setIntake] = useState({ sessionId: null, questions: [] });
  const [submittedDescription, setSubmittedDescription] = useState("");
  const homeStartRef = useRef(null);
  const resultsStartRef = useRef(null);
  // The live session id, mirrored outside React state so the leave-the-page
  // handler can read it without resubscribing on every change.
  const activeSessionRef = useRef(null);
  // Kept so a retry can rebuild an equivalent session after the server deleted
  // the failed one.
  const answersRef = useRef({});

  function trackIntake(next) {
    activeSessionRef.current = next.sessionId;
    setIntake(next);
  }

  /** Stop tracking the session first, then tell the server once. */
  function releaseIntake() {
    const sessionId = activeSessionRef.current;
    activeSessionRef.current = null;
    setIntake({ sessionId: null, questions: [] });
    if (sessionId) cancelIntake({ sessionId }).catch(() => {});
  }

  function motionBehavior() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  }

  useEffect(() => {
    if (view !== "results" || !resultsStartRef.current) return;
    resultsStartRef.current.scrollIntoView({ behavior: motionBehavior(), block: "start" });
  }, [view]);

  // A closing tab never runs React cleanup, so an abandoned session needs both
  // paths covered. Without this the redacted text waits for the 1-hour purge.
  useEffect(() => {
    function abandon() {
      const sessionId = activeSessionRef.current;
      if (!sessionId) return;
      activeSessionRef.current = null;
      abandonIntake({ sessionId });
    }
    window.addEventListener("pagehide", abandon);
    return () => {
      window.removeEventListener("pagehide", abandon);
      abandon();
    };
  }, []);

  function goHome() {
    setView("home");
    setResults([]);
    setSearchFailed(false);
    window.requestAnimationFrame(() => {
      homeStartRef.current?.scrollIntoView({ behavior: motionBehavior(), block: "start" });
    });
  }

  function startNewCase() {
    releaseIntake();
    answersRef.current = {};
    setRole("");
    setDescription("");
    setSubmittedDescription("");
    setAllowExternalEmbedding(false);
    // Remount the composer so the capture, its transcript and any answers go with it.
    setCaseKey((key) => key + 1);
    goHome();
  }

  async function finishIntake(sessionId) {
    setAnalyzing(true);
    setSearchFailed(false);
    // The server deletes the session whether the search succeeds or fails, so
    // stop tracking it now. Holding the id is what made retry always 404.
    activeSessionRef.current = null;
    setIntake({ sessionId: null, questions: [] });
    try {
      const response = await completeIntake({ sessionId, allowExternalEmbedding });
      setResults(response.results);
      setCoverage({
        availableCount: response.availableCount,
        comparedCount: response.comparedCount,
        scoring: response.scoring,
      });
      setView("results");
    } catch {
      setResults([]);
      setCoverage({ availableCount: null, comparedCount: 0, scoring: null });
      setSearchFailed(true);
      setView("results");
    } finally {
      setAnalyzing(false);
    }
  }

  async function startIntake(redactedText) {
    if (analyzing) return;
    setAnalyzing(true);
    setSearchFailed(false);
    // Remember the text before calling out: a retry needs it even when the
    // very first request is what failed.
    setSubmittedDescription(redactedText);
    answersRef.current = {};
    try {
      const response = await createIntake({ role, redactedText });
      trackIntake({ sessionId: response.sessionId, questions: response.questions || [] });
      if ((response.questions || []).length === 0) await finishIntake(response.sessionId);
    } catch {
      setSearchFailed(true);
      setView("results");
    } finally {
      setAnalyzing(false);
    }
  }

  async function submitAnswers(answers) {
    if (!intake.sessionId || analyzing) return;
    setAnalyzing(true);
    answersRef.current = answers;
    try {
      await answerIntake({ sessionId: intake.sessionId, answers });
      await finishIntake(intake.sessionId);
    } catch {
      setSearchFailed(true);
      setView("results");
    } finally {
      setAnalyzing(false);
    }
  }

  /**
   * A failed search takes its session with it, by design. Retrying therefore
   * builds a fresh session from the redacted text still held in the browser
   * rather than reusing an id the server has already deleted.
   */
  async function retrySearch() {
    if (analyzing || !role || !submittedDescription) return;
    setAnalyzing(true);
    setSearchFailed(false);
    try {
      const session = await createIntake({ role, redactedText: submittedDescription });
      const questions = session.questions || [];
      if (questions.length === 0) {
        await finishIntake(session.sessionId);
        return;
      }

      const answers = {};
      for (const question of questions) {
        const stored = String(answersRef.current[question.id] || "").trim();
        if (stored) answers[question.id] = stored;
      }
      // The server requires every asked answer, so ask again rather than fail.
      if (questions.some((question) => !answers[question.id])) {
        trackIntake({ sessionId: session.sessionId, questions });
        goHome();
        return;
      }

      await answerIntake({ sessionId: session.sessionId, answers });
      await finishIntake(session.sessionId);
    } catch {
      setSearchFailed(true);
      setView("results");
    } finally {
      setAnalyzing(false);
    }
  }

  function cancelCurrentIntake() {
    releaseIntake();
  }

  return (
    <div className="page-background">
      <div className={`app-shell ${view === "home" ? "is-home" : "has-results"}`}>
        <SideNavigation view={view} onHome={startNewCase} />
        <div className="app-content">
          <TopBar view={view} onHome={startNewCase} availableCount={coverage.availableCount} />
          <main className="main-content">
            <HomeView
              key={caseKey}
              role={role}
              setRole={setRole}
              description={description}
              setDescription={setDescription}
              onSubmit={startIntake}
              analyzing={analyzing}
              allowExternalEmbedding={allowExternalEmbedding}
              setAllowExternalEmbedding={setAllowExternalEmbedding}
              intake={intake}
              onStartIntake={startIntake}
              onSubmitAnswers={submitAnswers}
              onCancelIntake={cancelCurrentIntake}
              homeStartRef={homeStartRef}
            />
            {view === "results" && (
              <ResultsView
                description={submittedDescription}
                results={results}
                coverage={coverage}
                searchFailed={searchFailed}
                onRetry={retrySearch}
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
