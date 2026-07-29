process.env.PLC_CODEX_REQUIREMENT_NORMALIZER ||= 'app-server';
process.env.PLC_CODEX_MODEL ||= 'gpt-5.5';
process.env.PLC_CODEX_REASONING_EFFORT ||= 'low';
process.env.PLC_CODEX_TIMEOUT_MS ||= '60000';

const { startServer } = await import('./beginnerServer.js');

startServer();
