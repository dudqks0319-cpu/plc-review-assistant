import { createHash } from 'node:crypto';
import { getCpuProfile } from './cpuProfiles.js';

const DEVICE_PATTERN = /^(ZR|SD|SM|X|Y|M|L|B|D|W|R|T|C|Z)([0-9A-F]+)(?:\.(\d+))?$/i;
const INDIRECT_PATTERN = /^(ZR|SD|SM|X|Y|M|L|B|D|W|R|T|C|Z)\[([^\]]+)\]$/i;

function deviceRole(deviceType) {
  if (deviceType === 'X') return 'input';
  if (deviceType === 'Y') return 'output';
  if (deviceType === 'T') return 'timer';
  if (deviceType === 'C') return 'counter';
  if (deviceType === 'SM' || deviceType === 'SD') return 'special';
  if (['M', 'L', 'B', 'D', 'W', 'R', 'ZR', 'Z'].includes(deviceType)) return 'internal';
  return 'unknown';
}

function buildDeviceId(profileId, canonicalAddress) {
  const digest = createHash('sha256')
    .update(`${profileId || 'unknown'}|${canonicalAddress}`)
    .digest('hex')
    .slice(0, 16);
  return `device-${digest}`;
}

function unknownResult(rawAddress, deviceType = '', displayPart = '') {
  const canonicalAddress = String(rawAddress || '').trim().toUpperCase();
  return {
    id: buildDeviceId(null, canonicalAddress),
    rawAddress: String(rawAddress || ''),
    canonical: canonicalAddress,
    canonicalAddress,
    deviceType,
    displayPart,
    numericPart: null,
    bitIndex: null,
    radix: 'unknown',
    role: deviceRole(deviceType),
    valid: null,
    profileStatus: 'unknown-profile',
    indirect: false
  };
}

export function parseDeviceAddress(rawAddress, profileOrId) {
  const raw = String(rawAddress || '').trim();
  const canonicalAddress = raw.toUpperCase();
  const indirectMatch = canonicalAddress.match(INDIRECT_PATTERN);
  if (indirectMatch) {
    const [, deviceType, expression] = indirectMatch;
    return {
      ...unknownResult(raw, deviceType, expression),
      id: buildDeviceId(getCpuProfile(profileOrId)?.id, canonicalAddress),
      profileStatus: 'unknown-device',
      indirect: true,
      indirectExpression: expression
    };
  }

  const match = canonicalAddress.match(DEVICE_PATTERN);
  if (!match) {
    return {
      ...unknownResult(raw),
      profileStatus: 'unknown-device'
    };
  }

  const [, deviceType, displayPart, bitPart] = match;
  const cpuProfile = getCpuProfile(profileOrId);
  if (!cpuProfile) {
    return unknownResult(raw, deviceType, displayPart);
  }

  const radix = cpuProfile.addressRadixByDevice?.[deviceType] ?? 'unknown';
  if (radix === 'unknown' || radix === 'mixed') {
    return {
      ...unknownResult(raw, deviceType, displayPart),
      id: buildDeviceId(cpuProfile.id, canonicalAddress),
      radix,
      profileStatus: 'unknown-profile'
    };
  }

  const validDigits = {
    8: /^[0-7]+$/,
    10: /^\d+$/,
    16: /^[0-9A-F]+$/
  }[radix];
  const valid = validDigits.test(displayPart);
  const numericPart = valid ? Number.parseInt(displayPart, radix) : null;

  return {
    id: buildDeviceId(cpuProfile.id, canonicalAddress),
    rawAddress: raw,
    canonical: canonicalAddress,
    canonicalAddress,
    deviceType,
    displayPart,
    numericPart,
    bitIndex: bitPart === undefined ? null : Number.parseInt(bitPart, 10),
    radix,
    role: deviceRole(deviceType),
    valid,
    profileStatus: valid ? 'valid' : 'invalid-radix',
    indirect: false
  };
}

export function nextDeviceAddress(deviceOrAddress, profileOrId) {
  const cpuProfile = getCpuProfile(profileOrId);
  const parsed =
    deviceOrAddress && typeof deviceOrAddress === 'object'
      ? deviceOrAddress
      : parseDeviceAddress(deviceOrAddress, cpuProfile);

  if (!cpuProfile || parsed.valid !== true || typeof parsed.numericPart !== 'number') {
    return {
      ...parsed,
      valid: null,
      profileStatus: cpuProfile ? parsed.profileStatus : 'unknown-profile'
    };
  }

  const nextDisplayPart = (parsed.numericPart + 1).toString(parsed.radix).toUpperCase();
  return parseDeviceAddress(`${parsed.deviceType}${nextDisplayPart}`, cpuProfile);
}

export function calculateTimerDuration({ timerAddress, preset, cpuProfile: profileOrId }) {
  const cpuProfile = getCpuProfile(profileOrId);
  if (!cpuProfile) {
    return {
      status: 'unknown',
      seconds: null,
      reason: 'CPU_PROFILE_REQUIRED'
    };
  }

  const timer = typeof timerAddress === 'string' ? parseDeviceAddress(timerAddress, cpuProfile) : timerAddress;
  const presetMatch = String(preset || '').trim().toUpperCase().match(/^K(\d+)$/);
  const timerProfile = cpuProfile.timerProfiles.find(
    (item) =>
      item.status === 'verified' &&
      item.deviceType === timer?.deviceType &&
      typeof item.secondsPerUnit === 'number' &&
      (item.start === undefined || timer.numericPart >= item.start) &&
      (item.end === undefined || timer.numericPart <= item.end)
  );

  if (!timerProfile || !presetMatch) {
    return {
      status: 'unknown',
      seconds: null,
      reason: 'TIMER_PROFILE_UNVERIFIED'
    };
  }

  return {
    status: 'exact',
    seconds: Number(presetMatch[1]) * timerProfile.secondsPerUnit,
    reason: null
  };
}

export { getCpuProfile };
