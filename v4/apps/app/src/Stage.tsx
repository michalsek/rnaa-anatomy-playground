// Adapted from BoneTideOSS (MIT, Konrad Reczko), `GameScreen.tsx`: configure the WebGPU context
// on the first layout, start the shell, and forward later layouts as resizes.
import { useCallback, useEffect, useRef, useState } from 'react';
import { type LayoutChangeEvent, PixelRatio, StyleSheet, Text, View } from 'react-native';
import { Canvas, type CanvasRef } from 'react-native-webgpu';
import type { TgpuRoot } from 'typegpu';
import type { CanvasContext, Theme } from '@anatomy/engine';
import { type CanvasLike, type Shell, createShell } from './shell/createShell.ts';

export function Stage({ root, theme }: { root: TgpuRoot; theme: Theme }) {
  const canvasRef = useRef<CanvasRef>(null);
  const shellRef = useRef<Shell | null>(null);
  const themeRef = useRef(theme);
  const [fatal, setFatal] = useState<string | null>(null);

  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const { width, height } = event.nativeEvent.layout;
      const dpr = PixelRatio.get();
      if (shellRef.current) {
        shellRef.current.resize(width, height, dpr);
        return;
      }
      if (!canvasRef.current) return;
      try {
        const context = canvasRef.current.getContext('webgpu') as CanvasContext | null;
        if (!context) throw new Error('No WebGPU canvas context.');
        const format = navigator.gpu.getPreferredCanvasFormat();
        context.configure({ device: root.device, format, alphaMode: 'opaque' });
        const canvas = (context as unknown as { canvas: CanvasLike }).canvas;
        shellRef.current = createShell(
          root,
          context,
          canvas,
          format,
          { width, height, dpr },
          themeRef.current,
          setFatal,
        );
      } catch (err) {
        setFatal(err instanceof Error ? err.message : String(err));
      }
    },
    [root],
  );

  useEffect(() => {
    themeRef.current = theme;
    shellRef.current?.setTheme(theme);
  }, [theme]);

  useEffect(
    () => () => {
      shellRef.current?.stop();
      shellRef.current = null;
    },
    [],
  );

  return (
    <View style={styles.fill}>
      <Canvas ref={canvasRef} style={styles.fill} onLayout={onLayout} />
      {fatal !== null && (
        <View style={styles.fatal}>
          <Text style={styles.fatalText}>Graphics stopped: {fatal}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  fatal: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', padding: 24 },
  fatalText: { color: '#e5484d', fontFamily: 'Menlo', fontSize: 13, textAlign: 'center' },
});
