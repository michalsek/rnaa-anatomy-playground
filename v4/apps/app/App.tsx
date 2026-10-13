import './src/polyfills.ts';
import 'react-native-webgpu';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Pressable, StatusBar, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import type { TgpuRoot } from 'typegpu';
import { type DebugMode, PAPER, TOKENS, type Theme, initGpu, m1Scene } from '@anatomy/engine';
import { Stage } from './src/Stage.tsx';
import { retireRoot } from './src/gpuRoot.ts';

export default function App() {
  return (
    <SafeAreaProvider>
      <Main />
    </SafeAreaProvider>
  );
}

function Main() {
  const system: Theme = useColorScheme() === 'dark' ? 'dark' : 'light';
  // null = follow the system scheme until the user picks one.
  const [picked, setPicked] = useState<Theme | null>(null);
  const theme = picked ?? system;
  const insets = useSafeAreaInsets();
  const scene = useMemo(() => m1Scene(), []);
  const [view, setView] = useState(0);
  const [paused, setPaused] = useState(false);
  const [debug, setDebug] = useState<DebugMode>(0);
  const controls = useMemo(() => ({ theme, view, paused, debug }), [theme, view, paused, debug]);

  // Dev-only hook for driving the views from a debugger or the browser console.
  useEffect(() => {
    if (!__DEV__) return undefined;
    const g = globalThis as { __v4?: unknown };
    g.__v4 = {
      views: scene.views.map((v) => v.name),
      setView: (which: number | string) =>
        setView(typeof which === 'number' ? which : scene.views.findIndex((v) => v.name === which)),
      setPaused,
      setDebug,
      setTheme: setPicked,
    };
    return () => {
      delete g.__v4;
    };
  }, [scene]);

  const [root, setRoot] = useState<TgpuRoot | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    let created: TgpuRoot | null = null;
    initGpu().then(
      (next) => {
        if (disposed) {
          retireRoot(next);
          return;
        }
        created = next;
        setRoot(next);
      },
      (err: unknown) => !disposed && setError(err instanceof Error ? err.message : String(err)),
    );
    return () => {
      disposed = true;
      setRoot(null);
      if (created) retireRoot(created);
    };
  }, []);

  const ink = TOKENS[theme].steel.hi;
  return (
    <View style={[styles.fill, { backgroundColor: PAPER[theme] }]}>
      <StatusBar barStyle={theme === 'dark' ? 'light-content' : 'dark-content'} />
      {root && <Stage root={root} scene={scene} controls={controls} />}
      {error !== null && (
        <View style={styles.center}>
          <Text style={[styles.label, { color: ink }]}>WebGPU unavailable: {error}</Text>
        </View>
      )}
      <View style={[styles.bar, { top: insets.top + 8, right: insets.right + 8 }]}>
        <Chip
          theme={theme}
          label={`View: ${scene.views[view]?.name}. Next view`}
          onPress={() => setView((view + 1) % scene.views.length)}
        >
          {scene.views[view]?.name ?? 'fit'}
        </Chip>
        <Chip
          theme={theme}
          label={paused ? 'Paused. Resume' : 'Running. Pause'}
          onPress={() => setPaused(!paused)}
        >
          {paused ? 'paused' : 'run'}
        </Chip>
        <Chip
          theme={theme}
          label={`Debug view ${debug}. Next debug view`}
          onPress={() => setDebug(((debug + 1) % 3) as DebugMode)}
        >
          {`dbg ${debug}`}
        </Chip>
        <Chip
          theme={theme}
          label={`Theme: ${theme}. Switch to ${theme === 'dark' ? 'light' : 'dark'}`}
          onPress={() => setPicked(theme === 'dark' ? 'light' : 'dark')}
        >
          {theme}
        </Chip>
      </View>
    </View>
  );
}

declare const __DEV__: boolean;

/** A toolbar button: 44 pt hit area, a hairline chip inside, dimmed while pressed. */
function Chip({
  theme,
  label,
  onPress,
  children,
}: {
  theme: Theme;
  label: string;
  onPress: () => void;
  children: ReactNode;
}) {
  const ink = TOKENS[theme].steel.hi;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.toggle,
        pressed && { backgroundColor: TOKENS[theme].steel.s0 },
      ]}
    >
      {({ pressed }) => (
        <View style={[styles.chip, { borderColor: ink, opacity: pressed ? 0.6 : 1 }]}>
          <Text style={[styles.label, { color: ink }]}>{children}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  bar: { position: 'absolute', flexDirection: 'row', gap: 2 },
  // The pressable is the 44 pt hit area; the visible chip sits centred inside it.
  toggle: {
    minWidth: 44,
    minHeight: 44,
    padding: 4,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 4,
  },
  label: { fontFamily: 'Menlo', fontSize: 12, letterSpacing: 1 },
});
