import assert from 'node:assert/strict';
import test from 'node:test';
import { createProjectBundleSnapshot } from '../src/application/projectBundle.js';
import {
  answerGroundedQuestion,
  classifyGroundedQuestion,
  QUESTION_TYPES
} from '../src/application/groundedQuestion.js';

const labels = `Label,Device,Comment,Program
StartSwitch,X0,Start command,MAIN
StopSwitch,X1,Stop command,MAIN
FaultSignal,M10,Fault alarm,MAIN
RunCoil,Y20,Conveyor output,MAIN
DelayedRun,Y21,Delayed output,MAIN
DelayTimer,T0,Start delay timer,MAIN
RunLatch,M100,Run memory,MAIN`;

const listing = `PROGRAM MAIN
NETWORK 1
LD X0
ANI X1
OUT Y20
NETWORK 2
LD M10
RST Y20
NETWORK 3
LD X0
SET M100
NETWORK 4
LD X1
RST M100
NETWORK 5
LD X0
OUT T0 K30
NETWORK 6
LD T0
OUT Y21
END`;

function snapshot() {
  return createProjectBundleSnapshot({
    workspaceId: 'workspace-grounded',
    vendor: 'mitsubishi',
    cpuProfileId: 'mitsubishi-fx3',
    artifacts: [
      { filename: 'labels.csv', content: labels },
      { filename: 'main.lst', content: listing }
    ]
  }).snapshot;
}

const questions = [
  ['Y20은 어디서 켜지나?', 'output-on-locations'],
  ['Y20은 어디서 꺼지나?', 'output-off-locations'],
  ['왜 Y20이 안 켜질 수 있나?', 'why-output-not-on'],
  ['M100은 어디서 SET/RST 되나?', 'set-reset-locations'],
  ['동일 출력 Y20을 여러 곳에서 쓰나?', 'duplicate-output-writers'],
  ['입력 X0이 영향을 주는 출력은 무엇인가?', 'input-output-impact'],
  ['타이머 T0은 몇 초인가?', 'timer-duration'],
  ['Network 1을 초보자도 이해하게 설명해줘.', 'network-explanation'],
  ['이 프로그램의 시작·정지·Fault 조건을 정리해줘.', 'program-conditions'],
  ['X0을 변경하면 어디가 영향을 받나?', 'change-impact']
];

test('query planner classifies all ten first-release grounded question types', () => {
  assert.deepEqual(new Set(QUESTION_TYPES), new Set(questions.map(([, type]) => type)));
  for (const [question, type] of questions) {
    assert.equal(classifyGroundedQuestion(question), type, question);
  }
});

test('recommended Korean UI questions map to supported grounded question types', () => {
  assert.equal(classifyGroundedQuestion('Y20은 어디에서 켜지나요?'), 'output-on-locations');
  assert.equal(classifyGroundedQuestion('Y20은 어디에서 꺼지나요?'), 'output-off-locations');
  assert.equal(
    classifyGroundedQuestion('Y20이 켜지지 않을 수 있는 이유는 무엇인가요?'),
    'why-output-not-on'
  );
  assert.equal(classifyGroundedQuestion('Y20은 여러 곳에서 쓰이나요?'), 'duplicate-output-writers');
  assert.equal(classifyGroundedQuestion('T0 타이머는 몇 초인가요?'), 'timer-duration');
  assert.equal(
    classifyGroundedQuestion('X0을 바꾸면 어떤 출력에 영향이 있나요?'),
    'change-impact'
  );
});

test('grounded answers only cite evidence that exists in the current snapshot', () => {
  const current = snapshot();
  for (const [question, expectedType] of questions) {
    const result = answerGroundedQuestion({ snapshot: current, question, maxTraceDepth: 4 });
    assert.equal(result.questionType, expectedType);
    assert.equal(result.policy.generatedAddressCount, 0);
    assert.equal(result.policy.writesToPlc, false);
    assert.equal(result.policy.externalNetworkUsed, false);
    assert.equal(
      result.answer.evidenceIds.every((id) => result.evidence.some((entry) => entry.id === id)),
      true,
      question
    );
    assert.equal(
      result.evidence
        .filter((entry) => entry.kind !== 'knowledge')
        .every((entry) => /^[a-f0-9]{64}$/.test(entry.source?.rawSnippetHash || '')),
      true,
      question
    );
  }
});

test('why-not-on and forward-impact answers are derived from writer and data-flow evidence', () => {
  const current = snapshot();
  const why = answerGroundedQuestion({
    snapshot: current,
    question: '왜 Y20이 안 켜질 수 있나?'
  });
  const impact = answerGroundedQuestion({
    snapshot: current,
    question: '입력 X0이 영향을 주는 출력은 무엇인가?'
  });

  assert.equal(why.answer.conclusion.some((item) => item.includes('ON Writer 1개')), true);
  assert.equal(why.answer.explanation.some((item) => item.includes('X0')), true);
  assert.equal(why.answer.unknowns.some((item) => item.includes('실행 순서')), true);
  assert.equal(impact.answer.conclusion.some((item) => item.includes('Y20') && item.includes('Y21')), true);
  assert.equal(impact.evidence.some((item) => item.kind === 'data-flow-edge'), true);
});

test('timer answer keeps seconds unknown when exact timer profile facts are unavailable', () => {
  const result = answerGroundedQuestion({
    snapshot: snapshot(),
    question: '타이머 T0은 몇 초인가?'
  });

  assert.deepEqual(result.answer.conclusion, []);
  assert.equal(result.answer.unknowns.some((item) => item.includes('time base')), true);
  assert.equal(result.evidence.some((item) => item.opcode === 'OUT'), true);
});

test('missing devices and unsupported questions fail closed without invented evidence', () => {
  const current = snapshot();
  const missing = answerGroundedQuestion({
    snapshot: current,
    question: 'Y999는 어디서 켜지나?'
  });
  const unsupported = answerGroundedQuestion({
    snapshot: current,
    question: '오늘 날씨가 어때?'
  });

  assert.equal(missing.answer.confidence, 0);
  assert.deepEqual(missing.answer.conclusion, []);
  assert.deepEqual(missing.answer.evidenceIds, []);
  assert.equal(missing.answer.unknowns.some((item) => item.includes('찾지 못했습니다')), true);
  assert.equal(unsupported.questionType, 'unsupported');
  assert.equal(unsupported.answer.confidence, 0);
  assert.deepEqual(unsupported.answer.evidenceIds, []);
});
