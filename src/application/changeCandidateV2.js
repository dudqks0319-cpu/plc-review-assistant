import { createHash } from 'node:crypto';

const DEVICE_PATTERN = /\b(?:ZR|SD|SM|X|Y|M|L|B|D|W|R|T|C|Z)[0-9A-F]+\b/gi;
const WRITER_ACCESSES = new Set(['write', 'set', 'reset', 'indirect-write']);

export const LOW_RISK_TEMPLATE_LIBRARY = Object.freeze([
  {
    id: 'self-holding',
    label: '자기유지',
    match: /자기\s*(?:유지|보유)|seal[-_ ]?in|self[-_ ]?hold|holding/i,
    requiredFacts: ['start', 'stop', 'output'],
    renderer: 'gxworks2'
  },
  {
    id: 'start-stop',
    label: '시작/정지 회로',
    match: /(?:시작|기동|start).{0,40}(?:정지|stop)|(?:정지|stop).{0,40}(?:시작|기동|start)/i,
    requiredFacts: ['start', 'stop', 'output'],
    renderer: 'gxworks2'
  },
  {
    id: 'delay-on',
    label: '지연 ON',
    match: /지연\s*(?:on|온)|delay[-_ ]?on|(?:\d+(?:\.\d+)?\s*초).{0,30}(?:뒤|후).{0,20}(?:켜|on)/i,
    requiredFacts: ['start', 'stop', 'output', 'duration'],
    renderer: 'gxworks2'
  },
  {
    id: 'delay-off',
    label: '지연 OFF',
    match: /지연\s*(?:off|오프)|delay[-_ ]?off|(?:\d+(?:\.\d+)?\s*초).{0,30}(?:뒤|후).{0,20}(?:꺼|off)/i,
    requiredFacts: ['start', 'stop', 'output', 'duration'],
    renderer: 'logic-ir-only'
  },
  {
    id: 'edge-one-shot',
    label: 'Rising/Falling one-shot',
    match: /one[-_ ]?shot|원\s*샷|상승\s*(?:엣지|edge)|하강\s*(?:엣지|edge)|rising|falling/i,
    requiredFacts: ['trigger', 'output', 'edge'],
    renderer: 'logic-ir-only'
  },
  {
    id: 'alarm-latch-reset',
    label: 'Alarm Latch + Reset',
    match: /(?:alarm|알람|경보).{0,40}(?:latch|래치|유지|reset|리셋|복귀)/i,
    requiredFacts: ['alarm', 'reset', 'output'],
    renderer: 'logic-ir-only'
  },
  {
    id: 'mutual-interlock',
    label: '두 출력 상호 인터락',
    match: /상호\s*인터락|상호\s*연동|mutual\s*interlock|두\s*출력.{0,20}(?:동시|인터락)/i,
    requiredFacts: ['enable', 'two-outputs'],
    renderer: 'logic-ir-only'
  },
  {
    id: 'sensor-debounce',
    label: '센서 Debounce',
    match: /debounce|디바운스|채터링|센서.{0,30}(?:흔들|노이즈|안정)/i,
    requiredFacts: ['sensor', 'output', 'duration'],
    renderer: 'logic-ir-only'
  }
]);

