export const WINDOWS_CSV_FIXTURE = {
  filename: '../설비 검토 (Line A):2026?.CSV',
  expectedFilename: '설비 검토 (Line A)-2026.csv',
  rows: [
    ['번호', '명령', '설명'],
    [1, 'LD X0', '한글, English'],
    [2, 'OUT Y20', '따옴표 "확인"'],
    [3, 'END', '첫 줄\n둘째 줄']
  ],
  expectedText:
    '번호,명령,설명\r\n' +
    '1,LD X0,"한글, English"\r\n' +
    '2,OUT Y20,"따옴표 ""확인"""\r\n' +
    '3,END,"첫 줄\r\n둘째 줄"'
};

export function createLargeWindowsCsvRows(count = 20_000) {
  return [
    ['번호', '명령', '설명'],
    ...Array.from({ length: count }, (_, index) => [
      index + 1,
      `OUT Y${String(index).padStart(5, '0')}`,
      `대용량 fixture ${index}, "손실 없음"\n재검토`
    ])
  ];
}
