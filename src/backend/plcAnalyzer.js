import { createHash } from 'node:crypto';

const SUPPORTED_XML_BLOCK_TYPES = new Set(['FB', 'FC', 'OB', 'DB', 'UDT']);
const SIEMENS_IO_PATTERN = /%?\b(?:I|Q|M)(?:B|W|D)?\d+(?:\.\d+)?\b|%?\bDB\d+\.DB(?:X|B|W|D)\d+(?:\.\d+)?\b/gi;
const MITSUBISHI_DEVICE_PATTERN = /\b(?:X|Y|M|L|B|D|W|R|ZR|SD|SM)\d+[A-F0-9]*(?:\.\d+)?\b/gi;
const SET_RESET_PATTERN = /\b(?:SET|RST|S|R)\s+(%?(?:I|Q|M)(?:B|W|D)?\d+(?:\.\d+)?|(?:X|Y|M|L|B|D|W|R|ZR|SD|SM)\d+[A-F0-9]*(?:\.\d+)?)\b/gi;
const PROTECTED_PATTERN = /\b(?:know[-\s]?how\s+protected|password\s+protected|encrypted|protected\s+block|read\s+protected)\b/i;
const MAX_SAMPLE_ITEMS = 8;

function decodeXml(value = '') {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

function escapeXml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function safeString(value, fallback = '', maxLength = 160) {
  if (typeof value !== 'string') {
    return fallback;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }

  return trimmed.slice(0, maxLength);
}

function normalizeName(value) {
  return safeString(value, 'Unnamed', 120);
}

function sourceNameFromFilename(filename = '') {
  const withoutPath = filename.split(/[\\/]/).pop() || 'uploaded-project';
  return withoutPath.replace(/\.[^.]+$/, '') || 'uploaded-project';
}

function buildId(prefix, ...parts) {
  const hash = createHash('sha1').update(parts.filter(Boolean).join('|')).digest('hex').slice(0, 10);
  return `${prefix}-${hash}`;
}

function normalizeAddress(value = '') {
  return safeString(value, '', 80).toUpperCase().replace(/^%/, '');
}

function addressDirection(address = '') {
  const normalized = normalizeAddress(address);

  if (normalized.startsWith('I') || normalized.startsWith('X')) {
    return 'input';
  }

  if (normalized.startsWith('Q') || normalized.startsWith('Y')) {
    return 'output';
  }

  if (normalized.startsWith('M') || normalized.startsWith('L') || normalized.startsWith('B')) {
    return 'internal';
  }

  if (normalized.startsWith('SM') || normalized.startsWith('SD')) {
    return 'special';
  }

  return 'unknown';
}

function countLines(content) {
  if (!content) {
    return 0;
  }

  return content.split(/\r\n|\n|\r/).length;
}

function countNameUsage(content, name) {
  if (!name || name === 'Unnamed') {
    return 0;
  }

  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = content.match(new RegExp(`\\b${escaped}\\b`, 'gi'));
  return matches ? matches.length : 0;
}

function parseAttributes(rawAttributes = '') {
  const attributes = {};
  const pattern = /([A-Za-z_:\-.][\w:\-.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match = pattern.exec(rawAttributes);

  while (match) {
    const [, rawName, doubleValue, singleValue] = match;
    attributes[rawName] = decodeXml(doubleValue ?? singleValue ?? '');
    match = pattern.exec(rawAttributes);
  }

  return attributes;
}

function localTagName(tagName = '') {
  return tagName.split(':').pop()?.split('.').pop() || tagName;
}

function scanXmlTags(content) {
  const tags = [];
  const pattern = /<\s*([A-Za-z_][\w:\-.]*)([^<>]*?)(?:\/?)>/g;
  let match = pattern.exec(content);

  while (match) {
    const [raw, tagName, rawAttributes] = match;

    if (raw.startsWith('</') || raw.startsWith('<?') || raw.startsWith('<!--')) {
      match = pattern.exec(content);
      continue;
    }

    tags.push({
      raw,
      tagName,
      localName: localTagName(tagName),
      attributes: parseAttributes(rawAttributes),
      index: match.index
    });
    match = pattern.exec(content);
  }

  return tags;
}

function pickAttribute(attributes, names) {
  for (const name of names) {
    if (typeof attributes[name] === 'string' && attributes[name].trim()) {
      return attributes[name].trim();
    }
  }

  const lowerMap = new Map(Object.entries(attributes).map(([key, value]) => [key.toLowerCase(), value]));
  for (const name of names) {
    const value = lowerMap.get(name.toLowerCase());
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return '';
}

function inferSiemensBlockType(tagName, attributes) {
  const candidate = pickAttribute(attributes, ['Type', 'BlockType', 'type']);
  const upperCandidate = candidate.toUpperCase();

  if (SUPPORTED_XML_BLOCK_TYPES.has(upperCandidate)) {
    return upperCandidate;
  }

  const upperTag = tagName.toUpperCase();
  for (const type of SUPPORTED_XML_BLOCK_TYPES) {
    if (upperTag.endsWith(`.${type}`) || upperTag.includes(`BLOCKS.${type}`) || upperTag.includes(`${type}BLOCK`)) {
      return type;
    }
  }

  return upperTag.includes('BLOCK') ? 'BLOCK' : '';
}

function detectFileType(filename = '', content = '') {
  const suffix = filename.toLowerCase().split('.').pop() || '';
  const start = content.trimStart().slice(0, 300).toLowerCase();

  if (suffix === 'xml' || start.startsWith('<?xml') || start.startsWith('<')) {
    return start.includes('plcopen') ? 'plcopen-xml' : 'siemens-tia-xml';
  }

  if (suffix === 'csv') {
    return 'mitsubishi-csv';
  }

  if (['txt', 'lst', 'asc'].includes(suffix)) {
    return 'mitsubishi-text';
  }

  if (suffix === 'zip') {
    return 'export-zip';
  }

  if (content.includes(',') && content.split(/\r\n|\n|\r/)[0]?.includes(',')) {
    return 'mitsubishi-csv';
  }

  return 'unknown';
}

function normalizeVendor(inputVendor, fileType, content) {
  const requested = safeString(inputVendor, 'auto', 32).toLowerCase();

  if (requested === 'siemens' || requested === 'mitsubishi') {
    return requested;
  }

  if (fileType.includes('siemens') || /SW\.Blocks|TIA Portal|Siemens/i.test(content)) {
    return 'siemens';
  }

  if (fileType.includes('mitsubishi') || /\bGX\s*(Developer|Works)|MELSEC|Mitsubishi/i.test(content)) {
    return 'mitsubishi';
  }

  if (fileType === 'plcopen-xml') {
    return 'plcopen';
  }

  return 'unknown';
}

function makeProjectBase({ filename, vendor, fileType, content, parserWarnings = [] }) {
  const id = buildId('project', filename, content.slice(0, 4000));

  return {
    id,
    name: sourceNameFromFilename(filename),
    vendor,
    source: {
      filename: safeString(filename, 'uploaded-project', 240),
      fileType,
      sizeBytes: Buffer.byteLength(content, 'utf8'),
      lineCount: countLines(content),
      parserWarnings
    },
    blocks: [],
    variables: [],
    ioAddresses: [],
    networks: [],
    instructions: [],
    callGraph: [],
    protectedItems: []
  };
}

function addIoAddress(project, address, owner = 'raw-scan', source = 'content') {
  const normalized = normalizeAddress(address);
  if (!normalized) {
    return;
  }

  const id = buildId('io', normalized, owner, source);
  if (project.ioAddresses.some((item) => item.id === id)) {
    return;
  }

  project.ioAddresses.push({
    id,
    address: normalized,
    direction: addressDirection(normalized),
    owner: safeString(owner, 'raw-scan', 160),
    source
  });
}

function addVariable(project, variable, content) {
  const name = normalizeName(variable.name);
  const address = normalizeAddress(variable.address);
  const id = buildId('var', name, address, variable.scope || '', variable.sourceLine || '');
  const normalized = {
    id,
    name,
    kind: safeString(variable.kind, 'variable', 40),
    dataType: safeString(variable.dataType, '', 80),
    address,
    comment: safeString(variable.comment, '', 500),
    scope: safeString(variable.scope, 'global', 80),
    blockName: safeString(variable.blockName, '', 120),
    sourceLine: Number.isInteger(variable.sourceLine) ? variable.sourceLine : null,
    usageCount: countNameUsage(content, name)
  };

  if (!project.variables.some((item) => item.id === normalized.id)) {
    project.variables.push(normalized);
  }

  if (address) {
    addIoAddress(project, address, name, 'variable');
  }
}

function addBlock(project, block) {
  const name = normalizeName(block.name);
  const type = safeString(block.type, 'BLOCK', 32).toUpperCase();
  const id = buildId('block', name, type, block.sourceIndex || '');

  if (project.blocks.some((item) => item.id === id)) {
    return;
  }

  project.blocks.push({
    id,
    name,
    type,
    language: safeString(block.language, '', 32).toUpperCase(),
    comment: safeString(block.comment, '', 500),
    protected: Boolean(block.protected),
    source: safeString(block.source, 'export', 80),
    callTargets: Array.isArray(block.callTargets) ? block.callTargets : []
  });
}

function parseSiemensXml({ filename, vendor, fileType, content }) {
  const project = makeProjectBase({ filename, vendor, fileType, content });
  const tags = scanXmlTags(content);

  for (const tag of tags) {
    const name = pickAttribute(tag.attributes, ['Name', 'name']);
    const blockType = inferSiemensBlockType(tag.tagName, tag.attributes);

    if (name && blockType) {
      addBlock(project, {
        name,
        type: blockType,
        language: pickAttribute(tag.attributes, ['ProgrammingLanguage', 'Language', 'language']),
        comment: pickAttribute(tag.attributes, ['Comment', 'Description', 'comment']),
        protected: PROTECTED_PATTERN.test(tag.raw),
        source: 'siemens-xml',
        sourceIndex: tag.index
      });
      continue;
    }

    const localName = tag.localName.toLowerCase();
    const isVariableLike = ['member', 'variable', 'tag', 'parameter', 'constant'].some((token) => localName.includes(token));
    if (!name || !isVariableLike) {
      continue;
    }

    addVariable(
      project,
      {
        name,
        kind: tag.localName,
        dataType: pickAttribute(tag.attributes, ['Datatype', 'DataType', 'Type', 'TypeName']),
        address: pickAttribute(tag.attributes, ['Address', 'LogicalAddress', 'Operand', 'AbsoluteAddress']),
        comment: pickAttribute(tag.attributes, ['Comment', 'Description', 'comment']),
        scope: pickAttribute(tag.attributes, ['Scope', 'Section']) || 'global'
      },
      content
    );
  }

  const protectedMatches = content.match(PROTECTED_PATTERN);
  if (protectedMatches) {
    project.protectedItems.push({
      id: buildId('protected', filename, protectedMatches[0]),
      name: protectedMatches[0],
      reason: 'Protected or encrypted PLC item was detected and excluded from interpretation.'
    });
  }

  const callTags = tags.filter((tag) => /call/i.test(tag.localName));
  for (const tag of callTags) {
    const target = pickAttribute(tag.attributes, ['Target', 'Block', 'Name', 'CalledBlock']);
    if (target) {
      project.callGraph.push({
        id: buildId('call', 'project', target, tag.index),
        from: 'project',
        to: normalizeName(target),
        source: 'xml-call'
      });
    }
  }

  for (const block of project.blocks) {
    const escaped = block.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`\\b${escaped}\\s*\\(`, 'g');
    if (pattern.test(content)) {
      project.callGraph.push({
        id: buildId('call', 'project', block.name, 'text'),
        from: 'project',
        to: block.name,
        source: 'text-scan'
      });
    }
  }

  for (const address of content.match(SIEMENS_IO_PATTERN) || []) {
    addIoAddress(project, address, 'raw-scan', 'content');
  }

  return project;
}

function parseDelimitedRows(content) {
  const firstLine = content.split(/\r\n|\n|\r/)[0] || '';
  const delimiters = [',', ';', '\t'];
  const delimiter = delimiters
    .map((candidate) => ({ candidate, count: firstLine.split(candidate).length }))
    .sort((a, b) => b.count - a.count)[0].candidate;

  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      field += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === delimiter && !inQuotes) {
      row.push(field);
      field = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') {
        index += 1;
      }
      row.push(field);
      if (row.some((value) => value.trim())) {
        rows.push(row.map((value) => value.trim()));
      }
      field = '';
      row = [];
      continue;
    }

    field += char;
  }

  row.push(field);
  if (row.some((value) => value.trim())) {
    rows.push(row.map((value) => value.trim()));
  }

  if (rows.length === 0) {
    return [];
  }

  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1).map((values, rowIndex) => {
    const record = { __line: rowIndex + 2 };
    headers.forEach((header, index) => {
      record[header || `Column ${index + 1}`] = values[index] || '';
    });
    return record;
  });
}

