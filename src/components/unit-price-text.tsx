// A unit price ("€4.98 per kg") that never breaks inside the number (REVIEW_V1 S5, A15): the amount stays on one line and
// shrinks to the width it has; the basis ("per kg") wraps to the next line first. The testID and the full text sit on the
// outer element (accessible, labelled with the whole line) so screen readers and Maestro read "€4.98 per kg" as one.
import { StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';

import { splitUnitPriceLine } from '@/lib/format';

export function UnitPriceText({ text, style, testID }: { text: string; style?: StyleProp<TextStyle>; testID?: string }) {
  const { amount, per } = splitUnitPriceLine(text);
  return (
    <View testID={testID} accessible accessibilityLabel={text} style={styles.row}>
      <Text style={[style, styles.amount]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.4}>
        {amount}
      </Text>
      {per ? <Text style={style}>{per}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // columnGap is the space between amount and basis on one line; after a wrap the basis starts at the left edge.
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 5, flexShrink: 1, maxWidth: '100%' },
  amount: { flexShrink: 1 },
});
