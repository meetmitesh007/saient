import CoreGraphics
import ExpoModulesCore
import Foundation
import UIKit

private final class InvalidSaientImageException: GenericException<String> {
  override var reason: String {
    param
  }
}

public final class SaientImageQualityModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SaientImageQuality")

    AsyncFunction("analyze") { (encoded: String) -> [String: Any] in
      try analyze(encoded)
    }
  }

  private func analyze(_ encoded: String) throws -> [String: Any] {
    let payload = encoded.split(separator: ",", maxSplits: 1).last.map(String.init) ?? encoded
    guard let data = Data(base64Encoded: payload, options: .ignoreUnknownCharacters),
          let image = UIImage(data: data),
          let cgImage = image.cgImage else {
      throw InvalidSaientImageException("The selected image could not be decoded.")
    }

    let originalWidth = cgImage.width
    let originalHeight = cgImage.height
    guard originalWidth > 0, originalHeight > 0 else {
      throw InvalidSaientImageException("The selected image has invalid dimensions.")
    }

    let scale = min(1.0, 192.0 / Double(max(originalWidth, originalHeight)))
    let width = max(1, Int(Double(originalWidth) * scale))
    let height = max(1, Int(Double(originalHeight) * scale))
    let bytesPerPixel = 4
    let bytesPerRow = width * bytesPerPixel
    var pixels = [UInt8](repeating: 0, count: height * bytesPerRow)
    let colorSpace = CGColorSpaceCreateDeviceRGB()
    let bitmapInfo = CGBitmapInfo.byteOrder32Big.rawValue | CGImageAlphaInfo.premultipliedLast.rawValue

    let rendered = pixels.withUnsafeMutableBytes { buffer -> Bool in
      guard let baseAddress = buffer.baseAddress,
            let context = CGContext(
              data: baseAddress,
              width: width,
              height: height,
              bitsPerComponent: 8,
              bytesPerRow: bytesPerRow,
              space: colorSpace,
              bitmapInfo: bitmapInfo
            ) else {
        return false
      }
      context.interpolationQuality = .medium
      context.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))
      return true
    }
    guard rendered else {
      throw InvalidSaientImageException("The selected image could not be analyzed.")
    }

    let pixelCount = width * height
    var luminance = [Int](repeating: 0, count: pixelCount)
    var sum = 0.0
    var sumSquares = 0.0
    var dark = 0
    var bright = 0
    for index in 0..<pixelCount {
      let offset = index * bytesPerPixel
      let red = Int(pixels[offset])
      let green = Int(pixels[offset + 1])
      let blue = Int(pixels[offset + 2])
      let value = (77 * red + 150 * green + 29 * blue) >> 8
      luminance[index] = value
      sum += Double(value)
      sumSquares += Double(value * value)
      if value < 32 { dark += 1 }
      if value > 242 { bright += 1 }
    }

    var edgeSum = 0.0
    var edgeCount = 0
    for y in 0..<height {
      for x in 0..<width {
        let index = y * width + x
        if x + 1 < width {
          edgeSum += Double(abs(luminance[index] - luminance[index + 1]))
          edgeCount += 1
        }
        if y + 1 < height {
          edgeSum += Double(abs(luminance[index] - luminance[index + width]))
          edgeCount += 1
        }
      }
    }

    let count = Double(pixelCount)
    let mean = sum / count
    let variance = max(0.0, sumSquares / count - mean * mean)
    return [
      "width": originalWidth,
      "height": originalHeight,
      "brightness": mean / 255.0,
      "contrast": sqrt(variance) / 255.0,
      "sharpness": edgeCount > 0 ? edgeSum / Double(edgeCount) / 255.0 : 0.0,
      "darkFraction": Double(dark) / count,
      "brightFraction": Double(bright) / count,
    ]
  }
}