function pickColumn(row, candidates) {
  const entries = Object.entries(row);
  for (const candidate of candidates) {
    const normalizedCandidate = candidate.toLowerCase().replace(/[\s_-]/g, '');
    const match = entries.find(([key]) => key.toLowerCase().replace(/[\s_-]/g, '') === normalizedCandidate);
    if (match && safeString(match[1])) {
      return safeString(match[1], '', 500);
    }
  }

  return '';
}

function parseMitsubishiCsv({ filename, vendor, fileType, content }) {
  const project = makeProjectBase({ filename, vendor, fileType, content });
  const rows = parseDelimitedRows(content);
  const blockNames = new Set();

  for (const row of rows) {
    const name = pickColumn(row, ['Label Name', 'Label', 'Name', 'Device Name', 'Symbol']);
    const address = pickColumn(row, ['Device', 'Address', 'Device/Label', 'PLC Device']);
    const program = pickColumn(row, ['Program', 'POU', 'Block', 'Task']);

    if (program && !blockNames.has(program)) {
      blockNames.add(program);
      addBlock(project, {
        name: program,
        type: 'PROGRAM',
        language: 'LAD',
        source: 'mitsubishi-csv'
      });
    }

    if (!name && !address) {
      continue;
    }

    addVariable(
      project,
      {
        name: name || address,
        kind: 'label',
        dataType: pickColumn(row, ['Data Type', 'Datatype', 'Type']),
        address,
        comment: pickColumn(row, ['Comment', 'Description', 'Remark']),
        scope: program || 'global',
        sourceLine: row.__line
      },
      content
    );
  }

  for (const address of content.match(MITSUBISHI_DEVICE_PATTERN) || []) {
    addIoAddress(project, address, 'raw-scan', 'content');
  }

  return project;
}

