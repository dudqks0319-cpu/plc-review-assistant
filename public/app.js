const elements = {
  form: document.getElementById('analysis-form'),
  fileInput: document.getElementById('project-file'),
  fileName: document.getElementById('file-name'),
  fileMeta: document.getElementById('file-meta'),
  analyzeButton: document.getElementById('analyze-button'),
  changeButton: document.getElementById('change-button'),
  changeRequest: document.getElementById('change-request'),
  message: document.getElementById('message'),
  serverStatus: document.getElementById('server-status'),
  emptyState: document.getElementById('empty-state'),
  analysisView: document.getElementById('analysis-view'),
  assistantSummary: document.getElementById('assistant-summary'),
  metrics: {
    blocks: document.getElementById('metric-blocks'),
    variables: document.getElementById('metric-variables'),
    io: document.getElementById('metric-io'),
    findings: document.getElementById('metric-findings')
  },
  tabs: [...document.querySelectorAll('.tab')],
  panels: {
    findings: document.getElementById('tab-findings'),
    change: document.getElementById('tab-change'),
    blocks: document.getElementById('tab-blocks'),
    variables: document.getElementById('tab-variables'),
    limits: document.getElementById('tab-limits')
  },
  reportButtons: [...document.querySelectorAll('[data-report]')]
};

let selectedFile = null;
let currentAnalysis = null;
let currentChangePlan = null;
let currentSourceContent = '';

function setMessage(text, tone = 'neutral') {
  elements.message.textContent = text;
  elements.message.dataset.tone = tone;
}

function setBusy(isBusy) {
  elements.analyzeButton.disabled = isBusy || !selectedFile;
  elements.analyzeButton.textContent = isBusy ? '분석 중' : '분석 시작';
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
    const message = data?.error?.message || `요청 실패: ${response.status}`;
    throw new Error(message);
  }

  return data;
}

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

function renderFindings(findings) {
  const panel = elements.panels.findings;
  panel.replaceChildren();

  if (findings.length === 0) {
    panel.append(createElement('p', 'muted-line', '발견된 후보 이슈가 없습니다.'));
    return;
  }

  const list = createElement('div', 'finding-list');
  findings.forEach((finding) => {
    const item = createElement('article', `finding finding-${finding.severity}`);
    const header = createElement('header');
    header.append(createElement('span', 'severity', finding.severity.toUpperCase()));
    header.append(createElement('strong', '', finding.title));
    item.append(header);
    item.append(createElement('p', '', finding.description));
    item.append(createElement('small', '', finding.recommendation));

    if (finding.evidence?.length) {
      const evidence = createElement('ul', 'evidence-list');
      finding.evidence.forEach((entry) => evidence.append(createElement('li', '', entry)));
      item.append(evidence);
    }

    list.append(item);
  });

  panel.append(list);
}

function renderTable(panel, headers, rows, emptyText) {
  panel.replaceChildren();

  if (rows.length === 0) {
    panel.append(createElement('p', 'muted-line', emptyText));
    return;
  }

  const tableWrap = createElement('div', 'table-wrap');
  const table = createElement('table');
  const thead = createElement('thead');
  const headRow = createElement('tr');
  headers.forEach((header) => headRow.append(createElement('th', '', header)));
  thead.append(headRow);
  table.append(thead);

  const tbody = createElement('tbody');
  rows.forEach((row) => {
    const tr = createElement('tr');
    row.forEach((cell) => tr.append(createElement('td', '', cell || '-')));
    tbody.append(tr);
  });
  table.append(tbody);
  tableWrap.append(table);
  panel.append(tableWrap);
}

function renderBlocks(blocks) {
  renderTable(
    elements.panels.blocks,
    ['타입', '이름', '언어', '상태'],
    blocks.map((block) => [block.type, block.name, block.language, block.protected ? '보호됨' : '분석됨']),
    '추출된 블록이 없습니다.'
  );
}

function renderVariables(project) {
  const rows = project.variables.slice(0, 120).map((variable) => [
    variable.name,
    variable.address,
    variable.dataType || variable.kind,
    variable.comment,
    String(variable.usageCount)
  ]);

  renderTable(elements.panels.variables, ['이름', '주소', '타입', '코멘트', '사용'], rows, '추출된 태그/I/O가 없습니다.');
}

function renderLimits(limitations) {
  const panel = elements.panels.limits;
  panel.replaceChildren();
  const list = createElement('ul', 'limit-list');
  limitations.forEach((item) => list.append(createElement('li', '', item)));
  panel.append(list);
}

