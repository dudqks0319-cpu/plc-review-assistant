const elements = {
  form: document.getElementById('analysis-form'),
  fileInput: document.getElementById('project-file'),
  fileName: document.getElementById('file-name'),
  fileMeta: document.getElementById('file-meta'),
  fileList: document.getElementById('file-list'),
  clearFile: document.getElementById('clear-file'),
  cpuProfile: document.getElementById('cpu-profile'),
  fileEncoding: document.getElementById('file-encoding'),
  mitsubishiImportOptions: document.getElementById('mitsubishi-import-options'),
  changeButton: document.getElementById('change-button'),
  changeRequest: document.getElementById('change-request'),
  safetyAck: document.getElementById('safety-ack'),
  modeHint: document.getElementById('mode-hint'),
  message: document.getElementById('message'),
  serverStatus: document.getElementById('server-status'),
  emptyState: document.getElementById('empty-state'),
  analysisView: document.getElementById('analysis-view'),
  readinessView: document.getElementById('readiness-view'),
  assistantSummary: document.getElementById('assistant-summary'),
  importReview: document.getElementById('import-review'),
  metrics: {
    blocks: document.getElementById('metric-blocks'),
    variables: document.getElementById('metric-variables'),
    io: document.getElementById('metric-io'),
    findings: document.getElementById('metric-findings')
  },
  tabs: [...document.querySelectorAll('.tab')],
  panels: {
    change: document.getElementById('tab-change'),
    question: document.getElementById('tab-question'),
    findings: document.getElementById('tab-findings'),
    blocks: document.getElementById('tab-blocks'),
    variables: document.getElementById('tab-variables'),
    limits: document.getElementById('tab-limits')
  },
  reportButtons: [...document.querySelectorAll('[data-report]')],
  exampleButtons: [...document.querySelectorAll('[data-example]')],
  questionForm: document.getElementById('question-form'),
  questionInput: document.getElementById('question-input'),
  questionSubmit: document.getElementById('question-submit'),
  questionAvailability: document.getElementById('question-availability'),
  includeManualEvidence: document.getElementById('include-manual-evidence'),
  questionAnswer: document.getElementById('question-answer'),
  questionExampleButtons: [...document.querySelectorAll('[data-question-example]')],
  knowledgeForm: document.getElementById('knowledge-form'),
  knowledgeFile: document.getElementById('knowledge-file'),
  knowledgeSourceType: document.getElementById('knowledge-source-type'),
  knowledgeCpuFamily: document.getElementById('knowledge-cpu-family'),
  knowledgeDocNumber: document.getElementById('knowledge-doc-number'),
  knowledgeRevision: document.getElementById('knowledge-revision'),
  knowledgeSection: document.getElementById('knowledge-section'),
  knowledgePage: document.getElementById('knowledge-page'),
  knowledgeLicense: document.getElementById('knowledge-license'),
  knowledgeSubmit: document.getElementById('knowledge-submit'),
  knowledgeList: document.getElementById('knowledge-list'),
  sourcePreview: document.getElementById('source-preview'),
  sourcePreviewLocation: document.getElementById('source-preview-location'),
  sourcePreviewCode: document.getElementById('source-preview-code'),
  sourcePreviewClose: document.getElementById('source-preview-close')
};

let selectedFiles = [];
let currentAnalysis = null;
let currentChangePlan = null;
let currentSourceContent = '';
let currentWorkspaceId = null;
let currentSnapshotId = null;
let currentArtifactTexts = new Map();
let busy = false;
let questionBusy = false;
let knowledgeBusy = false;

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) {
    element.className = className;
  }
  if (text !== undefined) {
    element.textContent = text;
  }
  return element;
}

function setMessage(text, tone = 'neutral') {
  elements.message.textContent = text;
  elements.message.dataset.tone = tone;
}

function selectedAssistantVendor() {
  const value = new FormData(elements.form).get('assistant-version');
  return value === 'siemens' ? 'siemens' : 'mitsubishi';
}

function selectedCpuProfile() {
  return selectedAssistantVendor() === 'mitsubishi' ? elements.cpuProfile.value || null : null;
}

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function requestJson(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...(options.headers || {})
    },
    ...options
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data?.error?.message || `요청 실패: ${response.status}`);
  }

  return data;
}

function createDraftAnalysis(vendor, requestText) {
  const id = `draft-${Date.now().toString(36)}`;
  const vendorLabel = vendor === 'siemens' ? 'Siemens' : 'Mitsubishi';

  return {
    id: `analysis-${id}`,
    project: {
      id: `project-${id}`,
      name: `${vendorLabel} natural-language draft`,
      vendor,
      source: {
        filename: `${vendor}-natural-language-draft.txt`,
        fileType: 'natural-language-draft',
        detectedBy: 'request-only'
      },
      blocks: [],
      variables: [],
      ioAddresses: [],
      callGraph: [],
      protectedItems: [],
      parserWarnings: ['PLC export 파일이 없어 기존 프로젝트 영향 분석을 하지 못했습니다.']
    },
    summary: {
      blockCount: 0,
      variableCount: 0,
      ioAddressCount: 0,
      callEdgeCount: 0,
      protectedItemCount: 0,
      severityCounts: { high: 0, medium: 0, low: 0, info: 0 },
      languageDistribution: {}
    },
    findings: [],
    assistantSummary: [
      `${vendorLabel} 신규 회로 초안 모드입니다.`,
      '기존 PLC 파일이 없어 주소, 태그, 블록 충돌은 확인하지 않았습니다.',
      `요청: ${requestText}`
    ].join('\n'),
    limitations: [
      '기존 PLC export 파일이 없어 주소 충돌, 태그 중복, 블록 영향을 확인하지 못합니다.',
      '실제 프로젝트에 맞는 I/O 주소와 태그로 다시 매핑해야 합니다.',
      '벤더 툴 컴파일, 시뮬레이터 검증, PLC 담당자 승인이 필요합니다.',
      '이 도구는 PLC에 접속하거나 프로그램을 자동으로 쓰지 않습니다.'
    ]
  };
}

function updateModeHint() {
  if (selectedFiles.length) {
    elements.modeHint.dataset.mode = 'file';
    elements.modeHint.textContent =
      `기존 파일 검토 모드 · ${selectedFiles.length}개 export를 하나의 읽기 전용 스냅샷으로 묶어 검토합니다.`;
    return;
  }

  elements.modeHint.dataset.mode = 'draft';
  elements.modeHint.textContent =
    '신규 회로 초안 모드 · 파일 없이 만들 수 있지만 기존 주소 충돌과 블록 영향은 확인할 수 없습니다.';
}

