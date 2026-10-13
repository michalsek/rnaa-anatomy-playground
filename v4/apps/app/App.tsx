import './src/polyfills.ts';
import 'react-native-webgpu';
import { useEffect, useState } from 'react';
import { Pressable, StatusBar, StyleSheet, Text, View, useColorScheme } from 'react-native';
import type { TgpuRoot } from 'typegpu';
import { PAPER, TOKENS, type Theme, initGpu } from '@anatomy/engine';
import { Stage } from './src/Stage.tsx';

export default function App() {
  const system: Theme = useColorScheme() === 'dark' ? 'dark' : 'light';
  // null = follow the system scheme until the user picks one.
  const [picked, setPicked] = useState<Theme | null>(null);
  const theme = picked ?? system;

  const [root, setRoot] = useState<TgpuRoot | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    initGpu().then(
      (created) => (disposed ? created.destroy() : setRoot(created)),
      (err: unknown) => !disposed && setError(err instanceof Error ? err.message : String(err)),
    );
    return () => {
      disposed = true;
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
        style={[styles.toggle, { borderColor: ink }]}
      >
        <Text style={[styles.label, { color: ink }]}>{theme === 'dark' ? 'dark' : 'light'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  toggle: {
    position: 'absolute',
    top: 56,
    right: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 4,
  },
  label: { fontFamily: 'Menlo', fontSize: 12, letterSpacing: 1 },
});
