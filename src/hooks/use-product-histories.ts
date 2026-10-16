// Price history of the products linked on Compare cards (U5): loaded when Compare gains focus and when a link
// changes; the stats are recomputed when the settings change.
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';

import { listObservations, toPriceObservation } from '@/db/observations';
import { getProduct } from '@/db/products';
import type { Db } from '@/db/types';
import { productStats, type PriceObservation, type Stats } from '@/engine/stats';
import type { Dimension } from '@/engine/units';
import type { AppSettings } from '@/lib/app-settings';
import { today } from '@/lib/today';

type History = { dimension: Dimension; observations: PriceObservation[] } | 'missing';

/**
 * `links` are the cards' product ids with the uid the card was linked to (migration 4). A product whose uid differs is a
 * different product under a reused id: it gets no entry (no gauge) and `revalidateDraftLinks` unlinks the card. A v1.0
 * link without a uid waits for that check too.
 */
export function useProductStats(db: Db, links: { id: number; uid: string | null }[], settings: AppSettings): Record<number, Stats | 'missing'> {
  const [histories, setHistories] = useState<Record<number, History>>({});
  const key = [...new Set(links.filter((l) => l.uid !== null).map((l) => `${l.id}:${l.uid}`))].sort().join(',');
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        const out: Record<number, History> = {};
        for (const link of key ? key.split(',') : []) {
          const [idText, uid] = link.split(':');
          const id = Number(idText);
          const product = await getProduct(db, id);
          if (product && product.uid !== uid) continue;
          out[id] = product ? { dimension: product.dimension as Dimension, observations: (await listObservations(db, id)).map(toPriceObservation) } : 'missing';
        }
        if (alive) setHistories(out);
      })().catch(() => undefined);
      return () => {
        alive = false;
      };
    }, [db, key])
  );
  return useMemo(() => {
    const out: Record<number, Stats | 'missing'> = {};
    const day = today();
    for (const [id, h] of Object.entries(histories)) {
      out[Number(id)] =
        h === 'missing'
          ? 'missing'
          : productStats(h.observations, day, { currency: settings.currency, measurementSystem: settings.unitSystem, bases: settings.bases, dimension: h.dimension });
    }
    return out;
  }, [histories, settings]);
}
