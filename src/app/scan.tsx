// Scan a barcode (V1.5 P1, R9, D63, D65): finds YOUR saved product by its barcode. expo-camera's CameraView reads EAN-13, EAN-8,
// UPC-A and UPC-E on the phone (Android: ML Kit with the model inside the app; iOS: AVFoundation); there is no online product
// database and Google's downloadable code scanner is not used. The camera is asked for only after the user taps "Allow camera";
// typing the number always works (and is how a simulator, which has no camera, is tested).
// purpose: find (Price Book: open the product) · pick (Compare card: link it) · attach (product form: hand the code back).
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button } from '@/components/button';
import { ProductPickList } from '@/components/product-pick-list';
import { attachBarcode, findProductByBarcode } from '@/db/barcodes';
import type { ProductRow } from '@/db/products';
import { parseBarcode, RETAIL_BARCODE_TYPES, type Barcode } from '@/engine/barcode';
import { useTheme } from '@/hooks/use-theme';
import { linkProduct } from '@/lib/compare-draft';
import { updateDraft } from '@/lib/compare-store';
import { DEBUG_ENABLED } from '@/lib/debug';
import { fill } from '@/lib/format';
import { keyTick } from '@/lib/haptics';
import { barcodeErrorText, offerScannedCode, onSimulatedReading } from '@/lib/scan-handoff';
import { useAppSettings } from '@/lib/settings-store';
import { strings } from '@/lib/strings';

type Purpose = 'find' | 'pick' | 'attach';
type Result = { kind: 'notFound'; barcode: Barcode } | { kind: 'choose'; barcode: Barcode };

