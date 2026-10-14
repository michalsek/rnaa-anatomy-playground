/**
 * The figure card (the kit's `.iso-plate`): a framed card on the page with four corner texts
 * (fig, title, hint, readout) in the kit's mono at 10.5 px, and the stage inset inside it so the
 * fit never reaches the corners. The hint and the readout share the bottom row; when they don't
 * fit on one line (the layout decides, no estimate) the readout wraps below the hint. The stage
 * always leaves room for two lines: resizing it after the canvas is up leaves the iOS canvas
 * framed for the old size (notes/M6.md), so its size must not depend on the text.
 */
import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  AccessibilityInfo,
  type LayoutChangeEvent,
  Platform,
  type StyleProp,
  StyleSheet,
  Text,
  type TextStyle,
  View,
} from 'react-native';
import { CARD, MONO, type Theme } from '@anatomy/engine';
import type { CardText } from '../scenes.tsx';
import type { ReadoutSource } from './readout.ts';

const NARROW = 560;
/** The bottom row's distance from the card's bottom edge; room for its two lines above it. */
const BOTTOM = 18;
const ROW_GAP = 6;
const TWO_LINES = BOTTOM + 2 * 10.5 * 1.15 + ROW_GAP + 10;
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
      <View style={styles.row}>
        <Text style={[corner, styles.hint]}>{text.hint.toUpperCase()}</Text>
        {typeof text.readout === 'string' ? (
          <Text style={[corner, styles.readout, { color: ink.text }]}>{text.readout}</Text>
        ) : (
          <LiveReadout source={text.readout} style={[corner, styles.readout, { color: ink.text }]} />
        )}
      </View>
    </View>
  );
}

/**
 * The live readout: the only subscriber to the readout store, so a publish re-renders this leaf
 * alone. The line itself is no live region (it changes up to 10 times a second); a visually
 * hidden phase word is, and iOS announces phase changes.
 */
function LiveReadout({ source, style }: { source: ReadoutSource; style: StyleProp<TextStyle> }) {
  const line = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot);
  const phase = source.getPhase();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(phase);
  }, [phase]);
  return (
    <>
      <Text style={style}>{line}</Text>
      <Text style={styles.offscreen} accessibilityLiveRegion="polite" aria-live="polite">
        {phase}
      </Text>
    </>
  );
}

const styles = StyleSheet.create({
  card: { position: 'absolute', borderWidth: 1 },
  stage: { position: 'absolute' },
  stageWide: { top: 52, right: 24, bottom: TWO_LINES, left: 24 },
  stageNarrow: { top: 48, right: 12, bottom: TWO_LINES, left: 12 },
  corner: { position: 'absolute', fontSize: 10.5, lineHeight: 10.5 * 1.15, letterSpacing: 0.42 },
  fig: { top: 18, left: 20 },
  title: { top: 18, right: 20, letterSpacing: 1.05 },
  // Hint left, readout right; a readout that doesn't fit wraps to the line below (still right).
  row: { position: 'absolute', left: 20, right: 20, bottom: BOTTOM, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', columnGap: 24, rowGap: ROW_GAP },
  hint: { position: 'relative', letterSpacing: 1.05 },
  readout: { position: 'relative', marginLeft: 'auto', fontVariant: ['tabular-nums'] },
  // Visually hidden but still read by assistive tech.
  offscreen: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0, left: 0, bottom: 0 },
});