function stableId(prefix, ...parts) {
  return `${prefix}-${createHash('sha256')
    .update(parts.map(String).join('|'))
    .digest('hex')
    .slice(0, 16)}`;
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function addresses(value) {
  return [...new Set((text(value).toUpperCase().match(DEVICE_PATTERN) || []).map(String))];
}

function hasExistingSource(analysis, sourceContent) {
  return (
    text(sourceContent).length > 0 &&
    analysis?.project?.source?.fileType !== 'natural-language-draft'
  );
}

function fallbackTemplate(circuitDraft) {
  const byCircuit = {
    'self-holding': 'self-holding',
    'output-control': 'start-stop',
    'delayed-output': 'delay-on'
  };
  return LOW_RISK_TEMPLATE_LIBRARY.find(
    (template) => template.id === byCircuit[circuitDraft?.circuitType]
  );
}

export function selectLowRiskTemplate(
  requestText,
  circuitDraft = null,
  { allowCircuitFallback = false } = {}
) {
  const request = text(requestText);
  const priority = [
    'self-holding',
    'delay-off',
    'delay-on',
    'edge-one-shot',
    'alarm-latch-reset',
    'mutual-interlock',
    'sensor-debounce',
    'start-stop'
  ];
  const matched = priority
    .map((id) => LOW_RISK_TEMPLATE_LIBRARY.find((template) => template.id === id))
    .find((template) => template?.match.test(request));
  return matched || (allowCircuitFallback ? fallbackTemplate(circuitDraft) : null) || null;
}

function signalRole(item) {
  const device = text(item?.device).toUpperCase();
  const role = `${item?.role || ''} ${item?.contact || ''}`.toLowerCase();
  if (/^Y/.test(device) || role.includes('출력') || role.includes('coil')) return 'output';
  if (/^T/.test(device) || role.includes('timer') || role.includes('타이머')) return 'timer';
  if (/^[ML]/.test(device) || role.includes('internal') || role.includes('내부')) return 'internal';
  return 'input';
}

function toSignal(item, index) {
  return {
    id: stableId('signal', item?.device || index, item?.role || ''),
    address: text(item?.device).toUpperCase() || null,
    name: text(item?.label) || `Signal_${index + 1}`,
    role: signalRole(item),
    evidence: 'candidate-assumption'
  };
}

function templateInvariants(templateId, facts) {
  const output = facts.outputs[0] || 'TARGET_OUTPUT';
  const stop = facts.stop[0] || 'STOP_CONDITION';
  const invariants = [
    {
      id: 'candidate-read-only',
      expression: 'candidate.writesToPlc == false',
      severity: 'must'
    }
  ];

  if (['self-holding', 'start-stop', 'delay-on', 'delay-off'].includes(templateId)) {
    invariants.push({
      id: 'stop-priority',
      expression: `${stop}=true => ${output}=false`,
      severity: 'must'
    });
  }
  if (templateId === 'mutual-interlock') {
    const secondOutput = facts.outputs[1] || 'SECOND_OUTPUT';
    invariants.push({
      id: 'mutual-exclusion',
      expression: `NOT (${output}=true AND ${secondOutput}=true)`,
      severity: 'must'
    });
  }
  if (templateId === 'alarm-latch-reset') {
    invariants.push({
      id: 'reset-priority',
      expression: `RESET=true => ${output}=false`,
      severity: 'must'
    });
  }
  return invariants;
}

function collectFacts(plan, circuitDraft) {
  const start = (plan?.normalizedRequirement?.startConditions || [])
    .map((item) => text(item?.address || item?.name))
    .filter(Boolean);
  const stop = (plan?.normalizedRequirement?.stopConditions || [])
    .map((item) => text(item?.address || item?.name))
    .filter(Boolean);
  const targetAddressText = text(plan?.normalizedRequirement?.targetOutput?.address);
  const targetAddresses = addresses(targetAddressText);
  const targetIdentity =
    targetAddressText || text(plan?.normalizedRequirement?.targetOutput?.name);
  const ioSignals = (circuitDraft?.ioMap || []).map(toSignal);
  const candidateInputs = ioSignals
    .filter((signal) => signal.role === 'input')
    .map((signal) => signal.address)
    .filter(Boolean);
  const candidateOutputs = ioSignals
    .filter((signal) => signal.role === 'output')
    .map((signal) => signal.address)
    .filter(Boolean);

  return {
    start: [...new Set(start)],
    stop: [...new Set(stop)],
    outputs: [...new Set([targetIdentity, ...candidateOutputs].filter(Boolean))],
    targetAddresses,
    candidateInputs,
    durationSeconds: Number(plan?.normalizedRequirement?.delaySeconds || 0),
    ioSignals
  };
}

function missingRequiredFacts(template, facts, { existingSource, requestText }) {
  if (!template) return ['template'];
  const missing = [];
  const inputPool = existingSource ? [...facts.start, ...facts.stop] : facts.candidateInputs;
  for (const required of template.requiredFacts) {
    if (required === 'output' && facts.outputs.length < 1) missing.push(required);
    if (required === 'two-outputs' && facts.outputs.length < 2) missing.push(required);
    if (
      ['start', 'trigger', 'alarm', 'enable', 'sensor'].includes(required) &&
      (existingSource ? facts.start.length < 1 : inputPool.length < 1)
    ) {
      missing.push(required);
    }
    if (['stop', 'reset'].includes(required) && (existingSource ? facts.stop.length < 1 : inputPool.length < 2)) {
      missing.push(required);
    }
    if (required === 'duration' && facts.durationSeconds <= 0) missing.push(required);
    if (
      required === 'edge' &&
      !/(상승|하강|rising|falling)/i.test(text(requestText))
    ) {
      missing.push(required);
    }
  }
  return [...new Set(missing)];
}

function referenceSource(reference) {
  const source = reference?.source || {};
  return {
    artifactId: source.artifactId || null,
    programId: source.programId || null,
    networkId: source.networkId || null,
    lineStart: source.lineStart || null,
    lineEnd: source.lineEnd || null,
    contentHash: source.contentHash || null
  };
}

function assessWriters(analysis, targetAddresses) {
  const references = analysis?.snapshot?.references || [];
  const byAddress = [];
  const conflicts = [];

  for (const address of targetAddresses) {
    const writers = references.filter(
      (reference) =>
        reference?.canonicalAddress === address && WRITER_ACCESSES.has(reference?.access)
    );
    byAddress.push({
      address,
      writerCount: writers.length,
      writers: writers.map((reference) => ({
        id: reference.id,
        access: reference.access,
        source: referenceSource(reference)
      }))
    });
    if (writers.length > 1) {
      conflicts.push({
        code: 'DUPLICATE_WRITER_CONFLICT',
        severity: 'must-review',
        address,
        detail: `${address} has ${writers.length} existing writers in the current snapshot.`
      });
    } else if (writers.length === 1) {
      conflicts.push({
        code: 'EXISTING_WRITER_REVIEW',
        severity: 'review',
        address,
        detail: `${address} already has one anchored writer that must be edited in place.`
      });
    }
  }

  return { byAddress, conflicts };
}

function assessAllocatedAddresses(analysis, circuitDraft, targetAddresses) {
  const existing = new Set(
    (analysis?.snapshot?.devices || []).map((device) => device?.canonicalAddress).filter(Boolean)
  );
  const conflicts = [];
  for (const item of circuitDraft?.ioMap || []) {
    const device = text(item?.device).toUpperCase();
    const role = signalRole(item);
    if (!device || targetAddresses.includes(device) || !['timer', 'internal'].includes(role)) continue;
    if (existing.has(device)) {
      conflicts.push({
        code: 'ADDRESS_ALLOCATION_CONFLICT',
        severity: 'must-review',
        address: device,
        detail: `${device} is already present in the current snapshot.`
      });
    }
  }
  return conflicts;
}

function buildLogicIr({ template, plan, circuitDraft, facts }) {
  const operations = (circuitDraft?.instructionList || [])
    .filter((line) => line && !line.startsWith(';') && line !== 'END')
    .map((line, index) => ({
      id: stableId('operation', template?.id || 'unknown', index, line),
      expression: line,
      evidence: 'candidate'
    }));
  const networks = (circuitDraft?.ladderPreview || []).map((network, index) => ({
    id: stableId('candidate-network', template?.id || 'unknown', index),
    name: text(network.title) || `Candidate Network ${index + 1}`,
    intent: text(network.explanation),
    operations: index === 0 ? operations : [],
    sourceAnchors: []
  }));
  const signals = facts.ioSignals;

  return {
    version: 'logic-candidate-v2',
    templateId: template?.id || null,
    networks,
    inputs: signals.filter((signal) => signal.role === 'input'),
    outputs: signals.filter((signal) => signal.role === 'output'),
    internals: signals.filter((signal) => signal.role === 'internal'),
    timers: signals
      .filter((signal) => signal.role === 'timer')
      .map((signal) => ({
        ...signal,
        durationSeconds: facts.durationSeconds > 0 ? facts.durationSeconds : null,
        timeBaseVerified: plan?.timerValidation?.status === 'exact'
      })),
    invariants: templateInvariants(template?.id, facts),
    assumptions: [...new Set(circuitDraft?.assumptions || [])],
    writesToPlc: false
  };
}

function riskPolicy({ blocked, highRiskMachine, existingSource }) {
  if (blocked) return { class: 'R4', scope: 'blocked' };
  if (highRiskMachine) return { class: 'R3', scope: 'simulation-only' };
  if (existingSource) return { class: 'R2', scope: 'engineering-candidate' };
  return { class: 'R1', scope: 'draft-candidate' };
}

export function buildChangeCandidateV2({
  analysis,
  plan,
  requestText,
  sourceContent = '',
  highRiskMachine = null
}) {
  const existingSource = hasExistingSource(analysis, sourceContent);
  const template = selectLowRiskTemplate(requestText, plan?.circuitDraft, {
    allowCircuitFallback: !existingSource
  });
  const facts = collectFacts(plan, plan?.circuitDraft);
  const missingFacts = missingRequiredFacts(template, facts, { existingSource, requestText });
  const usableCircuitDraft =
    existingSource && missingFacts.length > 0 ? null : plan?.circuitDraft;
  const writerImpact = assessWriters(analysis, facts.targetAddresses);
  const addressConflicts = assessAllocatedAddresses(
    analysis,
    usableCircuitDraft,
    facts.targetAddresses
  );
  const mustReviewConflicts = [...writerImpact.conflicts, ...addressConflicts].filter(
    (conflict) => conflict.severity === 'must-review'
  );
  const blocked = plan?.executionScope === 'blocked' || plan?.riskLevel === 'blocked';
  const risk = riskPolicy({ blocked, highRiskMachine, existingSource });
  const rendererReady =
    plan?.vendor === 'siemens' ? Boolean(template) : template?.renderer === 'gxworks2';
  const timerReady =
    plan?.vendor !== 'mitsubishi' ||
    !['delay-on', 'delay-off', 'sensor-debounce'].includes(template?.id) ||
    plan?.timerValidation?.status === 'exact';
  const instructionEmissionAllowed =
    ['R1', 'R2'].includes(risk.class) &&
    missingFacts.length === 0 &&
    mustReviewConflicts.length === 0 &&
    rendererReady &&
    timerReady;
  const status =
    risk.class === 'R4'
      ? 'blocked'
      : risk.class === 'R3'
        ? 'simulation-only'
        : instructionEmissionAllowed
          ? 'candidate'
          : 'needs-review';
  const reviewReasons = [];
  if (!template) reviewReasons.push('SUPPORTED_TEMPLATE_REQUIRED');
  if (missingFacts.length) reviewReasons.push(`MISSING_FACTS:${missingFacts.join(',')}`);
  if (!rendererReady && template) reviewReasons.push('MITSUBISHI_RENDERER_NOT_IMPLEMENTED');
  if (!timerReady) reviewReasons.push('VERIFIED_TIMER_PROFILE_REQUIRED');
  reviewReasons.push(...mustReviewConflicts.map((conflict) => conflict.code));

  return {
    version: 'change-candidate-v2',
    status,
    template: template
      ? {
          id: template.id,
          label: template.label,
          requiredFacts: template.requiredFacts,
          renderer: template.renderer
        }
      : null,
    logicIr: buildLogicIr({ template, plan, circuitDraft: usableCircuitDraft, facts }),
    impactAnalysis: {
      targetAddresses: facts.targetAddresses,
      existingWriters: writerImpact.byAddress,
      conflicts: [...writerImpact.conflicts, ...addressConflicts]
    },
    validation: {
      status,
      missingFacts,
      reviewReasons: [...new Set(reviewReasons)],
      instructionEmissionAllowed
    },
    risk: {
      ...risk,
      highRiskMachine: highRiskMachine?.id || null
    },
    policy: {
      canWriteToPlc: false,
      canEmitInstructionCandidate: instructionEmissionAllowed,
      externalNetworkUsed: false
    }
  };
}
