// Compare (SPEC 2.1, U1/U2/U5): 2–5 cards, live results on every key, keypad pinned at the bottom.
import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { CompareCard } from '@/components/compare-card';
import { Keypad } from '@/components/keypad';
import { UnitChips } from '@/components/unit-chips';
import { compareGauge } from '@/engine/stats';
import { chipUnits, nextBasis, type Dimension, type UnitId } from '@/engine/units';
import { useProductStats } from '@/hooks/use-product-histories';
import { useTheme } from '@/hooks/use-theme';
import { SETTING_KEYS } from '@/lib/app-settings';
import {
  addCard, duplicateCard, findCard, MAX_CARDS, nextField, pressKey, removeCard, removeDeal, setFocus,
  setUnit, unlinkProduct, type CardDraft, type DealRef, type FieldKind,
} from '@/lib/compare-draft';
import { buildCompareView, type GaugeLine } from '@/lib/compare-view';
import { revalidateDraftLinks, updateDraft, useDraft } from '@/lib/compare-store';
import { currencyExponent } from '@/engine/money';
import { displayLocale, gaugeText, memoryBasisText } from '@/lib/format';
import { keyTick } from '@/lib/haptics';
import { clearNotice, useNotice } from '@/lib/notice';
import { deviceLocaleTag, saveSettings, useAppSettings } from '@/lib/settings-store';
import { strings } from '@/lib/strings';
import type { Breakdown } from '@/engine/deals';

