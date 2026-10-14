/**
 * The figure card (the kit's `.iso-plate`) as an overlay over the window-sized stage: the page
 * colour outside the card, its 1 px frame, and four corner texts (fig, title, hint, readout) in
 * the kit's mono at 10.5 px. Nothing here sizes the stage: the camera keeps the figure clear of
 * the texts through the frame's pads (`layout.ts`). Fig top-left, title top-right (in landscape
 * it stops short of the chips there), both one line; hint and readout share the bottom row (one
 * line each in landscape; in portrait a readout that doesn't fit wraps below the hint).
 */
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { AccessibilityInfo, Platform, type StyleProp, StyleSheet, Text, type TextStyle, View } from 'react-native';
import { CARD, MONO, type Theme } from '@anatomy/engine';
import type { CardText } from '../scenes.tsx';
import type { Edges } from './layout.ts';
import type { ReadoutSource } from './readout.ts';

/** The bottom row's distance from the card's bottom edge. */
const BOTTOM = 18;
const ROW_GAP = 6;
const FONT = Platform.OS === 'web' ? MONO.web : MONO.ios;

export function Card({
  theme,
  text,
  edges,
  landscape,
  reserveRight = 0,
}: {
  theme: Theme;
  text: CardText;
  edges: Edges;
  landscape: boolean;
  /** Landscape: room the chips take at the card's top-right (the top row stops short of it). */
  reserveRight?: number;
}) {
  const ink = CARD[theme];
  const corner = [styles.corner, { fontFamily: FONT, color: ink.muted }];
  const page = { backgroundColor: ink.page };
  const { top, right, bottom, left } = edges;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {/* The page around the card (painted over the canvas, which fills the window). */}
      <View style={[styles.strip, page, { top: 0, left: 0, right: 0, height: top }]} />
      <View style={[styles.strip, page, { bottom: 0, left: 0, right: 0, height: bottom }]} />
      <View style={[styles.strip, page, { top, bottom, left: 0, width: left }]} />
      <View style={[styles.strip, page, { top, bottom, right: 0, width: right }]} />
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={`${text.title}. ${text.label}`}
        style={[styles.card, edges, { borderColor: ink.frame }]}
      >
        <View style={[styles.topRow, { right: 20 + reserveRight }]}>
          <Text numberOfLines={1} style={[corner, styles.inline, styles.keep, { color: ink.text }]}>
            {text.fig}
          </Text>
          <Text numberOfLines={1} style={[corner, styles.inline, styles.titleText, styles.title]}>
            {text.title.toUpperCase()}
          </Text>
        </View>
        <View style={[styles.row, landscape && styles.rowOne]}>
          <Text numberOfLines={1} style={[corner, styles.hint]}>
            {text.hint.toUpperCase()}
          </Text>
          {typeof text.readout === 'string' ? (
            <Text numberOfLines={1} style={[corner, styles.readout, { color: ink.text }]}>
              {text.readout}
            </Text>
          ) : (
            <LiveReadout source={text.readout} style={[corner, styles.readout, { color: ink.text }]} />
          )}
        </View>
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
      <Text numberOfLines={1} style={style}>
        {line}
      </Text>
      <Text style={styles.offscreen} accessibilityLiveRegion="polite" aria-live="polite">
        {phase}
      </Text>
    </>
  );
}

const styles = StyleSheet.create({
  strip: { position: 'absolute' },
  card: { position: 'absolute', borderWidth: 1 },
  corner: { position: 'absolute', fontSize: 10.5, lineHeight: 10.5 * 1.15, letterSpacing: 0.42 },
  // The title keeps the top-right corner when there is room (portrait), ellipsized when not.
  title: { marginLeft: 'auto' },
  titleText: { letterSpacing: 1.05 },
  topRow: { position: 'absolute', top: 18, left: 20, right: 20, flexDirection: 'row', columnGap: 24 },
  inline: { position: 'relative', flexShrink: 1 },
  keep: { flexShrink: 0 },
  // Hint left, readout right; in portrait a readout that doesn't fit wraps to the line below.
  row: { position: 'absolute', left: 20, right: 20, bottom: BOTTOM, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', columnGap: 24, rowGap: ROW_GAP },
  rowOne: { flexWrap: 'nowrap' },
  hint: { position: 'relative', letterSpacing: 1.05, flexShrink: 1, maxWidth: '100%' },
  readout: { position: 'relative', marginLeft: 'auto', fontVariant: ['tabular-nums'], flexShrink: 1, maxWidth: '100%' },
  // Visually hidden but still read by assistive tech.
  offscreen: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0, left: 0, bottom: 0 },
});
