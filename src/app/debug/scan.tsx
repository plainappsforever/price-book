// Dev only (D65): `pricebook-dev://debug/scan?code=<digits>&type=<ean13|ean8|upc_a|upc_e|qr…>&nonce=<n>` hands a reading to the
// open scan screen as if the camera had read it, then goes back to it. Maestro cannot present a barcode to a camera.
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { DEBUG_ENABLED } from '@/lib/debug';
import { simulateReading } from '@/lib/scan-handoff';

export default function DebugScan() {
  const router = useRouter();
  const { code, type } = useLocalSearchParams<{ code?: string; type?: string; nonce?: string }>();
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!DEBUG_ENABLED) return;
    const delivered = simulateReading({ data: code ?? '', type: type ?? 'ean13' });
    if (!delivered) {
      const timer = setTimeout(() => setMissing(true), 0);
      return () => clearTimeout(timer);
    }
    if (router.canGoBack()) router.back();
  }, [router, code, type]);

  if (!DEBUG_ENABLED) return <Redirect href="/" />;
  return <View testID="debug-scan">{missing ? <Text testID="debug-scan-missing">No scan screen is open</Text> : null}</View>;
}
