import { useCallback, useEffect, useRef, useState } from 'react';
import { useThrottle } from './useThrottle';
import { Pipeline } from '@/pipeline/pipeline';
import type { Palette, ProcessParams, PipelineResult, UIStatus } from '@/types';

export function usePipeline(palette: Palette | null) {
  const pipelineRef = useRef<Pipeline | null>(null);
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [status, setStatus] = useState<UIStatus>('idle');
  const [error, setError] = useState<Error | null>(null);
  const srcRef = useRef<ImageData | null>(null);

  useEffect(() => {
    if (!palette) return;
    pipelineRef.current = new Pipeline();
    pipelineRef.current.init(palette);
  }, [palette]);

  const throttledProcess = useThrottle(async (src: ImageData, params: ProcessParams) => {
    if (!pipelineRef.current) return;
    try {
      await pipelineRef.current.process(src, params, setStatus, setResult);
      setError(null);
    } catch (e) {
      setError(e as Error);
    }
  }, 200);

  const process = useCallback((src: ImageData, params: ProcessParams) => {
    srcRef.current = src;
    return throttledProcess(src, params);
  }, [throttledProcess]);

  const reprocess = useCallback((params: ProcessParams) => {
    if (srcRef.current) throttledProcess(srcRef.current, params);
  }, [throttledProcess]);

  const exportTriptych = useCallback(async (exportCellPx: number) => {
    if (!pipelineRef.current || !result) return;
    setStatus('exporting');
    try {
      await pipelineRef.current.exportAll(result, exportCellPx);
    } finally {
      setStatus('ready');
    }
  }, [result]);

  return { status, result, error, process, reprocess, exportTriptych };
}