function updatePrimaryState() {
  const hasRequest = elements.changeRequest.value.trim().length > 0;
  const acknowledged = elements.safetyAck.checked;
  elements.changeButton.disabled = busy || !hasRequest || !acknowledged;
  elements.changeButton.textContent = busy
    ? selectedFiles.length
      ? '파일 분석하고 회로 만드는 중…'
      : '회로 초안 만드는 중…'
    : '안전한 회로 초안 만들기';
}

function resetResults() {
  currentAnalysis = null;
  currentChangePlan = null;
  currentSourceContent = '';
  currentWorkspaceId = null;
  currentSnapshotId = null;
  currentArtifactTexts = new Map();
  elements.analysisView.classList.add('hidden');
  elements.emptyState.classList.remove('hidden');
  elements.reportButtons.forEach((button) => {
    button.disabled = true;
  });
  elements.questionAnswer.replaceChildren(
    createElement(
      'p',
      'empty-panel-copy',
      'Mitsubishi export를 분석하면 이곳에서 근거 기반 질문을 할 수 있습니다.'
    )
  );
  elements.knowledgeList.replaceChildren(
    createElement('p', 'empty-panel-copy', '아직 추가한 문서가 없습니다.')
  );
  elements.sourcePreview.classList.add('hidden');
  updateQuestionAvailability();
}

function statusLabel(status) {
  const labels = {
    checked: '확인함',
    'not-provided': '파일 없음',
    unknown: '확인 필요',
    required: '필수',
    blocked: '중단',
    'basic-pass': '간이 통과',
    pass: '통과',
    fail: '실패',
    'not-run': '실행 안 함',
    'not-applicable': '해당 없음'
  };
  return labels[status] || status || '확인 필요';
}

function readinessTitle(readiness) {
  if (!readiness) {
    return '사용 전 확인이 필요합니다';
  }
  if (readiness.level === 'blocked') {
    return '이 요청은 자동 생성할 수 없습니다';
  }
  if (readiness.level === 'simulation-only') {
    return '시뮬레이션 전용 초안입니다';
  }
  if (readiness.level === 'needs-profile') {
    return 'CPU·타이머 기준을 먼저 확인해 주세요';
  }
  if (readiness.mode === 'existing-project-review') {
    return '기존 파일을 참고한 수정 후보입니다';
  }
  return '새 회로 초안입니다';
}

function renderReadiness(readiness) {
  elements.readinessView.replaceChildren();
  if (!readiness) {
    return;
  }

  const banner = createElement('section', `readiness-banner readiness-${readiness.level || 'unknown'}`);
  const heading = createElement('div', 'readiness-heading');
  heading.append(createElement('h3', '', readinessTitle(readiness)));
  heading.append(
    createElement(
      'span',
      'readiness-scope',
      readiness.canWriteToPlc ? 'PLC 쓰기 가능' : 'PLC 직접 쓰기 없음'
    )
  );
  banner.append(heading);
  banner.append(createElement('p', '', readiness.summary));

  const list = createElement('ul', 'readiness-check-list');
  (readiness.checks || []).forEach((check) => {
    const item = createElement('li', `check-${check.status || 'unknown'}`);
    const top = createElement('div');
    top.append(createElement('strong', '', check.label));
    top.append(createElement('span', 'check-status', statusLabel(check.status)));
    item.append(top);
    item.append(createElement('small', '', check.detail));
    list.append(item);
  });
  banner.append(list);
  elements.readinessView.append(banner);
}

function renderFindings(findings = []) {
  const panel = elements.panels.findings;
  panel.replaceChildren();

  if (findings.length === 0) {
    panel.append(
      createElement(
        'p',
        'empty-panel-copy',
        selectedFiles.length ? '업로드한 export 범위에서 표시할 문제 후보가 없습니다.' : '기존 파일을 넣으면 주소 중복과 주석 누락 등을 확인합니다.'
      )
    );
    return;
  }

  const list = createElement('div', 'finding-list');
  findings.forEach((finding) => {
    const item = createElement('article', `finding finding-${finding.severity}`);
    const header = createElement('header');
    header.append(createElement('span', 'severity', String(finding.severity || 'info').toUpperCase()));
    header.append(createElement('strong', '', finding.title));
    item.append(header);
    item.append(createElement('p', '', finding.description));
    item.append(createElement('small', '', finding.recommendation));
    if (finding.evidence?.length) {
      const evidence = createElement('ul', 'plain-list');
      finding.evidence.forEach((entry) => evidence.append(createElement('li', '', entry)));
      item.append(evidence);
    }
    list.append(item);
  });
  panel.append(list);
}

function renderTable(panel, headers, rows, emptyText) {
  panel.replaceChildren();
  if (!rows.length) {
    panel.append(createElement('p', 'empty-panel-copy', emptyText));
    return;
  }

  const wrap = createElement('div', 'table-wrap');
  const table = createElement('table');
  const head = createElement('thead');
  const headRow = createElement('tr');
  headers.forEach((header) => headRow.append(createElement('th', '', header)));
  head.append(headRow);
  table.append(head);

  const body = createElement('tbody');
  rows.forEach((row) => {
    const tr = createElement('tr');
    row.forEach((cell) => tr.append(createElement('td', '', cell || '-')));
    body.append(tr);
  });
  table.append(body);
  wrap.append(table);
  panel.append(wrap);
}

function renderBlocks(blocks = []) {
  renderTable(
    elements.panels.blocks,
    ['종류', '이름', '언어', '상태'],
    blocks.map((block) => [block.type, block.name, block.language, block.protected ? '보호됨' : '분석됨']),
    '기존 파일을 넣으면 프로그램 블록이 여기에 표시됩니다.'
  );
}

function renderVariables(project) {
  const variables = Array.isArray(project?.variables) ? project.variables : [];
  const rows = variables.slice(0, 120).map((variable) => [
    variable.name,
    variable.address,
    variable.dataType || variable.kind,
    variable.comment,
    String(variable.usageCount ?? '')
  ]);
  renderTable(
    elements.panels.variables,
    ['이름', '주소', '종류', '설명', '사용'],
    rows,
    '기존 파일을 넣으면 태그와 I/O 주소가 여기에 표시됩니다.'
  );
}

function renderLimits(limitations = [], warnings = []) {
  const panel = elements.panels.limits;
  panel.replaceChildren();
  const title = createElement('h3', '', '실제 사용 전에 꼭 확인하세요');
  const list = createElement('ul', 'warning-list');
  [...new Set([...warnings, ...limitations])].forEach((item) => list.append(createElement('li', '', item)));
  panel.append(title, list);
}

function appendList(parent, items, className = 'plain-list') {
  const list = createElement('ul', className);
  (items || []).forEach((item) => list.append(createElement('li', '', item)));
  parent.append(list);
  return list;
}

