import { createHash } from 'node:crypto';
import { createSourceAnchor } from '../../domain/sourceAnchor.js';
import { getCpuProfile, parseDeviceAddress } from './deviceAddress.js';

const READ_OPCODES = new Set(['LD', 'LDI', 'AND', 'ANI', 'OR', 'ORI']);
const WRITE_OPCODES = new Set(['OUT']);
const SET_OPCODES = new Set(['SET']);
const RESET_OPCODES = new Set(['RST']);
const FLOW_OPCODES = new Set(['CJ', 'CALL', 'RET', 'FOR', 'NEXT', 'END', 'FEND']);
const PASSTHROUGH_OPCODES = new Set([
  'ANB',
  'ORB',
  'MPS',
  'MRD',
  'MPP',
  'PLS',
  'PLF',
  'MOV',
  'DMOV',
  'BMOV',
  'CMP',
  'ZCP',
  'ADD',
  'SUB',
  'MUL',
  'DIV'
]);
const SUPPORTED_OPCODES = new Set([
  ...READ_OPCODES,
  ...WRITE_OPCODES,
  ...SET_OPCODES,
  ...RESET_OPCODES,
  ...FLOW_OPCODES,
  ...PASSTHROUGH_OPCODES
]);
const DEVICE_TOKEN = /^(?:ZR|SD|SM|X|Y|M|L|B|D|W|R|T|C|Z)(?:[0-9A-F]+|\[[^\]]+\])(?:\.\d+)?$/i;

function stableId(prefix, ...parts) {
  return `${prefix}-${createHash('sha256').update(parts.map(String).join('|')).digest('hex').slice(0, 16)}`;
}

function programKind(header) {
  const token = header.split(/\s+/)[0].toUpperCase();
  if (token === 'PROGRAM') return 'program';
  if (token === 'FUNCTION_BLOCK' || token === 'FB') return 'function-block';
  if (token === 'FUNCTION' || token === 'FC') return 'function';
  return 'unknown';
}

function semanticsFor(opcode) {
  if (READ_OPCODES.has(opcode)) return 'read-condition';
  if (WRITE_OPCODES.has(opcode)) return 'write-output';
  if (SET_OPCODES.has(opcode)) return 'set-latch';
  if (RESET_OPCODES.has(opcode)) return 'reset-latch';
  if (FLOW_OPCODES.has(opcode)) return 'control-flow';
  if (PASSTHROUGH_OPCODES.has(opcode)) return 'supported-operation';
  return 'unknown';
}

function accessFor(opcode, operandIndex) {
  if (SET_OPCODES.has(opcode)) return 'set';
  if (RESET_OPCODES.has(opcode)) return 'reset';
  if (WRITE_OPCODES.has(opcode)) return 'write';
  if (READ_OPCODES.has(opcode)) return 'read';
  if (['MOV', 'DMOV', 'BMOV'].includes(opcode)) return operandIndex === 0 ? 'read' : 'write';
  return 'read';
}

export function parseInstructionList({ artifactId, filename, content, cpuProfile: profileOrId }) {
  const cpuProfile = getCpuProfile(profileOrId);
  const lines = String(content || '').split(/\r\n|\n|\r/);
  const programs = [];
  const devicesById = new Map();
  const references = [];
  const unknownInstructions = [];
  let activeProgram = null;
  let activeNetwork = null;
  let executionIndex = 0;

  const ensureProgram = (lineNumber, rawLine, name = 'MAIN', kind = 'program') => {
    if (activeProgram) return activeProgram;
    const id = stableId('program', artifactId, name);
    activeProgram = {
      id,
      name,
      kind,
      language: 'instruction-list',
      networks: [],
      source: [
        createSourceAnchor({
          artifactId,
          filename,
          rawSnippet: rawLine,
          lineStart: lineNumber,
          programId: id
        })
      ]
    };
    programs.push(activeProgram);
    return activeProgram;
  };

  const ensureNetwork = (lineNumber, rawLine, ordinal = activeProgram?.networks.length + 1 || 1) => {
    ensureProgram(lineNumber, rawLine);
    if (activeNetwork) return activeNetwork;
    const id = stableId('network', activeProgram.id, ordinal);
    activeNetwork = {
      id,
      programId: activeProgram.id,
      ordinal,
      instructions: [],
      source: [
        createSourceAnchor({
          artifactId,
          filename,
          rawSnippet: rawLine,
          lineStart: lineNumber,
          programId: activeProgram.id,
          networkId: id
        })
      ]
    };
    activeProgram.networks.push(activeNetwork);
    return activeNetwork;
  };

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const trimmed = rawLine.trim();
    if (!trimmed || /^(?:;|\/\/|#)/.test(trimmed)) return;

    const programMatch = trimmed.match(/^(PROGRAM|POU|FUNCTION_BLOCK|FUNCTION|FB|FC)\s+([A-Za-z_][\w$]*)/i);
    if (programMatch) {
      activeProgram = null;
      activeNetwork = null;
      ensureProgram(lineNumber, rawLine, programMatch[2], programKind(programMatch[1]));
      return;
    }

    const networkMatch = trimmed.match(/^(?:NETWORK|N|RUNG)\s+(\d+)/i);
    if (networkMatch) {
      activeNetwork = null;
      ensureNetwork(lineNumber, rawLine, Number(networkMatch[1]));
      return;
    }

    ensureNetwork(lineNumber, rawLine);
    const withoutComment = trimmed.split(/\s+(?:;|\/\/|#)/, 1)[0];
    const [rawOpcode, ...operands] = withoutComment.split(/[\s,]+/).filter(Boolean);
    const opcode = String(rawOpcode || '').toUpperCase();
    if (!opcode) return;

    const instructionId = stableId('instruction', activeNetwork.id, executionIndex, opcode, trimmed);
    const source = createSourceAnchor({
      artifactId,
      filename,
      rawSnippet: rawLine,
      lineStart: lineNumber,
      programId: activeProgram.id,
      networkId: activeNetwork.id,
      instructionId
    });
    const unknown = !SUPPORTED_OPCODES.has(opcode);
    const instruction = {
      id: instructionId,
      opcode,
      operands,
      executionIndex,
      semantics: semanticsFor(opcode),
      source,
      parseConfidence: unknown ? 0.25 : 1,
      unknown
    };
    executionIndex += 1;
    activeNetwork.instructions.push(instruction);
    if (unknown) unknownInstructions.push(instruction);

    operands.forEach((operand, operandIndex) => {
      if (!DEVICE_TOKEN.test(operand)) return;
      const device = parseDeviceAddress(operand, cpuProfile);
      devicesById.set(device.id, device);
      references.push({
        id: stableId('reference', instructionId, device.id, operandIndex),
        deviceId: device.id,
        canonicalAddress: device.canonicalAddress,
        access: device.indirect
          ? accessFor(opcode, operandIndex) === 'write'
            ? 'indirect-write'
            : 'indirect-read'
          : accessFor(opcode, operandIndex),
        instructionId,
        source,
        evidence: 'exact'
      });
    });
  });

  return {
    programs,
    devices: [...devicesById.values()],
    references,
    unknownInstructions
  };
}
