/**
 * The figure card (the kit's `.iso-plate`): a framed card on the page with four corner texts
 * (fig, title, hint, readout) in the kit's mono at 10.5 px, and the stage inset inside it so the
 * fit never reaches the corners. On a narrow card the hint moves up, above the readout.
 */
import { type ReactNode, useState } from 'react';
import { type LayoutChangeEvent, Platform, StyleSheet, Text, View } from 'react-native';
import { CARD, MONO, type Theme } from '@anatomy/engine';
import type { CardText } from '../scenes.tsx';

const NARROW = 560;
const FONT = Platform.OS === 'web' ? MONO.web : MONO.ios;

export function Card({
  theme,
  text,
  inset,
  children,
}: {
  theme: Theme;
  text: CardText;
  /** Card edges from the window (safe areas, chrome). */
  inset: { top: number; right: number; bottom: number; left: number };
  children: ReactNode;
}) {
  const ink = CARD[theme];
  const [width, setWidth] = useState<number | null>(null);
  const narrow = width !== null && width < NARROW;
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  const corner = [styles.corner, { fontFamily: FONT, color: ink.muted }];
  return (
    <View
      onLayout={onLayout}
      style={[styles.card, inset, { backgroundColor: ink.card, borderColor: ink.frame }]}
    >
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={`${text.title}. ${text.label}`}
        style={[styles.stage, narrow ? styles.stageNarrow : styles.stageWide]}
      >
        {children}
      </View>
      <Text style={[corner, styles.fig, { color: ink.text }]}>{text.fig}</Text>
      <Text style={[corner, styles.title]}>{text.title.toUpperCase()}</Text>
      <Text style={[corner, styles.hint, narrow && styles.hintNarrow]}>{text.hint.toUpperCase()}</Text>
      <Text style={[corner, styles.readout, { color: ink.text }]} accessibilityLiveRegion="polite">
        {text.readout}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { position: 'absolute', borderWidth: 1 },
  stage: { position: 'absolute' },
  stageWide: { top: 52, right: 24, bottom: 52, left: 24 },
  stageNarrow: { top: 48, right: 12, bottom: 70, left: 12 },
  corner: { position: 'absolute', fontSize: 10.5, lineHeight: 10.5 * 1.15, letterSpacing: 0.42 },
  fig: { top: 18, left: 20 },
  title: { top: 18, right: 20, letterSpacing: 1.05 },
  hint: { bottom: 18, left: 20, letterSpacing: 1.05 },
  hintNarrow: { bottom: 36 },
  readout: { bottom: 18, right: 20, fontVariant: ['tabular-nums'] },
});
