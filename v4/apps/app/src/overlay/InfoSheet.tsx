/**
 * The "i" sheet (v2 A's `.fx-about`): the figure's full caption and a legend of the packet
 * colours, over the stage (an overlay: opening it never resizes anything). Closed by its own
 * button or the `i` chip.
 */
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CARD, type Material, MONO, TOKENS, type Theme } from '@anatomy/engine';

const FONT = Platform.OS === 'web' ? MONO.web : MONO.ios;

export function InfoSheet({
  theme,
  caption,
  legend,
  top,
  right,
  onClose,
}: {
  theme: Theme;
  caption: string;
  legend: readonly { material: Material; label: string }[];
  /** Its top-right corner from the window. */
  top: number;
  right: number;
  onClose: () => void;
}) {
  const ink = CARD[theme];
  return (
    <View accessibilityViewIsModal style={[styles.sheet, { top, right, backgroundColor: ink.card, borderColor: ink.frame }]}>
      <View style={styles.head}>
        <Text style={[styles.title, { color: ink.strong, fontFamily: FONT }]}>ABOUT THIS FIGURE</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={12} style={styles.close}>
          <Text style={[styles.closeText, { color: ink.text }]}>×</Text>
        </Pressable>
      </View>
      <ScrollView style={styles.body}>
        <Text style={[styles.caption, { color: ink.text }]}>{caption}</Text>
        <View style={styles.legend}>
          {legend.map((l) => {
            const t = TOKENS[theme][l.material];
            return (
              <View key={l.material} style={styles.item} accessible accessibilityLabel={l.label}>
                <View style={[styles.swatch, { backgroundColor: t.face, borderColor: t.hi }]} />
                <Text style={[styles.itemText, { color: ink.muted, fontFamily: FONT }]}>{l.label}</Text>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { position: 'absolute', width: 380, maxWidth: '86%', maxHeight: '78%', borderWidth: 1, borderRadius: 2, paddingHorizontal: 14, paddingVertical: 12 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  title: { fontSize: 10.5, letterSpacing: 1.05 },
  close: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  closeText: { fontSize: 18, lineHeight: 20 },
  body: { flexGrow: 0 },
  caption: { fontSize: 12.5, lineHeight: 18.5 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 6, marginTop: 10 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 11, height: 11, borderWidth: StyleSheet.hairlineWidth, borderRadius: 2 },
  itemText: { fontSize: 10.5, letterSpacing: 0.42 },
});
