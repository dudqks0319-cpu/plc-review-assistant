import { spawn } from 'node:child_process';
import readline from 'node:readline';

const DEFAULT_TIMEOUT_MS = 20_000;

function parseJsonBlock(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) {
    return null;
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : trimmed;
  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  if (firstBrace < 0 || lastBrace < firstBrace) {
    return null;
  }

  return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
}

function buildPrompt({ requestText, vendor, analysis }) {
  const compactAnalysis = {
    vendor,
    blocks: analysis?.project?.blocks?.slice(0, 40) || [],
    variables: analysis?.project?.variables?.slice(0, 120) || [],
    ioAddresses: analysis?.project?.ioAddresses?.slice(0, 120) || [],
    findings: analysis?.findings?.slice(0, 40) || []
  };

  return [
    'You normalize natural-language PLC circuit change requests into strict JSON.',
    'Do not generate PLC code. Do not approve a patch. Do not bypass safety logic.',
    'Return only JSON with this shape:',
    '{',
    '  "targetBehavior": "",',
    '  "targetOutput": { "name": "", "address": "", "confidence": 0 },',
    '  "delaySeconds": 0,',
    '  "startConditions": [],',
    '  "stopConditions": [],',
    '  "priorityRules": [],',
    '  "safetyNotes": [],',
    '  "uncertainties": []',
    '}',
    '',
    `Vendor: ${vendor}`,
    `User request: ${requestText}`,
    `PLC analysis JSON: ${JSON.stringify(compactAnalysis)}`
  ].join('\n');
}

export async function normalizeRequirementWithCodexAppServer({ analysis, vendor, requestText, env = process.env }) {
  const codexBin = env.PLC_CODEX_BIN || 'codex';
  const timeoutMs = Number(env.PLC_CODEX_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);

  return await new Promise((resolve, reject) => {
    const proc = spawn(codexBin, ['app-server'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        CODEX_ACCESS_TOKEN: env.CODEX_ACCESS_TOKEN || process.env.CODEX_ACCESS_TOKEN || ''
      }
    });
    const rl = readline.createInterface({ input: proc.stdout });
    const stderrChunks = [];
    const deltas = [];
    let nextId = 0;
    let threadId = null;
    let settled = false;

    const finish = (error, value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      rl.close();
      proc.kill();
      if (error) {
        reject(error);
        return;
      }
      resolve(value);
    };

    const timer = setTimeout(() => {
      finish(new Error('Codex app-server normalization timed out'));
    }, timeoutMs);

    const send = (method, params = {}, id = undefined) => {
      const message = id === undefined ? { method, params } : { method, id, params };
      proc.stdin.write(`${JSON.stringify(message)}\n`);
    };

    proc.stderr.on('data', (chunk) => {
      stderrChunks.push(chunk.toString('utf8'));
    });

    proc.on('error', (error) => {
      finish(error);
    });

    proc.on('exit', (code) => {
      if (!settled && code !== 0) {
        finish(new Error(`Codex app-server exited with code ${code}: ${stderrChunks.join('').slice(0, 500)}`));
      }
    });

    rl.on('line', (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }

      if (message.id === 0 && message.result) {
        send('initialized');
        send(
          'thread/start',
          env.PLC_CODEX_MODEL ? { model: env.PLC_CODEX_MODEL } : {},
          ++nextId
        );
        return;
      }

      if (message.id === 1 && message.result?.thread?.id) {
        threadId = message.result.thread.id;
        send(
          'turn/start',
          {
            threadId,
            input: [{ type: 'text', text: buildPrompt({ analysis, vendor, requestText }) }]
          },
          ++nextId
        );
        return;
      }

      if (message.method === 'item/agentMessage/delta' && typeof message.params?.delta === 'string') {
        deltas.push(message.params.delta);
        return;
      }

      if (message.method === 'turn/completed') {
        try {
          const parsed = parseJsonBlock(deltas.join(''));
          if (!parsed) {
            finish(new Error('Codex app-server did not return JSON'));
            return;
          }
          finish(null, {
            source: 'codex-app-server',
            requirement: parsed
          });
        } catch (error) {
          finish(error);
        }
      }
    });

    send('initialize', {
      clientInfo: {
        name: 'plc_review_assistant',
        title: 'PLC Review Assistant',
        version: '0.1.0'
      }
    }, nextId);
  });
}