function parseMitsubishiText({ filename, vendor, fileType, content }) {
  const project = makeProjectBase({ filename, vendor, fileType, content });
  const lines = content.split(/\r\n|\n|\r/);
  let activeBlock = '';

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    const blockMatch = trimmed.match(/\b(?:PROGRAM|POU|FUNCTION_BLOCK|FUNCTION|FB|FC)\s+([A-Za-z_][\w$]*)/i);
    if (blockMatch) {
      activeBlock = blockMatch[1];
      addBlock(project, {
        name: activeBlock,
        type: blockMatch[0].split(/\s+/)[0],
        language: /SCL|ST\b|STRUCTURED/i.test(trimmed) ? 'ST' : 'LAD',
        source: 'mitsubishi-text',
        sourceIndex: index
      });
    }

    const addressMatch = trimmed.match(MITSUBISHI_DEVICE_PATTERN);
    if (!addressMatch) {
      return;
    }

    const firstAddress = addressMatch[0];
    const nameMatch = trimmed.match(/^([A-Za-z_][\w$]*)\b/);
    const commentMatch = trimmed.match(/(?:\/\/|;|#)\s*(.+)$/);
    addVariable(
      project,
      {
        name: nameMatch ? nameMatch[1] : firstAddress,
        kind: 'text-label',
        address: firstAddress,
        comment: commentMatch ? commentMatch[1] : '',
        scope: activeBlock || 'global',
        sourceLine: index + 1
      },
      content
    );

    for (const address of addressMatch) {
      addIoAddress(project, address, nameMatch?.[1] || 'raw-scan', 'text-line');
    }
  });

  return project;
}

