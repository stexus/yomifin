Pod::Spec.new do |s|
  s.name           = 'OutlinedText'
  s.version        = '1.0.0'
  s.summary        = 'TextKit-stroked subtitle text with per-character tap hit-testing (yomifin)'
  s.description    = 'Crisp Infuse-style text outline (stroke behind fill) that React Native cannot express; used by the yomifin tappable subtitle overlay.'
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
