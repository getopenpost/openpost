package expo.modules.openpost.richcontent

import android.content.ClipDescription
import android.content.ContentResolver
import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import android.view.View
import androidx.core.view.ContentInfoCompat
import androidx.core.view.ViewCompat
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicLong

private const val MAX_IMAGE_BYTES = 50L * 1024L * 1024L
private val IMAGE_MIME_TYPES = arrayOf("image/*")

class OpenPostRichContentModule : Module() {
  private val copyExecutor = Executors.newSingleThreadExecutor()
  private val copySequence = AtomicLong(0)

  override fun definition() = ModuleDefinition {
    Name("OpenPostRichContent")
    Events("onImageReceived", "onImageError")

    AsyncFunction("registerTextInput") { viewTag: Int ->
      val view = appContext.findView<View>(viewTag) ?: return@AsyncFunction
      ViewCompat.setOnReceiveContentListener(view, IMAGE_MIME_TYPES) { _, payload ->
        receiveContent(viewTag, payload)
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("unregisterTextInput") { viewTag: Int ->
      val view = appContext.findView<View>(viewTag) ?: return@AsyncFunction
      ViewCompat.setOnReceiveContentListener(view, null, null)
    }.runOnQueue(Queues.MAIN)

    OnDestroy {
      copyExecutor.shutdownNow()
    }
  }

  private fun receiveContent(viewTag: Int, payload: ContentInfoCompat): ContentInfoCompat? {
    val partitioned = payload.partition { item ->
      val uri = item.uri ?: return@partition false
      imageMimeType(payload.getClip().getDescription(), uri) != null
    }
    val images = partitioned.first
    val remaining = partitioned.second

    if (images != null) {
      for (index in 0 until images.getClip().itemCount) {
        val uri = images.getClip().getItemAt(index).uri ?: continue
        val mimeType = imageMimeType(images.getClip().getDescription(), uri) ?: continue
        copyImage(viewTag, uri, mimeType, images)
      }
    }

    return remaining
  }

  private fun copyImage(
    viewTag: Int,
    uri: Uri,
    mimeType: String,
    permissionLease: ContentInfoCompat,
  ) {
    val context = appContext.reactContext ?: return
    val sequence = copySequence.incrementAndGet()
    copyExecutor.execute {
      val localId = "keyboard-$viewTag-$sequence"
      // Keep the payload alive until the asynchronous copy finishes. Android grants
      // URI access for the lifetime of this payload.
      permissionLease.getClip().itemCount
      val output = File(
        File(context.cacheDir, "openpost/rich-content").apply { mkdirs() },
        "$localId${extensionFor(mimeType)}",
      )

      try {
        val size = copyUri(context.contentResolver, uri, output)
        sendEvent(
          "onImageReceived",
          mapOf(
            "viewTag" to viewTag,
            "localId" to localId,
            "uri" to output.toURI().toString(),
            "mimeType" to mimeType,
            "filename" to displayName(context.contentResolver, uri, mimeType),
            "size" to size,
          ),
        )
      } catch (error: ImageTooLargeException) {
        output.delete()
        sendError(viewTag, "That image is too large to attach. Choose an image under 50 MB.")
      } catch (_: Exception) {
        output.delete()
        sendError(viewTag, "Could not read that image. Try copying it again.")
      }
    }
  }

  private fun copyUri(resolver: ContentResolver, uri: Uri, output: File): Long {
    var copied = 0L
    val input = resolver.openInputStream(uri) ?: throw IOException("Image content is unavailable")
    input.use { source ->
      FileOutputStream(output).use { destination ->
        val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
        while (true) {
          val read = source.read(buffer)
          if (read < 0) break
          copied += read
          if (copied > MAX_IMAGE_BYTES) throw ImageTooLargeException()
          destination.write(buffer, 0, read)
        }
      }
    }
    if (copied == 0L) throw IOException("Image content is empty")
    return copied
  }

  private fun imageMimeType(description: ClipDescription, uri: Uri): String? {
    val resolved = appContext.reactContext?.contentResolver?.getType(uri)
    if (resolved?.startsWith("image/") == true) return resolved
    for (index in 0 until description.mimeTypeCount) {
      val declared = description.getMimeType(index)
      if (declared.startsWith("image/")) {
        return if (declared == "image/*") "image/jpeg" else declared
      }
    }
    return null
  }

  private fun displayName(resolver: ContentResolver, uri: Uri, mimeType: String): String {
    resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
      if (cursor.moveToFirst()) {
        val name = cursor.getString(0)?.trim()?.substringAfterLast('/')
        if (!name.isNullOrEmpty()) return name
      }
    }
    return "keyboard-image${extensionFor(mimeType)}"
  }

  private fun extensionFor(mimeType: String): String {
    return MimeTypeMap.getSingleton().getExtensionFromMimeType(mimeType)?.let { ".${it}" } ?: ".jpg"
  }

  private fun sendError(viewTag: Int, message: String) {
    sendEvent("onImageError", mapOf("viewTag" to viewTag, "message" to message))
  }

  private class ImageTooLargeException : IOException()
}