function parseUnsupported({ filename, vendor, fileType, content }) {
  const project = makeProjectBase({
    filename,
    vendor,
    fileType,
    content,
    parserWarnings: [
      fileType === 'export-zip'
        ? 'ZIP archive was detected. MVP expects XML/CSV/TXT export files inside the archive to be uploaded directly.'
        : 'Unsupported file type. MVP supports Siemens XML and Mitsubishi CSV/TXT exports.'
    ]
  });

  if (PROTECTED_PATTERN.test(content)) {
    project.protectedItems.push({
      id: buildId('protected', filename, 'unsupported'),
      name: 'Protected content marker',
      reason: 'Protected content was detected and excluded from interpretation.'
    });
  }

  return project;
}

function groupBy(items, getKey) {
  return items.reduce((groups, item) => {
    const key = getKey(item);
    if (!key) {
      return groups;
    }

    if (!groups.has(key)) {
      groups.set(key, []);
    }

    groups.get(key).push(item);
    return groups;
  }, new Map());
}

function createFinding({ severity, category, title, description, evidence = [], recommendation }) {
  return {
    id: buildId('finding', severity, category, title, evidence.join('|')),
    severity,
    category,
    title,
    description,
    evidence: evidence.slice(0, MAX_SAMPLE_ITEMS),
    recommendation
  };
}

