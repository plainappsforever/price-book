// Generates the app icon, adaptive-icon layers, splash glyph and favicon: a white price tag on the app blue (V1_PLAN P6).
// Usage: swift scripts/make-icon.swift   (writes into assets/images/ and assets/expo.icon/Assets/; outputs are committed)
// Plain CoreGraphics, no dependencies. Written fresh for Price Book; the canvas helpers follow the sibling apps' pattern.
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let root = URL(fileURLWithPath: CommandLine.arguments[0]).deletingLastPathComponent().deletingLastPathComponent()
let images = root.appendingPathComponent("assets/images")
let iconAssets = root.appendingPathComponent("assets/expo.icon/Assets")
let space = CGColorSpace(name: CGColorSpace.sRGB)!

func rgb(_ hex: UInt32, _ a: CGFloat = 1) -> CGColor {
  CGColor(colorSpace: space, components: [CGFloat((hex >> 16) & 255) / 255, CGFloat((hex >> 8) & 255) / 255, CGFloat(hex & 255) / 255, a])!
}

enum Look { case colour, mono }

/// New square canvas with a top-left origin. `opaque` = no alpha channel (the iOS store icon must have none).
func canvas(_ size: Int, opaque: Bool = false) -> CGContext {
  let info = opaque ? CGImageAlphaInfo.noneSkipLast.rawValue : CGImageAlphaInfo.premultipliedLast.rawValue
  let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0, space: space, bitmapInfo: info)!
  ctx.translateBy(x: 0, y: CGFloat(size))
  ctx.scaleBy(x: 1, y: -1)
  return ctx
}

func save(_ ctx: CGContext, _ url: URL) {
  let image = ctx.makeImage()!
  let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
  CGImageDestinationAddImage(dest, image, nil)
  guard CGImageDestinationFinalize(dest) else { fatalError("could not write \(url.path)") }
  print("wrote \(url.path.replacingOccurrences(of: root.path + "/", with: ""))")
}

func resized(_ ctx: CGContext, to size: Int) -> CGContext {
  let out = canvas(size)
  out.interpolationQuality = .high
  out.translateBy(x: 0, y: CGFloat(size))
  out.scaleBy(x: 1, y: -1)
  out.draw(ctx.makeImage()!, in: CGRect(x: 0, y: 0, width: size, height: size))
  return out
}

func background(_ ctx: CGContext, _ size: CGFloat) {
  let gradient = CGGradient(colorsSpace: space, colors: [rgb(0x0A5FC4), rgb(0x3D98F5)] as CFArray, locations: [0, 1])!
  ctx.drawLinearGradient(gradient, start: CGPoint(x: 0, y: 0), end: CGPoint(x: size, y: size), options: [])
}

func roundedRect(_ r: CGRect, _ radius: CGFloat) -> CGPath { CGPath(roundedRect: r, cornerWidth: radius, cornerHeight: radius, transform: nil) }