export default function CompareScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const settings = useAppSettings();
  const draft = useDraft();
  const notice = useNotice();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const locale = useMemo(() => displayLocale(deviceLocaleTag(), settings.decimalSeparator), [settings.decimalSeparator]);
  const exponent = currencyExponent(settings.currency);
  const linked = draft.cards.flatMap((c) => (c.productId != null ? [{ id: c.productId, uid: c.productUid }] : []));
  const stats = useProductStats(db, linked, settings);
  // REVIEW_V1 S2: a link to a deleted product, or to another product under a reused id, is dropped when Compare shows.
  useFocusEffect(
    useCallback(() => {
      revalidateDraftLinks(db).catch(() => undefined);
    }, [db])
  );

  const gaugeFor = useCallback(
    (card: CardDraft, b: Breakdown): GaugeLine | null => {
      if (card.productId == null) return null;
      const s = stats[card.productId];
      if (s === undefined) return null;
      if (s === 'missing') return { text: strings.gauge.missing, basis: null };
      const g = compareGauge(s, b);
      if (!g) return { text: strings.gauge.otherDimension, basis: null };
      return { text: gaugeText(g), basis: memoryBasisText(b) };
    },
    [stats]
  );
  const view = useMemo(() => buildCompareView(draft, settings, locale, gaugeFor), [draft, settings, locale, gaugeFor]);

  const focus = draft.focus;
  const focusedCard = focus ? findCard(draft, focus.cardId) : undefined;
  const sizeFocused = focus?.field === 'size' && !!focusedCard;

  const onKey = (key: string) => {
    keyTick(settings.haptics);
    updateDraft((d) => pressKey(d, key, exponent));
  };
  const onNext = () => {
    keyTick(settings.haptics);
    updateDraft(nextField);
  };
  const cycleBasis = (dimension: Dimension) => {
    void saveSettings(db, { [SETTING_KEYS.basis(dimension)]: nextBasis(dimension, settings.bases[dimension]) });
  };

  return (
    <View testID="compare-screen" style={[styles.screen, { backgroundColor: theme.background }]}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="always">
        {notice?.action ? (
          <View style={[styles.noticeRow, { backgroundColor: theme.backgroundElement }]}>
            <Text testID="compare-notice" accessibilityLiveRegion="polite" style={[styles.noticeText, { color: theme.text }]}>
              {notice.text}
            </Text>
            <Pressable
              testID="compare-notice-action"
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => {
                notice.action?.run();
                clearNotice();
              }}
              style={styles.noticeAction}>
              <Text style={[styles.noticeActionText, { color: theme.tint }]}>{notice.action.label}</Text>
            </Pressable>
          </View>
        ) : notice ? (
          <Text testID="compare-notice" accessibilityLiveRegion="polite" style={[styles.notice, { backgroundColor: theme.backgroundElement, color: theme.text }]}>
            {notice.text}
          </Text>
        ) : null}
        {view.groups.length > 0 || view.warnings.length > 0 ? (
          <View testID="result-strip" style={[styles.strip, { backgroundColor: theme.backgroundElement }]}>
            {view.groups.map((g) => (
              <View key={g.dimension} style={styles.group}>
                <Pressable testID={`basis-${g.dimension}`} accessibilityRole="button" accessibilityHint={strings.compare.cycleBasis} onPress={() => cycleBasis(g.dimension)}>
                  <Text style={[styles.groupHeader, { color: theme.tint }]}>{g.header} ⇄</Text>
                </Pressable>
                {g.summary ? (
                  <Text testID={`summary-${g.dimension}`} style={[styles.summary, { color: theme.text }]}>
                    {g.summary}
                  </Text>
                ) : null}
                {g.lowestToPay ? (
                  <Text testID={`lowest-${g.dimension}`} style={[styles.stripLine, { color: theme.text }]}>
                    {g.lowestToPay}
                  </Text>
                ) : null}
              </View>
            ))}
            {view.warnings.map((w, i) => (
              <Text key={w} testID={`warning-${i}`} style={[styles.warning, { color: theme.danger }]}>
                {w}
              </Text>
            ))}
          </View>
        ) : null}

        {draft.cards.map((card) => (
          <CompareCard
            key={card.id}
            card={card}
            view={view.cards[card.id]}
            focusedField={focus?.cardId === card.id ? focus.field : null}
            expanded={!!expanded[card.id]}
            canDuplicate={draft.cards.length < MAX_CARDS}
            onFocus={(field: FieldKind) => updateDraft((d) => setFocus(d, card.id, field))}
            onAddDeal={() => router.push({ pathname: '/deal-sheet', params: { cardId: card.id } })}
            onRemoveDeal={(ref: DealRef) => updateDraft((d) => removeDeal(d, card.id, ref))}
            canSave={!!view.breakdowns[card.id]}
            onSave={() => router.push({ pathname: '/save-sheet', params: { cardId: card.id } })}
            onDuplicate={() => updateDraft((d) => duplicateCard(d, card.id))}
            onRemove={() => updateDraft((d) => removeCard(d, card.id))}
            onLink={() => router.push({ pathname: '/pick-product', params: { cardId: card.id } })}
            onUnlink={() => updateDraft((d) => unlinkProduct(d, card.id))}
            onScan={() => router.push({ pathname: '/scan', params: { purpose: 'pick', cardId: card.id } })}
            onToggleBreakdown={() => setExpanded((e) => ({ ...e, [card.id]: !e[card.id] }))}
          />
        ))}

        <View style={styles.actions}>
          {draft.cards.length < MAX_CARDS ? (
            <Pressable testID="add-card" accessibilityRole="button" onPress={() => updateDraft(addCard)} style={[styles.action, { backgroundColor: theme.backgroundElement }]}>
              <Text style={[styles.actionText, { color: theme.tint }]}>{strings.compare.addCard}</Text>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>

      <View style={[styles.bottom, { borderTopColor: theme.backgroundSelected }]}>
        {sizeFocused && focusedCard ? (
          <UnitChips
            units={chipUnits(settings.unitSystem)}
            selected={focusedCard.unit}
            onSelect={(u: UnitId) => {
              keyTick(settings.haptics);
              updateDraft((d) => setUnit(d, focusedCard.id, u));
            }}
            onMore={() => router.push({ pathname: '/units', params: { cardId: focusedCard.id } })}
          />
        ) : null}
        <Keypad sep={settings.decimalSeparator} timesEnabled={sizeFocused} onKey={onKey} onNext={onNext} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scroll: { flex: 1 },
  content: { padding: 10, gap: 10, paddingBottom: 24 },
  notice: { borderRadius: 12, padding: 10, fontSize: 15, fontWeight: '600', overflow: 'hidden' },
  noticeRow: { borderRadius: 12, paddingLeft: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  noticeText: { flex: 1, fontSize: 15, fontWeight: '600', paddingVertical: 10 },
  noticeAction: { minHeight: 44, minWidth: 64, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  noticeActionText: { fontSize: 16, fontWeight: '700' },
  strip: { borderRadius: 14, padding: 10, gap: 6 },
  group: { gap: 2 },
  groupHeader: { fontSize: 13, fontWeight: '700' },
  summary: { fontSize: 15, fontWeight: '600' },
  stripLine: { fontSize: 14 },
  warning: { fontSize: 14, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: 10 },
  action: { flex: 1, minHeight: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  actionText: { fontSize: 15, fontWeight: '600' },
  bottom: { borderTopWidth: StyleSheet.hairlineWidth },
});
