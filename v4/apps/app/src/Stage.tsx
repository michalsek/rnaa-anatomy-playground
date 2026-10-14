// Adapted from BoneTideOSS (MIT, Konrad Reczko), `GameScreen.tsx`: configure the WebGPU context
// once there is a layout, start the shell, and forward later layouts as resizes.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, type GestureResponderEvent, type LayoutChangeEvent, PanResponder, PixelRatio, Platform, StyleSheet, Text, View } from 'react-native';
import { Canvas, type CanvasRef } from 'react-native-webgpu';
import type { TgpuRoot } from 'typegpu';
import type { CanvasContext, SceneStore, ViewPreset } from '@anatomy/engine';
import {
  type Shell,
  type ShellControls,
  type ShellSize,
  createShell,
} from './shell/createShell.ts';
import { type Point, createGestures } from './shell/gestures.ts';

declare const __DEV__: boolean;

export function Stage({
  root,
  store,
  views,
  controls,
  onCameraInput,
}: {
  root: TgpuRoot;
  store: SceneStore;
  views: readonly ViewPreset[];
  controls: ShellControls;
  /** The user moved the camera (the tour stops). */
  onCameraInput?: (() => void) | undefined;
}) {
  const canvasRef = useRef<CanvasRef>(null);
  const shellRef = useRef<Shell | null>(null);
  // The shell starts from the latest controls; later changes go through the setters below.
  const controlsRef = useRef(controls);
  // The view list goes to the shell through a ref: an edited list re-applies the view without
  // restarting the shell.
  const viewsRef = useRef(views);
  useEffect(() => {
    controlsRef.current = controls;
    viewsRef.current = views;
  });
  // The latest layout lives in a ref (resizes must not restart the shell); `hasLayout` only
  // gates the first start.
  const layoutRef = useRef<ShellSize | null>(null);
  const [hasLayout, setHasLayout] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    const size = { width, height, dpr: PixelRatio.get() };
    if (__DEV__) {
      const w = Dimensions.get('window');
      console.log(`[stage] layout ${width.toFixed(1)}×${height.toFixed(1)} @${size.dpr} (window ${w.width}×${w.height})`);
    }
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
    let context: CanvasContext | null = null;
    try {
      context = canvas.getContext('webgpu');
      if (!context) throw new Error('No WebGPU canvas context.');
      const format = navigator.gpu.getPreferredCanvasFormat();
      context.configure({ device: root.device, format, alphaMode: 'opaque' });
      shell = createShell(
        root,
        context,
        context.canvas,
        format,
        size,
        store,
        () => viewsRef.current,
        controlsRef.current,
        setFatal,
      );
    } catch (err) {
      setFatal(err instanceof Error ? err.message : String(err));
      return undefined;
    }
    shellRef.current = shell;
    const ctx = context;
    const probe = globalThis as { __v4sizes?: () => object; __v4cam?: object };
    const sizes = () => ({
      window: Dimensions.get('window'),
      stage: layoutRef.current,
      canvas: { width: ctx.canvas.width, height: ctx.canvas.height },
      // What the shell's last frame drew into (asking the context here would hand out a texture
      // outside the frame loop).
      texture: shell.texture(),
    });
    // Rotation diagnosis (M7 review): JS window and stage sizes against the canvas and the texture.
    if (__DEV__) probe.__v4sizes = sizes;
    // The free camera (M11; scripts, M12): get(), set(state, ease?), ref() (the fit zoom), reset().
    const cam = {
      get: () => shell.camera(),
      set: (state: Parameters<Shell['setCamera']>[0], ease = false) => shell.setCamera(state, { ease }),
      ref: () => shell.refZoom(),
      reset: () => shell.resetView(),
    };
    if (__DEV__) probe.__v4cam = cam;
    return () => {
      shell.stop();
      if (shellRef.current === shell) shellRef.current = null;
      if (probe.__v4sizes === sizes) delete probe.__v4sizes;
      if (probe.__v4cam === cam) delete probe.__v4cam;
    };
  }, [root, hasLayout, store]);

  // Orbit, pan, zoom, double tap (M11): a PanResponder on the stage; on web also the wheel and
  // the shift key (shift-drag pans).
  const inputRef = useRef(onCameraInput);
  useEffect(() => {
    inputRef.current = onCameraInput;
  });
  // The touch pad over the canvas: an RN view takes several touches at once (the WebGPU canvas's
  // native view on iOS passes on only the first, so a pinch never reached the responder).
  const padRef = useRef<View>(null);
  const gestures = useMemo(
    () =>
      createGestures({
        target: () => shellRef.current,
        size: () => layoutRef.current ?? { width: 1, height: 1 },
        onInput: () => inputRef.current?.(),
      }),
    [],
  );
  const responder = useMemo(() => {
    const points = (e: GestureResponderEvent): Point[] => {
      const ts = e.nativeEvent.touches;
      if (ts && ts.length > 0) return Array.from(ts, (t) => ({ x: t.pageX, y: t.pageY }));
      return [{ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY }];
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => gestures.start(points(e)),
      onPanResponderMove: (e, g) => gestures.move(points(e), { x: g.dx, y: g.dy }),
      onPanResponderRelease: (e) => gestures.end({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY }, Date.now()),
      onPanResponderTerminate: () => gestures.end(null, Date.now()),
    });
  }, [gestures]);
  useEffect(() => {
    if (Platform.OS !== 'web') return undefined;
    const w = globalThis as unknown as { addEventListener: typeof window.addEventListener; removeEventListener: typeof window.removeEventListener };
    const onWheel = (e: WheelEvent) => {
      // Only over the stage (not the chips or the sheet).
      const pad = padRef.current as unknown as Node | null;
      if (!pad || !(e.target instanceof Node) || !pad.contains(e.target)) return;
      e.preventDefault();
      gestures.wheel(e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY, { x: e.clientX, y: e.clientY });
    };
    const onKey = (e: KeyboardEvent) => gestures.setShift(e.shiftKey);
    w.addEventListener('wheel', onWheel, { passive: false });
    w.addEventListener('keydown', onKey);
    w.addEventListener('keyup', onKey);
    return () => {
      w.removeEventListener('wheel', onWheel);
      w.removeEventListener('keydown', onKey);
      w.removeEventListener('keyup', onKey);
    };
  }, [gestures]);

  const { theme, view, paused, debug, frame } = controls;
  const frameKey = JSON.stringify(frame);
  useEffect(() => shellRef.current?.setTheme(theme), [theme]);
  // View changes ease (the first view of a shell cuts: it starts from it).
  useEffect(() => shellRef.current?.setView(view, { ease: true }), [view]);
  useEffect(() => shellRef.current?.refreshView(), [views]);
  useEffect(() => shellRef.current?.setPaused(paused), [paused]);
  useEffect(() => shellRef.current?.setDebug(debug), [debug]);
  // By value: a new object with the same pads doesn't refit.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => shellRef.current?.setFrame(frame), [frameKey]);

  return (
    <View style={styles.fill}>
      <Canvas ref={canvasRef} style={styles.fill} onLayout={onLayout} />
      <View ref={padRef} style={StyleSheet.absoluteFill} {...responder.panHandlers} />
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
