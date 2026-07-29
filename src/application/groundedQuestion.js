import { createHash } from 'node:crypto';
import { calculateTimerDuration, getCpuProfile } from '../adapters/mitsubishi/deviceAddress.js';
import {
  buildCrossReferenceIndex,
  traceBackward,
  traceForward
} from '../domain/dataFlow.js';

const DEVICE_PATTERN = /\b(?:ZR|SD|SM|X|Y|M|L|B|D|W|R|T|C|Z)[0-9A-F]+\b/i;
const QUESTION_TYPES = Object.freeze([
  'output-on-locations',
  'output-off-locations',
  'why-output-not-on',
  'set-reset-locations',
  'duplicate-output-writers',
  'input-output-impact',
  'timer-duration',
  'network-explanation',
  'program-conditions',
  'change-impact'
]);

function questionError(code, message, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function stableEvidenceId(value) {
  return `evi-${createHash('sha256').update(String(value)).digest('hex').slice(0, 20)}`;
}

function extractAddress(question) {
  return String(question || '').toUpperCase().match(DEVICE_PATTERN)?.[0] || null;
}

function extractNetworkOrdinal(question) {
  const match = String(question || '').match(/(?:network|네트워크)\s*#?\s*(\d+)/i);
  return match ? Number(match[1]) : null;
}

export function classifyGroundedQuestion(question) {
  const text = String(question || '').trim();
  const normalized = text.toLowerCase();
  if (!text) return 'unsupported';
  if (/(몇\s*초|시간|timer|타이머)/i.test(text)) return 'timer-duration';
  if (/(set\s*\/?\s*rst|set\s*\/?\s*reset|set.*rst|셋.*리셋|set.*reset)/i.test(text)) {
    return 'set-reset-locations';
  }
  if (/(동일 출력|중복 코일|여러 곳|여러곳|duplicate|multiple writer)/i.test(text)) {
    return 'duplicate-output-writers';
  }
  if (/(network|네트워크)/i.test(text) && /(설명|이해|explain)/i.test(text)) {
    return 'network-explanation';
  }
  if (/(시작.*정지.*fault|시작.*정지.*고장|start.*stop.*fault)/i.test(text)) {
    return 'program-conditions';
  }
  if (/(변경|바꾸|change)/i.test(text) && /(영향|impact)/i.test(text)) return 'change-impact';
  if (/(영향.*출력|출력.*영향|어떤 출력|impact.*output)/i.test(text)) {
    return 'input-output-impact';
  }
  if (/(왜|안\s*켜|켜지지|not turn on|not on)/i.test(text)) return 'why-output-not-on';
  if (/(어디(?:서|에서).*꺼|끄는|off\s*위치|reset|off location)/i.test(text)) {
    return 'output-off-locations';
  }
  if (/(어디(?:서|에서).*켜|켜는|on\s*위치|writer|on location)/i.test(text)) {
    return 'output-on-locations';
  }
  if (extractAddress(text) && /(영향|impact)/i.test(normalized)) return 'change-impact';
  return 'unsupported';
}

function queryPlan(questionType, address, maxTraceDepth) {
  const byType = {
    'output-on-locations': ['resolve_device', 'find_device_writers'],
    'output-off-locations': ['resolve_device', 'find_reset_locations', 'find_device_writers'],
    'why-output-not-on': [
      'resolve_device',
      'find_device_writers',
      'trace_backward',
      'find_set_locations',
      'find_reset_locations',
      'find_later_writes'
    ],
    'set-reset-locations': ['resolve_device', 'find_set_locations', 'find_reset_locations'],
    'duplicate-output-writers': ['resolve_device', 'find_device_writers', 'find_duplicate_coils'],
    'input-output-impact': ['resolve_device', 'trace_forward'],
    'timer-duration': ['resolve_device', 'calculate_timer_duration'],
    'network-explanation': ['explain_network'],
    'program-conditions': ['search_program_comments', 'find_device_readers'],
    'change-impact': ['resolve_device', 'trace_forward', 'assess_change_impact']
  };
  return {
    questionType,
    targetAddress: address,
    maxTraceDepth,
    toolCalls: byType[questionType] || []
  };
}

function networkIndex(snapshot) {
  const index = new Map();
  for (const program of snapshot.programs || []) {
    for (const network of program.networks || []) {
      index.set(network.id, { program, network });
    }
  }
  return index;
}

function instructionIndex(snapshot) {
  const index = new Map();
  for (const program of snapshot.programs || []) {
    for (const network of program.networks || []) {
      for (const instruction of network.instructions || []) {
        index.set(instruction.id, { program, network, instruction });
      }
    }
  }
  return index;
}

function referenceEvidence(reference, snapshot, labelPrefix = '코드 근거') {
  const networks = networkIndex(snapshot);
  const context = networks.get(reference.source?.networkId);
  const line = reference.source?.lineStart;
  return {
    id: stableEvidenceId(reference.id),
    kind: 'code-reference',
    label: `${labelPrefix}: ${context?.program?.name || '프로그램'} / Network ${
      context?.network?.ordinal ?? '?'
    }${line ? ` / line ${line}` : ''}`,
    address: reference.canonicalAddress,
    access: reference.access,
    source: reference.source,
    evidenceLevel: reference.evidence || 'exact'
  };
}

function instructionEvidence(instruction, program, network, labelPrefix = '명령 근거') {
  return {
    id: stableEvidenceId(instruction.id),
    kind: 'instruction',
    label: `${labelPrefix}: ${program.name} / Network ${network.ordinal} / ${instruction.opcode}`,
    source: instruction.source,
    opcode: instruction.opcode,
    operands: instruction.operands,
    evidenceLevel: instruction.parseConfidence === 1 ? 'exact' : 'unknown'
  };
}

function uniqueEvidence(entries) {
  return [...new Map(entries.filter(Boolean).map((entry) => [entry.id, entry])).values()];
}

function confidenceFor({ snapshot, evidence, unknownDevice, executionOrderKnown }) {
  if (unknownDevice || evidence.length === 0) return 0;
  let confidence = 1;
  if (!snapshot.cpuProfileId) confidence -= 0.2;
  if (!executionOrderKnown) confidence -= 0.15;
  if ((snapshot.references || []).some((reference) => reference.access.startsWith('indirect-'))) {
    confidence -= 0.2;
  }
  confidence -= 0.15; // HMI/communications are outside an export-only snapshot.
  confidence -= Math.min(0.2, (snapshot.parseWarnings || []).length * 0.05);
  if (evidence.some((entry) => !entry.source && entry.kind !== 'knowledge')) confidence -= 0.2;
  return Number(Math.max(0, Math.min(1, confidence)).toFixed(2));
}

function deviceOrUnknown(snapshot, address) {
  if (!address) return null;
  return (snapshot.devices || []).find((device) => device.canonicalAddress === address) || null;
}

function programNetworkByOrdinal(snapshot, ordinal) {
  for (const program of snapshot.programs || []) {
    const network = (program.networks || []).find((item) => item.ordinal === ordinal);
    if (network) return { program, network };
  }
  return null;
}

function evidenceForReferences(references, snapshot, prefix) {
  return (references || []).map((reference) => referenceEvidence(reference, snapshot, prefix));
}

function programConditionReferences(snapshot, keywords) {
  const matchingAddresses = new Set(
    (snapshot.devices || [])
      .filter((device) =>
        keywords.some((keyword) =>
          `${device.label || ''} ${device.comment || ''}`.toLowerCase().includes(keyword)
        )
      )
      .map((device) => device.canonicalAddress)
  );
  return (snapshot.references || []).filter(
    (reference) =>
      matchingAddresses.has(reference.canonicalAddress) &&
      ['read', 'indirect-read'].includes(reference.access)
  );
}

function timerAnswer(snapshot, address) {
  const references = (snapshot.references || []).filter(
    (reference) => reference.canonicalAddress === address
  );
  const instructions = instructionIndex(snapshot);
  const evidence = [];
  const exactDurations = [];
  for (const reference of references) {
    const context = instructions.get(reference.instructionId);
    if (!context) continue;
    evidence.push(
      instructionEvidence(context.instruction, context.program, context.network, '타이머 명령')
    );
    const preset = context.instruction.operands.find((operand) => /^K\d+$/i.test(operand));
    const duration = calculateTimerDuration({
      timerAddress: address,
      preset,
      cpuProfile: getCpuProfile(snapshot.cpuProfileId)
    });
    if (duration.status === 'exact') exactDurations.push(duration.seconds);
  }
  return { references, evidence, exactDurations };
}

export function answerGroundedQuestion({
  snapshot,
  question,
  maxTraceDepth = 4,
  manualEvidence = { results: [], warnings: [], strategy: 'not-requested' }
}) {
  if (!snapshot || typeof snapshot !== 'object') {
    throw questionError('SNAPSHOT_REQUIRED', 'A parsed snapshot is required.');
  }
  const normalizedQuestion = typeof question === 'string' ? question.trim() : '';
  if (!normalizedQuestion || normalizedQuestion.length > 1_000) {
    throw questionError(
      'QUESTION_INVALID',
      'Question text must contain between 1 and 1000 characters.'
    );
  }
  const depth = Math.max(1, Math.min(Number(maxTraceDepth) || 4, 12));
  const questionType = classifyGroundedQuestion(normalizedQuestion);
  const address = extractAddress(normalizedQuestion);
  const device = deviceOrUnknown(snapshot, address);
  const referenceIndex = buildCrossReferenceIndex(snapshot);
  const plan = queryPlan(questionType, address, depth);
  const conclusion = [];
  const explanation = [];
  const unknowns = [];
  const assumptions = ['답변 범위는 현재 로컬 Export Snapshot에 한정됩니다.'];
  const suggestedNextChecks = [];
  let evidence = [];

  if (questionType === 'unsupported') {
    unknowns.push('현재 지원하는 10가지 근거형 질문으로 분류하지 못했습니다.');
    suggestedNextChecks.push('추천 질문 문구를 사용하거나 디바이스 주소를 포함해 질문해 주세요.');
  } else if (address && !device) {
    unknowns.push(`${address}은(는) 현재 Export Snapshot에서 찾지 못했습니다.`);
    suggestedNextChecks.push('해당 디바이스가 포함된 label/listing export를 추가해 주세요.');
  } else if (questionType === 'network-explanation') {
    const ordinal = extractNetworkOrdinal(normalizedQuestion);
    const context = ordinal ? programNetworkByOrdinal(snapshot, ordinal) : null;
    if (!context) {
      unknowns.push('질문에 지정된 Network를 현재 Snapshot에서 찾지 못했습니다.');
      suggestedNextChecks.push('예: “Network 3을 설명해줘”처럼 번호를 포함해 주세요.');
    } else {
      evidence = (context.network.instructions || []).map((instruction) =>
        instructionEvidence(instruction, context.program, context.network)
      );
      const reads = (snapshot.references || []).filter(
        (reference) =>
          reference.source?.networkId === context.network.id &&
          ['read', 'indirect-read'].includes(reference.access)
      );
      const writes = (snapshot.references || []).filter(
        (reference) =>
          reference.source?.networkId === context.network.id &&
          ['write', 'set', 'reset', 'indirect-write'].includes(reference.access)
      );
      conclusion.push(
        `${context.program.name} / Network ${context.network.ordinal}에는 ${
          context.network.instructions.length
        }개 명령이 있습니다.`
      );
      explanation.push(
        `읽기 조건: ${reads.map((item) => item.canonicalAddress).join(', ') || '없음'}, 쓰기 대상: ${
          writes.map((item) => `${item.access.toUpperCase()} ${item.canonicalAddress}`).join(', ') ||
          '없음'
        }.`
      );
    }
  } else if (questionType === 'program-conditions') {
    const startRefs = programConditionReferences(snapshot, ['start', '시작', '기동']);
    const stopRefs = programConditionReferences(snapshot, ['stop', '정지']);
    const faultRefs = programConditionReferences(snapshot, ['fault', 'alarm', '고장', '이상']);
    const all = [...startRefs, ...stopRefs, ...faultRefs];
    evidence = evidenceForReferences(all, snapshot, '조건 근거');
    if (!all.length) {
      unknowns.push('주석·라벨에서 시작, 정지, Fault 조건을 식별하지 못했습니다.');
    } else {
      conclusion.push(
        `라벨·주석 기준으로 시작 ${startRefs.length}개, 정지 ${stopRefs.length}개, Fault ${faultRefs.length}개 참조를 찾았습니다.`
      );
      explanation.push('이 분류는 주소를 추측하지 않고 Export의 라벨·주석과 실제 참조만 사용했습니다.');
    }
  } else if (questionType === 'timer-duration') {
    if (!address || !address.startsWith('T')) {
      unknowns.push('타이머 주소(T 디바이스)를 질문에서 식별하지 못했습니다.');
    } else {
      const timer = timerAnswer(snapshot, address);
      evidence = timer.evidence;
      if (timer.exactDurations.length) {
        conclusion.push(`${address}의 검증된 설정 시간은 ${timer.exactDurations[0]}초입니다.`);
      } else {
        unknowns.push(
          snapshot.cpuProfileId
            ? `${address}의 CPU·타이머 번호별 time base가 검증되지 않아 초 단위로 환산할 수 없습니다.`
            : 'CPU 프로필이 없어 타이머 시간을 초 단위로 환산할 수 없습니다.'
        );
        suggestedNextChecks.push('정확한 CPU 모델, 타이머 번호, preset과 공식 time base를 확인해 주세요.');
      }
    }
  } else {
    const writers = address ? referenceIndex.writersByDevice.get(address) || [] : [];
    const activatingWriters = writers.filter((reference) =>
      ['write', 'set', 'indirect-write'].includes(reference.access)
    );
    const readers = address ? referenceIndex.readersByDevice.get(address) || [] : [];
    const setters = address ? referenceIndex.settersByDevice.get(address) || [] : [];
    const resetters = address ? referenceIndex.resettersByDevice.get(address) || [] : [];

    if (questionType === 'output-on-locations') {
      evidence = evidenceForReferences(activatingWriters, snapshot, 'ON Writer');
      if (activatingWriters.length) {
        conclusion.push(
          `${address}을(를) 켤 수 있는 Writer는 현재 Export에서 ${activatingWriters.length}개입니다.`
        );
      } else {
        unknowns.push(`${address}을(를) 켤 수 있는 Writer를 현재 Export에서 찾지 못했습니다.`);
      }
    } else if (questionType === 'output-off-locations') {
      evidence = evidenceForReferences([...resetters, ...writers], snapshot, 'OFF 후보');
      if (resetters.length) {
        conclusion.push(`${address}을(를) RST하는 위치는 ${resetters.length}개입니다.`);
      }
      if (writers.length) {
        explanation.push(
          `OUT Writer ${writers.length}개는 상위 조건이 거짓일 때 출력을 끌 수 있으나 실제 스캔 순서는 확인되지 않았습니다.`
        );
      }
      if (!resetters.length && !writers.length) unknowns.push('OFF 동작 후보를 찾지 못했습니다.');
    } else if (questionType === 'set-reset-locations') {
      evidence = evidenceForReferences([...setters, ...resetters], snapshot, 'SET/RST');
      conclusion.push(
        `${address}의 SET 위치는 ${setters.length}개, RST 위치는 ${resetters.length}개입니다.`
      );
    } else if (questionType === 'duplicate-output-writers') {
      evidence = evidenceForReferences(writers, snapshot, 'Writer');
      conclusion.push(
        writers.length > 1
          ? `${address}은(는) ${writers.length}개 위치에서 쓰여 중복 Writer 검토가 필요합니다.`
          : `${address}의 Writer는 현재 Export에서 ${writers.length}개입니다.`
      );
    } else if (questionType === 'why-output-not-on') {
      const backward = traceBackward(snapshot, address, { maxDepth: depth });
      const dependencyAddresses = new Set(
        backward.devices.map((item) => item.canonicalAddress).filter((item) => item !== address)
      );
      const dependencies = (snapshot.references || []).filter(
        (reference) =>
          dependencyAddresses.has(reference.canonicalAddress) &&
          ['read', 'indirect-read'].includes(reference.access)
      );
      evidence = [
        ...evidenceForReferences(activatingWriters, snapshot, 'ON Writer'),
        ...evidenceForReferences(dependencies, snapshot, '상위 조건'),
        ...evidenceForReferences([...setters, ...resetters], snapshot, 'SET/RST')
      ];
      if (activatingWriters.length) {
        conclusion.push(
          `${address}의 ON Writer ${activatingWriters.length}개와 상위 조건 후보를 찾았습니다.`
        );
        explanation.push(
          `현재 구조상 ${[...dependencyAddresses].join(', ') || '식별된 직접 조건 없음'} 상태가 출력 경로에 영향을 줄 수 있습니다.`
        );
        unknowns.push('프로그램 간 실제 실행 순서와 온라인 값은 Export만으로 확인할 수 없습니다.');
      } else {
        unknowns.push(`${address}을(를) 켜는 Writer를 현재 Export에서 찾지 못했습니다.`);
      }
    } else if (questionType === 'input-output-impact' || questionType === 'change-impact') {
      const forward = traceForward(snapshot, address, { maxDepth: depth });
      const outputs = forward.devices.filter((item) => item.role === 'output');
      evidence = uniqueEvidence(
        forward.edges.map((edge) => ({
          id: stableEvidenceId(edge.id),
          kind: 'data-flow-edge',
          label: `영향 경로: ${edge.fromAddress} → ${edge.toAddress}`,
          source: edge.source,
          fromAddress: edge.fromAddress,
          toAddress: edge.toAddress,
          evidenceLevel: edge.evidence
        }))
      );
      conclusion.push(
        `${address}에서 ${depth}단계 이내에 도달하는 출력은 ${
          outputs.map((item) => item.canonicalAddress).join(', ') || '현재 구조상 없음'
        }입니다.`
      );
      if (forward.cycles.length) explanation.push(`순환 경로 ${forward.cycles.length}개를 감지했습니다.`);
      if (questionType === 'change-impact') {
        explanation.push(`직접 Reader ${readers.length}개와 전방 데이터 흐름을 변경 영향 후보로 수집했습니다.`);
      }
    }
  }

  evidence = uniqueEvidence(evidence);
  const manualResults = Array.isArray(manualEvidence.results) ? manualEvidence.results : [];
  for (const item of manualResults) {
    evidence.push({
      id: item.evidenceId,
      kind: 'knowledge',
      label: `${item.citation.filename}${item.citation.section ? ` / ${item.citation.section}` : ''}`,
      citation: item.citation,
      snippet: item.snippet,
      contentHash: item.contentHash,
      evidenceLevel: 'exact'
    });
  }
  evidence = uniqueEvidence(evidence);
  if (manualResults.length) {
    explanation.push(`로컬 지식 문서 ${manualResults.length}개 조각을 추가 근거로 찾았습니다.`);
  }
  unknowns.push('HMI·통신·온라인 값과 보호 블록 내부 참조는 현재 Snapshot에서 확인할 수 없습니다.');
  const evidenceIds = evidence.map((entry) => entry.id);
  const confidence = confidenceFor({
    snapshot,
    evidence,
    unknownDevice: Boolean(address && !device),
    executionOrderKnown: referenceIndex.executionOrderKnown
  });
  if (confidence < 0.4 && conclusion.length) {
    assumptions.push('신뢰도가 낮아 결론은 가능성 표현으로만 사용해야 합니다.');
  }

  return {
    question: normalizedQuestion,
    questionType,
    plan,
    answer: {
      conclusion,
      explanation,
      evidenceIds,
      unknowns: [...new Set(unknowns)],
      assumptions,
      confidence,
      suggestedNextChecks
    },
    evidence,
    knowledgeSearch: {
      strategy: manualEvidence.strategy || 'not-requested',
      warnings: manualEvidence.warnings || [],
      resultCount: manualResults.length
    },
    policy: {
      mode: 'grounded',
      generatedAddressCount: 0,
      writesToPlc: false,
      externalNetworkUsed: false
    }
  };
}

export { QUESTION_TYPES };
