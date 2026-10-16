// V1.5 P1 (D65): hand-over between the scan screen and the screen that opened it, plus the dev-only simulated camera.
// The product form opens the scan screen with purpose "attach"; the scan screen offers the code here and goes back; the form
// takes it when it is focused again. The debug link pricebook-dev://debug/scan?code=…&type=… (development builds only) feeds a
// reading to the open scan screen exactly as the camera's onBarcodeScanned would (Maestro cannot show a barcode to a camera).
import type { BarcodeError } from '@/engine/barcode';

import { strings } from './strings';

export type CameraReading = { data: string; type: string };

let pending: string | null = null;

export function offerScannedCode(code: string): void {
  pending = code;
}

/** The code the scan screen handed over, once. */
export function takeScannedCode(): string | null {
  const code = pending;
  pending = null;
  return code;
}

const listeners = new Set<(r: CameraReading) => void>();

export function onSimulatedReading(listener: (r: CameraReading) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Feeds a reading to every open scan screen; false when none is open. */
export function simulateReading(reading: CameraReading): boolean {
  for (const listener of listeners) listener(reading);
  return listeners.size > 0;
}

export function barcodeErrorText(error: BarcodeError): string {
  return strings.scan.errors[error];
}
