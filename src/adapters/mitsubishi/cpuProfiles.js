const COMMON_INSTRUCTIONS = Object.freeze([
  'LD',
  'LDI',
  'AND',
  'ANI',
  'OR',
  'ORI',
  'ANB',
  'ORB',
  'MPS',
  'MRD',
  'MPP',
  'OUT',
  'SET',
  'RST',
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
  'DIV',
  'CJ',
  'CALL',
  'RET',
  'FOR',
  'NEXT',
  'END',
  'FEND'
]);

const DECIMAL_DEVICES = Object.freeze({
  M: 10,
  L: 10,
  D: 10,
  R: 10,
  ZR: 10,
  T: 10,
  C: 10,
  SD: 10,
  SM: 10,
  Z: 10
});

export const CPU_PROFILES = Object.freeze({
  'mitsubishi-fx3': Object.freeze({
    id: 'mitsubishi-fx3',
    vendor: 'mitsubishi',
    family: 'MELSEC-F / FX3',
    engineeringTool: 'GX Works2',
    addressRadixByDevice: Object.freeze({ ...DECIMAL_DEVICES, X: 8, Y: 8 }),
    deviceRanges: Object.freeze([]),
    timerProfiles: Object.freeze([
      Object.freeze({
        deviceType: 'T',
        status: 'unknown',
        note: 'The timer base depends on the exact CPU, instruction, and timer number.'
      })
    ]),
    supportedInstructions: COMMON_INSTRUCTIONS,
    reservedDevices: Object.freeze([]),
    sourceReferences: Object.freeze([
      'Mitsubishi MELSEC-F input/output numbering references; exact model ranges require vendor verification.'
    ])
  }),
  'mitsubishi-qcpu': Object.freeze({
    id: 'mitsubishi-qcpu',
    vendor: 'mitsubishi',
    family: 'MELSEC-Q / QCPU',
    engineeringTool: 'GX Works2',
    addressRadixByDevice: Object.freeze({ ...DECIMAL_DEVICES, X: 'unknown', Y: 'unknown' }),
    deviceRanges: Object.freeze([]),
    timerProfiles: Object.freeze([]),
    supportedInstructions: COMMON_INSTRUCTIONS,
    reservedDevices: Object.freeze([]),
    sourceReferences: Object.freeze(['Device ranges and X/Y radix require an exact QCPU model.'])
  }),
  'mitsubishi-lcpu': Object.freeze({
    id: 'mitsubishi-lcpu',
    vendor: 'mitsubishi',
    family: 'MELSEC-L / LCPU',
    engineeringTool: 'GX Works2',
    addressRadixByDevice: Object.freeze({ ...DECIMAL_DEVICES, X: 'unknown', Y: 'unknown' }),
    deviceRanges: Object.freeze([]),
    timerProfiles: Object.freeze([]),
    supportedInstructions: COMMON_INSTRUCTIONS,
    reservedDevices: Object.freeze([]),
    sourceReferences: Object.freeze(['Device ranges and X/Y radix require an exact LCPU model.'])
  })
});

export function getCpuProfile(profileOrId) {
  if (profileOrId && typeof profileOrId === 'object') {
    return profileOrId;
  }

  return CPU_PROFILES[String(profileOrId || '')] || null;
}
