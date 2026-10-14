import './src/polyfills.ts';
import 'react-native-webgpu';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StatusBar, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import type { TgpuRoot } from 'typegpu';
import { type DebugMode, PAPER, type PoolHandle, type SceneStore, TOKENS, type Theme, initGpu } from '@anatomy/engine';
import { Scene } from './src/blocks/Scene.tsx';
import { retireRoot } from './src/gpuRoot.ts';
import { SCENES } from './src/scenes.tsx';

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
  const [sceneIndex, setSceneIndex] = useState(0);
  const scene = SCENES[sceneIndex]!;
  const storeRef = useRef<SceneStore | null>(null);
  const [view, setView] = useState(0);
  const [paused, setPaused] = useState(false);
  const [debug, setDebug] = useState<DebugMode>(0);
  const controls = useMemo(() => ({ theme, view, paused, debug }), [theme, view, paused, debug]);

  // Dev-only hook for driving the views from a debugger or the browser console.
  useEffect(() => {
    if (!__DEV__) return undefined;
    const g = globalThis as { __v4?: unknown };
    g.__v4 = {
      scenes: SCENES.map((x) => x.name),
      views: scene.views.map((v) => v.name),
      setScene: (name: string) => {
        const index = SCENES.findIndex((x) => x.name === name);
        if (index < 0) {
          throw new Error(`unknown scene ${JSON.stringify(name)}; known: ${SCENES.map((x) => x.name).join(', ')}`);
        }
        setSceneIndex(index);
        setView(0);
      },
      setPoolCount: (id: string, n: number) => {
        const store = storeRef.current;
        if (!store) throw new Error('no scene yet');
        store.pool$(id).count = n;
      },
      store: () => storeRef.current,
      setView: (which: number | string) => {
        const index =
          typeof which === 'number' ? which : scene.views.findIndex((v) => v.name === which);
        if (!scene.views[index]) {
          throw new Error(`unknown view ${JSON.stringify(which)}; known: ${scene.views.map((v) => v.name).join(', ')}`);
        }
        setView(index);
      },
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
      {root && (
        <Scene key={scene.name} root={root} views={scene.views} controls={controls} storeRef={storeRef}>
          <scene.Content />
        </Scene>
      )}
      {error !== null && (
        <View style={styles.center}>
          <Text style={[styles.label, { color: ink }]}>WebGPU unavailable: {error}</Text>
        </View>
      )}
      <View style={[styles.bar, { top: insets.top + 8, right: insets.right + 8 }]}>
        <Chip
          theme={theme}
          label={`Scene: ${scene.name}. Next scene`}
          onPress={() => {
            setSceneIndex((sceneIndex + 1) % SCENES.length);
            setView(0);
          }}
        >
          {scene.name}
        </Chip>
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
  bar: {
    position: 'absolute',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 2,
    maxWidth: '100%',
  },
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
