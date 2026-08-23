const ALLOWED_FORMATS = new Set(['markdown', 'excel', 'pdf']);

function normalizeError(error) {
  return error instanceof Error && error.message
    ? error.message
    : '보고서 내보내기에 실패했습니다.';
}

export function createExportWorkflow({ createArtifact, deliverArtifact, onStateChange }) {
  let activeFormat = null;

  function publish(state) {
    onStateChange?.(state);
    return state;
  }

  return {
    isRunning() {
      return activeFormat !== null;
    },

    async run(format) {
      if (!ALLOWED_FORMATS.has(format)) {
        throw new Error('지원하지 않는 보고서 형식입니다.');
      }

      if (activeFormat) {
        return {
          accepted: false,
          ok: false,
          reason: 'busy',
          activeFormat
        };
      }

      activeFormat = format;
      publish({ state: 'running', format });

      try {
        const artifact = await createArtifact(format);
        if (!artifact?.filename || !artifact?.blob || artifact.blob.size <= 0) {
          throw new Error('생성된 보고서 파일이 비어 있습니다. 다시 시도해 주세요.');
        }

        await deliverArtifact(artifact);
        activeFormat = null;
        const completed = publish({
          state: 'complete',
          format,
          filename: artifact.filename,
          sizeBytes: artifact.blob.size,
          location: artifact.location || '브라우저 다운로드 위치'
        });
        return { accepted: true, ok: true, ...completed };
      } catch (error) {
        activeFormat = null;
        const failed = publish({
          state: 'failed',
          format,
          message: normalizeError(error),
          canRetry: true
        });
        return { accepted: true, ok: false, ...failed };
      }
    }
  };
}