function renderChangePlan(changePlan) {
  const panel = elements.panels.change;
  panel.replaceChildren();

  if (!changePlan) {
    panel.append(createElement('p', 'muted-line', '분석 후 회로수정 요청을 입력하면 수정 후보가 표시됩니다.'));
    return;
  }

  const grid = createElement('div', 'change-grid');
  const summary = createElement('article', 'change-card');
  const meta = createElement('div', 'change-meta');
  meta.append(createElement('span', '', changePlan.title));
  meta.append(createElement('span', `risk-${changePlan.riskLevel}`, `위험도 ${changePlan.riskLevel}`));
  meta.append(createElement('span', '', `하네스 ${changePlan.simulation.result}`));
  summary.append(meta);
  summary.append(createElement('h4', '', '수정 전/후'));
  const diffList = createElement('ul', 'limit-list');
  changePlan.beforeAfterDiff.forEach((item) => {
    diffList.append(createElement('li', '', `${item.area}: ${item.before} → ${item.after}`));
  });
  summary.append(diffList);
  summary.append(createElement('h4', '', '예상 동작'));
  const behaviorList = createElement('ul', 'limit-list');
  changePlan.expectedBehavior.forEach((item) => behaviorList.append(createElement('li', '', item)));
  summary.append(behaviorList);
  grid.append(summary);

  const harness = createElement('article', 'change-card');
  harness.append(createElement('h4', '', '간이 시뮬레이션 하네스'));
  const timeline = createElement('ul', 'timeline-list');
  changePlan.simulation.timeline.forEach((item) => {
    const row = createElement('li');
    row.append(createElement('span', '', item.name));
    row.append(createElement('strong', '', item.output ? 'ON' : 'OFF'));
    timeline.append(row);
  });
  if (changePlan.simulation.timeline.length === 0) {
    timeline.append(createElement('li', '', changePlan.simulation.blockedReason || '하네스 결과가 없습니다.'));
  }
  harness.append(timeline);
  grid.append(harness);

  const patch = createElement('article', 'change-card');
  patch.append(createElement('h4', '', '벤더별 패치 후보'));
  if (changePlan.recommendedPatch.patchArtifacts.length === 0) {
    patch.append(createElement('p', 'muted-line', changePlan.recommendedPatch.summary));
  } else {
    changePlan.recommendedPatch.patchArtifacts.forEach((artifact) => {
      patch.append(createElement('strong', '', artifact.name));
      patch.append(createElement('pre', '', artifact.content));
    });
  }
  grid.append(patch);

  const files = createElement('article', 'change-card');
  files.append(createElement('h4', '', '수정 후보 파일 다운로드'));
  if (!changePlan.candidateFiles || changePlan.candidateFiles.length === 0) {
    files.append(createElement('p', 'muted-line', '안전 차단 또는 원문 부족으로 생성된 후보 파일이 없습니다.'));
  } else {
    const fileList = createElement('div', 'file-download-list');
    changePlan.candidateFiles.forEach((file) => {
      const button = createElement('button', 'download-file-button', file.label);
      button.type = 'button';
      button.title = file.filename;
      button.addEventListener('click', () => downloadGeneratedFile(file));
      fileList.append(button);
    });
    files.append(fileList);
  }
  grid.append(files);

  const approval = createElement('article', 'change-card');
  approval.append(createElement('h4', '', '승인 및 반영 절차'));
  const steps = createElement('ol', 'limit-list');
  changePlan.recommendedPatch.manualSteps.forEach((step) => steps.append(createElement('li', '', step)));
  approval.append(steps);
  grid.append(approval);

  panel.append(grid);
}

