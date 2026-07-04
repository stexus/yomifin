Pod::Spec.new do |s|
  s.name           = 'GestureSurface'
  s.version        = '1.0.0'
  s.summary        = 'Unified native video gesture surface (yomifin)'
  s.description    = 'One UIKit tap-recognizer tree (single/double/two-finger) for the video player overlay'
  s.author         = 'yomifin'
  s.homepage       = 'https://github.com/streamyfin/streamyfin'
  s.platforms      = {
    :ios => '15.1',
    :tvos => '15.1'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_VERSION' => '5.9'
  }

  s.source_files = "*.{h,m,mm,swift}"
end
