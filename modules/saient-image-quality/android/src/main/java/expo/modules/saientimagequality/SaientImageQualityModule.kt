package expo.modules.saientimagequality

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlin.math.max
import kotlin.math.sqrt

private class InvalidImageException(message: String) : CodedException(message)

class SaientImageQualityModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SaientImageQuality")

    AsyncFunction("analyze") { encoded: String ->
      analyze(encoded)
    }
  }

  private fun analyze(encoded: String): Map<String, Any> {
    val payload = encoded.substringAfter(',', encoded)
    val bytes = try {
      Base64.decode(payload, Base64.DEFAULT)
    } catch (_: IllegalArgumentException) {
      throw InvalidImageException("The selected image data is not valid base64.")
    }

    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
      throw InvalidImageException("The selected image could not be decoded.")
    }

    var sampleSize = 1
    while (bounds.outWidth / sampleSize > 320 || bounds.outHeight / sampleSize > 320) {
      sampleSize *= 2
    }
    val decoded = BitmapFactory.decodeByteArray(
      bytes,
      0,
      bytes.size,
      BitmapFactory.Options().apply {
        inSampleSize = sampleSize
        inPreferredConfig = Bitmap.Config.ARGB_8888
      },
    ) ?: throw InvalidImageException("The selected image could not be decoded.")

    val scale = minOf(1.0, 192.0 / max(decoded.width, decoded.height).toDouble())
    val sample = if (scale < 1.0) {
      Bitmap.createScaledBitmap(
        decoded,
        max(1, (decoded.width * scale).toInt()),
        max(1, (decoded.height * scale).toInt()),
        true,
      ).also { decoded.recycle() }
    } else {
      decoded
    }

    try {
      val width = sample.width
      val height = sample.height
      val pixels = IntArray(width * height)
      sample.getPixels(pixels, 0, width, 0, 0, width, height)
      val luminance = IntArray(pixels.size)
      var sum = 0.0
      var sumSquares = 0.0
      var dark = 0
      var bright = 0

      for (index in pixels.indices) {
        val color = pixels[index]
        val red = color shr 16 and 0xff
        val green = color shr 8 and 0xff
        val blue = color and 0xff
        val value = (77 * red + 150 * green + 29 * blue) shr 8
        luminance[index] = value
        sum += value
        sumSquares += value.toDouble() * value
        if (value < 32) dark++
        if (value > 242) bright++
      }

      var edgeSum = 0.0
      var edgeCount = 0
      for (y in 0 until height) {
        for (x in 0 until width) {
          val index = y * width + x
          if (x + 1 < width) {
            edgeSum += kotlin.math.abs(luminance[index] - luminance[index + 1])
            edgeCount++
          }
          if (y + 1 < height) {
            edgeSum += kotlin.math.abs(luminance[index] - luminance[index + width])
            edgeCount++
          }
        }
      }

      val count = pixels.size.toDouble()
      val mean = sum / count
      val variance = max(0.0, sumSquares / count - mean * mean)
      return mapOf(
        "width" to bounds.outWidth,
        "height" to bounds.outHeight,
        "brightness" to mean / 255.0,
        "contrast" to sqrt(variance) / 255.0,
        "sharpness" to if (edgeCount > 0) edgeSum / edgeCount / 255.0 else 0.0,
        "darkFraction" to dark / count,
        "brightFraction" to bright / count,
      )
    } finally {
      sample.recycle()
    }
  }
}