function analyzeRules(project, content) {
  const findings = [];
  const duplicateAddressGroups = [...groupBy(project.variables.filter((item) => item.address), (item) => item.address).entries()]
    .filter(([, items]) => items.length > 1);

  for (const [address, variables] of duplicateAddressGroups) {
    findings.push(
      createFinding({
        severity: addressDirection(address) === 'output' ? 'high' : 'medium',
        category: 'duplicate-address',
        title: `중복 주소 후보: ${address}`,
        description: `${address} 주소가 ${variables.length}개 변수에 연결되어 있습니다.`,
        evidence: variables.map((item) => item.name),
        recommendation: '동일 디바이스/주소가 의도된 alias인지, 실수로 중복 선언된 것인지 PLC 엔지니어가 확인해야 합니다.'
      })
    );
  }

  const uncommentedBlocks = project.blocks.filter((block) => !block.comment && !block.protected);
  if (uncommentedBlocks.length > 0) {
    findings.push(
      createFinding({
        severity: 'low',
        category: 'missing-comments',
        title: `주석 없는 블록 후보 ${uncommentedBlocks.length}개`,
        description: '블록 설명이 비어 있어 인수인계와 변경 검토 비용이 커질 수 있습니다.',
        evidence: uncommentedBlocks.map((block) => `${block.type} ${block.name}`),
        recommendation: '핵심 OB/FB/FC부터 역할, 설비 범위, 주요 인터락을 주석으로 보강하세요.'
      })
    );
  }

  const uncommentedVariables = project.variables.filter((variable) => !variable.comment);
  if (uncommentedVariables.length > 0) {
    findings.push(
      createFinding({
        severity: 'low',
        category: 'missing-comments',
        title: `주석 없는 태그/변수 후보 ${uncommentedVariables.length}개`,
        description: '주소나 역할 설명이 없는 태그는 유지보수 중 오해를 만들 수 있습니다.',
        evidence: uncommentedVariables.map((variable) => variable.address ? `${variable.name} (${variable.address})` : variable.name),
        recommendation: 'I/O, 안전 인터락, 설비 동작 조건과 연결된 태그부터 코멘트를 채우세요.'
      })
    );
  }

  const unusedVariables = project.variables.filter((variable) => variable.usageCount <= 1 && variable.name.length > 2);
  if (unusedVariables.length > 0) {
    findings.push(
      createFinding({
        severity: 'medium',
        category: 'unused-tags',
        title: `미사용 태그 후보 ${unusedVariables.length}개`,
        description: '정적 텍스트 기준으로 선언 외 사용 흔적이 약한 태그입니다.',
        evidence: unusedVariables.map((variable) => variable.name),
        recommendation: 'HMI, 외부 참조, 간접 주소 사용 가능성을 확인한 뒤 정리 여부를 판단하세요.'
      })
    );
  }

  const namingViolations = project.variables
    .concat(project.blocks)
    .filter((item) => !/^[A-Za-z][A-Za-z0-9_]*$/.test(item.name));
  if (namingViolations.length > 0) {
    findings.push(
      createFinding({
        severity: 'low',
        category: 'naming',
        title: `네이밍 규칙 위반 후보 ${namingViolations.length}개`,
        description: '공백, 특수문자, 숫자 시작 이름은 자동 문서화와 검색 품질을 낮출 수 있습니다.',
        evidence: namingViolations.map((item) => item.name),
        recommendation: '팀 표준에 맞는 영문자 시작, 숫자/밑줄 조합의 안정적인 이름을 권장합니다.'
      })
    );
  }

  const setResetTargets = [...content.matchAll(SET_RESET_PATTERN)].map((match) => normalizeAddress(match[1]));
  const repeatedSetResetTargets = [...groupBy(setResetTargets, (target) => target).entries()].filter(([, targets]) => targets.length > 1);
  for (const [target, targets] of repeatedSetResetTargets) {
    findings.push(
      createFinding({
        severity: 'high',
        category: 'set-reset',
        title: `Set/Reset 다중 발생 후보: ${target}`,
        description: `${target} 대상 Set/Reset 명령이 ${targets.length}회 감지되었습니다.`,
        evidence: [target],
        recommendation: '스캔 사이클, 우선순위, 인터락 조건을 실제 설비 기준으로 검토하세요.'
      })
    );
  }

  if (project.protectedItems.length > 0) {
    findings.push(
      createFinding({
        severity: 'medium',
        category: 'protected-content',
        title: `보호/암호화 항목 ${project.protectedItems.length}개 제외`,
        description: '보호된 블록이나 암호화된 항목은 우회하지 않고 분석 범위에서 제외했습니다.',
        evidence: project.protectedItems.map((item) => item.name),
        recommendation: '벤더 툴과 정식 권한으로만 내용을 확인하고, 본 도구에서는 “보호됨” 상태로 관리하세요.'
      })
    );
  }

  return findings;
}

