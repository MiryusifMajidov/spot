package expo.modules.spotvideocompress

import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.Presentation
import androidx.media3.transformer.Composition
import androidx.media3.transformer.DefaultEncoderFactory
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.Effects
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.Transformer
import androidx.media3.transformer.VideoEncoderSettings
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

/**
 * Re-encodes a picked or recorded clip to H.264 with its short side at most
 * `shortSide` px, before it is uploaded.
 *
 * A phone camera records 1080p or 4K at 15–50 Mbit/s: a 60-second technique
 * clip is 100–300 MB, which is a long upload on mobile data, a full download for
 * every viewer, and most of a free plan's monthly egress. 720p at ~2.5 Mbit/s is
 * about 20 MB for the same minute and still shows the bar path and the joints.
 * iOS does the same inside the picker (`videoExportPreset`); Android's picker has
 * no such option, hence this module — Android only.
 *
 * Media3 Transformer (the same Media3 release expo-video plays with) runs the
 * hardware encoder. It has to be driven from a thread with a Looper, so the
 * function runs on the main queue; the work itself happens on Transformer's own
 * threads and the listener reports back on the main thread.
 */
@OptIn(UnstableApi::class)
class SpotVideoCompressModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SpotVideoCompress")

    AsyncFunction("compressAsync") { uri: String, shortSide: Int, bitrate: Int, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.reject("E_NO_CONTEXT", "No Android context", null)
        return@AsyncFunction
      }
      val dir = File(context.cacheDir, "spot-video").apply { mkdirs() }
      val out = File(dir, "clip-${System.currentTimeMillis()}.mp4")

      val transformer = Transformer.Builder(context)
        .setVideoMimeType(MimeTypes.VIDEO_H264)
        .setAudioMimeType(MimeTypes.AUDIO_AAC)
        .setEncoderFactory(
          DefaultEncoderFactory.Builder(context)
            .setRequestedVideoEncoderSettings(
              VideoEncoderSettings.Builder().setBitrate(bitrate).build()
            )
            .build()
        )
        .addListener(object : Transformer.Listener {
          override fun onCompleted(composition: Composition, exportResult: ExportResult) {
            promise.resolve(
              mapOf(
                "uri" to Uri.fromFile(out).toString(),
                "size" to out.length().toDouble()
              )
            )
          }

          override fun onError(
            composition: Composition,
            exportResult: ExportResult,
            exportException: ExportException
          ) {
            out.delete()
            promise.reject("E_COMPRESS", exportException.message ?: "Export failed", exportException)
          }
        })
        .build()

      // Upright frames are what the effect sees (Transformer applies the input's
      // rotation first), so «short side» is right for portrait and landscape alike.
      val item = EditedMediaItem.Builder(MediaItem.fromUri(Uri.parse(uri)))
        .setEffects(Effects(listOf(), listOf(Presentation.createForShortSide(shortSide))))
        .build()

      try {
        transformer.start(item, out.absolutePath)
      } catch (e: Exception) {
        out.delete()
        promise.reject("E_COMPRESS", e.message ?: "Could not start export", e)
      }
    }.runOnQueue(Queues.MAIN)
  }
}