export default function Scan() {
  const params = useLocalSearchParams<{ purpose?: string; cardId?: string }>();
  const purpose: Purpose = params.purpose === 'pick' || params.purpose === 'attach' ? params.purpose : 'find';
  const cardId = params.cardId;
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const settings = useAppSettings();
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraError, setCameraError] = useState(false);
  const [torch, setTorch] = useState(false);
  const [typed, setTyped] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const busy = useRef(false);

  const linkCard = (p: Pick<ProductRow, 'id' | 'uid' | 'name' | 'count_label'>) => {
    if (cardId) updateDraft((d) => linkProduct(d, cardId, { id: p.id, uid: p.uid, name: p.name, label: p.count_label }));
  };

  const open = (product: ProductRow) => {
    if (purpose === 'pick') {
      linkCard(product);
      router.back();
    } else {
      router.replace({ pathname: '/product/[id]', params: { id: String(product.id) } });
    }
  };

  const handle = async (raw: string, hint: string | null, fromCamera: boolean) => {
    if (busy.current) return;
    busy.current = true;
    let keepBusy = false;
    try {
      const parsed = parseBarcode(raw, hint);
      if (!parsed.ok) {
        setMessage(barcodeErrorText(parsed.error));
        return;
      }
      setMessage(null);
      if (fromCamera) keyTick(settings.haptics);
      if (purpose === 'attach') {
        keepBusy = true;
        offerScannedCode(parsed.code);
        router.back();
        return;
      }
      const hit = await findProductByBarcode(db, parsed.candidates);
      keepBusy = true;
      if (hit) open(hit.product);
      else setResult({ kind: 'notFound', barcode: parsed });
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      if (!keepBusy) busy.current = false;
    }
  };
  // Dev builds: the debug link feeds readings here as the camera would (Maestro has no camera).
  const handleRef = useRef(handle);
  useEffect(() => {
    handleRef.current = handle;
  });
  useEffect(() => (DEBUG_ENABLED ? onSimulatedReading((r) => void handleRef.current(r.data, r.type, true)) : undefined), []);

  const again = () => {
    setResult(null);
    setMessage(null);
    setTyped('');
    busy.current = false;
  };

  const attachTo = async (product: ProductRow, barcode: Barcode) => {
    const r = await attachBarcode(db, product.id, barcode.code);
    if (!r.ok) {
      setMessage(r.error === 'barcodeTaken' ? fill(strings.productEdit.errorBarcodeTaken, { code: barcode.display, name: r.owner.ownerName }) : strings.productEdit.errorNotFound);
      return;
    }
    open(product);
  };

  if (result?.kind === 'choose') {
    return (
      <View testID="scan-screen" style={[styles.screen, { backgroundColor: theme.background }]}>
        <ProductPickList
          header={
            <View style={styles.pad}>
              <Text testID="scan-choose" style={[styles.text, { color: theme.text }]}>{fill(strings.scan.attachTitle, { code: result.barcode.display })}</Text>
              {message ? <Text testID="scan-message" style={{ color: theme.danger }}>{message}</Text> : null}
            </View>
          }
          onPick={(row) => void attachTo(row, result.barcode)}
        />
      </View>
    );
  }

  if (result?.kind === 'notFound') {
    const b = result.barcode;
    return (
      <View testID="scan-screen" style={[styles.screen, styles.pad, { backgroundColor: theme.background }]}>
        <Text testID="scan-notfound" style={[styles.title, { color: theme.text }]}>{fill(strings.scan.notFound, { code: b.display })}</Text>
        <Text style={[styles.text, { color: theme.textSecondary }]}>{strings.scan.notFoundNote}</Text>
        {b.label === 'storeLabel' ? <Text testID="scan-store-label" style={[styles.text, { color: theme.text }]}>{strings.scan.storeLabel}</Text> : null}
        <Button testID="scan-new" label={strings.scan.newProduct} onPress={() => router.replace({ pathname: '/product/edit', params: { barcode: b.code } })} />
        <Button testID="scan-attach" variant="secondary" label={strings.scan.attach} onPress={() => setResult({ kind: 'choose', barcode: b })} />
        <Button testID="scan-again" variant="secondary" label={strings.scan.again} onPress={again} />
      </View>
    );
  }

  const camera = () => {
    if (!permission) return null;
    if (cameraError) return <Text testID="scan-unavailable" style={[styles.text, styles.pad, { color: theme.text }]}>{strings.scan.unavailable}</Text>;
    if (!permission.granted) {
      return (
        <View testID="scan-permission" style={[styles.pad, styles.gap]}>
          <Text style={[styles.text, { color: theme.text }]}>{permission.canAskAgain ? strings.scan.why : strings.scan.denied}</Text>
          {permission.canAskAgain ? (
            <Button testID="scan-allow" label={strings.scan.allow} onPress={() => void requestPermission()} />
          ) : (
            <Button testID="scan-settings" label={strings.scan.openSettings} onPress={() => void Linking.openSettings()} />
          )}
        </View>
      );
    }
    return (
      <View style={styles.cameraBox}>
        <CameraView
          testID="scan-camera"
          style={StyleSheet.absoluteFill}
          facing="back"
          enableTorch={torch}
          barcodeScannerSettings={{ barcodeTypes: [...RETAIL_BARCODE_TYPES] }}
          onBarcodeScanned={(r) => void handle(r.data, r.type, true)}
          onMountError={() => setCameraError(true)}
        />
        <View style={styles.overlay} pointerEvents="box-none">
          <Text style={styles.aim}>{strings.scan.aim}</Text>
          <Pressable testID="scan-light" accessibilityRole="switch" accessibilityState={{ checked: torch }} onPress={() => setTorch((t) => !t)} style={styles.light}>
            <Text style={styles.lightText}>{torch ? strings.scan.lightOff : strings.scan.light}</Text>
          </Pressable>
        </View>
      </View>
    );
  };

  return (
    <View testID="scan-screen" style={[styles.screen, { backgroundColor: theme.background }]}>
      <View style={[styles.pad, styles.gap]}>
        <Text style={[styles.label, { color: theme.textSecondary }]}>{strings.scan.manual}</Text>
        <View style={styles.row}>
          <TextInput
            testID="scan-manual"
            value={typed}
            onChangeText={(t) => {
              setTyped(t);
              setMessage(null);
            }}
            keyboardType="number-pad"
            returnKeyType="search"
            onSubmitEditing={() => void handle(typed, null, false)}
            accessibilityLabel={strings.scan.manual}
            placeholder="4001234567891"
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
          />
          <Button testID="scan-manual-go" label={strings.scan.find} onPress={() => void handle(typed, null, false)} />
        </View>
        {message ? <Text testID="scan-message" style={{ color: theme.danger, fontSize: 15 }}>{message}</Text> : null}
      </View>
      {camera()}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  pad: { padding: 16, gap: 12 },
  gap: { gap: 10 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: { flex: 1, minHeight: 48, borderRadius: 10, paddingHorizontal: 12, fontSize: 20, letterSpacing: 1 },
  label: { fontSize: 13, fontWeight: '600' },
  title: { fontSize: 20, fontWeight: '700' },
  text: { fontSize: 16 },
  cameraBox: { flex: 1, margin: 16, marginTop: 0, borderRadius: 16, overflow: 'hidden', backgroundColor: '#000' },
  overlay: { flex: 1, justifyContent: 'space-between', alignItems: 'center', padding: 16 },
  aim: { color: '#fff', fontSize: 16, fontWeight: '600', backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  light: { minHeight: 44, minWidth: 88, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  lightText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
