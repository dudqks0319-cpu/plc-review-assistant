const elements = {
  form: document.getElementById('analysis-form'),
  fileInput: document.getElementById('project-file'),
  fileName: document.getElementById('file-name'),
  fileMeta: document.getElementById('file-meta'),
  clearFile: document.getElementById('clear-file'),
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
  metrics: {
    blocks: document.getElementById('metric-blocks'),
    variables: document.getElementById('metric-variables'),
    io: document.getElementById('metric-io'),
    findings: document.getElementById('metric-findings')
  },
  tabs: [...document.querySelectorAll('.tab')],
  panels: {
    change: document.getElementById('tab-change'),
    findings: document.getElementById('tab-findings'),
    blocks: document.getElementById('tab-blocks'),
    variables: document.getElementById('tab-variables'),
    limits: document.getElementById('tab-limits')
  },
  reportButtons: [...document.querySelectorAll('[data-report]')],
  exampleButtons: [...document.querySelectorAll('[data-example]')]
};

let selectedFile = null;
let currentAnalysis = null;
let currentChangePlan = null;
let currentSourceContent = '';
let busy = false;

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
  if (selectedFile) {
    elements.modeHint.dataset.mode = 'file';
    elements.modeHint.textContent =
      '기존 파일 검토 모드 · 파일을 먼저 분석하고 주소·태그·블록을 참고해 수정 후보를 만듭니다.';
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
    ? selectedFile
      ? '파일 분석하고 회로 만드는 중…'
      : '회로 초안 만드는 중…'
    : '안전한 회로 초안 만들기';
}

function resetResults() {
  currentAnalysis = null;
  currentChangePlan = null;
  currentSourceContent = '';
  elements.analysisView.classList.add('hidden');
  elements.emptyState.classList.remove('hidden');
  elements.reportButtons.forEach((button) => {
    button.disabled = true;
  });
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
    fail: '실패'
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
        selectedFile ? '업로드한 export 범위에서 표시할 문제 후보가 없습니다.' : '기존 파일을 넣으면 주소 중복과 주석 누락 등을 확인합니다.'
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
  meta.append(createElement('span', `risk-chip risk-${changePlan.riskLevel}`, `위험도 ${changePlan.riskLevel}`));
  meta.append(createElement('span', '', changePlan.vendor === 'mitsubishi' ? 'GX Works2' : 'Siemens'));
  meta.append(
    createElement(
      'span',
      '',
      changePlan.executionScope === 'simulation-only'
        ? '시뮬레이션 전용'
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
  renderFindings(analysis.findings || []);
  renderBlocks(analysis.project?.blocks || []);
  renderVariables(analysis.project || {});
  renderLimits(analysis.limitations || [], changePlan?.warnings || []);
  renderChangePlan(changePlan);
  elements.reportButtons.forEach((button) => {
    button.disabled = false;
  });
}

async function analyzeSelectedFile(vendor) {
  if (!selectedFile) {
    return null;
  }

  setMessage('1/2 · 기존 PLC 파일을 읽고 있습니다.');
  const content = await selectedFile.text();
  currentSourceContent = content;
  const response = await requestJson('/api/v1/analyses', {
    method: 'POST',
    body: JSON.stringify({
      filename: selectedFile.name,
      vendor,
      content
    })
  });
  currentAnalysis = response.data;
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
    const analysis = selectedFile
      ? await analyzeSelectedFile(vendor)
      : createDraftAnalysis(vendor, requestText);
    setMessage(selectedFile ? '2/2 · 수정 후보와 안전 확인표를 만들고 있습니다.' : '회로 초안과 안전 확인표를 만들고 있습니다.');

    const payload = {
      vendor,
      requestText
    };
    if (selectedFile) {
      payload.analysis = analysis;
      payload.sourceContent = currentSourceContent;
      payload.sourceFilename = selectedFile.name;
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
    } else if (selectedFile) {
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
  selectedFile = elements.fileInput.files?.[0] || null;
  resetResults();

  if (!selectedFile) {
    elements.fileName.textContent = 'PLC export 파일 선택';
    elements.fileMeta.textContent = 'GX Works2 CSV/TXT/LST 또는 TIA Portal XML';
    elements.clearFile.classList.add('hidden');
    updateModeHint();
    updatePrimaryState();
    return;
  }

  elements.fileName.textContent = selectedFile.name;
  elements.fileMeta.textContent = `${formatBytes(selectedFile.size)} · 원본은 수정하지 않습니다`;
  elements.clearFile.classList.remove('hidden');
  updateModeHint();
  updatePrimaryState();
  setMessage('파일을 추가했습니다. 위 요청과 함께 한 번에 분석합니다.');
}

elements.form.addEventListener('submit', createChangePlan);
elements.fileInput.addEventListener('change', handleFileSelection);
elements.clearFile.addEventListener('click', () => {
  elements.fileInput.value = '';
  handleFileSelection();
  setMessage('파일을 뺐습니다. 신규 회로 초안 모드로 바뀌었습니다.');
});
elements.changeRequest.addEventListener('input', updatePrimaryState);
elements.safetyAck.addEventListener('change', updatePrimaryState);
elements.exampleButtons.forEach((button) => {
  button.addEventListener('click', () => {
    elements.changeRequest.value = button.dataset.example || '';
    elements.changeRequest.focus();
    updatePrimaryState();
    setMessage('예시 문장을 넣었습니다. 주소와 조건을 원하는 값으로 바꿔도 됩니다.');
  });
});
document.querySelectorAll('input[name="assistant-version"]').forEach((input) => {
  input.addEventListener('change', () => {
    resetResults();
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
activateTab('change');
checkHealth();