function severityCounts(findings) {
  return findings.reduce(
    (counts, finding) => ({
      ...counts,
      [finding.severity]: (counts[finding.severity] || 0) + 1
    }),
    { high: 0, medium: 0, low: 0 }
  );
}

function languageDistribution(blocks) {
  return blocks.reduce((distribution, block) => {
    const language = block.language || 'UNKNOWN';
    return {
      ...distribution,
      [language]: (distribution[language] || 0) + 1
    };
  }, {});
}

function generateAssistantSummary(project, findings) {
  const counts = severityCounts(findings);
  const vendorLabel = {
    siemens: 'Siemens TIA Portal XML export',
    mitsubishi: 'Mitsubishi GX Developer/GX Works export',
    plcopen: 'PLCopen XML export',
    unknown: 'unknown export'
  }[project.vendor] || project.vendor;

  const topFindings = findings.slice(0, 4).map((finding) => `- ${finding.title}`).join('\n');
  const findingText = topFindings || '- 즉시 표시할 정적 분석 이슈가 없습니다.';

  return [
    `이 프로젝트는 ${vendorLabel}로 보입니다.`,
    `총 ${project.blocks.length}개 블록, ${project.variables.length}개 태그/변수, ${project.ioAddresses.length}개 I/O 주소 후보가 발견되었습니다.`,
    `위험도 분포는 높음 ${counts.high}개, 중간 ${counts.medium}개, 낮음 ${counts.low}개입니다.`,
    '주요 발견:',
    findingText,
    '주의: 이 결과는 정적 분석 기반 후보이며 실제 설비 동작 검증, 시운전, 안전 인증을 대체하지 않습니다.'
  ].join('\n');
}

export function analyzePlcProject({ filename, vendor = 'auto', content }) {
  const safeContent = safeString(content, '', 5_000_000);
  if (!safeContent) {
    throw new Error('업로드 파일 내용이 비어 있습니다.');
  }

  const fileType = detectFileType(filename, safeContent);
  const normalizedVendor = normalizeVendor(vendor, fileType, safeContent);
  let project;

  if (fileType === 'siemens-tia-xml' || fileType === 'plcopen-xml') {
    project = parseSiemensXml({ filename, vendor: normalizedVendor, fileType, content: safeContent });
  } else if (fileType === 'mitsubishi-csv') {
    project = parseMitsubishiCsv({ filename, vendor: normalizedVendor, fileType, content: safeContent });
  } else if (fileType === 'mitsubishi-text') {
    project = parseMitsubishiText({ filename, vendor: normalizedVendor, fileType, content: safeContent });
  } else {
    project = parseUnsupported({ filename, vendor: normalizedVendor, fileType, content: safeContent });
  }

  const findings = analyzeRules(project, safeContent);
  const summary = {
    blockCount: project.blocks.length,
    variableCount: project.variables.length,
    ioAddressCount: project.ioAddresses.length,
    callEdgeCount: project.callGraph.length,
    protectedItemCount: project.protectedItems.length,
    severityCounts: severityCounts(findings),
    languageDistribution: languageDistribution(project.blocks)
  };

  return {
    id: buildId('analysis', project.id, String(summary.variableCount), String(findings.length)),
    project,
    summary,
    findings,
    assistantSummary: generateAssistantSummary(project, findings),
    limitations: [
      '정적 export 파일 기준 분석입니다.',
      'HMI, 드라이브 파라미터, 물리 배선, 실제 스캔 사이클은 별도 확인이 필요합니다.',
      '보호/암호화 블록은 우회하지 않고 분석에서 제외합니다.',
      '온라인 PLC 접속, PLC 쓰기, 자동 수정 기능은 제공하지 않습니다.'
    ]
  };
}

