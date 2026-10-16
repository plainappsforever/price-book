// One Compare card (SPEC 2.1): price and size fields (keypad-driven), unit, optional book link, deal chips,
// "bought" when a deal needs it, result line with badges, inline hints/warnings, gauge line and the breakdown.
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { UnitPriceText } from './unit-price-text';

import { useTheme } from '@/hooks/use-theme';
import type { CardDraft, DealRef, FieldKind } from '@/lib/compare-draft';
import { fill, type StepLine } from '@/lib/format';
import { strings } from '@/lib/strings';

export type DealChip = { ref: DealRef; label: string };

export type CardView = {
  letter: string;
  resultLine: string | null;
  perPackLine: string | null;
  best: boolean;
  tie: boolean;
  lowestToPay: boolean;
  missing: string | null;
  notes: string[];
  chips: DealChip[];
  showQuantity: boolean;
  quantityPlaceholder: string;
  steps: StepLine[] | null;
  gauge: { text: string; basis: string | null } | null;
};

type Props = {
  card: CardDraft;
  view: CardView;
  focusedField: FieldKind | null;
  expanded: boolean;
  canDuplicate: boolean;
  onFocus: (field: FieldKind) => void;
  onAddDeal: () => void;
  onRemoveDeal: (ref: DealRef) => void;
  canSave: boolean;
  onSave: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onLink: () => void;
  onUnlink: () => void;
  /** V1.5 P1: scan a barcode to link the card to the product that has it. */
  onScan: () => void;
  onToggleBreakdown: () => void;
};

