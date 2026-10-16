// A15 / REVIEW_V1 S5 visual check: reads a screenshot with the macOS Vision text recogniser (on the Mac, offline) and
// fails unless every expected text appears whole inside ONE recognised line. A unit price wrapped mid-number
// ("€4.9" / "8 per kg") or a clipped header word is then missing. Maestro alone cannot see this: it matches the
// element's full text however it is laid out.
// Usage: swift scripts/ocr-check.swift <screenshot.png> <text> [<text> ...]   (exit 1 on a miss; prints the lines)
import AppKit
import Foundation
import Vision

let args = CommandLine.arguments
guard args.count >= 3 else {
  FileHandle.standardError.write("Usage: ocr-check.swift <png> <text> [<text> ...]\n".data(using: .utf8)!)
  exit(2)
}
let url = URL(fileURLWithPath: args[1])
guard let image = NSImage(contentsOf: url), let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
  FileHandle.standardError.write("Cannot read \(args[1])\n".data(using: .utf8)!)
  exit(2)
}
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = false
try VNImageRequestHandler(cgImage: cg, options: [:]).perform([request])
let normalise = { (s: String) in s.replacingOccurrences(of: "\u{00A0}", with: " ").replacingOccurrences(of: "\u{202F}", with: " ") }
let lines = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.map(normalise)
var missing: [String] = []
for expected in args.dropFirst(2) where !lines.contains(where: { $0.contains(normalise(expected)) }) {
  missing.append(expected)
}
let name = url.lastPathComponent
if missing.isEmpty {
  print("OCR OK \(name): \(args.dropFirst(2).joined(separator: ", "))")
  exit(0)
}
print("OCR MISS \(name): \(missing.joined(separator: ", ")) not on one line. Lines read: \(lines.joined(separator: " | "))")
exit(1)
