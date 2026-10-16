// A text field with its label above (system keyboard: names, notes, deal text). Number entry uses the keypad (D19).
import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

export function LabeledInput({ label, ...rest }: TextInputProps & { label: string }) {
  const theme = useTheme();
  return (
    <View style={styles.box}>
      <Text style={[styles.label, { color: theme.textSecondary }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={theme.textSecondary}
        style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
        {...rest}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 4 },
  label: { fontSize: 13, fontWeight: '600' },
  input: { minHeight: 46, borderRadius: 10, paddingHorizontal: 12, fontSize: 17 },
});