export function CompareCard(p: Props) {
  const theme = useTheme();
  const large = useWindowDimensions().fontScale > 1.3;
  const { card, view } = p;
  const L = view.letter;
  const field = (kind: FieldKind, label: string, text: string, placeholder: string, flex: number) => {
    const focused = p.focusedField === kind;
    return (
      <Pressable
        testID={`${kind === 'quantity' ? 'qty' : kind}-${L}`}
        accessibilityRole="button"
        accessibilityLabel={`${label} ${L}`}
        accessibilityState={{ selected: focused }}
        onPress={() => p.onFocus(kind)}
        style={[styles.field, { flex, borderColor: focused ? theme.tint : theme.backgroundSelected, backgroundColor: theme.background }]}>
        <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>{label}</Text>
        <Text testID={`${kind === 'quantity' ? 'qty' : kind}-${L}-text`} style={[styles.fieldText, { color: text ? theme.text : theme.textSecondary }]} numberOfLines={1}>
          {text || placeholder}
          {focused ? <Text style={{ color: theme.tint }}>|</Text> : null}
        </Text>
      </Pressable>
    );
  };
  const small = (text: string, id?: string, color?: string) => (
    <Text key={text + (id ?? '')} testID={id} style={[styles.note, { color: color ?? theme.textSecondary }]}>
      {text}
    </Text>
  );

  return (
    <View testID={`card-${L}`} style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: view.best ? theme.tint : 'transparent' }]}>
      <View style={large ? styles.headerLarge : styles.header}>
        <View style={styles.titleRow}>
        <Text maxFontSizeMultiplier={1.5} style={[styles.letter, { color: theme.text }]}>{L}</Text>
        {card.productName ? (
          <View style={styles.linkRow}>
            <Pressable testID={`link-${L}`} onPress={p.onLink} style={styles.linkName}>
              <Text style={[styles.linkText, { color: theme.text }]} numberOfLines={1}>
                {card.productName}
              </Text>
            </Pressable>
            <Pressable testID={`unlink-${L}`} accessibilityLabel={strings.compare.unlink} onPress={p.onUnlink} hitSlop={8}>
              <Text maxFontSizeMultiplier={1.5} style={[styles.action, { color: theme.textSecondary }]}>✕</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.linkRow}>
            <Pressable testID={`link-${L}`} onPress={p.onLink} style={styles.linkName}>
              <Text style={[styles.linkText, { color: theme.tint }]} numberOfLines={1}>
                {strings.compare.link}
              </Text>
            </Pressable>
            <Pressable testID={`scan-${L}`} accessibilityRole="button" accessibilityLabel={fill(strings.compare.scanLabel, { letter: L })} onPress={p.onScan} hitSlop={ACTION_SLOP}>
              <Text maxFontSizeMultiplier={1.5} style={[styles.action, { color: theme.tint }]}>{strings.compare.scan}</Text>
            </Pressable>
          </View>
        )}
        </View>
        <View style={[styles.actions, large && styles.actionsLarge]}>
        {p.canSave ? (
          <Pressable testID={`save-${L}`} accessibilityRole="button" onPress={p.onSave} hitSlop={ACTION_SLOP}>
            <Text maxFontSizeMultiplier={1.5} style={[styles.action, { color: theme.tint }]}>{strings.compare.save}</Text>
          </Pressable>
        ) : null}
        {p.canDuplicate ? (
          <Pressable testID={`duplicate-${L}`} onPress={p.onDuplicate} hitSlop={ACTION_SLOP}>
            <Text maxFontSizeMultiplier={1.5} style={[styles.action, { color: theme.tint }]}>{strings.compare.duplicate}</Text>
          </Pressable>
        ) : null}
        <Pressable testID={`remove-${L}`} onPress={p.onRemove} hitSlop={ACTION_SLOP}>
          <Text maxFontSizeMultiplier={1.5} style={[styles.action, { color: theme.textSecondary }]}>{strings.compare.remove}</Text>
        </Pressable>
        </View>
      </View>

      <View style={styles.fields}>
        {field('price', strings.compare.price, card.price, '0', 5)}
        {field('size', `${strings.compare.size} (${strings.units[card.unit]})`, card.size, '0', 5)}
        {view.showQuantity ? field('quantity', strings.compare.quantity, card.quantity, view.quantityPlaceholder, 3) : null}
      </View>

      <View style={styles.resultRow}>
        {view.resultLine ? (
          <UnitPriceText testID={`result-${L}`} style={[styles.result, { color: theme.text }]} text={view.resultLine} />
        ) : (
          small(view.missing ?? '', `missing-${L}`)
        )}
        {view.best && !view.tie ? (
          <Text testID={`badge-best-${L}`} style={[styles.badge, { backgroundColor: theme.tint, color: theme.onTint }]}>
            {strings.compare.bestValue}
          </Text>
        ) : null}
        {view.best && view.tie ? (
          <Text testID={`badge-tie-${L}`} style={[styles.badge, { backgroundColor: theme.backgroundSelected, color: theme.text }]}>
            {strings.compare.sameUnitPrice}
          </Text>
        ) : null}
        {view.lowestToPay ? (
          <Text testID={`badge-lowest-${L}`} style={[styles.badge, { backgroundColor: theme.backgroundSelected, color: theme.text }]}>
            {strings.compare.lowestToPay}
          </Text>
        ) : null}
      </View>
      {view.perPackLine ? small(view.perPackLine, `perpack-${L}`) : null}

      <View style={styles.chips}>
        {view.chips.map((chip, i) => (
          <View key={`${chip.label}-${i}`} style={[styles.chip, { backgroundColor: theme.background }]}>
            <Text testID={`deal-${L}-${i}`} style={[styles.chipText, { color: theme.text }]}>
              {chip.label}
            </Text>
            <Pressable
              testID={`deal-remove-${L}-${i}`}
              accessibilityLabel={strings.deals.chip.remove.replace('{name}', chip.label)}
              onPress={() => p.onRemoveDeal(chip.ref)}
              hitSlop={8}>
              <Text style={[styles.chipX, { color: theme.textSecondary }]}>✕</Text>
            </Pressable>
          </View>
        ))}
        <Pressable testID={`deal-add-${L}`} onPress={p.onAddDeal} style={[styles.chip, { backgroundColor: theme.background }]}>
          <Text style={[styles.chipText, { color: theme.tint }]}>{strings.compare.addDeal}</Text>
        </Pressable>
      </View>

      {view.notes.map((n, i) => small(n, `note-${L}-${i}`))}
      {view.gauge ? (
        <View>
          {small(view.gauge.text, `gauge-${L}`, theme.text)}
          {view.gauge.basis ? small(view.gauge.basis, `gauge-basis-${L}`) : null}
        </View>
      ) : null}

      {view.steps ? (
        <Pressable testID={`breakdown-toggle-${L}`} onPress={p.onToggleBreakdown} hitSlop={ACTION_SLOP}>
          <Text style={[styles.note, { color: theme.tint }]}>{p.expanded ? strings.compare.breakdownHide : strings.compare.breakdownShow}</Text>
        </Pressable>
      ) : null}
      {p.expanded && view.steps ? (
        <View testID={`breakdown-${L}`} style={styles.steps}>
          {view.steps.map((s, i) => (
            <View key={i} style={styles.step}>
              <Text style={[styles.stepLabel, { color: theme.text }]}>{s.label}</Text>
              <Text style={[styles.stepAmount, { color: theme.textSecondary }]}>{s.amount}</Text>
              <Text style={[styles.stepAmount, { color: theme.text }]}>{s.total}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** REVIEW_V1 N9: Save / Duplicate / Remove are small words; their touch areas reach 44 pt high. */
const ACTION_SLOP = { top: 14, bottom: 14, left: 5, right: 5 };

const styles = StyleSheet.create({
  card: { borderRadius: 14, padding: 10, gap: 6, borderWidth: 2 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  // Large text (REVIEW_V1 S5): letter + product link on the first line, Save / Duplicate / Remove on their own line.
  headerLarge: { gap: 4 },
  titleRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  actionsLarge: { justifyContent: 'flex-end', flexWrap: 'wrap', gap: 14 },
  letter: { fontSize: 18, fontWeight: '700', width: 18 },
  linkRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  linkName: { flex: 1 },
  linkText: { fontSize: 14, fontWeight: '600' },
  action: { fontSize: 14, fontWeight: '600' },
  fields: { flexDirection: 'row', gap: 8 },
  field: { borderWidth: 2, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4, minHeight: 50 },
  fieldLabel: { fontSize: 11, fontWeight: '600' },
  fieldText: { fontSize: 20, fontWeight: '600' },
  resultRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  result: { fontSize: 18, fontWeight: '700' },
  badge: { fontSize: 12, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, overflow: 'hidden' },
  note: { fontSize: 13, lineHeight: 18 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 14, paddingHorizontal: 10, minHeight: 30 },
  chipText: { fontSize: 13, fontWeight: '600' },
  chipX: { fontSize: 13 },
  steps: { gap: 2, paddingTop: 4 },
  step: { flexDirection: 'row', gap: 8 },
  stepLabel: { flex: 1, fontSize: 13 },
  stepAmount: { fontSize: 13, minWidth: 64, textAlign: 'right' },
});
