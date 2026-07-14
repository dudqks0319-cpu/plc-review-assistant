import assert from 'node:assert/strict';
import test from 'node:test';
import { extractCompletedAgentMessage } from '../src/backend/codexAppServerClient.js';

test('extractCompletedAgentMessage reads completed agent items', () => {
  const text = extractCompletedAgentMessage({
    method: 'item/completed',
    params: {
      item: {
        type: 'agentMessage',
        text: '{"targetBehavior":"self holding"}'
      }
    }
  });

  assert.equal(text, '{"targetBehavior":"self holding"}');
});

test('extractCompletedAgentMessage reads agent text from completed turns', () => {
  const text = extractCompletedAgentMessage({
    method: 'turn/completed',
    params: {
      turn: {
        items: [
          { type: 'reasoning', text: 'ignored' },
          { type: 'agentMessage', text: '{"targetBehavior":"elevator"}' }
        ]
      }
    }
  });

  assert.equal(text, '{"targetBehavior":"elevator"}');
});