function renderCircuitDraft(circuitDraft) {
  const section = createElement('article', 'result-card circuit-draft-card');
  section.append(createElement('h3', '', '회로 미리보기'));
  section.append(createElement('p', 'card-lead', circuitDraft.title));

  const ioTitle = createElement('h4', '', '어떤 신호를 쓰나요?');
  section.append(ioTitle);
  const ioMap = createElement('div', 'io-map');
  (circuitDraft.ioMap || []).forEach((item) => {
    const row = createElement('div', 'io-item');
    row.append(createElement('strong', '', item.device));
    row.append(createElement('span', '', item.role));
    row.append(createElement('small', '', `${item.label} · ${item.contact}`));
    ioMap.append(row);
  });
  section.append(ioMap);

  if (circuitDraft.assumptions?.length) {
    const assumptions = createElement('div', 'assumption-box');
    assumptions.append(createElement('h4', '', '이 초안이 가정한 것'));
    appendList(assumptions, circuitDraft.assumptions);
    section.append(assumptions);
  }

  (circuitDraft.ladderPreview || []).forEach((network) => {
    const networkBox = createElement('div', 'ladder-network');
    networkBox.append(createElement('h4', '', network.title));
    networkBox.append(createElement('pre', 'ladder-preview-block', network.ascii));
    networkBox.append(createElement('p', '', network.explanation));
    section.append(networkBox);
  });

  const commandDetails = createElement('details', 'command-details');
  commandDetails.append(createElement('summary', '', 'GX Works2 명령 리스트 보기'));
  commandDetails.append(createElement('pre', 'ladder-preview-block', (circuitDraft.instructionList || []).join('\n')));
  section.append(commandDetails);
  return section;
}

