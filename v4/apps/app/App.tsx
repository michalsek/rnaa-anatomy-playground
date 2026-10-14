import './src/polyfills.ts';
import 'react-native-webgpu';
import { type ReactNode, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Pressable, StatusBar, StyleSheet, Text, View, useColorScheme, useWindowDimensions } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import type { TgpuRoot } from 'typegpu';
import { CARD, type DebugMode, type SceneStore, type Theme, type ViewPreset } from '@anatomy/engine';
import { Scene } from './src/blocks/Scene.tsx';
import { acquireRoot } from './src/gpuRoot.ts';
import { Card } from './src/overlay/Card.tsx';
import { InfoSheet } from './src/overlay/InfoSheet.tsx';
import { overlayLayout } from './src/overlay/layout.ts';
import { SCENES, type SceneEntry } from './src/scenes.tsx';

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
  const win = useWindowDimensions();
  const [sceneIndex, setSceneIndex] = useState(0);
  const scene = SCENES[sceneIndex]!;
  const storeRef = useRef<SceneStore | null>(null);
  // The view by name (resolved by the shell, first view as the fallback), or an ad-hoc preset.
  const [view, setView] = useState<string | ViewPreset>(scene.views[0]?.name ?? 'fit');
  const [paused, setPaused] = useState(false);
  const [debug, setDebug] = useState<DebugMode>(0);
  const [chrome, setChrome] = useState(true);
  // Full-bleed (no card frame or texts) and the 16:9 recording frame: overlays and camera pads
  // only; the stage always fills the window.
  const [bare, setBare] = useState(false);
  const [rec, setRec] = useState(false);
  // The chip bar's width (landscape: the card's top row keeps clear of it).
  const [chipsWidth, setChipsWidth] = useState(0);
  // The "i" sheet (scenes with an `info` caption; never in bare mode).
  const [sheet, setSheet] = useState(false);
  const layout = overlayLayout(win, insets, { bare, chrome, rec });
  const frameKey = JSON.stringify(layout.frame);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const frame = useMemo(() => layout.frame, [frameKey]);
  const controls = useMemo(() => ({ theme, view, paused, debug, frame }), [theme, view, paused, debug, frame]);

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
        setView(SCENES[index]!.views[0]?.name ?? 'fit');
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
      setView: (name: string) => {
        if (!scene.views.some((v) => v.name === name)) {
          throw new Error(`unknown view ${JSON.stringify(name)}; known: ${scene.views.map((v) => v.name).join(', ')}`);
        }
        setView(name);
      },
      setPaused,
      setDebug,
      setTheme: setPicked,
      /** Hide the chip bar for clean captures (overlays and the camera's pads only). */
      setChrome,
      /** Full-bleed: no card frame, texts or sheet (`bare` chip). */
      setBare: (on: boolean) => setBare(!!on),
      /** Open or close the "i" sheet. */
      setSheet: (on: boolean) => setSheet(!!on),
      /** Fit every view into a centred 16:9 rectangle (recordings). */
      record: (on: boolean) => setRec(!!on),
      /** The scene's own hook (the centrifuge: time control, see live.ts). */
      sim: scene.dev,
      /** The factory's reveal: seek(0–1), play(), skip(), restart(), state(). */
      reveal: scene.reveal,
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
  const narrow = layout.narrow;
  const viewIndex = typeof view === 'string' ? Math.max(0, scene.views.findIndex((v) => v.name === view)) : -1;
  const viewName = typeof view === 'string' ? (scene.views[viewIndex]?.name ?? 'fit') : view.name;
  // One card whose text follows the view (the stage never changes with it).
  const card = scene.cardFor ? scene.cardFor(viewName) : scene.card;
  useEffect(() => {
    scene.onView?.(viewName);
  }, [scene, viewName]);
  return (
    <View style={[styles.fill, { backgroundColor: CARD[theme].page }]}>
      <StatusBar barStyle={theme === 'dark' ? 'light-content' : 'dark-content'} />
      {/* The stage fills the window in every mode; only the window resizes it. */}
      <View
        style={StyleSheet.absoluteFill}
        accessible={bare}
        accessibilityRole={bare ? 'image' : undefined}
        accessibilityLabel={bare ? `${card.title}. ${card.label}` : undefined}
      >
        {root && (
          <Scene key={scene.name} root={root} views={scene.views} controls={controls} storeRef={storeRef}>
            {content}
          </Scene>
        )}
      </View>
      {layout.card && (
        <Card
          theme={theme}
          text={card}
          edges={layout.card}
          bands={layout.bands}
          landscape={layout.landscape}
          reserveRight={layout.landscape && chrome ? chipsWidth : 0}
        />
      )}
      {sheet && !bare && scene.info && (
        <InfoSheet
          theme={theme}
          caption={scene.info.caption}
          legend={scene.info.legend}
          top={layout.chips.top + 48}
          right={layout.chips.right + 4}
          onClose={() => setSheet(false)}
        />
      )}
      {error !== null && (
        <View style={styles.center}>
          <Text style={[styles.label, { color: ink }]}>WebGPU unavailable: {error}</Text>
        </View>
      )}
      <View
        onLayout={(e) => setChipsWidth(Math.ceil(e.nativeEvent.layout.width))}
        style={[styles.bar, { top: layout.chips.top, right: layout.chips.right }, !chrome && styles.hidden]}
      >
        <Chip
          compact={narrow}
          theme={theme}
          label={`Scene: ${scene.name}. Next scene`}
          onPress={() => {
            const next = (sceneIndex + 1) % SCENES.length;
            setSceneIndex(next);
            setView(SCENES[next]!.views[0]?.name ?? 'fit');
          }}
        >
          {scene.name}
        </Chip>
        <Chip
          compact={narrow}
          theme={theme}
          label={`View: ${viewName}. Next view`}
          onPress={() => setView(scene.views[(viewIndex + 1) % scene.views.length]?.name ?? 'fit')}
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
        {scene.reveal && <RevealChip reveal={scene.reveal} compact={narrow} theme={theme} />}
        {scene.info && !bare && (
          <Chip compact={narrow} theme={theme} label={sheet ? 'Close the figure notes' : 'About this figure'} onPress={() => setSheet(!sheet)}>
            i
          </Chip>
        )}
        <Chip
          compact={narrow}
          theme={theme}
          label={bare ? 'Full-bleed. Show the card' : 'Card. Go full-bleed'}
          onPress={() => setBare(!bare)}
        >
          {bare ? 'bare' : 'card'}
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

/** Open or close the phone (the factory's reveal and conceal); follows the reveal's state. */
function RevealChip({ reveal, compact, theme }: { reveal: NonNullable<SceneEntry['reveal']>; compact: boolean; theme: Theme }) {
  useSyncExternalStore(reveal.subscribe, reveal.getSnapshot, reveal.getSnapshot);
  const open = reveal.opening;
  return (
    <Chip compact={compact} theme={theme} label={open ? 'Close the phone' : 'Open the phone'} onPress={() => (open ? reveal.conceal() : reveal.reveal())}>
      {open ? 'conceal' : 'reveal'}
    </Chip>
  );
}

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
