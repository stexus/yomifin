import ExpoModulesCore

public class MpvPlayerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MpvPlayer")

    // Defines event names that the module can send to JavaScript.
    Events("onChange")

    // Defines a JavaScript synchronous function that runs the native code on the JavaScript thread.
    Function("hello") {
      return "Hello from MPV Player! 👋"
    }

    // Defines a JavaScript function that always returns a Promise and whose native code
    // is by default dispatched on the different thread than the JavaScript runtime runs on.
    AsyncFunction("setValueAsync") { (value: String) in
      // Send an event to JavaScript.
      self.sendEvent("onChange", [
        "value": value
      ])
    }

    // Enables the module to be used as a native view. Definition components that are accepted as part of the
    // view definition: Prop, Events.
    View(MpvPlayerView.self) {
      // All video load options are passed via a single "source" prop
      Prop("source") { (view: MpvPlayerView, source: [String: Any]?) in
        guard let source = source,
              let urlString = source["url"] as? String,
              let videoURL = URL(string: urlString) else { return }

        // Parse cache config if provided
        let cacheConfig = source["cacheConfig"] as? [String: Any]

        let config = VideoLoadConfig(
          url: videoURL,
          headers: source["headers"] as? [String: String],
          externalSubtitles: source["externalSubtitles"] as? [String],
          startPosition: source["startPosition"] as? Double,
          autoplay: (source["autoplay"] as? Bool) ?? true,
          initialSubtitleId: source["initialSubtitleId"] as? Int,
          initialAudioId: source["initialAudioId"] as? Int,
          cacheEnabled: cacheConfig?["enabled"] as? String,
          cacheSeconds: cacheConfig?["cacheSeconds"] as? Int,
          demuxerMaxBytes: cacheConfig?["maxBytes"] as? Int,
          demuxerMaxBackBytes: cacheConfig?["maxBackBytes"] as? Int
        )

        view.loadVideo(config: config)
      }

      // Now Playing metadata for iOS Control Center and Lock Screen
      Prop("nowPlayingMetadata") { (view: MpvPlayerView, metadata: [String: Any]?) in
        guard let metadata = metadata else { return }
        // Convert Any values to String, filtering out nil/null values
        var stringMetadata: [String: String] = [:]
        for (key, value) in metadata {
          if let stringValue = value as? String {
            stringMetadata[key] = stringValue
          }
        }
        if !stringMetadata.isEmpty {
          view.setNowPlayingMetadata(stringMetadata)
        }
      }

      // Async function to play video
      AsyncFunction("play") { (view: MpvPlayerView) in
        view.play()
      }
      
      // Async function to pause video
      AsyncFunction("pause") { (view: MpvPlayerView) in
        view.pause()
      }
      
      // Async function to seek to position
      AsyncFunction("seekTo") { (view: MpvPlayerView, position: Double) in
        view.seekTo(position: position)
      }
      
      // Async function to seek by offset
      AsyncFunction("seekBy") { (view: MpvPlayerView, offset: Double) in
        view.seekBy(offset: offset)
      }
      
      // Async function to set playback speed
      AsyncFunction("setSpeed") { (view: MpvPlayerView, speed: Double) in
        view.setSpeed(speed: speed)
      }
      
      // Function to get current speed
      AsyncFunction("getSpeed") { (view: MpvPlayerView) -> Double in
        return view.getSpeed()
      }
      
      // Function to check if paused
      AsyncFunction("isPaused") { (view: MpvPlayerView) -> Bool in
        return view.isPaused()
      }
      
      // Function to get current position
      AsyncFunction("getCurrentPosition") { (view: MpvPlayerView) -> Double in
        return view.getCurrentPosition()
      }
      
      // Function to get duration
      AsyncFunction("getDuration") { (view: MpvPlayerView) -> Double in
        return view.getDuration()
      }

      // Picture in Picture functions
      AsyncFunction("startPictureInPicture") { (view: MpvPlayerView) in
        view.startPictureInPicture()
      }
      
      AsyncFunction("stopPictureInPicture") { (view: MpvPlayerView) in
        view.stopPictureInPicture()
      }
      
      AsyncFunction("isPictureInPictureSupported") { (view: MpvPlayerView) -> Bool in
        return view.isPictureInPictureSupported()
      }
      
      AsyncFunction("isPictureInPictureActive") { (view: MpvPlayerView) -> Bool in
        return view.isPictureInPictureActive()
      }
      
      // Subtitle functions
      AsyncFunction("getSubtitleTracks") { (view: MpvPlayerView) -> [[String: Any]] in
        return view.getSubtitleTracks()
      }
      
      AsyncFunction("setSubtitleTrack") { (view: MpvPlayerView, trackId: Int) in
        view.setSubtitleTrack(trackId)
      }
      
      AsyncFunction("disableSubtitles") { (view: MpvPlayerView) in
        view.disableSubtitles()
      }

      // YOMIFIN: hide native subtitle rendering without deselecting the track, so
      // sub-text keeps flowing for the tappable overlay (text subs only).
      AsyncFunction("setSubtitleVisibility") { (view: MpvPlayerView, visible: Bool) in
        view.setSubtitleVisibility(visible)
      }
      
      AsyncFunction("getCurrentSubtitleTrack") { (view: MpvPlayerView) -> Int in
        return view.getCurrentSubtitleTrack()
      }
      
      AsyncFunction("addSubtitleFile") { (view: MpvPlayerView, url: String, select: Bool) in
        view.addSubtitleFile(url: url, select: select)
      }

      // YOMIFIN Phase 5: prev/next subtitle cue navigation (mpv sub-seek).
      AsyncFunction("subSeek") { (view: MpvPlayerView, delta: Int) in
        view.subSeek(delta)
      }

      // YOMIFIN: subtitle timing offset in seconds (mpv sub-delay; online-sub sync).
      AsyncFunction("setSubtitleDelay") { (view: MpvPlayerView, seconds: Double) in
        view.setSubtitleDelay(seconds)
      }
      
      // Subtitle positioning functions
      AsyncFunction("setSubtitlePosition") { (view: MpvPlayerView, position: Int) in
        view.setSubtitlePosition(position)
      }
      
      AsyncFunction("setSubtitleScale") { (view: MpvPlayerView, scale: Double) in
        view.setSubtitleScale(scale)
      }
      
      AsyncFunction("setSubtitleMarginY") { (view: MpvPlayerView, margin: Int) in
        view.setSubtitleMarginY(margin)
      }
      
      AsyncFunction("setSubtitleAlignX") { (view: MpvPlayerView, alignment: String) in
        view.setSubtitleAlignX(alignment)
      }
      
      AsyncFunction("setSubtitleAlignY") { (view: MpvPlayerView, alignment: String) in
        view.setSubtitleAlignY(alignment)
      }
      
      AsyncFunction("setSubtitleFontSize") { (view: MpvPlayerView, size: Int) in
        view.setSubtitleFontSize(size)
      }

      AsyncFunction("setSubtitleBackgroundColor") { (view: MpvPlayerView, color: String) in
        view.setSubtitleBackgroundColor(color)
      }

      AsyncFunction("setSubtitleBorderStyle") { (view: MpvPlayerView, style: String) in
        view.setSubtitleBorderStyle(style)
      }

      AsyncFunction("setSubtitleAssOverride") { (view: MpvPlayerView, mode: String) in
        view.setSubtitleAssOverride(mode)
      }

      // Audio track functions
      AsyncFunction("getAudioTracks") { (view: MpvPlayerView) -> [[String: Any]] in
        return view.getAudioTracks()
      }
      
      AsyncFunction("setAudioTrack") { (view: MpvPlayerView, trackId: Int) in
        view.setAudioTrack(trackId)
      }
      
      AsyncFunction("getCurrentAudioTrack") { (view: MpvPlayerView) -> Int in
        return view.getCurrentAudioTrack()
      }

      // YOMIFIN Phase 4 (Anki media capture). On-device, MPVKit ffmpeg + SW render API.
      // Phase 8: the heavy work (throwaway-handle seek/decode/encode) is dispatched OFF
      // the main thread — view-taking AsyncFunctions run on main by default, which froze
      // the whole UI (spinner + playback) for the duration of a capture. The throwaway
      // handles never touch the view/layer, so a background queue is safe.
      // YOMIFIN: binary marker for the native two-finger-tap seam. Lets JS detect an
      // OLD binary (method missing → throws → false) and log "rebuild needed" instead
      // of the gesture silently not working.
      AsyncFunction("hasTwoFingerTapSeam") { (_: MpvPlayerView) -> Bool in
        return true
      }

      // Seam version history: 1 = plain window recognizer (could be killed by UIKit
      // recognizer-prevention when RNGH's double-tap activated); 2 = delegate allows
      // simultaneous recognition; 3 = window recognizer REMOVED — all taps (single/
      // double/two-finger) live in the dedicated YomifinGestureSurface view
      // (modules/gesture-surface) and onTwoFingerTap here never fires. Bump on every
      // behavior change so the Metro probe can prove which binary is on-device.
      AsyncFunction("twoFingerTapSeamVersion") { (_: MpvPlayerView) -> Int in
        return 3
      }

      // captureScreenshot(view, path, sourceUrl, pos) -> Bool : frame at `pos` (no subs/
      // OSD) to a JPG path. sourceUrl="" => use the playing URL (local/offline).
      AsyncFunction("captureScreenshot") { (view: MpvPlayerView, path: String, sourceUrl: String, pos: Double, promise: Promise) in
        DispatchQueue.global(qos: .userInitiated).async {
          do {
            let ok = try view.captureScreenshot(to: path, sourceUrl: sourceUrl, pos: pos)
            promise.resolve(ok)
          } catch {
            promise.reject(error)
          }
        }
      }
      // extractAudio(view, start, end, audioId, path, sourceUrl) -> Bool : AAC .m4a clip
      // of [start,end]. audioId<=0 = current track; sourceUrl="" => playing URL.
      AsyncFunction("extractAudio") { (view: MpvPlayerView, start: Double, end: Double, audioId: Int, path: String, sourceUrl: String, promise: Promise) in
        DispatchQueue.global(qos: .userInitiated).async {
          let ok = view.extractAudioClip(start: start, end: end, audioId: audioId, sourceUrl: sourceUrl, to: path)
          promise.resolve(ok)
        }
      }

      // Video scaling functions
      AsyncFunction("setZoomedToFill") { (view: MpvPlayerView, zoomed: Bool) in
        view.setZoomedToFill(zoomed)
      }

      AsyncFunction("isZoomedToFill") { (view: MpvPlayerView) -> Bool in
        return view.isZoomedToFill()
      }

      // Technical info function
      AsyncFunction("getTechnicalInfo") { (view: MpvPlayerView) -> [String: Any] in
        return view.getTechnicalInfo()
      }

      // Defines events that the view can send to JavaScript
      Events("onLoad", "onPlaybackStateChange", "onProgress", "onError", "onTracksReady", "onPictureInPictureChange", "onSubtitleText", "onTwoFingerTap")
    }
  }
}
