// Link a Compare card to a Price Book product (U5): the card then shows the gauge line from that history.
import { useLocalSearchParams, useRouter } from 'expo-router';
import { View } from 'react-native';

import { ProductPickList } from '@/components/product-pick-list';
import { useTheme } from '@/hooks/use-theme';
import { linkProduct } from '@/lib/compare-draft';
import { updateDraft } from '@/lib/compare-store';

export default function PickProduct() {
  const { cardId } = useLocalSearchParams<{ cardId: string }>();
  const router = useRouter();
  const theme = useTheme();
  return (
    <View testID="pick-product" style={{ flex: 1, backgroundColor: theme.background }}>
      <ProductPickList
        onPick={(item) => {
          if (cardId) updateDraft((d) => linkProduct(d, cardId, { id: item.id, uid: item.uid, name: item.name, label: item.count_label }));
          router.back();
        }}
      />
    </View>
  );
}