function downloadGeneratedFile(file) {
  const blob = new Blob([file.content], { type: file.mimeType || 'text/plain; charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.filename || 'plc-change-candidate.txt';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  setMessage(`${link.download} 다운로드를 시작했습니다.`, 'success');
}

function renderChangePlan(changePlan) {
  const panel = elements.panels.change;
  panel.replaceChildren();
  renderReadiness(changePlan?.readiness || null);

  if (!changePlan) {
    panel.append(createElement('p', 'empty-panel-copy', '요청을 입력하고 회로 초안을 만들면 결과가 표시됩니다.'));
    return;
  }

  const overview = createElement('article', 'result-card overview-card');
  const meta = createElement('div', 'result-meta');
  meta.append(
    createElement(
      'span',
      `risk-chip risk-${changePlan.riskLevel}`,
      changePlan.riskClass
        ? `위험 등급 ${changePlan.riskClass}`
        : `위험도 ${changePlan.riskLevel}`
    )
  );
  meta.append(createElement('span', '', changePlan.vendor === 'mitsubishi' ? 'GX Works2' : 'Siemens'));
  if (changePlan.changeCandidateV2?.template) {
    meta.append(
      createElement('span', '', `Template · ${changePlan.changeCandidateV2.template.label}`)
    );
  }
  meta.append(
    createElement(
      'span',
      '',
      changePlan.executionScope === 'simulation-only'
        ? '시뮬레이션 전용'
        : changePlan.executionScope === 'review-only'
          ? '기준 확인 전 검토만'
        : changePlan.readiness?.mode === 'existing-project-review'
          ? '기존 파일 검토'
          : '신규 초안'
    )
  );
  overview.append(meta);
  overview.append(createElement('h3', '', '무엇을 만들었나요?'));
  overview.append(createElement('p', 'card-lead', changePlan.normalizedRequirement?.targetBehavior || changePlan.title));

  const behavior = createElement('div', 'two-column-copy');
  const expected = createElement('section');
  expected.append(createElement('h4', '', '예상 동작'));
  appendList(expected, changePlan.expectedBehavior || []);
  behavior.append(expected);

  const checks = createElement('section');
  checks.append(createElement('h4', '', '간이 확인 결과'));
  checks.append(
    createElement(
      'p',
      `simulation-result simulation-${changePlan.simulation?.result || 'unknown'}`,
      changePlan.simulation?.result === 'pass'
        ? '기본 ON/OFF 논리 확인 통과'
        : changePlan.simulation?.result === 'blocked'
          ? '안전 조건으로 확인 중단'
          : '추가 확인 필요'
    )
  );
  const timeline = createElement('ul', 'timeline-list');
  (changePlan.simulation?.timeline || []).forEach((item) => {
    const row = createElement('li');
    row.append(createElement('span', '', item.name));
    row.append(createElement('strong', '', item.output ? 'ON' : 'OFF'));
    timeline.append(row);
  });
  checks.append(timeline);
  behavior.append(checks);
  overview.append(behavior);
  panel.append(overview);

  if (changePlan.changeCandidateV2) {
    const candidate = changePlan.changeCandidateV2;
    const impact = createElement('article', 'result-card impact-card');
    impact.append(createElement('h3', '', 'Logic IR·영향 검토'));
    impact.append(
      createElement(
        'p',
        'card-lead',
        candidate.validation.instructionEmissionAllowed
          ? '필수 신호와 충돌 검사를 통과해 검토용 명령 후보를 만들었습니다.'
          : '근거 또는 충돌 확인이 남아 명령 후보는 만들지 않고 검토 기록만 제공합니다.'
      )
    );
    const impactMeta = createElement('div', 'summary-grid');
    [
      ['Template', candidate.template?.label || '확인 필요'],
      ['Logic IR', candidate.logicIr?.version || '없음'],
      ['대상 출력', candidate.impactAnalysis?.targetAddresses?.join(', ') || '확인 필요'],
      ['명령 후보', candidate.policy?.canEmitInstructionCandidate ? '생성 가능' : '보류']
    ].forEach(([label, value]) => {
      const item = createElement('div');
      item.append(createElement('span', '', label));
      item.append(createElement('strong', '', value));
      impactMeta.append(item);
    });
    impact.append(impactMeta);

    const conflicts = candidate.impactAnalysis?.conflicts || [];
    if (conflicts.length) {
      const conflictBox = createElement('div', 'warning-box');
      conflictBox.append(createElement('h4', '', 'Writer·주소 충돌'));
      appendList(
        conflictBox,
        conflicts.map(
          (conflict) =>
            `${conflict.address || '주소 확인 필요'} · ${conflict.detail}`
        ),
        'warning-list'
      );
      impact.append(conflictBox);
    }
    const reviewReasons = candidate.validation?.reviewReasons || [];
    if (reviewReasons.length) {
      impact.append(createElement('h4', '', '추가 확인 항목'));
      appendList(impact, reviewReasons);
    }
    panel.append(impact);
  }

  if (changePlan.circuitDraft) {
    panel.append(renderCircuitDraft(changePlan.circuitDraft));
  }

  const files = createElement('article', 'result-card');
  files.append(createElement('h3', '', '저장할 수 있는 파일'));
  if (!changePlan.candidateFiles?.length) {
    files.append(createElement('p', 'empty-panel-copy', '안전 차단 때문에 생성된 파일이 없습니다.'));
  } else {
    files.append(
      createElement(
        'p',
        'card-lead',
        changePlan.executionScope === 'simulation-only'
          ? '실제 적용 파일 대신 시뮬레이션 설명과 검토 기록만 제공합니다.'
          : '원본은 바뀌지 않습니다. 아래 파일은 모두 별도 검토용 후보입니다.'
      )
    );
    const fileList = createElement('div', 'file-download-list');
    changePlan.candidateFiles.forEach((file) => {
      const button = createElement('button', 'download-file-button');
      button.type = 'button';
      button.append(createElement('strong', '', file.label));
      button.append(createElement('small', '', file.filename));
      button.addEventListener('click', () => downloadGeneratedFile(file));
      fileList.append(button);
    });
    files.append(fileList);
  }
  panel.append(files);

  const review = createElement('article', 'result-card review-card');
  review.append(createElement('h3', '', '다음에 무엇을 해야 하나요?'));
  const steps = createElement('ol', 'numbered-list');
  (changePlan.recommendedPatch?.manualSteps || []).forEach((step) => steps.append(createElement('li', '', step)));
  review.append(steps);
  if (changePlan.warnings?.length) {
    const warningBox = createElement('div', 'warning-box');
    warningBox.append(createElement('h4', '', '주의'));
    appendList(warningBox, changePlan.warnings, 'warning-list');
    review.append(warningBox);
  }
  panel.append(review);

  const technical = createElement('details', 'technical-details');
  technical.append(createElement('summary', '', '개발자용 패치 내용 보기'));
  if (!changePlan.recommendedPatch?.patchArtifacts?.length) {
    technical.append(createElement('p', 'empty-panel-copy', changePlan.recommendedPatch?.summary || '패치가 없습니다.'));
  } else {
    changePlan.recommendedPatch.patchArtifacts.forEach((artifact) => {
      technical.append(createElement('h4', '', artifact.name));
      technical.append(createElement('pre', 'technical-code', artifact.content));
    });
  }
  panel.append(technical);
}

function renderAnalysis(analysis, changePlan = null) {
  currentAnalysis = analysis;
  elements.emptyState.classList.add('hidden');
  elements.analysisView.classList.remove('hidden');
  elements.metrics.blocks.textContent = analysis.summary?.blockCount ?? 0;
  elements.metrics.variables.textContent = analysis.summary?.variableCount ?? 0;
  elements.metrics.io.textContent = analysis.summary?.ioAddressCount ?? 0;
  elements.metrics.findings.textContent = analysis.findings?.length ?? 0;
  elements.assistantSummary.textContent = analysis.assistantSummary || '분석 설명이 없습니다.';
  renderImportReview(analysis);
  renderFindings(analysis.findings || []);
  renderBlocks(analysis.project?.blocks || []);
  renderVariables(analysis.project || {});
  renderLimits(analysis.limitations || [], changePlan?.warnings || []);
  renderChangePlan(changePlan);
  elements.reportButtons.forEach((button) => {
    button.disabled = false;
  });
  updateQuestionAvailability();
  if (currentWorkspaceId) {
    refreshKnowledgeDocuments();
  }
}

function bytesToBase64(bytes) {
  const chunkSize = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function decodeArtifactBytes(bytes, encoding) {
  const browserEncoding = {
    cp949: 'euc-kr',
    'shift-jis': 'shift_jis',
    'windows-1252': 'windows-1252',
    'utf-8': 'utf-8'
  }[encoding] || 'utf-8';
  return new TextDecoder(browserEncoding, { fatal: false }).decode(bytes);
}

function primaryFile(files) {
  const rank = (file) => {
    const extension = file.name.split('.').pop()?.toLowerCase();
    return extension === 'lst' || extension === 'txt' || extension === 'asc' ? 0 : 1;
  };
  return [...files].sort((left, right) => rank(left) - rank(right))[0];
}

function bundleRecordToAnalysis(record, workspace, sourceFile) {
  const snapshot = record.snapshot;
  const variables = snapshot.devices.map((device) => ({
    id: device.id,
    name: device.label || device.canonicalAddress,
    address: device.canonicalAddress,
    dataType: device.family || device.kind || 'device',
    kind: device.kind || device.family || 'device',
    comment: device.comment || '',
    usageCount: snapshot.references.filter(
      (reference) => reference.canonicalAddress === device.canonicalAddress
    ).length
  }));
  const parserWarnings = snapshot.parseWarnings.map((warning) =>
    typeof warning === 'string' ? warning : warning.message || warning.code || '확인되지 않은 구문'
  );
  const instructionCount = snapshot.programs.reduce(
    (programTotal, program) =>
      programTotal +
      (program.networks || []).reduce(
        (networkTotal, network) => networkTotal + (network.instructions || []).length,
        0
      ),
    0
  );

  return {
    id: snapshot.id,
    snapshot,
    importReview: {
      artifacts: snapshot.artifacts,
      artifactResults: record.artifactResults || [],
      warnings: parserWarnings,
      reused: Boolean(record.reused)
    },
    project: {
      id: workspace.id,
      name: workspace.name,
      vendor: snapshot.vendor,
      cpuProfileId: snapshot.cpuProfileId,
      source: {
        filename: sourceFile.name,
        fileType: 'project-bundle',
        detectedBy: 'api-v2-bundle'
      },
      blocks: snapshot.programs.map((program) => ({
        id: program.id,
        name: program.name,
        type: program.kind,
        language: program.language,
        protected: false
      })),
      variables,
      ioAddresses: variables.map((variable) => variable.address),
      callGraph: snapshot.callEdges,
      protectedItems: [],
      parserWarnings
    },
    summary: {
      blockCount: snapshot.programs.length,
      variableCount: variables.length,
      ioAddressCount: variables.length,
      callEdgeCount: snapshot.callEdges.length,
      protectedItemCount: 0,
      instructionCount,
      severityCounts: { high: 0, medium: 0, low: 0, info: 0 },
      languageDistribution: { 'instruction-list': snapshot.programs.length }
    },
    findings: record.findings || [],
    assistantSummary: [
      `Mitsubishi export ${snapshot.artifacts.length}개를 메모리 전용 스냅샷으로 분석했습니다.`,
      `CPU 계열: ${snapshot.cpuProfileId || '미확인'}`,
      `프로그램 ${snapshot.programs.length}개 · 명령 ${instructionCount}개 · 디바이스 ${snapshot.devices.length}개`,
      parserWarnings.length ? `파서 확인 항목 ${parserWarnings.length}개가 있습니다.` : '파서 경고가 없습니다.',
      '원본 파일과 PLC에는 어떤 변경도 하지 않았습니다.'
    ].join('\n'),
    limitations: [
      '분석 범위는 사용자가 선택한 export 파일에 한정됩니다.',
      '보호 블록과 벤더 전용 바이너리 프로젝트 내부는 읽지 않습니다.',
      '실행 순서, 간접 주소, 타이머 기준이 불명확하면 확인 필요로 표시합니다.',
      '벤더 툴 컴파일, 시뮬레이터 검증, PLC 담당자 승인이 별도로 필요합니다.'
    ]
  };
}

function renderImportReview(analysis) {
  elements.importReview.replaceChildren(createElement('h3', '', '가져오기 검토'));
  const review = analysis.importReview;
  if (!review?.artifacts?.length) {
    elements.importReview.append(
      createElement('p', 'empty-panel-copy', '단일 파일 또는 자연어 초안입니다.')
    );
    return;
  }
  const tableHost = createElement('div');
  renderTable(
    tableHost,
    ['파일', '인코딩', '크기', '내용 해시'],
    review.artifacts.map((artifact) => [
      artifact.filename,
      artifact.encoding || 'utf-8',
      formatBytes(artifact.sizeBytes || 0),
      String(artifact.contentHash || '').slice(0, 12)
    ]),
    '가져온 파일이 없습니다.'
  );
  elements.importReview.append(tableHost);
  if (review.warnings?.length) {
    appendList(elements.importReview, review.warnings, 'warning-list');
  }
}

function updateQuestionAvailability() {
  const available = Boolean(
    currentWorkspaceId &&
      currentSnapshotId &&
      currentAnalysis?.project?.vendor === 'mitsubishi'
  );
  const questionDisabled = !available || questionBusy;
  const knowledgeDisabled = !available || knowledgeBusy;

  elements.questionAvailability.textContent = available
    ? '현재 Snapshot 사용 중'
    : 'Mitsubishi 분석 후 사용 가능';
  elements.questionAvailability.dataset.available = String(available);
  elements.questionInput.disabled = questionDisabled;
  elements.questionSubmit.disabled =
    questionDisabled || elements.questionInput.value.trim().length === 0;
  elements.questionSubmit.textContent = questionBusy ? '근거 찾는 중…' : '근거 답변 만들기';
  elements.questionExampleButtons.forEach((button) => {
    button.disabled = questionDisabled;
  });

  [
    elements.knowledgeFile,
    elements.knowledgeSourceType,
    elements.knowledgeCpuFamily,
    elements.knowledgeDocNumber,
    elements.knowledgeRevision,
    elements.knowledgeSection,
    elements.knowledgePage,
    elements.knowledgeLicense
  ].forEach((control) => {
    control.disabled = knowledgeDisabled;
  });
  elements.knowledgeSubmit.disabled = knowledgeDisabled;
  elements.knowledgeSubmit.textContent = knowledgeBusy ? '로컬 색인 중…' : '문서 색인하기';

  if (available && !elements.knowledgeCpuFamily.value) {
    elements.knowledgeCpuFamily.value = {
      'mitsubishi-fx3': 'FX3',
      'mitsubishi-q': 'QCPU',
      'mitsubishi-l': 'LCPU'
    }[currentAnalysis.project.cpuProfileId] || '';
  }
}

function appendAnswerSection(parent, title, items, className = '') {
  if (!Array.isArray(items) || !items.length) return;
  const section = createElement('section', className);
  section.append(createElement('h4', '', title));
  appendList(section, items);
  parent.append(section);
}

function formatSourceLocation(source) {
  if (!source?.filename) return '원문 위치 정보 없음';
  const lineStart = Number.isInteger(source.lineStart) ? source.lineStart : null;
  const lineEnd = Number.isInteger(source.lineEnd) ? source.lineEnd : lineStart;
  const lines = lineStart
    ? lineEnd && lineEnd !== lineStart
      ? `${lineStart}–${lineEnd}줄`
      : `${lineStart}줄`
    : '줄 번호 확인 필요';
  return `${source.filename} · ${lines}`;
}

function openSourceAnchor(source) {
  const filename = typeof source?.filename === 'string' ? source.filename : '';
  const sourceText = currentArtifactTexts.get(filename);
  const lineStart = Math.max(1, Number.isInteger(source?.lineStart) ? source.lineStart : 1);
  const requestedEnd = Number.isInteger(source?.lineEnd) ? source.lineEnd : lineStart;
  const lineEnd = Math.max(lineStart, Math.min(requestedEnd, lineStart + 39));

  elements.sourcePreview.classList.remove('hidden');
  elements.sourcePreviewLocation.textContent = formatSourceLocation(source);

  if (typeof sourceText !== 'string') {
    elements.sourcePreviewCode.textContent =
      '이 근거의 원문 파일이 현재 브라우저에 없습니다. 해당 export를 다시 선택해 분석해 주세요.';
  } else {
    const lines = sourceText.split(/\r?\n/);
    const from = Math.max(1, lineStart - 2);
    const to = Math.min(lines.length, lineEnd + 2);
    const width = String(to).length;
    elements.sourcePreviewCode.textContent = lines
      .slice(from - 1, to)
      .map((line, index) => {
        const number = from + index;
        const marker = number >= lineStart && number <= lineEnd ? '>' : ' ';
        return `${marker} ${String(number).padStart(width, ' ')} │ ${line}`;
      })
      .join('\n');
  }

  elements.sourcePreview.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  elements.sourcePreviewCode.focus({ preventScroll: true });
}

function renderEvidenceCard(entry) {
  const card = createElement('article', 'evidence-card');
  const heading = createElement('div', 'evidence-card-heading');
  heading.append(createElement('strong', '', entry.label || entry.kind || '근거'));
  heading.append(createElement('span', '', entry.kind === 'knowledge' ? '로컬 문서' : 'Export'));
  card.append(heading);

  if (entry.kind === 'knowledge') {
    const citation = entry.citation || {};
    const citationParts = [
      citation.documentNumber,
      citation.revision ? `개정 ${citation.revision}` : '',
      citation.section,
      citation.page ? `${citation.page}쪽` : ''
    ].filter(Boolean);
    card.append(
      createElement(
        'p',
        'evidence-location',
        citationParts.length ? citationParts.join(' · ') : citation.filename || '문서 위치 확인 필요'
      )
    );
    if (entry.snippet) {
      card.append(createElement('blockquote', 'knowledge-snippet', entry.snippet));
    }
  } else if (entry.source) {
    card.append(createElement('p', 'evidence-location', formatSourceLocation(entry.source)));
    const sourceButton = createElement('button', 'source-link-button', '원문 위치 열기');
    sourceButton.type = 'button';
    sourceButton.addEventListener('click', () => openSourceAnchor(entry.source));
    card.append(sourceButton);
  } else {
    card.append(createElement('p', 'evidence-location', '직접 원문 위치 정보 없음'));
  }
  return card;
}

function renderGroundedAnswer(result) {
  const host = elements.questionAnswer;
  host.replaceChildren();
  const answer = result?.answer || {};
  const confidence = Math.max(0, Math.min(1, Number(answer.confidence) || 0));
  const confidencePercent = Math.round(confidence * 100);

  const summary = createElement('article', 'grounded-answer-card');
  const heading = createElement('div', 'answer-heading');
  const headingCopy = createElement('div');
  headingCopy.append(createElement('span', 'step-kicker', '근거 답변'));
  headingCopy.append(
    createElement(
      'h3',
      '',
      answer.conclusion?.length ? answer.conclusion.join(' ') : '현재 근거로 결론을 확정할 수 없습니다'
    )
  );
  heading.append(headingCopy);
  const confidenceBox = createElement('div', 'confidence-box');
  confidenceBox.append(createElement('strong', '', `신뢰도 ${confidencePercent}%`));
  const meter = createElement('progress');
  meter.max = 100;
  meter.value = confidencePercent;
  meter.setAttribute('aria-label', `답변 신뢰도 ${confidencePercent}%`);
  confidenceBox.append(meter);
  heading.append(confidenceBox);
  summary.append(heading);

  const meta = createElement('div', 'answer-meta');
  meta.append(createElement('span', '', `질문 유형: ${result.questionType || '분류 안 됨'}`));
  meta.append(createElement('span', '', `근거 ${result.evidence?.length || 0}개`));
  meta.append(createElement('span', '', 'PLC 쓰기 없음'));
  summary.append(meta);

  appendAnswerSection(summary, '설명', answer.explanation, 'answer-explanation');
  appendAnswerSection(summary, '확인되지 않은 점', answer.unknowns, 'answer-unknowns');
  appendAnswerSection(summary, '전제', answer.assumptions, 'answer-assumptions');
  appendAnswerSection(summary, '다음 확인', answer.suggestedNextChecks, 'answer-next-checks');
  host.append(summary);

  const evidenceSection = createElement('section', 'answer-evidence');
  evidenceSection.append(createElement('h3', '', `사용한 근거 ${result.evidence?.length || 0}개`));
  if (result.evidence?.length) {
    const evidenceList = createElement('div', 'answer-evidence-list');
    result.evidence.forEach((entry) => evidenceList.append(renderEvidenceCard(entry)));
    evidenceSection.append(evidenceList);
  } else {
    evidenceSection.append(
      createElement(
        'p',
        'empty-panel-copy',
        '직접 근거를 찾지 못했습니다. 주소와 export 범위를 확인해 주세요.'
      )
    );
  }
  if (result.knowledgeSearch?.warnings?.length) {
    appendAnswerSection(
      evidenceSection,
      '문서 검색에서 제외된 항목',
      result.knowledgeSearch.warnings.map((warning) =>
        warning.code === 'KNOWLEDGE_CPU_FAMILY_FILTERED'
          ? '현재 Snapshot과 CPU 계열이 다른 문서는 근거에서 제외했습니다.'
          : warning.detail || warning.code
      ),
      'answer-unknowns'
    );
  }
  host.append(evidenceSection);
}

async function askGroundedQuestion(event) {
  event.preventDefault();
  const question = elements.questionInput.value.trim();
  if (!currentSnapshotId || !question || questionBusy) return;

  questionBusy = true;
  updateQuestionAvailability();
  setMessage('현재 Snapshot과 로컬 문서에서 직접 근거를 찾고 있습니다.');
  try {
    const response = await requestJson(
      `/api/v2/snapshots/${encodeURIComponent(currentSnapshotId)}/questions`,
      {
        method: 'POST',
        body: JSON.stringify({
          mode: 'grounded',
          question,
          includeManualEvidence: elements.includeManualEvidence.checked,
          maxTraceDepth: 4
        })
      }
    );
    renderGroundedAnswer(response.data);
    setMessage(
      response.data.evidence?.length
        ? `근거 ${response.data.evidence.length}개로 답변했습니다. 원문 위치를 직접 확인해 주세요.`
        : '직접 근거가 없어 결론을 확정하지 않았습니다.',
      response.data.evidence?.length ? 'success' : 'warning'
    );
  } catch (error) {
    elements.questionAnswer.replaceChildren(
      createElement(
        'p',
        'empty-panel-copy',
        error instanceof Error ? error.message : '근거 질문에 답하지 못했습니다.'
      )
    );
    setMessage(error instanceof Error ? error.message : '근거 질문에 답하지 못했습니다.', 'error');
  } finally {
    questionBusy = false;
    updateQuestionAvailability();
  }
}

function renderKnowledgeDocuments(documents) {
  elements.knowledgeList.replaceChildren();
  if (!documents.length) {
    elements.knowledgeList.append(
      createElement('p', 'empty-panel-copy', '아직 추가한 문서가 없습니다.')
    );
    return;
  }

  documents.forEach((document) => {
    const card = createElement('article', 'knowledge-document-card');
    const copy = createElement('div');
    copy.append(createElement('strong', '', document.filename));
    copy.append(
      createElement(
        'small',
        '',
        [
          document.family || 'CPU 공통',
          document.documentNumber,
          document.revision ? `개정 ${document.revision}` : '',
          `${document.chunkCount}개 조각`,
          '메모리 전용'
        ]
          .filter(Boolean)
          .join(' · ')
      )
    );
    card.append(copy);
    const removeButton = createElement('button', 'text-button', '빼기');
    removeButton.type = 'button';
    removeButton.addEventListener('click', async () => {
      if (!currentWorkspaceId) return;
      const workspaceId = currentWorkspaceId;
      removeButton.disabled = true;
      try {
        await requestJson(
          `/api/v2/workspaces/${encodeURIComponent(workspaceId)}/knowledge-documents/${encodeURIComponent(document.id)}`,
          { method: 'DELETE' }
        );
        if (workspaceId === currentWorkspaceId) {
          await refreshKnowledgeDocuments();
          setMessage(`${document.filename} 로컬 색인을 뺐습니다.`, 'success');
        }
      } catch (error) {
        removeButton.disabled = false;
        setMessage(error instanceof Error ? error.message : '문서를 빼지 못했습니다.', 'error');
      }
    });
    card.append(removeButton);
    elements.knowledgeList.append(card);
  });
}

async function refreshKnowledgeDocuments() {
  if (!currentWorkspaceId) return;
  const workspaceId = currentWorkspaceId;
  try {
    const response = await requestJson(
      `/api/v2/workspaces/${encodeURIComponent(workspaceId)}/knowledge-documents`
    );
    if (workspaceId === currentWorkspaceId) {
      renderKnowledgeDocuments(Array.isArray(response.data) ? response.data : []);
    }
  } catch (error) {
    if (workspaceId === currentWorkspaceId) {
      elements.knowledgeList.replaceChildren(
        createElement(
          'p',
          'empty-panel-copy',
          error instanceof Error ? error.message : '문서 목록을 불러오지 못했습니다.'
        )
      );
    }
  }
}

async function importKnowledgeDocument(event) {
  event.preventDefault();
  const file = elements.knowledgeFile.files?.[0];
  if (!currentWorkspaceId || !file || knowledgeBusy) {
    setMessage('먼저 Mitsubishi export를 분석하고 TXT 또는 Markdown 문서를 선택해 주세요.', 'error');
    return;
  }
  if (file.size > 1_000_000) {
    setMessage('로컬 문서는 1MB 이하만 색인할 수 있습니다.', 'error');
    return;
  }

  const rawPage = Number.parseInt(elements.knowledgePage.value, 10);
  const workspaceId = currentWorkspaceId;
  knowledgeBusy = true;
  updateQuestionAvailability();
  setMessage(`${file.name} 문서를 브라우저 세션의 로컬 메모리에 색인하고 있습니다.`);
  try {
    const response = await requestJson(
      `/api/v2/workspaces/${encodeURIComponent(workspaceId)}/knowledge-documents`,
      {
        method: 'POST',
        body: JSON.stringify({
          filename: file.name,
          content: await file.text(),
          sourceType: elements.knowledgeSourceType.value,
          vendor: 'mitsubishi',
          family: elements.knowledgeCpuFamily.value.trim(),
          cpuModels: currentAnalysis?.project?.cpuProfileId
            ? [currentAnalysis.project.cpuProfileId]
            : [],
          engineeringTool: 'GX Works2',
          documentNumber: elements.knowledgeDocNumber.value.trim(),
          revision: elements.knowledgeRevision.value.trim(),
          section: elements.knowledgeSection.value.trim(),
          page: Number.isInteger(rawPage) && rawPage > 0 ? rawPage : null,
          licensePolicy: elements.knowledgeLicense.value
        })
      }
    );
    if (workspaceId !== currentWorkspaceId) return;
    elements.knowledgeFile.value = '';
    await refreshKnowledgeDocuments();
    const warningCount = response.data.warnings?.length || 0;
    setMessage(
      response.data.reused
        ? `${file.name}은 이미 같은 내용으로 색인되어 기존 문서를 재사용했습니다.`
        : `${file.name}을 로컬 메모리에 색인했습니다.${warningCount ? ` 지시문 형태 문단 ${warningCount}개는 제외했습니다.` : ''}`,
      warningCount ? 'warning' : 'success'
    );
  } catch (error) {
    setMessage(error instanceof Error ? error.message : '문서를 색인하지 못했습니다.', 'error');
  } finally {
    knowledgeBusy = false;
    updateQuestionAvailability();
  }
}

async function analyzeSelectedFiles(vendor) {
  if (!selectedFiles.length) {
    return null;
  }

  if (vendor === 'siemens') {
    if (selectedFiles.length !== 1 || !selectedFiles[0].name.toLowerCase().endsWith('.xml')) {
      throw new Error('Siemens 검토는 TIA Portal XML 파일 1개만 선택해 주세요.');
    }
    setMessage('1/2 · Siemens XML 파일을 읽고 있습니다.');
    currentSourceContent = await selectedFiles[0].text();
    currentArtifactTexts = new Map([[selectedFiles[0].name, currentSourceContent]]);
    const response = await requestJson('/api/v1/analyses', {
      method: 'POST',
      body: JSON.stringify({
        filename: selectedFiles[0].name,
        vendor,
        content: currentSourceContent
      })
    });
    currentAnalysis = response.data;
    return currentAnalysis;
  }

  setMessage(`1/2 · Mitsubishi export ${selectedFiles.length}개를 읽고 있습니다.`);
  currentArtifactTexts = new Map();
  const artifacts = await Promise.all(
    selectedFiles.map(async (file) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      currentArtifactTexts.set(
        file.name,
        decodeArtifactBytes(bytes, elements.fileEncoding.value)
      );
      return {
        filename: file.name,
        contentBase64: bytesToBase64(bytes),
        encoding: elements.fileEncoding.value
      };
    })
  );
  const sourceFile = primaryFile(selectedFiles);
  currentSourceContent = currentArtifactTexts.get(sourceFile.name) || '';
  const workspaceResponse = await requestJson('/api/v2/workspaces', {
    method: 'POST',
    body: JSON.stringify({
      name: sourceFile.name.replace(/\.[^.]+$/, '') || 'Mitsubishi review',
      vendor,
      cpuProfileId: selectedCpuProfile()
    })
  });
  currentWorkspaceId = workspaceResponse.data.id;
  const importResponse = await requestJson(
    `/api/v2/workspaces/${encodeURIComponent(workspaceResponse.data.id)}/artifacts`,
    {
      method: 'POST',
      body: JSON.stringify({
        cpuProfileId: selectedCpuProfile(),
        artifacts
      })
    }
  );
  currentSnapshotId = importResponse.data.snapshot.id;
  currentAnalysis = bundleRecordToAnalysis(
    importResponse.data,
    workspaceResponse.data,
    sourceFile
  );
  return currentAnalysis;
}

async function createChangePlan(event) {
  event.preventDefault();
  const requestText = elements.changeRequest.value.trim();

  if (!requestText) {
    setMessage('원하는 동작을 한 문장 이상 적어 주세요.', 'error');
    elements.changeRequest.focus();
    return;
  }

  if (!elements.safetyAck.checked) {
    setMessage('검토용 초안 확인란을 먼저 체크해 주세요.', 'error');
    elements.safetyAck.focus();
    return;
  }

  busy = true;
  updatePrimaryState();
  const vendor = selectedAssistantVendor();

  try {
    const analysis = selectedFiles.length
      ? await analyzeSelectedFiles(vendor)
      : createDraftAnalysis(vendor, requestText);
    setMessage(selectedFiles.length ? '2/2 · 수정 후보와 안전 확인표를 만들고 있습니다.' : '회로 초안과 안전 확인표를 만들고 있습니다.');

    const payload = {
      vendor,
      requestText
    };
    if (selectedFiles.length) {
      payload.analysis = analysis;
      payload.sourceContent = currentSourceContent;
      payload.sourceFilename = primaryFile(selectedFiles).name;
    }

    const response = await requestJson('/api/v1/change-plans', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    currentChangePlan = response.data;
    renderAnalysis(analysis, currentChangePlan);
    activateTab('change');

    if (currentChangePlan.executionScope === 'blocked') {
      setMessage('안전 조건 때문에 자동 생성을 중단했습니다. 결과의 이유를 확인해 주세요.', 'error');
    } else if (currentChangePlan.executionScope === 'simulation-only') {
      setMessage('시뮬레이션 전용 초안을 만들었습니다. 실제 설비에는 반영할 수 없습니다.', 'warning');
    } else if (currentChangePlan.executionScope === 'review-only') {
      setMessage('CPU·타이머 기준 확인 전에는 시간값이 있는 회로 후보를 만들지 않습니다.', 'warning');
    } else if (selectedFiles.length) {
      setMessage('기존 파일을 참고한 수정 후보를 만들었습니다. 원본 파일은 바뀌지 않았습니다.', 'success');
    } else {
      setMessage('새 회로 초안을 만들었습니다. 실제 주소와 태그는 PLC 담당자가 확인해야 합니다.', 'success');
    }
  } catch (error) {
    setMessage(error instanceof Error ? error.message : '회로 초안 생성에 실패했습니다.', 'error');
  } finally {
    busy = false;
    updatePrimaryState();
  }
}

async function downloadReport(format) {
  if (!currentAnalysis) {
    return;
  }

  try {
    const response = await fetch('/api/v1/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ format, analysis: currentAnalysis, changePlan: currentChangePlan })
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data?.error?.message || '보고서 생성에 실패했습니다.');
    }

    const blob = await response.blob();
    const disposition = response.headers.get('Content-Disposition') || '';
    const filenameMatch = disposition.match(/filename="([^"]+)"/);
    const extension = format === 'markdown' ? 'md' : format === 'excel' ? 'xls' : 'pdf';
    const filename = filenameMatch?.[1] || `plc-review.${extension}`;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    setMessage(`${filename} 다운로드를 시작했습니다.`, 'success');
  } catch (error) {
    setMessage(error instanceof Error ? error.message : '보고서 다운로드에 실패했습니다.', 'error');
  }
}

function activateTab(tabName) {
  elements.tabs.forEach((tab) => {
    const active = tab.dataset.tab === tabName;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  });

  Object.entries(elements.panels).forEach(([name, panel]) => {
    panel.classList.toggle('hidden', name !== tabName);
  });
}

async function checkHealth() {
  try {
    const response = await requestJson('/api/health');
    elements.serverStatus.textContent = response.data.status === 'ok' ? '준비됨' : '확인 필요';
    elements.serverStatus.dataset.tone = response.data.status === 'ok' ? 'success' : 'warning';
  } catch {
    elements.serverStatus.textContent = '서버 연결 안 됨';
    elements.serverStatus.dataset.tone = 'error';
  }
}

function handleFileSelection() {
  selectedFiles = [...(elements.fileInput.files || [])];
  resetResults();

  if (!selectedFiles.length) {
    elements.fileName.textContent = 'PLC export 파일 선택';
    elements.fileMeta.textContent = 'GX Works2는 CSV/TXT/LST/ASC 여러 개, Siemens는 XML 1개';
    elements.fileList.replaceChildren();
    elements.fileList.classList.add('hidden');
    elements.clearFile.classList.add('hidden');
    updateModeHint();
    updatePrimaryState();
    return;
  }

  elements.fileName.textContent =
    selectedFiles.length === 1 ? selectedFiles[0].name : `${selectedFiles.length}개 파일 선택됨`;
  elements.fileMeta.textContent = `${formatBytes(
    selectedFiles.reduce((total, file) => total + file.size, 0)
  )} · 원본은 수정하지 않습니다`;
  elements.fileList.replaceChildren(
    ...selectedFiles.map((file) =>
      createElement('li', '', `${file.name} · ${formatBytes(file.size)}`)
    )
  );
  elements.fileList.classList.remove('hidden');
  elements.clearFile.classList.remove('hidden');
  updateModeHint();
  updatePrimaryState();
  setMessage('파일을 추가했습니다. 위 요청과 함께 한 번에 분석합니다.');
}

elements.form.addEventListener('submit', createChangePlan);
elements.questionForm.addEventListener('submit', askGroundedQuestion);
elements.knowledgeForm.addEventListener('submit', importKnowledgeDocument);
elements.fileInput.addEventListener('change', handleFileSelection);
elements.clearFile.addEventListener('click', () => {
  elements.fileInput.value = '';
  handleFileSelection();
  setMessage('파일을 뺐습니다. 신규 회로 초안 모드로 바뀌었습니다.');
});
elements.changeRequest.addEventListener('input', updatePrimaryState);
elements.questionInput.addEventListener('input', updateQuestionAvailability);
elements.safetyAck.addEventListener('change', updatePrimaryState);
elements.cpuProfile.addEventListener('change', () => {
  resetResults();
  setMessage('CPU 계열을 바꿨습니다. 다시 분석하면 새 기준이 적용됩니다.');
});
elements.fileEncoding.addEventListener('change', () => {
  resetResults();
  setMessage('파일 문자 인코딩을 바꿨습니다. 다시 분석해 주세요.');
});
elements.exampleButtons.forEach((button) => {
  button.addEventListener('click', () => {
    elements.changeRequest.value = button.dataset.example || '';
    elements.changeRequest.focus();
    updatePrimaryState();
    setMessage('예시 문장을 넣었습니다. 주소와 조건을 원하는 값으로 바꿔도 됩니다.');
  });
});
elements.questionExampleButtons.forEach((button) => {
  button.addEventListener('click', () => {
    elements.questionInput.value = button.dataset.questionExample || '';
    elements.questionInput.focus();
    updateQuestionAvailability();
    setMessage('추천 질문을 넣었습니다. 주소를 현재 프로젝트 값으로 바꿔도 됩니다.');
  });
});
elements.sourcePreviewClose.addEventListener('click', () => {
  elements.sourcePreview.classList.add('hidden');
});
document.querySelectorAll('input[name="assistant-version"]').forEach((input) => {
  input.addEventListener('change', () => {
    resetResults();
    elements.mitsubishiImportOptions.classList.toggle('hidden', input.value !== 'mitsubishi');
    updateModeHint();
    setMessage(`${input.value === 'siemens' ? 'Siemens PLC' : 'Mitsubishi GX Works2'}를 선택했습니다.`);
  });
});
elements.tabs.forEach((tab) => tab.addEventListener('click', () => activateTab(tab.dataset.tab)));
elements.reportButtons.forEach((button) => {
  button.addEventListener('click', () => downloadReport(button.dataset.report));
});

updateModeHint();
updatePrimaryState();
updateQuestionAvailability();
activateTab('change');
checkHealth();
