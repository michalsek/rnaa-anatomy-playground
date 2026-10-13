// Adapted from BoneTideOSS (MIT, Konrad Reczko), `GameScreen.tsx`: configure the WebGPU context
// once there is a layout, start the shell, and forward later layouts as resizes.
import { useCallback, useEffect, useRef, useState } from 'react';
import { type LayoutChangeEvent, PixelRatio, StyleSheet, Text, View } from 'react-native';
import { Canvas, type CanvasRef } from 'react-native-webgpu';
import type { TgpuRoot } from 'typegpu';
import type { CanvasContext, Theme } from '@anatomy/engine';
import { type Shell, type ShellSize, createShell } from './shell/createShell.ts';

export function Stage({ root, theme }: { root: TgpuRoot; theme: Theme }) {
  const canvasRef = useRef<CanvasRef>(null);
  const shellRef = useRef<Shell | null>(null);
  const themeRef = useRef(theme);
  // The latest layout lives in a ref (resizes must not restart the shell); `hasLayout` only
  // gates the first start.
  const layoutRef = useRef<ShellSize | null>(null);
  const [hasLayout, setHasLayout] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    const size = { width, height, dpr: PixelRatio.get() };
    layoutRef.current = size;
    shellRef.current?.resize(size.width, size.height, size.dpr);
    setHasLayout(true);
  }, []);

  // Runs again on a new root and on Fast Refresh (which re-runs effects), so the shell is
  // always rebuilt from the current code and device.
  useEffect(() => {
    const size = layoutRef.current;
    const canvas = canvasRef.current;
    if (!hasLayout || !size || !canvas) return undefined;
    setFatal(null);
    let shell: Shell;
    try {
      const context: CanvasContext | null = canvas.getContext('webgpu');
      if (!context) throw new Error('No WebGPU canvas context.');
      const format = navigator.gpu.getPreferredCanvasFormat();
      context.configure({ device: root.device, format, alphaMode: 'opaque' });
      shell = createShell(root, context, context.canvas, format, size, themeRef.current, setFatal);
    } catch (err) {
      setFatal(err instanceof Error ? err.message : String(err));
      return undefined;
    }
    shellRef.current = shell;
    return () => {
      shell.stop();
      if (shellRef.current === shell) shellRef.current = null;
    };
  }, [root, hasLayout]);

  useEffect(() => {
    themeRef.current = theme;
    shellRef.current?.setTheme(theme);
  }, [theme]);

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