/// The price-tag glyph: a tag pointing to the upper left, a hole near the tip, two price bars and a green "down" arrow.
/// Drawn around the canvas centre; `fraction` = share of the canvas the glyph's longer side may use.
func glyph(_ ctx: CGContext, canvasSize: CGFloat, fraction: CGFloat, _ look: Look) {
  ctx.saveGState()
  ctx.translateBy(x: canvasSize / 2, y: canvasSize / 2)
  let scale = canvasSize * fraction / 700
  ctx.scaleBy(x: scale, y: scale)
  ctx.rotate(by: 35 * .pi / 180)

  // Tag body in a local space centred at (0, 0): tip at the left.
  let tag = CGMutablePath()
  tag.move(to: CGPoint(x: -300, y: 0))
  tag.addLine(to: CGPoint(x: -150, y: -190))
  tag.addLine(to: CGPoint(x: 280, y: -190))
  tag.addLine(to: CGPoint(x: 280, y: 190))
  tag.addLine(to: CGPoint(x: -150, y: 190))
  tag.closeSubpath()
  let hole = CGRect(x: -222, y: -42, width: 84, height: 84)
  let bar1 = roundedRect(CGRect(x: -80, y: -100, width: 250, height: 52), 26)
  let bar2 = roundedRect(CGRect(x: -80, y: 8, width: 160, height: 52), 26)
  let arrow = CGMutablePath()
  arrow.move(to: CGPoint(x: 150, y: 58))
  arrow.addLine(to: CGPoint(x: 150, y: 128))
  arrow.move(to: CGPoint(x: 112, y: 92))
  arrow.addLine(to: CGPoint(x: 150, y: 132))
  arrow.addLine(to: CGPoint(x: 188, y: 92))

  func fillTag(_ colour: CGColor) {
    ctx.setFillColor(colour)
    ctx.setStrokeColor(colour)
    ctx.setLineWidth(60)
    ctx.setLineJoin(.round)
    ctx.addPath(tag)
    ctx.drawPath(using: .fillStroke)  // the stroke rounds every corner
  }

  if look == .colour {
    ctx.saveGState()
    ctx.setShadow(offset: CGSize(width: 0, height: 22), blur: 40, color: rgb(0x00234D, 0.4))
    fillTag(rgb(0xFFFFFF))
    ctx.restoreGState()
    fillTag(rgb(0xFFFFFF))
    ctx.setFillColor(rgb(0x1B78DD))
    ctx.fillEllipse(in: hole)
    ctx.setFillColor(rgb(0xB7D6FA))
    ctx.addPath(bar1)
    ctx.fillPath()
    ctx.setFillColor(rgb(0xB7D6FA))
    ctx.addPath(bar2)
    ctx.fillPath()
    ctx.addPath(arrow)
    ctx.setStrokeColor(rgb(0x1E8E3E))
    ctx.setLineWidth(34)
    ctx.setLineCap(.round)
    ctx.setLineJoin(.round)
    ctx.strokePath()
  } else {
    fillTag(rgb(0xFFFFFF))
    ctx.setBlendMode(.clear)
    ctx.fillEllipse(in: hole)
    ctx.addPath(bar1)
    ctx.fillPath()
    ctx.addPath(bar2)
    ctx.fillPath()
    ctx.addPath(arrow)
    ctx.setStrokeColor(rgb(0x000000))
    ctx.setLineWidth(34)
    ctx.setLineCap(.round)
    ctx.setLineJoin(.round)
    ctx.strokePath()
    ctx.setBlendMode(.normal)
  }
  ctx.restoreGState()
}

// iOS / store icon: opaque, full bleed (iOS rounds the corners itself).
do {
  let ctx = canvas(1024, opaque: true)
  background(ctx, 1024)
  glyph(ctx, canvasSize: 1024, fraction: 0.74, .colour)
  save(ctx, images.appendingPathComponent("icon.png"))
  save(resized(ctx, to: 48), images.appendingPathComponent("favicon.png"))
}

// Android adaptive layers (108 dp canvas, 66 % safe zone; v1.1 REVIEW_V1 N6: 0.50 so the shadow clears a circular mask too): foreground = glyph inside the safe zone, background = gradient, monochrome = silhouette.
do {
  let fg = canvas(1024)
  glyph(fg, canvasSize: 1024, fraction: 0.50, .colour)
  save(fg, images.appendingPathComponent("android-icon-foreground.png"))
  let bg = canvas(1024, opaque: true)
  background(bg, 1024)
  save(bg, images.appendingPathComponent("android-icon-background.png"))
  let mono = canvas(1024)
  glyph(mono, canvasSize: 1024, fraction: 0.50, .mono)
  save(mono, images.appendingPathComponent("android-icon-monochrome.png"))
}

// Splash: the glyph alone, transparent (the splash colour is the gradient's middle blue, set in app.config.ts).
do {
  let ctx = canvas(1024)
  glyph(ctx, canvasSize: 1024, fraction: 0.9, .colour)
  save(ctx, images.appendingPathComponent("splash-icon.png"))
}

// iOS Icon Composer bundle: one transparent glyph layer over the bundle's own gradient fill.
do {
  let ctx = canvas(1024)
  glyph(ctx, canvasSize: 1024, fraction: 0.74, .colour)
  save(ctx, iconAssets.appendingPathComponent("glyph.png"))
}
