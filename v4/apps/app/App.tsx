import './src/polyfills.ts';
import 'react-native-webgpu';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StatusBar, StyleSheet, Text, View, useColorScheme, useWindowDimensions } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import type { TgpuRoot } from 'typegpu';
import { CARD, type DebugMode, type SceneStore, type Theme, type ViewPreset } from '@anatomy/engine';
import { Scene } from './src/blocks/Scene.tsx';
import { acquireRoot } from './src/gpuRoot.ts';
import { Card } from './src/overlay/Card.tsx';
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
  const { width } = useWindowDimensions();
  const [sceneIndex, setSceneIndex] = useState(0);
  const scene = SCENES[sceneIndex]!;
  const storeRef = useRef<SceneStore | null>(null);
  const [view, setView] = useState<number | ViewPreset>(0);
  const [paused, setPaused] = useState(false);
  const [debug, setDebug] = useState<DebugMode>(0);
  const [chrome, setChrome] = useState(true);
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
      /** An ad-hoc camera: `__v4.look({ focus: [x, y, z], zoom: 4 })` (angles in degrees). */
      look: (p: Partial<ViewPreset>) =>
        setView({ name: 'look', yaw: 45, elevation: 30, zoom: 1, ...p }),
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
      /** Hide the chip bar for clean captures (the card moves up into its place). */
      setChrome,
    };
    return () => {
      delete g.__v4;
    };
  }, [scene]);

  const [root, setRoot] = useState<TgpuRoot | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    acquireRoot().then(
      (next) => live && setRoot(next),
      (err: unknown) => live && setError(err instanceof Error ? err.message : String(err)),
    );
    return () => {
      live = false;
    };
  }, []);

  // A stable element: theme, view or debug toggles re-render the Scene but not the ~175 blocks.
  const content = useMemo(() => <scene.Content />, [scene]);

  const ink = CARD[theme].text;
  const narrow = width < 600;
  const side = narrow ? 8 : 12;
  const inset = {
    top: insets.top + (chrome ? 52 : 12),
    right: insets.right + side,
    bottom: insets.bottom + side,
    left: insets.left + side,
  };
  const viewName = typeof view === 'number' ? (scene.views[view]?.name ?? 'fit') : view.name;
  return (
    <View style={[styles.fill, { backgroundColor: CARD[theme].page }]}>
      <StatusBar barStyle={theme === 'dark' ? 'light-content' : 'dark-content'} />
      <Card theme={theme} text={scene.card} inset={inset}>
        {root && (
          <Scene key={scene.name} root={root} views={scene.views} controls={controls} storeRef={storeRef}>
            {content}
          </Scene>
        )}
      </Card>
      {error !== null && (
        <View style={styles.center}>
          <Text style={[styles.label, { color: ink }]}>WebGPU unavailable: {error}</Text>
        </View>
      )}
      <View style={[styles.bar, { top: insets.top + 4, right: insets.right + side - 4 }, !chrome && styles.hidden]}>
        <Chip
          compact={narrow}
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
          compact={narrow}
          theme={theme}
          label={`View: ${viewName}. Next view`}
          onPress={() => setView(typeof view === 'number' ? (view + 1) % scene.views.length : 0)}
        >
          {viewName}
        </Chip>
        <Chip
          compact={narrow}
          theme={theme}
          label={paused ? 'Paused. Resume' : 'Running. Pause'}
          onPress={() => setPaused(!paused)}
        >
          {paused ? 'paused' : 'run'}
        </Chip>
        <Chip
          compact={narrow}
          theme={theme}
          label={`Debug view ${debug}. Next debug view`}
          onPress={() => setDebug(((debug + 1) % 3) as DebugMode)}
        >
          {`dbg ${debug}`}
        </Chip>
        <Chip
          compact={narrow}
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
  compact,
  children,
}: {
  theme: Theme;
  label: string;
  onPress: () => void;
  /** Phone widths: tighter padding and type, so the five chips fit one row. */
  compact: boolean;
  children: ReactNode;
}) {
  const ink = CARD[theme].text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.toggle,
        pressed && { backgroundColor: CARD[theme].card },
      ]}
    >
      {({ pressed }) => (
        <View style={[styles.chip, compact && styles.chipCompact, { borderColor: ink, opacity: pressed ? 0.6 : 1 }]}>
          <Text style={[styles.label, compact && styles.labelCompact, { color: ink }]}>{children}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  hidden: { display: 'none' },
  bar: {
    position: 'absolute',
    height: 44,
    flexDirection: 'row',
    flexWrap: 'nowrap',
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
  chipCompact: { paddingHorizontal: 7 },
  label: { fontFamily: 'Menlo', fontSize: 12, letterSpacing: 1 },
  labelCompact: { fontSize: 11, letterSpacing: 0.4 },
});
