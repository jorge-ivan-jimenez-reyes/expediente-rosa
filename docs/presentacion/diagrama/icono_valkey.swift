import AppKit
// Ícono neutro para Valkey (diagrams.py no trae uno): nombre en un cuadro redondeado, sin imitar su logo.
let n = 256
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: n, pixelsHigh: n, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
NSColor(calibratedRed: 0.13, green: 0.16, blue: 0.24, alpha: 1).setFill()
NSBezierPath(roundedRect: NSRect(x: 8, y: 8, width: n - 16, height: n - 16), xRadius: 48, yRadius: 48).fill()
let t = NSAttributedString(string: "Valkey", attributes: [.font: NSFont.systemFont(ofSize: 58, weight: .bold), .foregroundColor: NSColor.white])
t.draw(at: NSPoint(x: (CGFloat(n) - t.size().width) / 2, y: (CGFloat(n) - t.size().height) / 2))
NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "valkey.png"))