function createChangePlanMarkdown(changePlan) {
  if (!changePlan) {
    return '';
  }

  const artifacts = changePlan.recommendedPatch.patchArtifacts.length
    ? changePlan.recommendedPatch.patchArtifacts
        .map((artifact) => `### ${artifact.name}\n\n\`\`\`${artifact.language}\n${artifact.content}\n\`\`\``)
        .join('\n\n')
    : '- 안전 또는 보호 조건으로 인해 자동 패치 후보를 생성하지 않았습니다.';

  return [
    '## 회로수정 후보',
    '',
    `- 버전: ${changePlan.title}`,
    `- 위험도: ${changePlan.riskLevel}`,
    `- 상태: ${changePlan.recommendedPatch.status}`,
    `- 대상 출력: ${changePlan.normalizedRequirement.targetOutput.name || changePlan.normalizedRequirement.targetOutput.address || '확인 필요'}`,
    `- 지연 시간: ${changePlan.normalizedRequirement.delaySeconds || 0}초`,
    `- 엔지니어 승인 필요: ${changePlan.recommendedPatch.engineerReviewRequired ? '예' : '아니오'}`,
    '',
    '### 수정 전/후',
    '',
    changePlan.beforeAfterDiff.map((item) => `- ${item.area}: ${item.before} -> ${item.after}`).join('\n'),
    '',
    '### 예상 동작',
    '',
    changePlan.expectedBehavior.map((item) => `- ${item}`).join('\n'),
    '',
    '### 테스트 케이스',
    '',
    changePlan.testCases.map((item) => `- ${item.name}: 기대 출력 ${item.expectedOutput ? 'ON' : 'OFF'}`).join('\n'),
    '',
    '### 내장 하네스 결과',
    '',
    `- 하네스: ${changePlan.simulation.harness}`,
    `- 결과: ${changePlan.simulation.result}`,
    '',
    '### 패치 후보',
    '',
    artifacts,
    ''
  ].join('\n');
}

export function createMarkdownReport(analysis, changePlan = null) {
  const { project, summary, findings, assistantSummary, limitations } = analysis;
  const findingLines = findings.length
    ? findings
        .map(
          (finding) =>
            `- [${finding.severity.toUpperCase()}] ${finding.title}\n  - ${finding.description}\n  - 권장 조치: ${finding.recommendation}`
        )
        .join('\n')
    : '- 발견된 후보 이슈가 없습니다.';

  const blockLines = project.blocks.length
    ? project.blocks.map((block) => `- ${block.type} ${block.name}${block.language ? ` (${block.language})` : ''}`).join('\n')
    : '- 추출된 블록이 없습니다.';

  const variableLines = project.variables.slice(0, 50).length
    ? project.variables
        .slice(0, 50)
        .map((variable) => `- ${variable.name}${variable.address ? `: ${variable.address}` : ''}${variable.comment ? ` - ${variable.comment}` : ''}`)
        .join('\n')
    : '- 추출된 태그/변수가 없습니다.';

  return [
    `# PLC Review Assistant Report`,
    '',
    `## 프로젝트 요약`,
    '',
    `- 파일: ${project.source.filename}`,
    `- 벤더: ${project.vendor}`,
    `- 파일 타입: ${project.source.fileType}`,
    `- 블록: ${summary.blockCount}`,
    `- 태그/변수: ${summary.variableCount}`,
    `- I/O 주소 후보: ${summary.ioAddressCount}`,
    `- 보호/암호화 제외 항목: ${summary.protectedItemCount}`,
    '',
    `## AI 요약`,
    '',
    assistantSummary,
    '',
    `## 주요 발견`,
    '',
    findingLines,
    '',
    `## 블록 목록`,
    '',
    blockLines,
    '',
    `## 태그/변수 샘플`,
    '',
    variableLines,
    '',
    `## 분석 한계`,
    '',
    limitations.map((item) => `- ${item}`).join('\n'),
    '',
    createChangePlanMarkdown(changePlan),
    ''
  ].join('\n');
}

function worksheetRows(title, rows) {
  const rowXml = rows
    .map(
      (row) =>
        `<Row>${row.map((cell) => `<Cell><Data ss:Type="String">${escapeXml(cell)}</Data></Cell>`).join('')}</Row>`
    )
    .join('');

  return `<Worksheet ss:Name="${escapeXml(title)}"><Table>${rowXml}</Table></Worksheet>`;
}

