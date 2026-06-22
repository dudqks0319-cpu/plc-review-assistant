# PLC Review Assistant Agent Rules

## Product Direction

This product assists PLC engineers with static review and candidate change planning for Siemens and Mitsubishi PLC export files.

It must never directly modify a live PLC, bypass protected blocks, remove safety logic, or claim that simulated results guarantee field behavior.

## Supported Scope

- Siemens TIA Portal XML/SCL exports
- Mitsubishi GX Works/GX Developer CSV/TXT/listing exports
- Static analysis
- Candidate patch generation
- Expected behavior explanation
- Offline simulator scenario suggestions
- Engineer approval workflow

## Hard Safety Rules

Never generate code or instructions that:

- bypass emergency stop
- disable safety interlocks
- remove guard door, light curtain, STO, overload, or safety relay conditions
- decrypt or bypass protected blocks
- write directly to a PLC
- connect to a live PLC
- claim field behavior is guaranteed

When a request touches safety, return a blocked/high-risk result and require review by:

- safety engineer
- PLC engineer
- site owner

## Architecture Rules

Use this pipeline:

1. Parse vendor export.
2. Normalize to project model.
3. Run deterministic static rules.
4. Use Codex only to normalize ambiguous natural-language requirements.
5. Validate with deterministic safety rules.
6. Generate candidate patch artifacts.
7. Run built-in harness.
8. Return report and approval requirements.

Codex output must not be trusted directly. All Codex output must be validated before producing candidate patches.
