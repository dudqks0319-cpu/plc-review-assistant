export type EvidenceLevel = 'exact' | 'derived' | 'heuristic' | 'ai-interpreted' | 'unknown';
export type AddressRadix = 8 | 10 | 16 | 'mixed' | 'unknown';

export interface SourceAnchor {
  id: string;
  artifactId: string;
  filename: string;
  lineStart?: number;
  lineEnd?: number;
  byteStart?: number;
  byteEnd?: number;
  programId?: string;
  networkId?: string;
  instructionId?: string;
  rawSnippetHash: string;
}

export interface DeviceRange {
  deviceType: string;
  start?: number;
  end?: number;
  status: 'verified' | 'unknown';
}

export interface TimerProfile {
  deviceType: string;
  start?: number;
  end?: number;
  secondsPerUnit?: number;
  status: 'verified' | 'unknown';
}

export interface CpuProfile {
  id: string;
  vendor: 'mitsubishi';
  family: string;
  model?: string;
  engineeringTool: string;
  addressRadixByDevice: Record<string, AddressRadix>;
  deviceRanges: DeviceRange[];
  timerProfiles: TimerProfile[];
  supportedInstructions: string[];
  reservedDevices: string[];
  sourceReferences: string[];
}

export interface PlcDevice {
  id: string;
  rawAddress: string;
  canonical: string;
  canonicalAddress: string;
  deviceType: string;
  displayPart: string;
  numericPart: number | null;
  radix: AddressRadix;
  role: 'input' | 'output' | 'internal' | 'timer' | 'counter' | 'special' | 'unknown';
  valid: boolean | null;
  profileStatus: 'valid' | 'invalid-radix' | 'out-of-range' | 'unknown-profile' | 'unknown-device';
}

export interface DeviceReference {
  id: string;
  deviceId: string;
  canonicalAddress: string;
  access: 'read' | 'write' | 'set' | 'reset' | 'indirect-read' | 'indirect-write';
  instructionId: string;
  source: SourceAnchor;
  evidence: EvidenceLevel;
}

export interface DataFlowEdge {
  id: string;
  fromDeviceId: string;
  fromAddress: string;
  toDeviceId: string;
  toAddress: string;
  relation: 'influences';
  networkId: string;
  instructionId: string;
  source: SourceAnchor;
  evidence: 'derived';
}

export interface PlcInstruction {
  id: string;
  opcode: string;
  operands: string[];
  executionIndex: number;
  semantics: string;
  source: SourceAnchor;
  parseConfidence: number;
  unknown: boolean;
}

export interface PlcNetwork {
  id: string;
  programId: string;
  ordinal: number;
  title?: string;
  instructions: PlcInstruction[];
  source: SourceAnchor[];
}

export interface PlcProgram {
  id: string;
  name: string;
  kind: 'program' | 'subroutine' | 'function' | 'function-block' | 'unknown';
  language: 'ladder' | 'instruction-list' | 'structured-text' | 'sfc' | 'unknown';
  networks: PlcNetwork[];
  source: SourceAnchor[];
}

export interface Finding {
  id: string;
  ruleId: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  title: string;
  description: string;
  evidence: string[];
  evidenceAnchors: SourceAnchor[];
  recommendation: string;
}

export interface PlcProjectSnapshot {
  id: string;
  workspaceId: string | null;
  contentHash: string;
  vendor: string;
  cpuProfileId: string | null;
  artifacts: Array<{
    id: string;
    filename: string;
    contentHash: string;
    sizeBytes: number;
    encoding?: 'utf-8' | 'utf-8-bom' | 'cp949' | 'euc-kr' | 'shift-jis' | 'cp932' | 'windows-1252';
  }>;
  programs: PlcProgram[];
  devices: PlcDevice[];
  references: DeviceReference[];
  callEdges: unknown[];
  dataFlowEdges: DataFlowEdge[];
  parseWarnings: Array<{ code: string; message: string; source?: SourceAnchor }>;
  createdAt: string;
}

export interface PlcWorkspace {
  id: string;
  name: string;
  vendor: 'mitsubishi' | 'siemens';
  cpuProfileId: string | null;
  snapshotIds: string[];
  createdAt: string;
  updatedAt: string;
  storage: 'memory-only';
}

export interface ProjectBundleArtifactInput {
  filename: string;
  encoding?: 'utf-8' | 'utf-8-bom' | 'cp949' | 'euc-kr' | 'shift-jis' | 'cp932' | 'windows-1252';
  content?: string;
  contentBase64?: string;
}

export interface ProjectBundleRecord {
  snapshot: PlcProjectSnapshot;
  findings: Finding[];
  artifactResults: Array<{
    artifact: PlcProjectSnapshot['artifacts'][number];
    summary: Record<string, unknown>;
    parserWarnings: PlcProjectSnapshot['parseWarnings'];
  }>;
  reused?: boolean;
}

export type GroundedQuestionType =
  | 'output-on-locations'
  | 'output-off-locations'
  | 'why-output-not-on'
  | 'set-reset-locations'
  | 'duplicate-output-writers'
  | 'input-output-impact'
  | 'timer-duration'
  | 'network-explanation'
  | 'program-conditions'
  | 'change-impact'
  | 'unsupported';

export interface KnowledgeCitation {
  filename: string;
  sourceType: 'vendor-manual' | 'company-rule' | 'approved-case' | 'public-guideline';
  vendor: string;
  family: string | null;
  documentNumber: string | null;
  revision: string | null;
  section: string | null;
  page: number | null;
  licensePolicy: 'local-index-only' | 'redistributable' | 'unknown';
}

export interface GroundedEvidence {
  id: string;
  kind: 'instruction' | 'reference' | 'data-flow-edge' | 'knowledge';
  label: string;
  source?: SourceAnchor;
  citation?: KnowledgeCitation;
  snippet?: string;
  contentHash?: string;
  evidenceLevel: EvidenceLevel;
}

export interface GroundedAnswer {
  conclusion: string[];
  explanation: string[];
  evidenceIds: string[];
  unknowns: string[];
  assumptions: string[];
  confidence: number;
  suggestedNextChecks: string[];
}

export interface GroundedQuestionResult {
  question: string;
  questionType: GroundedQuestionType;
  plan: {
    questionType: GroundedQuestionType;
    targetAddress: string | null;
    maxTraceDepth: number;
    toolCalls: string[];
  };
  answer: GroundedAnswer;
  evidence: GroundedEvidence[];
  knowledgeSearch: {
    strategy: string;
    warnings: Array<{ code: string; detail?: string; documentId?: string }>;
    resultCount: number;
  };
  policy: {
    mode: 'grounded';
    generatedAddressCount: 0;
    writesToPlc: false;
    externalNetworkUsed: false;
  };
}

export interface KnowledgeDocument {
  id: string;
  filename: string;
  sourceType: KnowledgeCitation['sourceType'];
  vendor: string;
  family: string;
  cpuModels: string[];
  engineeringTool: string;
  documentNumber: string;
  revision: string;
  section: string;
  page: number | null;
  contentHash: string;
  licensePolicy: KnowledgeCitation['licensePolicy'];
  sizeBytes: number;
  chunkCount: number;
  warnings: Array<{ code: string; detail: string }>;
  storage: 'memory-only';
  createdAt: string;
}
