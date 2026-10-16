// "Clear" in the Compare header (SPEC 2.1): resets all cards; a second tap confirms when a card is linked to the
// book or has deals. In the header so it is reachable however long the cards get.
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { clearDraft, clearNeedsConfirm } from '@/lib/compare-draft';
import { getDraft, updateDraft } from '@/lib/compare-store';
import { showNotice } from '@/lib/notice';
import { strings } from '@/lib/strings';

export function ClearButton() {
  const theme = useTheme();
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const onPress = () => {
    if (clearNeedsConfirm(getDraft()) && !armed) {
      setArmed(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setArmed(false), 4000);
      return;
    }
    setArmed(false);
    // REVIEW_V1 S6 (L10): one tap wipes every typed price, so it can be taken back for 5 seconds.
    const before = getDraft();
    updateDraft(clearDraft);
    if (getDraft() !== before) showNotice(strings.compare.cleared, 5000, { label: strings.compare.undo, run: () => updateDraft(() => before) });
  };
  return (
    <Pressable testID="clear" accessibilityRole="button" hitSlop={{ top: 8, bottom: 8, left: 8, right: 0 }} onPress={onPress} style={styles.button}>
      <Text maxFontSizeMultiplier={1.3} style={[styles.text, { color: armed ? theme.danger : theme.tint }]}>{armed ? strings.compare.clearConfirm : strings.compare.clear}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // marginRight keeps Clear's touch area apart from the gear's (REVIEW_V1 S6: they overlapped).
  button: { paddingHorizontal: 4, marginRight: 8, minHeight: 44, justifyContent: 'center' },
  text: { fontSize: 15, fontWeight: '600' },
});
