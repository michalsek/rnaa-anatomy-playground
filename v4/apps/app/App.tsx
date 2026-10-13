import './src/polyfills.ts';
import 'react-native-webgpu';
import { useEffect, useState } from 'react';
import { Pressable, StatusBar, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import type { TgpuRoot } from 'typegpu';
import { PAPER, TOKENS, type Theme, initGpu } from '@anatomy/engine';
import { Stage } from './src/Stage.tsx';

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

  const [root, setRoot] = useState<TgpuRoot | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    let created: TgpuRoot | null = null;
    initGpu().then(
      (next) => {
        if (disposed) {
          next.destroy();
          return;
        }
        created = next;
        setRoot(next);
      },
      (err: unknown) => !disposed && setError(err instanceof Error ? err.message : String(err)),
    );
    return () => {
      disposed = true;
      // Unmount the stage first; the device it used is destroyed with the root.
      setRoot(null);
      created?.destroy();
    };
  }, []);

  const ink = TOKENS[theme].steel.hi;
  return (
    <View style={[styles.fill, { backgroundColor: PAPER[theme] }]}>
      <StatusBar barStyle={theme === 'dark' ? 'light-content' : 'dark-content'} />
      {root && <Stage root={root} theme={theme} />}
      {error !== null && (
        <View style={styles.center}>
          <Text style={[styles.label, { color: ink }]}>WebGPU unavailable: {error}</Text>
        </View>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Theme: ${theme}. Switch to ${theme === 'dark' ? 'light' : 'dark'}`}
        onPress={() => setPicked(theme === 'dark' ? 'light' : 'dark')}
        style={({ pressed }) => [
          styles.toggle,
          { top: insets.top + 8, right: insets.right + 8 },
          pressed && { backgroundColor: TOKENS[theme].steel.s0 },
        ]}
      >
        {({ pressed }) => (
          <View style={[styles.chip, { borderColor: ink, opacity: pressed ? 0.6 : 1 }]}>
            <Text style={[styles.label, { color: ink }]}>{theme}</Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  // The pressable is the 44 pt hit area; the visible chip sits centred inside it.
  toggle: {
    position: 'absolute',
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