function downloadGeneratedFile(file) {
  const blob = new Blob([file.content], { type: file.mimeType || 'text/plain; charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.filename || 'plc-change-candidate.txt';
  link.click();
  URL.revokeObjectURL(url);
  setMessage(`${link.download} 다운로드를 시작했습니다.`, 'success');
}

function renderAnalysis(analysis) {
  currentAnalysis = analysis;
  elements.emptyState.classList.add('hidden');
  elements.analysisView.classList.remove('hidden');

  elements.metrics.blocks.textContent = analysis.summary.blockCount;
  elements.metrics.variables.textContent = analysis.summary.variableCount;
  elements.metrics.io.textContent = analysis.summary.ioAddressCount;
  elements.metrics.findings.textContent = analysis.findings.length;
  elements.assistantSummary.textContent = analysis.assistantSummary;

  renderFindings(analysis.findings);
  renderChangePlan(null);
  renderBlocks(analysis.project.blocks);
  renderVariables(analysis.project);
  renderLimits(analysis.limitations);

  elements.reportButtons.forEach((button) => {
    button.disabled = false;
  });
  elements.changeButton.disabled = false;
}

async function analyzeSelectedFile(event) {
  event.preventDefault();
  if (!selectedFile) {
    return;
  }

  setBusy(true);
  setMessage('파일을 읽고 있습니다.');

  try {
    const content = await selectedFile.text();
    currentSourceContent = content;
    const vendor = new FormData(elements.form).get('vendor') || 'auto';
    setMessage('정적 분석을 실행하고 있습니다.');
    const response = await requestJson('/api/v1/analyses', {
      method: 'POST',
      body: JSON.stringify({
        filename: selectedFile.name,
        vendor,
        content
      })
    });

    currentChangePlan = null;
    renderAnalysis(response.data);
    setMessage('분석이 완료되었습니다.', 'success');
  } catch (error) {
    setMessage(error.message, 'error');
  } finally {
    setBusy(false);
  }
}

async function createChangePlan() {
  if (!currentAnalysis) {
    return;
  }

  const requestText = elements.changeRequest.value.trim();
  if (!requestText) {
    setMessage('회로수정 요청을 입력해 주세요.', 'error');
    return;
  }

  elements.changeButton.disabled = true;
  elements.changeButton.textContent = '생성 중';
  setMessage('수정 후보와 하네스 결과를 생성하고 있습니다.');

  try {
    const vendor = new FormData(elements.form).get('assistant-version') || 'mitsubishi';
    const response = await requestJson('/api/v1/change-plans', {
      method: 'POST',
      body: JSON.stringify({
        analysis: currentAnalysis,
        vendor,
        requestText,
        sourceContent: currentSourceContent,
        sourceFilename: selectedFile?.name || currentAnalysis.project.source.filename
      })
    });
    currentChangePlan = response.data;
    renderChangePlan(currentChangePlan);
    activateTab('change');
    setMessage('회로수정 후보가 생성되었습니다. 실제 반영 전 엔지니어 검토가 필요합니다.', 'success');
  } catch (error) {
    setMessage(error.message, 'error');
  } finally {
    elements.changeButton.disabled = false;
    elements.changeButton.textContent = '수정 후보 생성';
  }
}

async function downloadReport(format) {
  if (!currentAnalysis) {
    return;
  }

  try {
    const response = await fetch('/api/v1/reports', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8'
      },
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
    URL.revokeObjectURL(url);
    setMessage(`${filename} 다운로드를 시작했습니다.`, 'success');
  } catch (error) {
    setMessage(error.message, 'error');
  }
}

function activateTab(tabName) {
  elements.tabs.forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.tab === tabName);
  });

  for (const [name, panel] of Object.entries(elements.panels)) {
    panel.classList.toggle('hidden', name !== tabName);
  }
}

async function checkHealth() {
  try {
    const response = await requestJson('/api/health');
    elements.serverStatus.textContent = response.data.status === 'ok' ? '준비됨' : '확인 필요';
    elements.serverStatus.dataset.tone = 'success';
  } catch {
    elements.serverStatus.textContent = '오프라인';
    elements.serverStatus.dataset.tone = 'error';
  }
}

elements.fileInput.addEventListener('change', () => {
  selectedFile = elements.fileInput.files?.[0] || null;

  if (!selectedFile) {
    elements.fileName.textContent = 'XML, CSV, TXT export 파일';
    elements.fileMeta.textContent = 'Siemens TIA XML 또는 Mitsubishi CSV/TXT';
    elements.analyzeButton.disabled = true;
    return;
  }

  elements.fileName.textContent = selectedFile.name;
  elements.fileMeta.textContent = `${formatBytes(selectedFile.size)} · ${selectedFile.type || 'export file'}`;
  elements.analyzeButton.disabled = false;
  setMessage('');
});

document.querySelectorAll('input[name="assistant-version"]').forEach((input) => {
  input.addEventListener('change', () => {
    const vendor = input.value;
    const vendorInput = document.querySelector(`input[name="vendor"][value="${vendor}"]`);
    if (vendorInput) {
      vendorInput.checked = true;
    }
  });
});

elements.form.addEventListener('submit', analyzeSelectedFile);
elements.changeButton.addEventListener('click', createChangePlan);
elements.tabs.forEach((tab) => tab.addEventListener('click', () => activateTab(tab.dataset.tab)));
elements.reportButtons.forEach((button) => {
  button.addEventListener('click', () => downloadReport(button.dataset.report));
});

checkHealth();