export function createExcelReport(analysis, changePlan = null) {
  const { project, summary, findings } = analysis;
  const summaryRows = [
    ['Field', 'Value'],
    ['Filename', project.source.filename],
    ['Vendor', project.vendor],
    ['File type', project.source.fileType],
    ['Blocks', String(summary.blockCount)],
    ['Variables', String(summary.variableCount)],
    ['I/O candidates', String(summary.ioAddressCount)],
    ['High findings', String(summary.severityCounts.high)],
    ['Medium findings', String(summary.severityCounts.medium)],
    ['Low findings', String(summary.severityCounts.low)]
  ];
  const findingRows = [
    ['Severity', 'Category', 'Title', 'Description', 'Recommendation'],
    ...findings.map((finding) => [
      finding.severity,
      finding.category,
      finding.title,
      finding.description,
      finding.recommendation
    ])
  ];
  const blockRows = [
    ['Type', 'Name', 'Language', 'Comment', 'Protected'],
    ...project.blocks.map((block) => [block.type, block.name, block.language, block.comment, block.protected ? 'yes' : 'no'])
  ];
  const variableRows = [
    ['Name', 'Kind', 'Data type', 'Address', 'Comment', 'Scope', 'Usage count'],
    ...project.variables.map((variable) => [
      variable.name,
      variable.kind,
      variable.dataType,
      variable.address,
      variable.comment,
      variable.scope,
      String(variable.usageCount)
    ])
  ];
  const ioRows = [
    ['Address', 'Direction', 'Owner', 'Source'],
    ...project.ioAddresses.map((item) => [item.address, item.direction, item.owner, item.source])
  ];
  const changeRows = changePlan
    ? [
        ['Field', 'Value'],
        ['Version', changePlan.title],
        ['Vendor', changePlan.vendor],
        ['Risk level', changePlan.riskLevel],
        ['Patch status', changePlan.recommendedPatch.status],
        ['Target output', changePlan.normalizedRequirement.targetOutput.name || changePlan.normalizedRequirement.targetOutput.address || ''],
        ['Delay seconds', String(changePlan.normalizedRequirement.delaySeconds || 0)],
        ['Harness result', changePlan.simulation.result],
        ['Approvals', changePlan.approvalsRequired.join(', ')]
      ]
    : [['Field', 'Value'], ['Change plan', 'Not generated']];

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<?mso-application progid="Excel.Sheet"?>',
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">',
    worksheetRows('Summary', summaryRows),
    worksheetRows('Findings', findingRows),
    worksheetRows('Blocks', blockRows),
    worksheetRows('Variables', variableRows),
    worksheetRows('IO', ioRows),
    worksheetRows('ChangePlan', changeRows),
    '</Workbook>'
  ].join('');
}

function escapePdfString(value) {
  return String(value).replace(/[\\()]/g, '\\$&').replace(/[^\x20-\x7E]/g, '?');
}

function pdfLine(value) {
  return `(${escapePdfString(value)}) Tj\nT*\n`;
}

export function createPdfReport(analysis, changePlan = null) {
  const { project, summary, findings } = analysis;
  const lines = [
    'PLC Review Assistant Report',
    `Project: ${project.name}`,
    `Vendor: ${project.vendor}`,
    `File type: ${project.source.fileType}`,
    `Blocks: ${summary.blockCount}`,
    `Variables: ${summary.variableCount}`,
    `I/O candidates: ${summary.ioAddressCount}`,
    `Findings: high ${summary.severityCounts.high}, medium ${summary.severityCounts.medium}, low ${summary.severityCounts.low}`,
    'Top findings:',
    ...findings.slice(0, 12).map((finding) => `- [${finding.severity}] ${finding.title}`),
    ...(changePlan
      ? [
          'Change plan:',
          `- Version: ${changePlan.title}`,
          `- Risk: ${changePlan.riskLevel}`,
          `- Patch status: ${changePlan.recommendedPatch.status}`,
          `- Harness: ${changePlan.simulation.result}`
        ]
      : []),
    'Limit: static analysis only; field validation remains required.'
  ];
  const contentStream = `BT\n/F1 11 Tf\n72 760 Td\n14 TL\n${lines.map(pdfLine).join('')}ET`;
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    `5 0 obj\n<< /Length ${Buffer.byteLength(contentStream, 'utf8')} >>\nstream\n${contentStream}\nendstream\nendobj\n`
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];

  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += object;
  }

  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, 'utf8');
}
