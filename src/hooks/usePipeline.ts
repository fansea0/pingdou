import { useCallback, useEffect, useRef, useState } from 'react';
import { useThrottle } from './useThrottle';
import { Pipeline } from '@/pipeline/pipeline';
import type {
  ColorBudgetLevel,
  Palette,
  ProcessParams,
  PipelineResult,
  SampleMode,
  UIStatus,
} from '@/types';

export function usePipeline(palette: Palette | null) {
  const pipelineRef = useRef<Pipeline | null>(null);
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [status, setStatus] = useState<UIStatus>('idle');
  const [error, setError] = useState<Error | null>(null);
  const srcRef = useRef<ImageData | null>(null);
  const settingsRef = useRef({
    removeBackground: false,
    simplifyColors: false,
    tightCrop: true,
    colorBudget: 'standard' as ColorBudgetLevel,
    sampleMode: 'gradient' as SampleMode,
  });

  useEffect(() => {
    if (!palette) return;
    pipelineRef.current = new Pipeline();
    pipelineRef.current.init(palette);
  }, [palette]);

  const throttledProcess = useThrottle(async (src: ImageData, params: ProcessParams) => {
    if (!pipelineRef.current) return;
    try {
      settingsRef.current = {
        removeBackground: params.removeBackground,
        simplifyColors: params.simplifyColors,
        tightCrop: params.tightCrop,
        colorBudget: params.colorBudget,
        sampleMode: params.sampleMode,
      };
      await pipelineRef.current.process(src, params, setStatus, setResult);
      setError(null);
    } catch (e) {
      setError(e as Error);
    }
  }, 200);

  const process = useCallback((src: ImageData, params: ProcessParams) => {
    srcRef.current = src;
    settingsRef.current = {
      removeBackground: params.removeBackground,
      simplifyColors: params.simplifyColors,
      tightCrop: params.tightCrop,
      colorBudget: params.colorBudget,
      sampleMode: params.sampleMode,
    };
    return throttledProcess(src, params);
  }, [throttledProcess]);

  const reprocess = useCallback((params: ProcessParams) => {
    if (srcRef.current) {
      settingsRef.current = {
        removeBackground: params.removeBackground,
        simplifyColors: params.simplifyColors,
        tightCrop: params.tightCrop,
        colorBudget: params.colorBudget,
        sampleMode: params.sampleMode,
      };
      throttledProcess(srcRef.current, params);
    }
  }, [throttledProcess]);

  // 水印不是图案参数（不进 settingsRef）：它由调用点在导出那一刻显式传入，
  // 因此切换开关不会触发任何重算。
  const exportMulti = useCallback(async (
    exportCellPx: number,
    selectedGridSize: number,
    extraGridSizes: number[],
    watermark: boolean
  ) => {
    if (!pipelineRef.current || !result || !srcRef.current) return null;
    setStatus('exporting');
    try {
      const out = await pipelineRef.current.exportMulti(
        srcRef.current,
        exportCellPx,
        selectedGridSize,
        extraGridSizes,
        settingsRef.current.removeBackground,
        settingsRef.current.simplifyColors,
        settingsRef.current.tightCrop,
        settingsRef.current.colorBudget,
        settingsRef.current.sampleMode,
        watermark
      );
      return out;
    } finally {
      setStatus('ready');
    }
  }, [result]);

  return { status, result, error, process, reprocess, exportMulti };
}
